import { randomUUID } from "node:crypto";
import { users } from "./mongo.js";
import redis from "./redis.js";
import { normalizeWallet as normalizeWalletUtil } from "../utils/normalize.js";
import { generatePlayerUsername } from "../utils/crypto.js";

const CANONICAL_USER_PROJECTION = {
  walletAddress: 1,
  walletAddressOriginal: 1,
  username: 1,
  correctAnswers: 1,
  currentStreak: 1,
  streak: 1,
  rank: 1,
  dungeonTitle: 1,
  nameUpdated: 1,
  createdAt: 1,
  updatedAt: 1,
  lastUpdatedAt: 1,
  lastFlushedAt: 1,
  privyMetaData: 1,
};
const USER_CREATE_LOCK_TTL_SEC = Math.max(Number(process.env.USER_CREATE_LOCK_TTL_SEC || 10), 1);
const USER_CREATE_LOCK_WAIT_MS = Math.max(Number(process.env.USER_CREATE_LOCK_WAIT_MS || 4000), 100);
const USER_CREATE_LOCK_POLL_MS = Math.max(Number(process.env.USER_CREATE_LOCK_POLL_MS || 50), 10);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const userCreateLockKey = (walletAddress) => `gta:user:create-lock:${walletAddress}`;

function normalizeWallet(walletAddress) {
  return normalizeWalletUtil(walletAddress) || "";
}

function mergeProjection(projection = null) {
  if (!projection) return CANONICAL_USER_PROJECTION;
  return { ...projection, ...CANONICAL_USER_PROJECTION };
}

function toTimestamp(value, fallback = -1) {
  if (!value) return fallback;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : fallback;
}

function candidateSortValue(doc) {
  return {
    nameUpdated: doc?.nameUpdated ? 1 : 0,
    correctAnswers: Number(doc?.correctAnswers) || 0,
    streak: Number(doc?.streak) || 0,
    currentStreak: Number(doc?.currentStreak) || 0,
    hasPrivyMeta: doc?.privyMetaData && typeof doc.privyMetaData === "object" ? 1 : 0,
    updatedAt: toTimestamp(doc?.updatedAt),
    lastUpdatedAt: toTimestamp(doc?.lastUpdatedAt),
    createdAt: toTimestamp(doc?.createdAt, Number.MAX_SAFE_INTEGER),
  };
}

function compareUserDocs(leftDoc, rightDoc) {
  const left = candidateSortValue(leftDoc);
  const right = candidateSortValue(rightDoc);

  if (right.nameUpdated !== left.nameUpdated) return right.nameUpdated - left.nameUpdated;
  if (right.correctAnswers !== left.correctAnswers) return right.correctAnswers - left.correctAnswers;
  if (right.streak !== left.streak) return right.streak - left.streak;
  if (right.currentStreak !== left.currentStreak) return right.currentStreak - left.currentStreak;
  if (right.hasPrivyMeta !== left.hasPrivyMeta) return right.hasPrivyMeta - left.hasPrivyMeta;
  if (right.updatedAt !== left.updatedAt) return right.updatedAt - left.updatedAt;
  if (right.lastUpdatedAt !== left.lastUpdatedAt) return right.lastUpdatedAt - left.lastUpdatedAt;
  if (left.createdAt !== right.createdAt) return left.createdAt - right.createdAt;
  return String(leftDoc?._id || "").localeCompare(String(rightDoc?._id || ""));
}

export function pickCanonicalUserDoc(docs = []) {
  if (!docs.length) return null;
  return [...docs].sort(compareUserDocs)[0];
}

export async function findUserDocsByWallet(walletAddress, options = {}) {
  const normalizedWallet = normalizeWallet(walletAddress);
  if (!normalizedWallet) return [];

  const cursor = users.find(
    { walletAddress: normalizedWallet },
    { projection: mergeProjection(options.projection) }
  );

  if (options.limit) cursor.limit(options.limit);
  return cursor.toArray();
}

export async function findCanonicalUserByWallet(walletAddress, options = {}) {
  const docs = await findUserDocsByWallet(walletAddress, options);
  if (!docs.length) return null;

  if (docs.length > 1) {
    console.warn("[userStore] duplicate wallet docs detected", {
      walletAddress: normalizeWallet(walletAddress),
      count: docs.length,
      canonicalId: String(pickCanonicalUserDoc(docs)?._id || ""),
      logLabel: options.logLabel || "",
    });
  }

  return pickCanonicalUserDoc(docs);
}

