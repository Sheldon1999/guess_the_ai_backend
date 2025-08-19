import { users } from "../lib/mongo.js";

function normalizeWallet(w) {
  return String(w || "").trim().toLowerCase();
}

// case-insensitive 0x + 40 hex chars
const WALLET_RE = /^0x[0-9a-z]{40}$/i;

export default function userRoutes(app) {
  // REGISTER (create or update username if exists)
  app.post("/user/register", async (req, res) => {
  try {
    const walletAddress = normalizeWallet(req.body?.walletAddress);
    const username = String(req.body?.username || "").trim();

    if (!WALLET_RE.test(walletAddress)) {
      return res.status(400).json({ success: false, message: "invalid walletAddress" });
    }
    if (!username) {
      return res.status(400).json({ success: false, message: "username required" });
    }

    const now = new Date();

    const setOnInsert = {
      _id: walletAddress,
      correctAnswers: 0,
      currentStreak: 0,
      streak: 0,
      rank: "E",
      dungeonTitle: "Newbie",
      createdAt: now
    };

    const set = {
      username,
      updatedAt: now
    };

    await users.updateOne(
      { _id: walletAddress },
      { $setOnInsert: setOnInsert, $set: set },
      { upsert: true }
    );

    const profile = await users.findOne(
      { _id: walletAddress },
      {
        projection: {
          _id: 1, username: 1, correctAnswers: 1, currentStreak: 1, streak: 1,
          rank: 1, dungeonTitle: 1, createdAt: 1, updatedAt: 1
        }
      }
    );

    return res.json({ success: true, data: profile });
  } catch (e) {
    console.error("user/register error:", e);
    return res.status(500).json({ success: false, message: "internal error" });
  }
});

  // GET PROFILE
  app.get("/user/:walletAddress", async (req, res) => {
    try {
      const walletAddress = normalizeWallet(req.params.walletAddress);
      if (!WALLET_RE.test(walletAddress)) {
        return res.status(400).json({ success: false, message: "invalid walletAddress" });
      }

      const profile = await users.findOne(
        { _id: walletAddress },
        {
          projection: {
            _id: 1, username: 1, correctAnswers: 1, currentStreak: 1, streak: 1,
            rank: 1, dungeonTitle: 1, createdAt: 1, updatedAt: 1
          }
        }
      );
      if (!profile) return res.status(404).json({ success: false, message: "user not found" });
      return res.json({ success: true, data: profile });
    } catch (e) {
      console.error("user/get error:", e);
      return res.status(500).json({ success: false, message: "internal error" });
    }
  });

  // PATCH (username only)
  app.patch("/user/:walletAddress", async (req, res) => {
    try {
      const walletAddress = normalizeWallet(req.params.walletAddress);
      if (!WALLET_RE.test(walletAddress)) {
        return res.status(400).json({ success: false, message: "invalid walletAddress" });
      }

      const updates = {};
      if (typeof req.body?.username === "string") {
        const username = req.body.username.trim();
        if (!username) return res.status(400).json({ success: false, message: "username cannot be empty" });
        if (username.length > 30) return res.status(400).json({ success: false, message: "username too long" });
        updates.username = username;
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ success: false, message: "no valid fields to update" });
      }

      updates.updatedAt = new Date();
      const r = await users.updateOne({ _id: walletAddress }, { $set: updates });
      if (r.matchedCount === 0) return res.status(404).json({ success: false, message: "user not found" });

      const profile = await users.findOne(
        { _id: walletAddress },
        {
          projection: {
            _id: 1, username: 1, correctAnswers: 1, currentStreak: 1, streak: 1,
            rank: 1, dungeonTitle: 1, createdAt: 1, updatedAt: 1
          }
        }
      );
      return res.json({ success: true, data: profile });
    } catch (e) {
      console.error("user/patch error:", e);
      return res.status(500).json({ success: false, message: "internal error" });
    }
  });
}
