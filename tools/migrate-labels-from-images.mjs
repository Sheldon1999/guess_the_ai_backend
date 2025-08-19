import { MongoClient } from "mongodb";

// Usage:
//   node tools/migrate-labels-from-images.mjs
//   DRY_RUN=true node tools/migrate-labels-from-images.mjs   # don't write, just report
//   UNSET_IMAGES_LABEL=true node tools/migrate-labels-from-images.mjs  # remove label from images after copy

const MONGO_URL = process.env.MONGO_URL || "mongodb://localhost:27017/guesstheai";
const DRY_RUN = String(process.env.DRY_RUN || "false").toLowerCase() === "true";
const UNSET_IMAGES_LABEL = String(process.env.UNSET_IMAGES_LABEL || "false").toLowerCase() === "true";

const client = new MongoClient(MONGO_URL);

const norm = s => String(s ?? "").trim().toLowerCase();

(async () => {
  try {
    await client.connect();
    const db = client.db();
    const images = db.collection("images");
    const labels = db.collection("labels");

    // ensure unique on labels.hash (idempotent)
    await labels.createIndex({ hash: 1 }, { unique: true });

    const cursor = images.find({ label: { $exists: true } }, { projection: { _id: 0, hash: 1, label: 1 } });

    const upserts = [];
    let scanned = 0, prepared = 0;

    for await (const doc of cursor) {
      scanned++;
      const hash = doc.hash;
      const label = norm(doc.label);
      if (label !== "ai" && label !== "human") continue;
      upserts.push({
        updateOne: {
          filter: { hash },
          update: { $setOnInsert: { hash }, $set: { label, updatedAt: new Date() } },
          upsert: true
        }
      });
      if (upserts.length >= 1000) {
        if (!DRY_RUN) await labels.bulkWrite(upserts, { ordered: false });
        prepared += upserts.length;
        upserts.length = 0;
        process.stdout.write(`  migrated ${prepared}\r`);
      }
    }
    if (upserts.length) {
      if (!DRY_RUN) await labels.bulkWrite(upserts, { ordered: false });
      prepared += upserts.length;
    }
    console.log(`\nScanned:${scanned} | Migrated:${prepared}`);

    if (UNSET_IMAGES_LABEL && !DRY_RUN) {
      const r = await images.updateMany({ label: { $exists: true } }, { $unset: { label: "" } });
      console.log(`Unset label on images: matched ${r.matchedCount}, modified ${r.modifiedCount}`);
    }

    const counts = await labels.aggregate([{ $group: { _id: "$label", n: { $sum: 1 } } }]).toArray();
    console.log("labels collection counts:", counts);
  } catch (e) {
    console.error("Fatal:", e);
    process.exit(1);
  } finally {
    await client.close().catch(() => {});
  }
})();
