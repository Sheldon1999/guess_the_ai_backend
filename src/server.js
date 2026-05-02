// server.js
import "dotenv/config";
import http from "http";
import express from "express";
import cors from "cors";
import morgan from "morgan";

import "./lib/redis.js";
import "./lib/mongo.js";

import healthRoutes from "./routes/health.js";
import imageRoutes from "./routes/image.js";
import userRoutes from "./routes/userRoutes.js";
import gameRoutes from "./routes/gameRoutes.js";
import leaderboardRoutes from "./routes/leaderboardRoutes.js";
import sessionRoutes from "./routes/sessionRoutes.js";
import internalDaRoutes from "./routes/internalDaRoutes.js";
import verifyRoutes from "./routes/verifyRoutes.js";
import daPublicRoutes from "./routes/daPublicRoutes.js";
import { logDaGatewayBootHealth } from "./services/daGatewayInspectService.js";

import { warmOnBoot, startBackgroundTopup } from "./lib/warmup.js";
import { startRedisFlushWorker } from "./lib/docCache.js";
import { attachPresenceWS } from "./ws/presence.js";
import { startDaFlushWorker } from "./services/daEventService.js";

const app = express();
app.use(express.json({ limit: "1mb" }));

const defaultAllowedOrigins = [
  "https://guesstheai.xyz",
  "http://localhost:8080",
  "http://127.0.0.1:8080"
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

// Routes
userRoutes(app);
sessionRoutes(app);
healthRoutes(app);
imageRoutes(app);
gameRoutes(app);
leaderboardRoutes(app);
internalDaRoutes(app);
verifyRoutes(app);
daPublicRoutes(app);

const server = http.createServer(app);
attachPresenceWS(server);

const port = Number(process.env.PORT || 3000);
server.listen(port, () => console.log(`[server] listen: URL: http://localhost:${port}`));

// to fill in a single go
await warmOnBoot().then(r => console.log("[warmup] successfull: ", r)).catch(e => console.error("[warmup] error: ", e));

// Optional background maintainer (no-op if PREFETCH_INTERVAL_SEC=0)
const stopTopup = await startBackgroundTopup();
const stopRedisFlush = await startRedisFlushWorker();
const stopDaFlush = startDaFlushWorker();

void logDaGatewayBootHealth();
