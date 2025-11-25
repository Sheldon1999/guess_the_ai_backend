// src/lib/warmup.js
import { ObjectId } from "mongodb";
import redis from "./redis.js";
import { images } from "./mongo.js";
import { ensureImageMeta } from "./docCache.js";
import { READY_QUEUE_KEY, WARM_LAST_KEY } from "./redisKeys.js";

const CONC = Math.max(Number(process.env.WARMER_CONCURRENCY || 8), 1);

async function loadWarmCursor() {
  const raw = await redis.get(WARM_LAST_KEY);
  if (!raw) return null;
  try {
    return new ObjectId(raw);
  } catch {
    return null;
  }
}

async function saveWarmCursor(id) {
  if (!id) return;
  await redis.set(WARM_LAST_KEY, id.toString());
}

export async function appendIfMissing(hash) {
  const pos = await redis.lpos(READY_QUEUE_KEY, hash);
  if (pos === null) await redis.rpush(READY_QUEUE_KEY, hash);
}

async function pmap(items, fn, conc = CONC) {
  const total = items.length;
  if (!total) return { ok: 0, fail: 0 };

  let ok = 0;
  let fail = 0;
  let cursor = 0;

  const worker = async () => {
    while (true) {
      const index = cursor++;
      if (index >= total) break;
      const item = items[index];
      try {
        await fn(item, index);
        ok++;
      } catch {
        fail++;
      }
    }
  };

  const workers = Array.from({ length: Math.min(conc, total) }, worker);
  await Promise.all(workers);
  return { ok, fail };
}

export async function warmFromMongo(limit) {
  const lastId = await loadWarmCursor();
  const query = lastId ? { _id: { $gt: lastId } } : {};
  const cursor = images.find(query).sort({ _id: 1 }).limit(limit);
  const list = [];
  let newestId = lastId;
  for await (const doc of cursor) {
    if (doc?.hash && typeof doc.hash === "string") {
      list.push(doc.hash.toLowerCase());
      await ensureImageMeta(doc).catch(() => {});
      newestId = doc._id;
    }
  }
  const total = list.length;
  const { ok, fail } = await pmap(list, async (hash, index) => {
    const seq = index + 1;
    const prefix = `[warmup] hash:${hash}`;
    try {
      await appendIfMissing(hash);
    } catch (enqueueErr) {
      console.warn(`${prefix} enqueue error:${enqueueErr?.message || enqueueErr}`);
      throw enqueueErr;
    }
  });
  if (total > 0 && newestId) {
    await saveWarmCursor(newestId);
  }
  return { scanned: list.length, warmed: ok, failed: fail };
}

export async function runTopupFillRedis(target) {
  const report = await warmFromMongo(target);
  const after = await redis.llen(READY_QUEUE_KEY);
  return { ready: after, done: after >= target, source: "mongo", report };
}

// Boot-time warmer
export async function warmOnBoot() {
  const target = Number(process.env.CACHE_MIN_READY || 500);
  const before = await redis.llen(READY_QUEUE_KEY);
  if (before >= target) return { ready: before, done: true, message: "redis has enough" };
  return runTopupFillRedis(target-before)
}

// Optional periodic top-up (returns a stop function)
export async function startBackgroundTopup() {
  const periodSec = Number(process.env.PER_TOPUP_INTERVAL_SEC || 300);
  const pertopupTarget = Number(process.env.PER_TOPUP_TARGET) || 100;
  const id = setInterval(async () => {
    try { const result = await runTopupFillRedis(pertopupTarget); console.log("[topup] success: ", result); } catch (e) { console.log("[topup] failed: error: ", e); }
  }, periodSec * 1000);
  return () => clearInterval(id);
}
