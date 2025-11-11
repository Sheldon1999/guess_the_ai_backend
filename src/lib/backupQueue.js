import fs from "fs";
import path from "path";
import redis from "./redis.js";
import { BACKUP_QUEUE_KEY, backupImageAnswerKey } from "./redisKeys.js";
import answer_list from "./backup_answer.js";

const BACKUP_DIR = process.env.BACKUP_CACHE_DIR || "./cache/backup";

function isHashName(name) {
  if (!name || typeof name !== "string") return false;
  if (name.startsWith(".")) return false;
  const trimmed = name.trim();
  if (!trimmed) return false;
  return true;
}

export function deriveAnswerForFile(name) {
  if (!name) return null;
  const clean = name.trim();
  const entry = answer_list.find((item) => item.file_name === clean);
  return entry?.answer ?? null;
}

export async function seedBackupQueue() {
  await fs.promises.mkdir(BACKUP_DIR, { recursive: true });
  const entries = await fs.promises.readdir(BACKUP_DIR, { withFileTypes: true });
  let totalFiles = 0;
  let added = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !isHashName(entry.name)) continue;
    totalFiles += 1;
    const name = entry.name;
    const answer = deriveAnswerForFile(name);
    const pos = await redis.lpos(BACKUP_QUEUE_KEY, name);
    if (pos === null) {
      await redis.rpush(BACKUP_QUEUE_KEY, name);
      added += 1;
    }
    if (answer) {
      await redis.set(backupImageAnswerKey(name), answer);
    }
  }
  return { totalFiles, added };
}

export async function popBackupCandidate() {
  const name = await redis.lpop(BACKUP_QUEUE_KEY);
  if (!name) return null;
  return name;
}

export async function requeueBackupCandidate(name) {
  if (!name) return;
  await redis.rpush(BACKUP_QUEUE_KEY, name);
}

export function backupFilePath(name) {
  return path.join(BACKUP_DIR, name);
}

export { BACKUP_DIR, BACKUP_QUEUE_KEY };
