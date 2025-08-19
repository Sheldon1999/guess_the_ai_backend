import { MongoClient } from "mongodb";

const client = new MongoClient(process.env.MONGO_URL);
await client.connect();
console.log("mongo: connected");

const db = client.db(); // db from URI (guesstheai)

export const users = db.collection("users");
export const images = db.collection("images");
export const exposures = db.collection("exposures");
export const labels = db.collection("labels");

// Indexes (idempotent)
await images.createIndex({ hash: 1 }, { unique: true });
await images.createIndex({ uploadedAt: -1 });
await users.createIndex({ username: 1 }, { unique: false, collation: { locale: "en", strength: 2 } });
await users.createIndex({ correctAnswers: -1 });
await users.createIndex({ streak: -1 });
await labels.createIndex({ hash: 1 }, { unique: true });
await exposures.createIndex({ userId: 1, shownAt: -1 });

export default db;
