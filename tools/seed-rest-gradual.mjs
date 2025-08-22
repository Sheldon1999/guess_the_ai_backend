// tools/seed-rest-gradual.mjs
import fs from "fs";
import { MongoClient } from "mongodb";

const FILE = process.argv[2];
const START = Number(process.argv[3] || 100);   // start index
const CHUNK = Number(process.argv[4] || 10);    // insert chunk size
const SLEEP = Number(process.argv[5] || 3000);  // ms between chunks
const MONGO_URL = process.env.MONGO_URL || "mongodb://localhost:27017/guesstheai";

if (!FILE) { console.error("Usage: node tools/seed-rest-gradual.mjs <hashes.txt> [startIndex=100] [chunk=10] [sleepMs=3000]"); process.exit(1); }

const raw = fs.readFileSync(FILE, "utf8").split(/\r?\n/).map(s => s.trim()).filter(Boolean);
const hashes = [...new Set(raw.map(h => h.startsWith("0x") ? h.toLowerCase() : ("0x"+h.toLowerCase())))].slice(START);

function sleep(ms){return new Promise(r=>setTimeout(r,ms));}

const client = new MongoClient(MONGO_URL);
(async () => {
  await client.connect();
  const db = client.db();
  const images = db.collection("images");
  const labels = db.collection("labels");

  let i = 0;
  while (i < hashes.length) {
    const batch = hashes.slice(i, i+CHUNK);
    const now = new Date();

    const imgDocs = batch.map(h => ({ hash: h, uploadedAt: now }));
    const lblDocs = batch.map(h => ({ hash: h, label: Math.random() < 0.5 ? "ai" : "human" }));

    if (imgDocs.length) await images.insertMany(imgDocs, { ordered: false }).catch(()=>{});
    if (lblDocs.length) await labels.insertMany(lblDocs, { ordered: false }).catch(()=>{});

    console.log(`Inserted ${batch.length} (total ${i+batch.length}/${hashes.length + START})`);
    i += CHUNK;
    await sleep(SLEEP);
  }
  await client.close();
})();
