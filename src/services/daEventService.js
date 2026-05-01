import { sessionDaRefs } from "../lib/mongo.js";
import { randomUUID } from "node:crypto";

const DEFAULT_DA_API_URL = `http://127.0.0.1:${Number(process.env.PORT || 3000)}/api/internal/da/submit`;
const DA_API_URL = (process.env.DA_API_URL || DEFAULT_DA_API_URL).trim();
const DA_API_KEY = (process.env.DA_API_KEY || "").trim();
const DA_BATCH_SIZE = Math.max(Number(process.env.DA_BATCH_SIZE || 20), 1);
const DA_FLUSH_INTERVAL_MS = Math.max(Number(process.env.DA_FLUSH_INTERVAL_MS || 15000), 1000);
const DA_TIMEOUT_MS = Math.max(Number(process.env.DA_TIMEOUT_MS || 12000), 1000);
const DA_ENABLED = Boolean(DA_API_URL);

let queue = [];
let flushInFlight = null;
let flushTimer = null;

function nowIso() {
  return new Date().toISOString();
}

function buildDaHeaders() {
  const headers = { "Content-Type": "application/json" };
  if (DA_API_KEY) headers.Authorization = `Bearer ${DA_API_KEY}`;
  return headers;
}

function extractDaReference(payload) {
  if (!payload || typeof payload !== "object") return null;
  return (
    payload.reference ||
    payload.batchId ||
    payload.id ||
    payload.root ||
    payload.txHash ||
    payload?.data?.reference ||
    payload?.data?.batchId ||
    payload?.data?.id ||
    payload?.data?.root ||
    payload?.result?.reference ||
    payload?.result?.batchId ||
    null
  );
}

async function submitBatchToDa(events) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DA_TIMEOUT_MS);
  try {
    const body = {
      createdAt: nowIso(),
      source: "guess-the-ai",
      events
    };

    const response = await fetch(DA_API_URL, {
      method: "POST",
      headers: buildDaHeaders(),
      body: JSON.stringify(body),
      signal: controller.signal
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      return {
        ok: false,
        error: new Error(`DA submit failed with status ${response.status}`),
        payload
      };
    }

    return {
      ok: true,
      reference: extractDaReference(payload),
      payload
    };
  } catch (error) {
    return { ok: false, error };
  } finally {
    clearTimeout(timeout);
  }
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

export async function flushDaAnswerEvents() {
  if (!DA_ENABLED) return { skipped: true, reason: "disabled" };
  if (flushInFlight) return flushInFlight;
  if (!queue.length) return { flushed: 0 };

  const batch = queue.slice(0, DA_BATCH_SIZE);
  queue = queue.slice(batch.length);

  flushInFlight = (async () => {
    const result = await submitBatchToDa(batch);
    if (!result.ok) {
      console.error("[DA] batch submit failed:", result.error || result.payload);
      // Put failed events back to queue head for retry.
      queue = [...batch, ...queue];
      return { flushed: 0, error: result.error || result.payload };
    }

    await persistBatchReference(batch, result);
    return { flushed: batch.length, reference: result.reference || null };
  })();

  try {
    return await flushInFlight;
  } finally {
    flushInFlight = null;
  }
}

export async function enqueueDaAnswerEvent(event) {
  if (!DA_ENABLED) return { skipped: true, reason: "disabled" };
  if (!event?.sessionKey) return { skipped: true, reason: "session-required" };

  queue.push({
    eventId: event.eventId || randomUUID(),
    walletAddress: event.walletAddress || "",
    sessionId: event.sessionId || "",
    sessionKey: event.sessionKey,
    hash: event.hash || "",
    guess: event.guess || "",
    isCorrect: Boolean(event.isCorrect),
    latencyMs: Number(event.latencyMs) || 0,
    ts: event.ts || nowIso()
  });

  if (queue.length >= DA_BATCH_SIZE) {
    return flushDaAnswerEvents();
  }

  return { queued: true, size: queue.length };
}

export function startDaFlushWorker() {
  if (!DA_ENABLED || flushTimer) return () => {};
  flushTimer = setInterval(() => {
    flushDaAnswerEvents().catch((error) => {
      console.error("[DA] periodic flush failed:", error);
    });
  }, DA_FLUSH_INTERVAL_MS);

  return () => {
    if (flushTimer) clearInterval(flushTimer);
    flushTimer = null;
  };
}

