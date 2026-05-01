/**
 * Publish events to zero_g_da_event_gateway (HTTP ingest).
 * Fire-and-forget — never blocks login UX.
 */

const GATEWAY_URL = (process.env.DA_GATEWAY_URL || "").trim().replace(/\/+$/, "");
const INGEST_API_KEY = (process.env.DA_INGEST_API_KEY || "").trim();
const TIMEOUT_MS = Math.max(Number(process.env.DA_GATEWAY_TIMEOUT_MS || 8000), 1000);
const GAME_ID = (process.env.DA_GAME_ID || "guess_the_ai").trim();
const PUBLISH_ANSWER_EVENTS =
  String(process.env.DA_GATEWAY_PUBLISH_ANSWERS ?? "true")
    .trim()
    .toLowerCase() !== "false";

function isEnabled() {
  return Boolean(GATEWAY_URL);
}

/**
 * @param {Object} param0
 * @param {string} param0.eventType - e.g. session.login
 * @param {Object} param0.data - JSON-serializable payload
 */
export function publishDaEvent({ eventType, data }) {
  if (!isEnabled()) return;

  const url = `${GATEWAY_URL}/v1/events`;
  const body = JSON.stringify({
    game: GAME_ID,
    event: eventType,
    ts: new Date().toISOString(),
    data: data && typeof data === "object" ? data : { value: data }
  });

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
        console.warn("[daGateway] ingest failed", res.status, text?.slice(0, 200));
      } else {
        console.log("[daGateway] ingest ok", eventType);
      }
    })
    .catch((err) => {
      console.warn("[daGateway] ingest error", eventType, err?.message || err);
    })
    .finally(() => clearTimeout(t));
}

/**
 * Per-answer event to DA gateway (parallel to legacy daEventService batch pipeline).
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
