// tools/random-labels.mjs
import { MongoClient } from "mongodb";

// Usage:
//   node tools/random-labels.mjs
//   RATIO_AI=0.6 node tools/random-labels.mjs
//   OVERWRITE=true node tools/random-labels.mjs

const MONGO_URL = process.env.MONGO_URL || "mongodb://localhost:27017/guesstheai";
const RATIO_AI = Math.min(Math.max(Number(process.env.RATIO_AI ?? 0.5), 0), 1); // 0..1
const OVERWRITE = String(process.env.OVERWRITE || "false").toLowerCase() === "true";

const client = new MongoClient(MONGO_URL);

async function serverSide(images) {
  const filter = OVERWRITE ? {} : { label: { $exists: false } };
  const updatePipeline = [
    { $set: { label: { $cond: [ { $lt: [ { $rand: {} }, RATIO_AI ] }, "ai", "human" ] } } }
  ];
  console.log(`[server] updateMany ${OVERWRITE ? "(overwrite ALL)" : "(only unlabeled)"} ratioAI=${RATIO_AI}`);
  const r = await images.updateMany(filter, updatePipeline);
  return { matched: r.matchedCount ?? 0, modified: r.modifiedCount ?? 0 };
}

async function clientSide(images) {
  const filter = OVERWRITE ? {} : { label: { $exists: false } };
  console.log(`[client] scanning ${OVERWRITE ? "all docs" : "unlabeled docs"}…`);
  const cursor = images.find(filter, { projection: { _id: 1 } });

  let n = 0;
  const ops = [];
  for await (const doc of cursor) {
    n++;
    const label = Math.random() < RATIO_AI ? "ai" : "human";
    ops.push({ updateOne: { filter: { _id: doc._id }, update: { $set: { label } } } });
    if (ops.length >= 1000) {
      await images.bulkWrite(ops, { ordered: false });
      ops.length = 0;
      process.stdout.write(`  wrote ${n}\r`);
    }
  }
  if (ops.length) await images.bulkWrite(ops, { ordered: false });
  console.log(`  wrote ${n}`);
  return { matched: n, modified: n };
}

async function counts(images) {
  return images.aggregate([
    { $group: { _id: "$label", count: { $sum: 1 } } },
    { $sort: { _id: 1 } }
  ]).toArray();
}

(async () => {
  try {
    await client.connect();
    const db = client.db();            // db from URL
    const images = db.collection("images");

    let res;
    try {
      res = await serverSide(images);
      console.log(`[server] matched:${res.matched} modified:${res.modified}`);
    } catch (e) {
      console.warn(`[server] failed: ${e.message}`);
      console.warn(`[server] falling back to client-side bulk updates…`);
      res = await clientSide(images);
      console.log(`[client] modified:${res.modified}`);
    }

    const c = await counts(images);
    console.log("Label counts:", c);
    console.log("Done ✔");
  } catch (e) {
    console.error("Fatal:", e);
    process.exit(1);
  } finally {
    await client.close().catch(() => {});
  }
})();
