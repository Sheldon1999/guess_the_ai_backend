// src/lib/warmup.js
import fs from "fs";
import path from "path";
import redis from "./redis.js";
import { images } from "./mongo.js";
import { fetchToDisk } from "./fetcher.js";
import { ensureImageMeta } from "./docCache.js";

const CACHE_DIR = process.env.CACHE_DIR || "./cache/orig";
const CONC = Math.max(Number(process.env.WARMER_CONCURRENCY || 8), 1);

function isHashName(name) {
  // filenames are the root-hash (e.g., 0xabc...); store only exact hash files.
  return /^0x[0-9a-z]+$/i.test(name);
}

export async function scanCacheDir() {
  await fs.promises.mkdir(CACHE_DIR, { recursive: true });
  const entries = await fs.promises.readdir(CACHE_DIR, { withFileTypes: true });
  const hashes = entries
    .filter((e) => e.isFile() && isHashName(e.name))
    .map((e) => e.name.toLowerCase());
  return hashes;
}

export async function enqueueIfMissing(hash) {
  const pos = await redis.lpos("ready:q", hash);
  if (pos === null) await redis.rpush("ready:q", hash);
}

export async function enqueueCached() {
  const cached = await scanCacheDir();
  let added = 0;
  for (const h of cached) {
    const pos = await redis.lpos("ready:q", h);
    if (pos === null) { await redis.rpush("ready:q", h); added++; }
  }
  return { cachedCount: cached.length, enqueued: added };
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
  // Use newest uploads first if available (requires uploader to write uploadedAt)
  const cursor = images.find({}).sort({ uploadedAt: -1, _id: -1 }).limit(limit);
  const list = [];
  for await (const doc of cursor) {
    if (doc?.hash && typeof doc.hash === "string") {
      list.push(doc.hash.toLowerCase());
      await ensureImageMeta(doc).catch(() => {});
    }
  }
  const total = list.length;
  const { ok, fail } = await pmap(list, async (hash, index) => {
    const filePath = path.join(CACHE_DIR, hash);
    const seq = index + 1;
    const prefix = `[warmup] hash:${hash} seq:${seq}/${total}`;
    console.log(`${prefix} trying`);
    let source = "cached";
    try {
      await fs.promises.access(filePath, fs.constants.R_OK);
    } catch {
      source = "fetched";
      try {
        console.log(`${prefix} not-on-disk -> fetch`);
        await fetchToDisk(hash, filePath); // HTTP or CLI + fallback
      } catch (fetchErr) {
        console.warn(`${prefix} fetch error:${fetchErr?.message || fetchErr}`);
        throw fetchErr;
      }
    }
    try {
      await enqueueIfMissing(hash);
    } catch (enqueueErr) {
      console.warn(`${prefix} enqueue error:${enqueueErr?.message || enqueueErr}`);
      throw enqueueErr;
    }
    console.log(`${prefix} success source:${source}`);
  });
  return { scanned: list.length, warmed: ok, failed: fail };
}

export async function ensureMinReady(target, mongoLimit) {
  const targetN = Math.max(Number(target || 0), 0);
  if (!targetN) return { ready: await redis.llen("ready:q"), done: false };

  const before = await redis.llen("ready:q");

  // First, enqueue whatever’s already on disk.
  const { enqueued } = await enqueueCached();
  let after = await redis.llen("ready:q");
  if (after >= targetN) return { ready: after, done: true, source: "cached", enqueued };

  // If still short and allowed, warm from Mongo/0g.
  const doWarm = String(process.env.STARTUP_WARM_FROM_MONGO || "true").toLowerCase() === "true";
  if (!doWarm) return { ready: after, done: false, source: "cached-only" };

  const limit = Number(process.env.STARTUP_WARM_LIMIT || mongoLimit || targetN * 2);
  const report = await warmFromMongo(limit);
  after = await redis.llen("ready:q");
  return { ready: after, done: after >= targetN, source: "mongo", report, before, enqueued };
}

// Boot-time warmer
export async function warmOnBoot() {
  const target = Number(process.env.CACHE_MIN_READY || 0);
  if (!target) return { skipped: true };
  return ensureMinReady(target);
}

// Optional periodic top-up (returns a stop function)
export async function startBackgroundTopup() {
  console.log("Backgroung topup started..");
  const periodSec = Number(process.env.PREFETCH_INTERVAL_SEC || 0);
  // const target = Number(process.env.PREFETCH_TARGET || 0);
  const perUserImages = Number(process.env.PER_USER_IMAGES) || 50;
  const activeUsers = await redis.scard("active:users");
  console.log("active users::", activeUsers);
  const multiplier = Math.max(10, activeUsers);
  const target = multiplier * perUserImages;
  if (!periodSec || !target) return () => { console.log("Background topup not running."); };
  const id = setInterval(async () => {
    try { const result = await ensureMinReady(target); console.log(`[topup] Success:`, result); } catch (e) { console.log("[topup] failed:"); }
  }, periodSec * 1000);
  return () => clearInterval(id);
}
