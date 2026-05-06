import { createHash, randomUUID } from "node:crypto";
import { daBatches } from "../lib/mongo.js";

const DA_UPSTREAM_URL = (process.env.DA_UPSTREAM_URL || "").trim();
const DA_UPSTREAM_API_KEY = (process.env.DA_UPSTREAM_API_KEY || "").trim();
const DA_TIMEOUT_MS = Math.max(Number(process.env.DA_TIMEOUT_MS || 12000), 1000);
const DA_STRICT_UPSTREAM =
  String(process.env.DA_STRICT_UPSTREAM ?? "true").trim().toLowerCase() !== "false";

function buildUpstreamHeaders() {
  const headers = { "Content-Type": "application/json" };
  if (DA_UPSTREAM_API_KEY) headers.Authorization = `Bearer ${DA_UPSTREAM_API_KEY}`;
  return headers;
}

function extractReference(payload) {
  if (!payload || typeof payload !== "object") return null;
  return (
    payload.reference ||
    payload.batchId ||
    payload.id ||
    payload.root ||
    payload?.data?.reference ||
    payload?.result?.reference ||
    null
  );
}

function createLocalReference(events) {
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(events || []))
    .digest("hex")
    .slice(0, 32);
  return `local-da-${fingerprint}-${randomUUID().slice(0, 8)}`;
}

async function submitToUpstream(events) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DA_TIMEOUT_MS);
  try {
    const response = await fetch(DA_UPSTREAM_URL, {
      method: "POST",
      headers: buildUpstreamHeaders(),
      body: JSON.stringify({
        source: "guess-the-ai",
        createdAt: new Date().toISOString(),
        events
      }),
      signal: controller.signal
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      throw new Error(`DA upstream failed with status ${response.status}`);
    }

    return {
      reference: extractReference(payload) || createLocalReference(events),
      payload
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function submitDaBatch({ events }) {
  const safeEvents = Array.isArray(events) ? events : [];
  if (!safeEvents.length) {
    return { reference: null, accepted: 0 };
  }

  let reference = null;
  let upstreamPayload = null;
  let mode = "local";

  if (DA_UPSTREAM_URL) {
    const upstream = await submitToUpstream(safeEvents);
    reference = upstream.reference;
    upstreamPayload = upstream.payload;
    mode = "upstream";
  } else {
    if (DA_STRICT_UPSTREAM || process.env.NODE_ENV === "production") {
      throw new Error("DA_UPSTREAM_URL is required for durable DA submission in production mode");
    }
    reference = createLocalReference(safeEvents);
  }

  await daBatches.insertOne({
    reference,
    mode,
    size: safeEvents.length,
    events: safeEvents,
    upstreamPayload,
    createdAt: new Date()
  });

  return {
    reference,
    accepted: safeEvents.length,
    mode
  };
}

