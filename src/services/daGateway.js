/**
 * Publish events to zero_g_da_event_gateway (HTTP ingest).
 * Fire-and-forget — never blocks login UX.
 *
 * Sends a client-generated eventId so the gateway can track /status /retrieve later
 * (Highway Hustle pattern). Optionally persists daGatewaySnapshot on guesstheai_users.
 */

import { randomUUID } from "node:crypto";
import { users } from "../lib/mongo.js";
import { normalizeWallet } from "../utils/normalize.js";

const GATEWAY_URL = (process.env.DA_GATEWAY_URL || "").trim().replace(/\/+$/, "");
const INGEST_API_KEY = (process.env.DA_INGEST_API_KEY || "").trim();
const TIMEOUT_MS = Math.max(Number(process.env.DA_GATEWAY_TIMEOUT_MS || 8000), 1000);
const GAME_ID = (process.env.DA_GAME_ID || "guess_the_ai").trim();
const PUBLISH_ANSWER_EVENTS =
  String(process.env.DA_GATEWAY_PUBLISH_ANSWERS ?? "true")
    .trim()
    .toLowerCase() !== "false";

/** Persist Mongo snapshot after ingest (default true). Disable with DA_GATEWAY_PERSIST_SNAPSHOT=false */
const PERSIST_SNAPSHOT = String(process.env.DA_GATEWAY_PERSIST_SNAPSHOT ?? "true")
  .trim()
  .toLowerCase() !== "false";

/** Extra writes per answer; default false — set DA_GATEWAY_PERSIST_ANSWER_SNAPSHOT=true to mirror every game.answer */
const PERSIST_ANSWER_SNAPSHOT =
  String(process.env.DA_GATEWAY_PERSIST_ANSWER_SNAPSHOT ?? "false")
    .trim()
    .toLowerCase() === "true";

function isEnabled() {
  // return Boolean(GATEWAY_URL); // 0G DA disabled
  return false;
}

function walletFromPayload(data) {
  if (!data || typeof data !== "object") return null;
  return normalizeWallet(String(data.walletAddress || ""));
}

function shouldPersistMongoSnapshot(eventType, wallet) {
  if (!wallet || !PERSIST_SNAPSHOT) return false;
  if (eventType === "game.answer") return PERSIST_ANSWER_SNAPSHOT;
  return true;
}

async function persistDaGatewaySnapshot(walletAddress, eventId, eventType) {
  try {
    await users.updateOne(
      { walletAddress },
      {
        $set: {
          daGatewaySnapshot: {
            eventId,
            event: eventType,
            daStatus: "submitted",
            snapshotAt: new Date(),
          },
        },
      },
    );
  } catch (err) {
    console.warn("[daGateway] persist snapshot failed:", err?.message || err);
  }
}

/**
 * @param {Object} param0
 * @param {string} param0.eventType - e.g. session.login
 * @param {Object} param0.data - JSON-serializable payload
 */
export function publishDaEvent({ eventType, data }) {
  if (!isEnabled()) return;

  const eventId = randomUUID();
  const wallet = walletFromPayload(data);

  const url = `${GATEWAY_URL}/v1/events`;
  const payload = {
    eventId,
    game: GAME_ID,
    event: eventType,
    ts: new Date().toISOString(),
    data: data && typeof data === "object" ? data : { value: data },
  };
  const body = JSON.stringify(payload);

  const headers = { "Content-Type": "application/json" };
  if (INGEST_API_KEY) {
    headers.Authorization = `Bearer ${INGEST_API_KEY}`;
  }

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);

  fetch(url, { method: "POST", headers, body, signal: controller.signal })
    .then(async (res) => {
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        console.warn("[daGateway] ingest failed", eventType, eventId, res.status, text?.slice(0, 200));
        return;
      }

      /** @type {{ accepted?: number, success?: boolean } | null} */
      let json = null;
      try {
        json = await res.json();
      } catch {
        json = null;
      }

      const accepted =
        (typeof json?.accepted === "number" && json.accepted > 0) ||
        json?.success === true ||
        json == null;

      if (accepted && shouldPersistMongoSnapshot(eventType, wallet)) {
        void persistDaGatewaySnapshot(wallet, eventId, eventType);
      }

      console.log("[daGateway] ingest ok", eventType, eventId);
    })
    .catch((err) => {
      console.warn("[daGateway] ingest error", eventType, eventId, err?.message || err);
    })
    .finally(() => clearTimeout(t));
}

/**
 * Per-answer event to DA gateway (single DA pipeline).
 * Set DA_GATEWAY_PUBLISH_ANSWERS=false to disable.
 * @param {Record<string, unknown>} data — hash, guess, isCorrect, sessionKey, walletAddress, ...
 */
export function publishDaAnswerGatewayEvent(data) {
  if (!isEnabled() || !PUBLISH_ANSWER_EVENTS) return;
  publishDaEvent({
    eventType: "game.answer",
    data: data && typeof data === "object" ? data : { value: data }
  });
}
