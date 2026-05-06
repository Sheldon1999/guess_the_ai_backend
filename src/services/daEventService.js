import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { randomUUID } from "node:crypto";
import { daDeadLetters, sessionDaRefs } from "../lib/mongo.js";
import { submitDaBatch } from "./daWriterService.js";

const REDIS_URL = (process.env.REDIS_URL || "").trim();
const DA_BATCH_SIZE = Math.max(Number(process.env.DA_BATCH_SIZE || 20), 1);
const DA_QUEUE_RETRIES = Math.max(Number(process.env.DA_QUEUE_RETRIES || 5), 1);
const DA_QUEUE_BACKOFF_MS = Math.max(Number(process.env.DA_QUEUE_BACKOFF_MS || 2000), 100);
const DA_QUEUE_CONCURRENCY = Math.max(Number(process.env.DA_QUEUE_CONCURRENCY || 4), 1);
const DA_ENABLED = Boolean(REDIS_URL);
const DA_QUEUE_NAME = "guesstheai_da_answer_events";

let redis = null;
let queue = null;
let worker = null;

function nowIso() {
  return new Date().toISOString();
}

async function persistBatchReference(events, daResult) {
  const grouped = new Map();
  for (const event of events) {
    if (!event?.sessionKey) continue;
    const key = event.sessionKey;
    if (!grouped.has(key)) {
      grouped.set(key, {
        walletAddress: event.walletAddress || "",
        sessionId: event.sessionId || "",
        sessionKey: event.sessionKey,
        refs: []
      });
    }
    grouped.get(key).refs.push({
      daReference: daResult.reference || null,
      eventId: event.eventId,
      submittedAt: nowIso(),
      payload: {
        hash: event.hash,
        guess: event.guess,
        isCorrect: event.isCorrect,
        latencyMs: event.latencyMs,
        ts: event.ts
      }
    });
  }

  const updates = Array.from(grouped.values()).map((entry) =>
    sessionDaRefs.updateOne(
      { sessionKey: entry.sessionKey },
      {
        $set: {
          walletAddress: entry.walletAddress,
          sessionId: entry.sessionId,
          sessionKey: entry.sessionKey,
          updatedAt: new Date()
        },
        $setOnInsert: {
          createdAt: new Date()
        },
        $push: {
          refs: { $each: entry.refs }
        }
      },
      { upsert: true }
    )
  );

  await Promise.all(updates);
}

async function writeDeadLetter(event, error, attemptsMade) {
  await daDeadLetters.updateOne(
    { eventId: event.eventId },
    {
      $set: {
        eventId: event.eventId,
        walletAddress: event.walletAddress || "",
        sessionKey: event.sessionKey || "",
        event,
        error: String(error?.message || error),
        attemptsMade: Number(attemptsMade || 0),
        updatedAt: new Date()
      },
      $setOnInsert: { createdAt: new Date() }
    },
    { upsert: true }
  );
}

function ensureDaQueue() {
  if (!DA_ENABLED) return;
  if (queue && worker && redis) return;

  redis = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
  queue = new Queue(DA_QUEUE_NAME, {
    connection: redis,
    prefix: "GUESSTHEAI:DA:"
  });

  worker = new Worker(
    DA_QUEUE_NAME,
    async (job) => {
      const events = Array.isArray(job?.data?.events) ? job.data.events : [];
      if (!events.length) return { skipped: true };
      const result = await submitDaBatch({ events });
      await persistBatchReference(events, result);
      return { ok: true, accepted: events.length, reference: result.reference || null };
    },
    {
      connection: redis,
      prefix: "GUESSTHEAI:DA:",
      concurrency: DA_QUEUE_CONCURRENCY
    }
  );

  worker.on("failed", async (job, err) => {
    try {
      const attemptsMade = Number(job?.attemptsMade || 0);
      const attemptsLimit = Number(job?.opts?.attempts || DA_QUEUE_RETRIES);
      if (attemptsMade >= attemptsLimit) {
        const events = Array.isArray(job?.data?.events) ? job.data.events : [];
        for (const event of events) {
          await writeDeadLetter(event, err, attemptsMade);
        }
      }
    } catch (dlqError) {
      console.error("[DA] DLQ write failed:", dlqError);
    }
  });
}

export async function enqueueDaAnswerEvent(event) {
  if (!DA_ENABLED) return { skipped: true, reason: "disabled" };
  if (!event?.sessionKey) return { skipped: true, reason: "session-required" };
  ensureDaQueue();
  const normalized = {
    eventId: event.eventId || randomUUID(),
    walletAddress: event.walletAddress || "",
    sessionId: event.sessionId || "",
    sessionKey: event.sessionKey,
    hash: event.hash || "",
    guess: event.guess || "",
    isCorrect: Boolean(event.isCorrect),
    latencyMs: Number(event.latencyMs) || 0,
    ts: event.ts || nowIso()
  };

  const jobId = `da-${normalized.eventId}`;
  await queue.add(
    "submit",
    { events: [normalized] },
    {
      jobId,
      attempts: DA_QUEUE_RETRIES,
      backoff: { type: "exponential", delay: DA_QUEUE_BACKOFF_MS },
      removeOnComplete: 2000,
      removeOnFail: 5000
    }
  );
  const counts = await queue.getJobCounts("waiting", "active", "failed", "completed");
  return {
    queued: (counts.waiting || 0) + (counts.active || 0),
    failed: counts.failed || 0,
    completed: counts.completed || 0
  };
}

export function startDaFlushWorker() {
  ensureDaQueue();
  return () => {
    worker?.close().catch(() => {});
    queue?.close().catch(() => {});
    redis?.quit().catch(() => {});
    worker = null;
    queue = null;
    redis = null;
  };
}

export async function getDaQueueMetrics() {
  if (!queue) {
    return { enabled: DA_ENABLED, queued: 0, failed: 0, completed: 0, retries: DA_QUEUE_RETRIES };
  }
  const counts = await queue.getJobCounts("waiting", "active", "failed", "completed");
  return {
    enabled: DA_ENABLED,
    queued: (counts.waiting || 0) + (counts.active || 0),
    failed: counts.failed || 0,
    completed: counts.completed || 0,
    retries: DA_QUEUE_RETRIES,
    batchSize: DA_BATCH_SIZE
  };
}