function buildPrivyMetaUpdate(existingMeta, incomingMeta) {
  if (!incomingMeta || typeof incomingMeta !== "object") return null;
  const merged = { ...(existingMeta || {}) };
  let changed = false;

  for (const [key, value] of Object.entries(incomingMeta)) {
    if (
      value !== undefined &&
      value !== null &&
      value !== "" &&
      merged[key] == null
    ) {
      merged[key] = value;
      changed = true;
    }
  }

  return changed ? merged : null;
}

async function acquireWalletCreateLock(walletAddress) {
  const lockKey = userCreateLockKey(walletAddress);
  const token = randomUUID();
  const deadline = Date.now() + USER_CREATE_LOCK_WAIT_MS;

  while (Date.now() <= deadline) {
    const result = await redis.set(lockKey, token, "EX", USER_CREATE_LOCK_TTL_SEC, "NX");
    if (result === "OK") {
      return { lockKey, token };
    }
    await sleep(USER_CREATE_LOCK_POLL_MS);
  }

  return null;
}

async function releaseWalletCreateLock(lock) {
  if (!lock) return;

  try {
    await redis.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      1,
      lock.lockKey,
      lock.token
    );
  } catch (error) {
    console.error("[userStore] failed to release wallet create lock", {
      lockKey: lock.lockKey,
      error,
    });
  }
}

export async function createOrGetUserByWallet({
  walletAddress,
  walletAddressOriginal,
  privyMetaData = null,
  now = new Date(),
  username = generatePlayerUsername(),
  logLabel = "",
} = {}) {
  const normalizedWallet = normalizeWallet(walletAddress);
  if (!normalizedWallet) {
    throw new Error("walletAddress is required");
  }

  const lock = await acquireWalletCreateLock(normalizedWallet);
  if (!lock) {
    const fallbackDocs = await findUserDocsByWallet(normalizedWallet, { logLabel });
    if (fallbackDocs.length) {
      return {
        userDoc: pickCanonicalUserDoc(fallbackDocs),
        created: false,
        duplicateWalletCount: fallbackDocs.length,
      };
    }
    throw new Error(`timed out acquiring user create lock for ${normalizedWallet}`);
  }

  try {
    const existingDocs = await findUserDocsByWallet(normalizedWallet, { logLabel });
    if (existingDocs.length) {
      const canonical = pickCanonicalUserDoc(existingDocs);
      const nextMeta = buildPrivyMetaUpdate(canonical?.privyMetaData, privyMetaData);
      const update = { updatedAt: now };

      if (!canonical?.walletAddressOriginal && walletAddressOriginal) {
        update.walletAddressOriginal = walletAddressOriginal;
      }
      if (nextMeta) {
        update.privyMetaData = nextMeta;
      }

      if (Object.keys(update).length) {
        await users.updateOne({ _id: canonical._id }, { $set: update });
      }

      return {
        userDoc: { ...canonical, ...update },
        created: false,
        duplicateWalletCount: existingDocs.length,
      };
    }

    const setOnInsert = {
      walletAddress: normalizedWallet,
      ...(walletAddressOriginal ? { walletAddressOriginal } : {}),
      correctAnswers: 0,
      currentStreak: 0,
      streak: 0,
      rank: "E",
      dungeonTitle: "Newbie",
      createdAt: now,
      username,
      nameUpdated: false,
      lastUpdatedAt: now,
      lastFlushedAt: now,
      ...(privyMetaData && typeof privyMetaData === "object" ? { privyMetaData } : {}),
    };

    await users.updateOne(
      { walletAddress: normalizedWallet },
      { $setOnInsert: setOnInsert, $set: { updatedAt: now } },
      { upsert: true }
    );

    const finalDocs = await findUserDocsByWallet(normalizedWallet, { logLabel });
    const canonical = pickCanonicalUserDoc(finalDocs);
    return {
      userDoc: canonical || setOnInsert,
      created: Boolean(canonical && String(canonical.username || "") === String(username)),
      duplicateWalletCount: finalDocs.length,
    };
  } finally {
    await releaseWalletCreateLock(lock);
  }
}
