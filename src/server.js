import "dotenv/config";
import fs from "fs";
import express from "express";
import pino from "pino-http";
import cors from 'cors';

import "./lib/redis.js";
import "./lib/mongo.js";

import health from "./routes/health.js";
import imageRoutes from "./routes/image.js";
import adminRoutes from "./routes/admin.js";
import userRoutes from "./routes/user.js";
import gameRoutes from "./routes/game.js";
import authRoutes from "./routes/auth.js";
import leaderboardRoutes from "./routes/leaderboard.js";

import { warmOnBoot, startBackgroundTopup } from "./lib/warmup.js";

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(cors())
app.use(pino());

const cacheDir = process.env.CACHE_DIR || "./cache/orig";
fs.mkdirSync(cacheDir, { recursive: true });

// Routes
health(app);
imageRoutes(app);
adminRoutes(app);
userRoutes(app);
gameRoutes(app);
authRoutes(app);
leaderboardRoutes(app);

await warmOnBoot().then(r => console.log("warmup:", r)).catch(e => console.error("warmup error:", e));

// Optional background maintainer (no-op if PREFETCH_INTERVAL_SEC=0)
const stopTopup = await startBackgroundTopup();

const port = Number(process.env.PORT || 3000);
console.log("MY PORT IS ",port);
app.listen(port, () => console.log(`server: http://localhost:${port}`));
