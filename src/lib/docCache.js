import redis from "./redis.js";
import { users, images } from "./mongo.js";
import { rankFromCorrect, titleFromStreak } from "./rank.js";

const LOAD_FROM_REDIS = String(process.env.LOAD_FROM_REDIS || "false").toLowerCase() === "true";
const KEY_PREFIX = "gta:mongodoc:";
const DIRTY_USERS_KEY = `${KEY_PREFIX}dirty-users`;
const REDIS_FLUSH_BATCH = Math.max(Number(process.env.REDIS_DATA_FLUSH_BATCH || 100), 1);

const userKey = (wallet) => `${KEY_PREFIX}user:${wallet}`;
const imageKey = (hash) => `${KEY_PREFIX}image:${hash}`;

const normalizeWallet = (w) => String(w || "").trim().toLowerCase();
const normalizeHash = (h) => String(h || "").trim().toLowerCase();
const nowIso = () => new Date().toISOString();

function safeParse(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function materializeUserDoc(doc) {
  if (!doc?.walletAddress) return null;
  const walletAddress = normalizeWallet(doc.walletAddress);
  const correctAnswers = Number(doc.correctAnswers) || 0;
  const currentStreak = Number(doc.currentStreak) || 0;
  const streak = Number(doc.streak) || 0;

  const lastUpdatedAt = doc.lastUpdatedAt
    ? new Date(doc.lastUpdatedAt).toISOString()
    : (doc.updatedAt instanceof Date ? doc.updatedAt.toISOString() : nowIso());
  const lastFlushedAt = doc.lastFlushedAt
    ? new Date(doc.lastFlushedAt).toISOString()
    : lastUpdatedAt;

  return {
    walletAddress,
    username: doc.username || `Player_${Date.now()}`,
    correctAnswers,
    currentStreak,
    streak,
    rank: doc.rank || rankFromCorrect(correctAnswers),
    dungeonTitle: doc.dungeonTitle || titleFromStreak(streak),
    lastUpdatedAt,
    lastFlushedAt,
  };
}

function materializeImageDoc(doc) {
  if (!doc?.hash || !doc?._id) return null;
  const label = typeof doc.label === "string" ? doc.label.toLowerCase() : "";
  return {
    hash: normalizeHash(doc.hash),
    imageId: String(doc._id),
    label,
  };
}

export const shouldLoadFromRedis = () => LOAD_FROM_REDIS;

export async function readUserFromRedis(wallet) {
  if (!LOAD_FROM_REDIS) return null;
  const cached = await redis.get(userKey(normalizeWallet(wallet)));
  return safeParse(cached);
}

export async function writeUserToRedis(doc, markDirty = false) {
  if (!doc || !doc.walletAddress) return null;
  const payload = materializeUserDoc(doc);
  if (LOAD_FROM_REDIS) {
    await redis.set(userKey(payload.walletAddress), JSON.stringify(payload));
    if (markDirty) await redis.sadd(DIRTY_USERS_KEY, payload.walletAddress);
  }
  return payload;
}

export async function fetchUserProfile(wallet) {
  const normWallet = normalizeWallet(wallet);
  if (!normWallet) return null;
  const cached = await readUserFromRedis(normWallet);
  if (cached) return cached;

  const doc = await users.findOne(
    { walletAddress: normWallet },
    {
      projection: {
        walletAddress: 1,
        username: 1,
        correctAnswers: 1,
        currentStreak: 1,
        streak: 1,
        rank: 1,
        dungeonTitle: 1,
        lastUpdatedAt: 1,
        lastFlushedAt: 1,
        updatedAt: 1,
      },
    }
  );
  if (!doc) return null;
  const materialized = materializeUserDoc(doc);
  if (LOAD_FROM_REDIS) {
    await redis.set(userKey(materialized.walletAddress), JSON.stringify(materialized));
  }
  return materialized;
}

export async function updateCachedUser(wallet, updater) {
  if (!LOAD_FROM_REDIS) return null;
  const normWallet = normalizeWallet(wallet);
  let doc = await fetchUserProfile(normWallet);
  if (!doc) return null;
  const updated = await updater({ ...doc });
  if (!updated) return doc;
  updated.walletAddress = normWallet;
  updated.lastUpdatedAt = nowIso();
  if (!updated.rank) updated.rank = rankFromCorrect(updated.correctAnswers);
  if (!updated.dungeonTitle) updated.dungeonTitle = titleFromStreak(updated.streak);
  await writeUserToRedis(updated, true);
  return updated;
}

export async function fetchImageMeta(hash) {
  const normHash = normalizeHash(hash);
  if (!normHash) return null;
  if (LOAD_FROM_REDIS) {
    const cached = safeParse(await redis.get(imageKey(normHash)));
    if (cached?.imageId && cached?.label) return cached;
  }
  const doc = await images.findOne(
    { hash: normHash },
    { projection: { _id: 1, hash: 1, label: 1 } }
  );
  if (!doc) return null;
  const materialized = materializeImageDoc(doc);
  if (LOAD_FROM_REDIS) {
    await redis.set(imageKey(normHash), JSON.stringify(materialized));
  }
  return materialized;
}

export async function ensureImageMeta(docOrHash) {
  if (!LOAD_FROM_REDIS) return null;
  if (!docOrHash) return null;
  if (typeof docOrHash === "string") {
    return fetchImageMeta(docOrHash);
  }
  const meta = materializeImageDoc(docOrHash);
  if (!meta) return null;
  await redis.set(imageKey(meta.hash), JSON.stringify(meta));
  return meta;
}

export async function hydrateRedisFromMongo() {
  if (!LOAD_FROM_REDIS) return { skipped: true };
  let usersSynced = 0;
  let imagesSynced = 0;

  const userCursor = users.find({}, {
    projection: {
      walletAddress: 1,
      username: 1,
      correctAnswers: 1,
      currentStreak: 1,
      streak: 1,
      rank: 1,
      dungeonTitle: 1,
      lastUpdatedAt: 1,
      lastFlushedAt: 1,
      updatedAt: 1,
    },
  });
  for await (const doc of userCursor) {
    const payload = materializeUserDoc(doc);
    await redis.set(userKey(payload.walletAddress), JSON.stringify(payload));
    usersSynced += 1;
  }

  const imageCursor = images.find({}, { projection: { _id: 1, hash: 1, label: 1 } });
  for await (const doc of imageCursor) {
    const payload = materializeImageDoc(doc);
    if (!payload) continue;
    await redis.set(imageKey(payload.hash), JSON.stringify(payload));
    imagesSynced += 1;
  }

  return { usersSynced, imagesSynced };
}

export async function queueUserFlush(wallet) {
  if (!LOAD_FROM_REDIS) return;
  const norm = normalizeWallet(wallet);
  if (!norm) return;
  await redis.sadd(DIRTY_USERS_KEY, norm);
}

export async function flushDirtyUsers(limit = REDIS_FLUSH_BATCH) {
  if (!LOAD_FROM_REDIS) return { flushed: 0, skipped: true };
  const members = await redis.smembers(DIRTY_USERS_KEY);
  if (!members.length) return { flushed: 0 };
  const batch = members.slice(0, limit);
  let flushed = 0;
  for (const wallet of batch) {
    const key = userKey(wallet);
    const snapshot = safeParse(await redis.get(key));
    if (!snapshot) {
      await redis.srem(DIRTY_USERS_KEY, wallet);
      continue;
    }
    const updatedAt = snapshot.lastUpdatedAt ? new Date(snapshot.lastUpdatedAt) : null;
    const flushedAt = snapshot.lastFlushedAt ? new Date(snapshot.lastFlushedAt) : null;
    if (updatedAt && flushedAt && flushedAt >= updatedAt) {
      await redis.srem(DIRTY_USERS_KEY, wallet);
      continue;
    }
    const payload = {
      username: snapshot.username,
      correctAnswers: snapshot.correctAnswers,
      currentStreak: snapshot.currentStreak,
      streak: snapshot.streak,
      rank: snapshot.rank,
      dungeonTitle: snapshot.dungeonTitle,
      lastUpdatedAt: snapshot.lastUpdatedAt,
      lastFlushedAt: nowIso(),
      updatedAt: new Date(snapshot.lastUpdatedAt || nowIso()),
    };
    await users.updateOne(
      { walletAddress: snapshot.walletAddress },
      { $set: payload },
      { upsert: true }
    );
    snapshot.lastFlushedAt = payload.lastFlushedAt;
    await redis.set(key, JSON.stringify(snapshot));
    await redis.srem(DIRTY_USERS_KEY, wallet);
    flushed += 1;
  }
  return { flushed };
}

export async function startRedisFlushWorker() {
  if (!LOAD_FROM_REDIS) return () => {};
  const intervalSec = Number(process.env.REDIS_DATA_FLUSH || 0);
  if (!intervalSec) return () => {};
  const timer = setInterval(() => {
    flushDirtyUsers().catch((err) => console.error("redis flush error:", err));
  }, intervalSec * 1000);
  return () => clearInterval(timer);
}
