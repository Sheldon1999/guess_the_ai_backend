// src/lib/mongo.js
import { MongoClient } from "mongodb";

console.log("[mongo] connection: URL: ",process.env.MONGO_URL);

const client = new MongoClient(process.env.MONGO_URL);
try {
  await client.connect();
  console.log("[mongo] connection: successfull");
} catch (err) {
  console.error("[mongo] connection:: error: ", err);
  throw err;
}

const db = client.db(); // db from URI (guesstheai)

export const users = db.collection("guesstheai_users");
export const images = db.collection("guesstheai_images");
export const dailyLogins = db.collection("guesstheai_daily_logins");
export const gateWallets = db.collection("guesstheai_gate_wallets");

// NEW: daily active time (seconds) per wallet per IST day
export const userActiveDaily = db.collection("guesstheai_user_active_daily");

// Indexes (idempotent)
await images.createIndex({ hash: 1 }, { unique: true });
await gateWallets.createIndex({ walletAddress: 1 }, { unique: true });
// Drop the old non-unique walletAddress index if it exists, then recreate as unique
await users.dropIndex("walletAddress_1").catch(() => {/* already gone or doesn't exist */});
await users.createIndex({ walletAddress: 1 }, { unique: true });
await users.createIndex({ username: 1 }, { unique: true, collation: { locale: "en", strength: 2 } });
await users.createIndex({ correctAnswers: -1 });
await dailyLogins.createIndex({ walletAddress: 1, day: 1 }, { unique: true });

// NEW index
await userActiveDaily.createIndex({ walletAddress: 1, dateLocal: 1 }, { unique: true });

export default db;
