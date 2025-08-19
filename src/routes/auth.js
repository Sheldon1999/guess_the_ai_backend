// Connect wallet route (idempotent register/login)
import { users } from "../lib/mongo.js";

function normalizeWallet(w) {
  return String(w || "").trim().toLowerCase();
}

export default function authRoutes(app) {
  app.post("/auth/connect", async (req, res) => {
    const walletAddress = normalizeWallet(req.body?.walletAddress);
    const username = String(req.body?.username || "").trim(); // optional
    if (!/^0x[0-9a-f]{40}$/.test(walletAddress)) {
      return res.status(400).json({ error: "invalid walletAddress" });
    }
    const now = new Date();
    const setOnInsert = {
      _id: walletAddress,
      username: username || walletAddress.slice(0, 8),
      correctAnswers: 0,
      currentStreak: 0,
      streak: 0,
      rank: "E",
      dungeonTitle: "Newbie",
      createdAt: now,
      updatedAt: now
    };
    const $set = { updatedAt: now };
    if (username) $set.username = username;

    await users.updateOne(
      { _id: walletAddress },
      { $setOnInsert: setOnInsert, $set },
      { upsert: true }
    );

    const profile = await users.findOne(
      { _id: walletAddress },
      { projection: { _id: 1, username: 1, correctAnswers: 1, currentStreak: 1, streak: 1, rank: 1, dungeonTitle: 1, createdAt: 1, updatedAt: 1 } }
    );
    res.json(profile);
  });
}
