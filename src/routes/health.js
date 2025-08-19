import redis from "../lib/redis.js";
import db from "../lib/mongo.js";

export default function health(app) {
  app.get("/health", (_, res) => res.json({ ok: true }));
  app.get("/health/deps", async (_req, res) => {
    try {
      await redis.ping();
      await db.command({ ping: 1 });
      res.json({ redis: "ok", mongo: "ok" });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
}
