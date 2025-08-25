import redis from "../lib/redis.js";
import { users, images, exposures } from "../lib/mongo.js";
import { rankFromCorrect, titleFromStreak } from "../lib/rank.js";
import { getTruthLabel } from "../lib/kv.js";
import { bumpAllTime, bumpWeekly } from "../lib/leaderboard.js";

const COOLDOWN_DAYS = Number(process.env.IMAGE_COOLDOWN_DAYS || 7);
const COOLDOWN_SECS = COOLDOWN_DAYS * 24 * 60 * 60;

const GLOBAL_DAYS = Number(process.env.IMAGE_GLOBAL_COOLDOWN_DAYS || 0);
const GLOBAL_SECS = GLOBAL_DAYS * 24 * 60 * 60;

const nowSec = () => Math.floor(Date.now() / 1000);

function normalizeWallet(w) {
  return String(w || "")
    .trim()
    .toLowerCase();
}
function normalizeGuess(g) {
  const v = String(g || "")
    .trim()
    .toLowerCase();
  return v === "ai" || v === "human" ? v : null;
}

async function withUserLock(userId, fn) {
  const key = `picklock:${userId}`;
  const ok = await redis.set(key, "1", "NX", "EX", 2);
  if (!ok) return { status: 429, body: { error: "try again" } };
  try {
    return await fn();
  } finally {
    await redis.del(key);
  }
}

async function isEligibleForUser(userId, imageId) {
  const cutoff = nowSec() - COOLDOWN_SECS;
  const score = await redis.zscore(`recent:${userId}`, String(imageId));
  if (!score) return true;
  return Number(score) < cutoff;
}

async function isEligibleGlobal(imageId) {
  if (GLOBAL_SECS <= 0) return true;
  const cutoff = nowSec() - GLOBAL_SECS;
  const score = await redis.zscore("recent:global", String(imageId));
  if (!score) return true;
  return Number(score) < cutoff;
}

async function recordExposure(userId, imageId, hash, extra = {}) {
  const ts = nowSec();
  await redis.zadd(`recent:${userId}`, ts, String(imageId));
  await redis.zremrangebyscore(`recent:${userId}`, 0, ts - COOLDOWN_SECS - 1);
  await exposures.insertOne({
    userId,
    imageId,
    hash,
    shownAt: new Date(ts * 1000),
    ...extra,
  });
}

async function recordGlobal(imageId) {
  if (GLOBAL_SECS <= 0) return;
  const ts = nowSec();
  await redis.zadd("recent:global", ts, String(imageId));
  await redis.zremrangebyscore("recent:global", 0, ts - GLOBAL_SECS - 1);
}

async function getOrCreateImageIdByHash(hash) {
  const existing = await images.findOne({ hash }, { projection: { _id: 1 } });
  if (existing?._id) return existing._id;
  const r = await images.findOneAndUpdate(
    { hash },
    { $set: { hash } },
    { upsert: true, returnDocument: "after" }
  );
  if (r?.value?._id) return r.value._id;
  const ins = await images.insertOne({ hash });
  return ins.insertedId;
}

