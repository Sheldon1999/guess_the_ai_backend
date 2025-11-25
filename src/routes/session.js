// src/routes/session
import { randomUUID } from "node:crypto";
import redis from "../lib/redis.js";
import { users } from "../lib/mongo.js";
import { protect } from '../middleware/jwt.js';
import { deriveSessionKey, recordGameEnd, recordGameStart } from "../lib/onchain/index.js";
import {
  sessionKey,
  SESSION_TTL_SEC,
} from "../lib/redisKeys.js";

const sessionKeyForWallet = (wallet) => sessionKey(wallet);

export async function loadSession(wallet) {
  const raw = await redis.get(sessionKeyForWallet(wallet));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    console.warn("game: unable to parse session payload", error);
    return null;
  }
}

export async function persistSession(wallet, session) {
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

export function normalizeGuess(g) {
  const v = String(g || "")
    .trim()
    .toLowerCase();
  return v === "ai" || v === "human" ? v : null;
}

export default function sessionRoutes(app) {
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
}
