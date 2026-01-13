import { topAllTime } from "../lib/leaderboard.js";
import { flushDirtyUsers } from "../lib/docCache.js";

export default function leaderboardRoutes(app) {
  app.get("/api/leaderboard/alltime", async (req, res) => {
    const limit = Math.min(Number(req.query.limit || 50), 200);
    const offset = Math.max(Number(req.query.offset || 0), 0);
    // await flushDirtyUsers().catch((err) => console.error("leaderboard flush error:", err));
    const data = await topAllTime(limit, offset);
    res.json(data);
  });
}
