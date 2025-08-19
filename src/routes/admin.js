import fs from "fs";
import path from "path";
import redis from "../lib/redis.js";
import { images, labels } from "../lib/mongo.js";
import { fetchToDisk } from "../lib/fetcher.js";
import { scanCacheDir } from "../lib/warmup.js";

const CACHE_DIR = process.env.CACHE_DIR || "./cache/orig";

async function ensureOnDisk(hash) {
  const filePath = path.join(CACHE_DIR, hash);
  try {
    await fs.promises.access(filePath, fs.constants.R_OK);
    return { filePath, existed: true, mode: "CACHE" };
  } catch (_) {}
  const { existed, mode } = await fetchToDisk(hash, filePath);
  return { filePath, existed, mode };
}

export default function adminRoutes(app) {
  app.post("/admin/topup", async (req, res) => {
    const hashes = Array.isArray(req.body?.hashes) ? req.body.hashes : [];
    if (!hashes.length)
      return res.status(400).json({ error: "hashes[] required" });

    const results = [];
    for (const hash of hashes) {
      try {
        const { existed, mode } = await ensureOnDisk(hash);
        const pos = await redis.lpos("ready:q", hash);
        if (pos === null) await redis.rpush("ready:q", hash);
        results.push({ hash, ok: true, existed, queued: pos === null, mode });
      } catch (e) {
        results.push({ hash, ok: false, error: e.message });
      }
    }
    const queueLen = await redis.llen("ready:q");
    res.json({ queueLen, results });
  });

  app.post("/admin/topup/new", async (req, res) => {
    const limit = Number(req.body?.limit || process.env.TOPUP_NEW_LIMIT || 500);
    const cursor = images
      .find({ uploadedAt: { $exists: true } })
      .sort({ uploadedAt: -1 })
      .limit(limit);

    const results = [];
    for await (const doc of cursor) {
      const hash = doc.hash;
      try {
        const filePath = path.join(CACHE_DIR, hash);
        const { existed, mode } = await fetchToDisk(hash, filePath);
        const pos = await redis.lpos("ready:q", hash);
        if (pos === null) await redis.rpush("ready:q", hash);
        results.push({
          hash,
          ok: true,
          queued: pos === null,
          existed,
          mode,
          uploadedAt: doc.uploadedAt,
        });
      } catch (e) {
        results.push({ hash, ok: false, error: e.message });
      }
    }
    const queueLen = await redis.llen("ready:q");
    res.json({ queueLen, count: results.length, results });
  });

  app.get("/admin/queue", async (_req, res) => {
    const length = await redis.llen("ready:q");
    const head = await redis.lrange("ready:q", 0, 9);
    res.json({ length, head });
  });

  app.get("/admin/recent/:userId", async (req, res) => {
    const userId = req.params.userId;
    const items = await redis.zrevrange(`recent:${userId}`, 0, 9, "WITHSCORES");
    const out = [];
    for (let i = 0; i < items.length; i += 2) {
      const imageId = items[i];
      const ts = Number(items[i + 1]) * 1000;
      out.push({ imageId, seenAt: new Date(ts).toISOString() });
    }
    res.json({ userId, recent: out });
  });

  app.get("/admin/recent-global", async (_req, res) => {
    const GLOBAL_SECS =
      Number(process.env.IMAGE_GLOBAL_COOLDOWN_DAYS || 0) * 24 * 3600;
    const items = await redis.zrevrange("recent:global", 0, 49, "WITHSCORES");
    const out = [];
    for (let i = 0; i < items.length; i += 2) {
      const imageId = items[i];
      const tsSec = Number(items[i + 1]);
      const expiresAt =
        GLOBAL_SECS > 0
          ? new Date((tsSec + GLOBAL_SECS) * 1000).toISOString()
          : null;
      out.push({
        imageId,
        lastShownAt: new Date(tsSec * 1000).toISOString(),
        expiresAt,
      });
    }
    res.json({ recent: out });
  });

  app.post("/admin/label", async (req, res) => {
    const hash = String(req.body?.hash || "")
      .trim()
      .toLowerCase();
    const label = String(req.body?.label || "")
      .trim()
      .toLowerCase();
    if (!/^0x[0-9a-f]+$/.test(hash))
      return res.status(400).json({ error: "invalid hash" });
    if (label !== "ai" && label !== "human")
      return res.status(400).json({ error: "label must be 'ai' or 'human'" });
    await labels.updateOne(
      { hash },
      { $set: { hash, label } },
      { upsert: true }
    );
    res.json({ ok: true });
  });

  app.post("/admin/labels", async (req, res) => {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length)
      return res.status(400).json({ error: "items[] required" });
    const ops = [];
    for (const it of items) {
      const hash = String(it?.hash || "")
        .trim()
        .toLowerCase();
      const label = String(it?.label || "")
        .trim()
        .toLowerCase();
      if (!/^0x[0-9a-f]+$/.test(hash)) continue;
      if (label !== "ai" && label !== "human") continue;
      ops.push({
        updateOne: {
          filter: { hash },
          update: { $set: { hash, label } },
          upsert: true,
        },
      });
    }
    if (!ops.length) return res.status(400).json({ error: "no valid items" });
    const r = await labels.bulkWrite(ops, { ordered: false });
    res.json({
      ok: true,
      upserted: r.upsertedCount ?? 0,
      modified: r.modifiedCount ?? 0,
    });
  });

  app.get("/admin/cache/stats", async (_req, res) => {
    const files = await scanCacheDir();
    const ready = await redis.llen("ready:q");
    res.json({
      cacheDir: CACHE_DIR,
      diskFiles: files.length,
      readyQueue: ready,
      minReadyTarget: Number(process.env.CACHE_MIN_READY || 0),
    });
  });
}
