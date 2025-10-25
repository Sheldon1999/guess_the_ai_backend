// server.js
import "dotenv/config";
import fs from "fs";
import http from "http";
import express from "express";
import cors from "cors";

import "./lib/redis.js";
import "./lib/mongo.js";

import health from "./routes/health.js";
import imageRoutes from "./routes/image.js";
import userRoutes from "./routes/user.js";
import gameRoutes from "./routes/game.js";
import leaderboardRoutes from "./routes/leaderboard.js";
import { warmOnBoot, startBackgroundTopup } from "./lib/warmup.js";

// NEW: attach presence WS
import { attachPresenceWS } from "./ws/presence.js";

const app = express();
app.use(express.json({ limit: "1mb" }));

const defaultAllowedOrigins = [
  "https://guesstheai.xyz",
  "http://localhost:5172",
  "http://localhost:5173",
  "http://localhost:5174"
];

const envOrigins = (process.env.CORS_ALLOWED_ORIGINS || "")
  .split(",")
  .map(origin => origin.trim())
  .filter(Boolean);

const allowedOrigins = envOrigins.length > 0 ? envOrigins : defaultAllowedOrigins;

app.use(cors({
  origin: allowedOrigins,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  credentials: true
}));

if (process.env.ENABLE_CRASH_ENDPOINT === "true") {
  app.post("/debug/crash", (req, res) => {
    console.warn("Crash endpoint invoked via /debug/crash");
    res.status(200).json({ status: "exiting" });
    setTimeout(() => process.exit(1), 50);
  });
}

const cacheDir = process.env.CACHE_DIR || "./cache/orig";
fs.mkdirSync(cacheDir, { recursive: true });

// Routes
userRoutes(app);
health(app);
imageRoutes(app);
gameRoutes(app);
leaderboardRoutes(app);

await warmOnBoot().then(r => console.log("warmup:", r)).catch(e => console.error("warmup error:", e));

// Optional background maintainer (no-op if PREFETCH_INTERVAL_SEC=0)
const stopTopup = await startBackgroundTopup();

const port = Number(process.env.PORT || 3000);
console.log("MY PORT IS ", port);

// ⬇️ minimal addition: create HTTP server & attach WS
const server = http.createServer(app);
attachPresenceWS(server);

server.listen(port, () => console.log(`server: http://localhost:${port} (ws on /ws)`));
