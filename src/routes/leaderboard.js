import { topAllTime } from "../lib/leaderboard.js";
import { flushDirtyUsers } from "../lib/docCache.js";
import { getGateWalletLeaderboard } from "../services/gate.js";
import { flushGateUsers } from "../services/gate.js";

const gateLeaderboardLog = (stage, data) => {
  if (process.env.GATE_DEBUG === "1") {
    console.log(`[gate-leaderboard] ${stage}`, data);
  }
};

export default function leaderboardRoutes(app) {
  app.get("/api/leaderboard/alltime", async (req, res) => {
    res.set('Cache-Control', 'public, s-maxage=120, max-age=120');
    const limit = Math.min(Number(req.query.limit || 50), 200);
    const offset = Math.max(Number(req.query.offset || 0), 0);
    await flushDirtyUsers().catch((err) => console.error("leaderboard flush error:", err));
    const data = await topAllTime(limit, offset);
    res.json(data);
  });

  app.get("/api/leaderboard/gateUsers", async (req, res) => {
    res.set('Cache-Control', 'public, s-maxage=120, max-age=120');
    const limit = Math.min(Number(req.query.limit || 50), 200);
    gateLeaderboardLog("request", { limit });
    const flushResult = await flushGateUsers().catch((err) => {
      console.error("leaderboard flush error:", err);
      return null;
    });
    gateLeaderboardLog("flushResult", { flushResult });
    const data = await getGateWalletLeaderboard(limit);
    gateLeaderboardLog("leaderboardData", { limit, count: data.length });
    res.json(data);
  });
}
