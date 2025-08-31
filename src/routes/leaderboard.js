import { currentWeekKey, topAllTime, topWeekly } from "../lib/leaderboard.js";

export default function leaderboardRoutes(app) {
  app.get("/leaderboard/alltime", async (req, res) => {
    console.log("step 1");
    const limit = Math.min(Number(req.query.limit || 50), 200);
    const offset = Math.max(Number(req.query.offset || 0), 0);
    console.log("step 2")
    const data = await topAllTime(limit, offset);
    res.json(data);
  });

  app.get("/leaderboard/weekly", async (req, res) => {
    const limit = Math.min(Number(req.query.limit || 50), 200);
    const offset = Math.max(Number(req.query.offset || 0), 0);
    const week = req.query.week || currentWeekKey();
    const data = await topWeekly(week, limit, offset);
    res.json({ period: "weekly", week, limit, offset, data });
  });
}
