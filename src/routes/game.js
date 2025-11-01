// src/routes/game
import { randomUUID } from "node:crypto";
import redis from "../lib/redis.js";
import { users, images } from "../lib/mongo.js";
import { getTruthLabel } from "../lib/kv.js";
import { rankSwitchExpression, titleSwitchExpression } from "../lib/rank.js";
import { protect } from '../middleware/jwt.js';
import { deriveSessionKey, recordGameEnd, recordGameStart } from "../lib/onchain/index.js";

const COOLDOWN_DAYS = Number(process.env.IMAGE_COOLDOWN_DAYS || 7);
const COOLDOWN_SECS = COOLDOWN_DAYS * 24 * 60 * 60;
const MAX_ATTEMPTS = Number(process.env.MAX_ATTEMPTS_FINDING_UNUSED_HAS || 30);
const IMAGES_LIST_SIZE = Number(process.env.IMAGES_LIST_SIZE || 10);
const SESSION_TTL_SEC = Math.max(Number(process.env.GAME_SESSION_TTL_SEC || 3600), 60);

const sessionKeyForWallet = (wallet) => `session:${wallet}`;

async function loadSession(wallet) {
  const raw = await redis.get(sessionKeyForWallet(wallet));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    console.warn("game: unable to parse session payload", error);
    return null;
  }
}

async function persistSession(wallet, session) {
  if (!session) return null;
  await redis.set(
    sessionKeyForWallet(wallet),
    JSON.stringify(session),
    "EX",
    SESSION_TTL_SEC
  );
  return session;
}

async function clearSession(wallet) {
  await redis.del(sessionKeyForWallet(wallet));
}

const nowSec = () => Math.floor(Date.now() / 1000);

function normalizeGuess(g) {
  const v = String(g || "")
    .trim()
    .toLowerCase();
  return v === "ai" || v === "human" ? v : null;
}

async function isEligibleForUser(userId, imageId) {
  const cutoff = nowSec() - COOLDOWN_SECS;
  const score = await redis.zscore(`recent:${userId}`, String(imageId));
  if (!score) return true;
  return Number(score) < cutoff;
}

async function recordExposure(userId, imageId) {
  const ts = nowSec();
  const key = `recent:${userId}`;

  await redis
    .multi()
    .zadd(key, ts, String(imageId))
    .expire(key, COOLDOWN_SECS)
    .exec();

  await redis.zremrangebyscore(key, 0, ts - COOLDOWN_SECS - 1);
}

async function getOrCreateImageIdByHash(hash) {
  const existing = await images.findOne({ hash }, { projection: { _id: 1 } });
  if (existing?._id) return existing._id;
}

async function pickEligibleImage(wallet, mode="single") {
  let image_hashes = [];
  if(mode === "list"){
    console.log("picking eligible images");
  } else {
    console.log('picking eligible image');
  }
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const hash = await redis.lpop("ready:q");
    if (!hash) {
      continue;
    }
    const imageId = await getOrCreateImageIdByHash(hash);
    const okUser = await isEligibleForUser(wallet, imageId);
    if (okUser) {
      await redis.rpush("ready:q", hash); // keep in rotation
      await recordExposure(wallet, imageId);

      if(mode === "list"){
        if (image_hashes.length < IMAGES_LIST_SIZE) {
          image_hashes.push({
            imageId: String(imageId),
            hash,
            url: `/api/img/h/${encodeURIComponent(hash)}`,
          });
        } else {
          return {
            status: 200,
            body: {
              image_list: image_hashes
            }
          }
        }
      } else {
        return {
          status: 200,
          body: {
            imageId: String(imageId),
            hash,
            url: `/api/img/h/${encodeURIComponent(hash)}`,
          },
        };
      }
    } else {
      await redis.rpush("ready:q", hash);
    }
  }

  return { status: 204, body: null };
}

