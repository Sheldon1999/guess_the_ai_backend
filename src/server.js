// server.js
import "dotenv/config";
import http from "http";
import express from "express";
import cors from "cors";
import morgan from "morgan";

import "./lib/redis.js";
import "./lib/mongo.js";

import health from "./routes/health.js";
import imageRoutes from "./routes/image.js";
import userRoutes from "./routes/user.js";
import gameRoutes from "./routes/game.js";
import leaderboardRoutes from "./routes/leaderboard.js";

import { warmOnBoot, startBackgroundTopup } from "./lib/warmup.js";
import { startRedisFlushWorker } from "./lib/docCache.js";
import { seedBackupQueue } from "./lib/backupQueue.js";
import { attachPresenceWS } from "./ws/presence.js";

const app = express();
app.use(express.json({ limit: "1mb" }));

const defaultAllowedOrigins = [
  "https://guesstheai.xyz"
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

app.use(morgan('short', {
  stream: {
    write: (message) => {
      process.stdout.write(`[morgan] ${message}`);
    }
  }
}));

if (process.env.ENABLE_CRASH_ENDPOINT === "true") {
  app.post("/debug/crash", (req, res) => {
    console.warn("Crash endpoint invoked via /debug/crash");
    res.status(200).json({ status: "exiting" });
    setTimeout(() => process.exit(1), 50);
  });
}

// Routes
userRoutes(app);
health(app);
imageRoutes(app);
gameRoutes(app);
leaderboardRoutes(app);

const server = http.createServer(app);
attachPresenceWS(server);

const port = Number(process.env.PORT || 3000);
server.listen(port, () => console.log(`[server] listen: URL: http://localhost:${port}`));

//to fill backup
await seedBackupQueue()
  .then((report) => console.log("[backup] queue: successfull: ", report))
  .catch((err) => console.error("[backup] queue: error: ", err));

// to fill in a single go
await warmOnBoot().then(r => console.log("[warmup] successfull: ", r)).catch(e => console.error("[warmup] error: ", e));

// Optional background maintainer (no-op if PREFETCH_INTERVAL_SEC=0)
const stopTopup = await startBackgroundTopup();
const stopRedisFlush = await startRedisFlushWorker();