export default function gameRoutes(app) {
  app.post("/game/next", async (req, res) => {
    const wallet = normalizeWallet(req.body?.walletAddress || req.body?.userId);
    if (!/^0x[0-9a-z]{40}$/.test(wallet))
      return res.status(400).json({ error: "walletAddress required" });

    const expiry = Number(process.env.ACTIVE_USER_EXPIRY_SEC) || 600;
    await redis.sadd("active:users", wallet);
    await redis.expire("active:users", expiry);

    const MAX_ATTEMPTS = 30;

     // Extracted function for image selection
    async function pickEligibleImage() {
      return withUserLock(wallet, async () => {
        for (let i = 0; i < MAX_ATTEMPTS; i++) {
          const hash = await redis.lpop("ready:q");
          if (!hash) return { status: 204, body: null };

          const imageId = await getOrCreateImageIdByHash(hash);
          const okUser = await isEligibleForUser(wallet, imageId);
          const okGlobal = await isEligibleGlobal(imageId);

          if (okUser && okGlobal) {
            await redis.rpush("ready:q", hash); // keep in rotation
            await recordExposure(wallet, imageId, hash);
            await recordGlobal(imageId);

            const expiresAt =
              GLOBAL_SECS > 0 ? new Date(Date.now() + GLOBAL_SECS * 1000) : null;
            await images.updateOne(
              { _id: imageId },
              { $set: { expiresAt, lastShownAt: new Date() } }
            );

            return {
              status: 200,
              body: {
                imageId: String(imageId),
                hash,
                url: `/img/h/${encodeURIComponent(hash)}`,
              },
            };
          } else {
            await redis.rpush("ready:q", hash);
          }
        }
        return { status: 204, body: null };
      });
    }

    // First attempt
    let result = await pickEligibleImage();

    // If no eligible image, clear user cooldowns and try again
    if (result.status === 204) {
      await redis.del(`recent:${wallet}`);
      result = await pickEligibleImage();
    }

    if (result.status === 200) return res.json(result.body);
    if (result.status === 204) return res.status(204).send();
    if (result.status === 429) return res.status(429).json(result.body);
    res.status(500).json({ error: "unexpected" });
  });

  app.post("/game/answer", async (req, res) => {
    const wallet = normalizeWallet(req.body?.walletAddress || req.body?.userId);
    const hash = String(req.body?.hash || "").trim();
    const guess = normalizeGuess(req.body?.guess);

    if (!/^0x[0-9a-z]{40}$/.test(wallet))
      return res.status(400).json({ error: "walletAddress required" });
    if (!hash) return res.status(400).json({ error: "hash required" });
    if (!guess)
      return res.status(400).json({ error: "guess must be 'ai' or 'human'" });

    const now = new Date();
    await users.updateOne(
      { _id: wallet },
      {
        $setOnInsert: {
          _id: wallet,
          username: wallet.slice(0, 8),
          correctAnswers: 0,
          currentStreak: 0,
          streak: 0,
          rank: "E",
          dungeonTitle: "Newbie",
          createdAt: now,
        },
        $set: { updatedAt: now },
      },
      { upsert: true }
    );

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

    const udoc = await users.findOne(
      { _id: wallet },
      { projection: { correctAnswers: 1, currentStreak: 1, streak: 1 } }
    );
    let correctAnswers = udoc?.correctAnswers || 0;
    let currentStreak = udoc?.currentStreak || 0;
    let streak = udoc?.streak || 0;

    if (correct) {
      correctAnswers += 1;
      currentStreak += 1;
      if (currentStreak > streak) streak = currentStreak;
    } else {
      currentStreak = 0;
    }

    const rank = rankFromCorrect(correctAnswers);
    const dungeonTitle = titleFromStreak(streak);

    await users.updateOne(
      { _id: wallet },
      {
        $set: {
          correctAnswers,
          currentStreak,
          streak,
          rank,
          dungeonTitle,
          updatedAt: new Date(),
        },
      }
    );

    // Leaderboards
    if (correct) {
      await Promise.all([
        bumpAllTime(wallet, 1),
        bumpWeekly(wallet, 1, new Date()),
      ]);
    }

    await recordExposure(wallet, imageId, hash, {
      answeredAt: new Date(),
      guess,
      truth,
      correct,
    });

    const profile = await users.findOne(
      { _id: wallet },
      {
        projection: {
          _id: 1,
          username: 1,
          correctAnswers: 1,
          currentStreak: 1,
          streak: 1,
          rank: 1,
          dungeonTitle: 1,
          updatedAt: 1,
        },
      }
    );

    res.json({ correct, truth, imageId: String(imageId), hash, profile });
  });
}
