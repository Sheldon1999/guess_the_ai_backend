// src/lib/mongo
import { MongoClient } from "mongodb";

console.log("MY URL IS ",process.env.MONGO_URL);

const client = new MongoClient(process.env.MONGO_URL);
await client.connect();
console.log("mongo: connected");

const db = client.db(); // db from URI (guesstheai)

export const users = db.collection("guesstheai_users");
export const images = db.collection("guesstheai_images");
export const dailyLogins = db.collection("guesstheai_daily_logins");

// Indexes (idempotent)
await images.createIndex({ hash: 1 }, { unique: true });
await users.createIndex({ username: 1 }, { unique: true, collation: { locale: "en", strength: 2 } });
await dailyLogins.createIndex(
  { walletAddress: 1, day: 1 },
  { unique: true }
);

export default db;
