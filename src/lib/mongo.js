import { MongoClient } from "mongodb";

console.log("MY URL IS ",process.env.MONGO_URL);

const client = new MongoClient(process.env.MONGO_URL);
await client.connect();
console.log("mongo: connected");

const db = client.db(); // db from URI (guesstheai)

export const users = db.collection("Guess_the_ai_users");
export const images = db.collection("Guess_the_ai_images");
export const exposures = db.collection("Guess_the_ai_exposures");
export const labels = db.collection("Guess_the_ai_labels");

// Indexes (idempotent)
await images.createIndex({ hash: 1 }, { unique: true });
await images.createIndex({ uploadedAt: -1 });
await users.createIndex({ username: 1 }, { unique: true, collation: { locale: "en", strength: 2 } });
await users.createIndex({ correctAnswers: -1 });
await users.createIndex({ streak: -1 });
await labels.createIndex({ hash: 1 }, { unique: true });
await exposures.createIndex({ userId: 1, shownAt: -1 });

export default db;