export default function gameRoutes(app) {
  app.post(
    "/api/game/session/start",
    protect,
    async (req, res) => {
      try {
        const wallet = req.user.walletAddress;
        const forceNew = Boolean(req.body?.forceNew);
        let session = await loadSession(wallet);

        const shouldCreate = !session || forceNew;

        if (shouldCreate) {
          const now = new Date().toISOString();
          const providedId = String(req.body?.sessionId || "").trim();
          const sessionId = providedId || randomUUID();
          const sessionKey = deriveSessionKey(sessionId);

          session = {
            sessionId,
            sessionKey,
            startedAt: now,
            lastUpdatedAt: now,
            totalGuesses: 0,
            correctGuesses: 0
          };

          await persistSession(wallet, session);

          recordGameStart({ walletAddress: wallet, sessionKey })
            .then((result) => {
              if (result?.error) {
                console.error("onchain game start error:", result.error);
              }
            })
            .catch((error) =>
              console.error("onchain game start exception:", error)
            );
        } else {
          session.lastUpdatedAt = new Date().toISOString();
          await persistSession(wallet, session);
        }

        return res.json({
          success: true,
          data: {
            sessionId: session.sessionId,
            startedAt: session.startedAt,
            totalGuesses: session.totalGuesses || 0,
            correctGuesses: session.correctGuesses || 0
          }
        });
      } catch (error) {
        console.error("game/session/start error:", error);
        return res.status(500).json({ success: false, message: "internal error" });
      }
    }
  );

  app.post(
    "/api/game/session/end",
    protect,
    async (req, res) => {
      try {
        const wallet = req.user.walletAddress;
        const providedId = String(req.body?.sessionId || "").trim();
        const completed =
          typeof req.body?.completed === "boolean" ? req.body.completed : true;

        const session = await loadSession(wallet);
        if (!session) {
          return res.status(404).json({ success: false, message: "no active session" });
        }

        if (providedId && session.sessionId !== providedId) {
          return res.status(409).json({ success: false, message: "session mismatch" });
        }

        await clearSession(wallet);

        const userDoc = await users.findOne(
          { walletAddress: wallet },
          { projection: { correctAnswers: 1, currentStreak: 1 } }
        );

        const totalCorrect = userDoc?.correctAnswers ?? 0;
        const currentStreak = userDoc?.currentStreak ?? 0;

        const onchainResult = await recordGameEnd({
          walletAddress: wallet,
          sessionKey: session.sessionKey,
          completed,
          totalCorrect,
          currentStreak
        });

        return res.json({
          success: true,
          data: {
            sessionId: session.sessionId,
            startedAt: session.startedAt,
            totalGuesses: session.totalGuesses || 0,
            correctGuesses: session.correctGuesses || 0,
            totals: {
              correctAnswers: totalCorrect,
              currentStreak
            },
            onchain: onchainResult?.hash
              ? { transactionHash: onchainResult.hash }
              : null
          }
        });
      } catch (error) {
        console.error("game/session/end error:", error);
        return res.status(500).json({ success: false, message: "internal error" });
      }
    }
  );

  app.post(
    "/api/game/next",
    protect,
    async (req, res) => {
      try {
        const wallet = req.user._id;

        const expiry = Number(process.env.ACTIVE_USER_EXPIRY_SEC) || 600;
        await redis.sadd("active:users", wallet);
        await redis.expire("active:users", expiry);

        let result = await pickEligibleImage(wallet);

        if (result.status === 204) {
          console.log("could not find elligible image so deleting redis cache..");
          await redis.del(`recent:${wallet}`);
          result = await pickEligibleImage(wallet);
        }

        if (result.status === 200) return res.json(result.body);
        if (result.status === 204) return res.status(204).send();
        if (result.status === 429) return res.status(429).json(result.body);
        return res.status(500).json({ error: "unexpected error: next image" });
      } catch (error) {
        console.error("game/next error:", error);
        return res.status(500).json({ error: "internal server error" });
      }
    }
  );

  app.get(
    "/api/game/next10",
    protect,
    async(req, res) => {
      try {
        const wallet = req.user._id;

        const expiry = Number(process.env.ACTIVE_USER_EXPIRY_SEC) || 600;
        await redis.sadd("active:users", wallet);
        await redis.expire("active:users", expiry);

        let result = await pickEligibleImage(wallet, "list");

        if (result.status === 204) {
          console.log("could not find elligible image so deleting redis cache..");
          await redis.del(`recent:${wallet}`);
          result = await pickEligibleImage(wallet, "list");
        }

        if (result.status === 200) return res.json(result.body);
        if (result.status === 204) return res.status(204).send();
        if (result.status === 429) return res.status(429).json(result.body);
        return res.status(500).json({ error: "unexpected error: next10" });
      } catch (error) {
        console.error("game/next10 error:", error);
        return res.status(500).json({ error: "internal server error" });
      }
    }
  );

  app.post(
    "/api/game/answer",
    protect,
    async (req, res) => {
      try {
        const wallet = req.user.walletAddress;
        const hash = String(req.body?.hash || "").trim();
        const guess = normalizeGuess(req.body?.guess);
        const sessionId = String(req.body?.sessionId || "").trim();

        if (!hash) return res.status(400).json({ error: "hash required" });
        if (!guess) {
          return res.status(400).json({ error: "guess must be 'ai' or 'human'" });
        }

        const now = new Date();

        const imageId = await getOrCreateImageIdByHash(hash);

        let truth;
        try {
          truth = await getTruthLabel(hash);
        } catch (e) {
          return res
            .status(502)
            .json({ error: "label unavailable", detail: e.message });
        }

        const correct = guess === truth;

        const session = await loadSession(wallet);
        if (session && (!sessionId || session.sessionId === sessionId)) {
          session.totalGuesses = (session.totalGuesses || 0) + 1;
          if (correct) {
            session.correctGuesses = (session.correctGuesses || 0) + 1;
          }
          session.lastUpdatedAt = now.toISOString();
          await persistSession(wallet, session);
        }

        const baseCorrectAnswers = { $ifNull: ["$correctAnswers", 0] };
        const baseCurrentStreak = { $ifNull: ["$currentStreak", 0] };
        const baseStreak = { $ifNull: ["$streak", 0] };

        const updatedCorrectAnswers = correct
          ? { $add: [baseCorrectAnswers, 1] }
          : baseCorrectAnswers;
        const updatedCurrentStreak = correct
          ? { $add: [baseCurrentStreak, 1] }
          : 0;
        const computedStreak = correct
          ? {
            $cond: [
              { $gt: ["$currentStreak", baseStreak] },
              "$currentStreak",
              baseStreak,
            ],
          }
          : baseStreak;

        const rankExpression = rankSwitchExpression("$correctAnswers");
        const dungeonTitleExpression = titleSwitchExpression(computedStreak);

        const profileResult = await users.findOneAndUpdate(
          { walletAddress: wallet },
          [
            {
              $set: {
                correctAnswers: updatedCorrectAnswers,
                currentStreak: updatedCurrentStreak,
              },
            },
            {
              $set: {
                streak: computedStreak,
                rank: rankExpression,
                dungeonTitle: dungeonTitleExpression,
                updatedAt: now,
              },
            },
          ],
          {
            returnDocument: "after",
            projection: {
              username: 1,
              correctAnswers: 1,
              currentStreak: 1,
              streak: 1,
              rank: 1,
              dungeonTitle: 1,
            },
          }
        );

        const profile = profileResult || null;

        return res.json({ correct, truth, imageId: String(imageId), hash, profile });
      } catch (error) {
        console.error("game/answer error:", error);
        return res.status(500).json({ error: "internal server error" });
      }
    }
  );
}
