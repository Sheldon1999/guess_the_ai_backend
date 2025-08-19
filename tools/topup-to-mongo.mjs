import fs from "fs";
import { MongoClient } from "mongodb";

// Usage: node tools/topup-to-mongo.mjs ./hashes.txt [batchSize]
const file = process.argv[2];
const batchSize = Number(process.argv[3] || 1000);

if (!file) {
  console.error("Usage: node tools/topup-to-mongo.mjs <hashes.txt> [batchSize]");
  process.exit(1);
}

const MONGO_URL = process.env.MONGO_URL || "mongodb://localhost:27017/guesstheai";
const client = new MongoClient(MONGO_URL);

function normalizeHash(h) {
  if (!h) return null;
  const s = String(h).trim().toLowerCase();
  const with0x = s.startsWith("0x") ? s : "0x" + s;
  return /^0x[0-9a-f]+$/.test(with0x) ? with0x : null;
}

function loadHashes(filePath) {
  const raw = fs.readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  const normalized = raw
    .map(normalizeHash)
    .filter(Boolean);

  const uniq = [...new Set(normalized)];
  console.log(`Loaded ${raw.length} lines → ${uniq.length} unique valid hashes`);
  return uniq;
}

async function upsertBatch(col, batch) {
  const now = new Date();
  const ops = batch.map((hash) => ({
    updateOne: {
      filter: { hash },
      update: {
        $setOnInsert: { hash, uploadedAt: now },
        // you can add defaults here later (e.g., label) without touching caller
      },
      upsert: true,
    },
  }));
  return col.bulkWrite(ops, { ordered: false });
}

(async () => {
  const hashes = loadHashes(file);

  try {
    await client.connect();
    const db = client.db(); // database derived from URL (guesstheai)
    const images = db.collection("images");

    // Ensure index (safe to run repeatedly)
    await images.createIndex({ hash: 1 }, { unique: true });
    await images.createIndex({ uploadedAt: -1 });

    let insertedOrUpserted = 0;
    let i = 0;

    while (i < hashes.length) {
      const batch = hashes.slice(i, i + batchSize);
      process.stdout.write(`Upserting ${i + 1}-${i + batch.length}… `);
      try {
        const r = await upsertBatch(images, batch);
        const upserts = (r.upsertedCount ?? 0);
        const mods = (r.modifiedCount ?? 0);
        // Note: modifiedCount is typically 0 here since we only setOnInsert.
        insertedOrUpserted += upserts;
        console.log(`ok (upserted:${upserts}, modified:${mods})`);
      } catch (e) {
        console.log(`ERROR: ${e.message}`);
      }
      i += batch.length;
    }

    console.log(`Done. insertedOrUpserted: ${insertedOrUpserted}`);
    console.log("Tip: start the server with CACHE_MIN_READY set, or call /admin/topup/new to warm & enqueue.");
  } catch (e) {
    console.error("Fatal:", e);
    process.exitCode = 1;
  } finally {
    await client.close().catch(() => {});
  }
})();
