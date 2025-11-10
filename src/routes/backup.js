import fs from "fs";
import redis from "../lib/redis.js";
import { protect } from "../middleware/jwt.js";
import {
  seedBackupQueue,
  popBackupCandidate,
  requeueBackupCandidate,
  backupFilePath,
} from "../lib/backupQueue.js";

const COOLDOWN_DAYS = Number(process.env.IMAGE_COOLDOWN_DAYS || 7);
const COOLDOWN_SECS = COOLDOWN_DAYS * 24 * 60 * 60;
const BACKUP_MAX_ATTEMPTS = Math.max(Number(process.env.BACKUP_MAX_ATTEMPTS || 50), 1);

const nowSec = () => Math.floor(Date.now() / 1000);

async function isEligibleForUser(userId, imageId) {
  const cutoff = nowSec() - COOLDOWN_SECS;
  const score = await redis.zscore(`recent:${userId}`, String(imageId));
  if (!score) return true;
  return Number(score) < cutoff;
}

async function recordExposure(userId, imageId) {
  const ts = nowSec();
  const key = `recent:${userId}`;
  await redis
    .multi()
    .zadd(key, ts, String(imageId))
    .expire(key, COOLDOWN_SECS)
    .exec();
  await redis.zremrangebyscore(key, 0, ts - COOLDOWN_SECS - 1);
}

async function fetchBackupImageBuffer(fileName) {
  const filePath = backupFilePath(fileName);
  const data = await fs.promises.readFile(filePath);
  return data;
}

export default function backupRoutes(app) {
  app.get(
    "/api/backup/game/nextimage",
    protect,
    async (req, res) => {
      try {
        const wallet = req.user.walletAddress || req.user._id;
        if (!wallet) {
          return res.status(400).json({ error: "wallet required" });
        }

        for (let attempt = 0; attempt < BACKUP_MAX_ATTEMPTS; attempt += 1) {
          let candidate = await popBackupCandidate();
          if (!candidate) {
            await seedBackupQueue();
            candidate = await popBackupCandidate();
            if (!candidate) break;
          }

          const eligible = await isEligibleForUser(wallet, candidate);
          if (!eligible) {
            await requeueBackupCandidate(candidate);
            continue;
          }

          let buffer;
          try {
            buffer = await fetchBackupImageBuffer(candidate);
          } catch (fileErr) {
            console.warn("backup: unable to read file", candidate, fileErr?.message);
            continue;
          }

          await recordExposure(wallet, candidate);
          await requeueBackupCandidate(candidate);

          return res.json({
            fileName: candidate,
            image: buffer.toString("base64"),
          });
        }

        return res.status(204).send();
      } catch (error) {
        console.error("backup/nextimage error:", error);
        return res.status(500).json({ error: "internal server error" });
      }
    }
  );
}
