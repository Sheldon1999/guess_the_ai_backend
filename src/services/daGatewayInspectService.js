/**
 * Calls the deployed zero_g_da_event_gateway for status / retrieve / health (Highway-style).
 * Uses DA_INGEST_API_KEY or optional DA_GATEWAY_QUERY_API_KEY for protected routes.
 */

const GATEWAY_URL = (process.env.DA_GATEWAY_URL || "").trim().replace(/\/+$/, "");
const API_KEY = (
  process.env.DA_GATEWAY_QUERY_API_KEY ||
  process.env.DA_INGEST_API_KEY ||
  ""
).trim();
const STATUS_TIMEOUT = Math.max(Number(process.env.DA_GATEWAY_QUERY_TIMEOUT_MS || 8000), 1000);
const RETRIEVE_TIMEOUT = Math.max(Number(process.env.DA_GATEWAY_RETRIEVE_TIMEOUT_MS || 12000), 1000);

function ingestHeaders(includeJson = true) {
  const headers = {};
  if (includeJson) headers["Content-Type"] = "application/json";
  if (API_KEY) headers.Authorization = `Bearer ${API_KEY}`;
  return headers;
}

export function isGatewayConfigured() {
  return Boolean(GATEWAY_URL);
}

/** @returns {Promise<{ gateway: string, online: boolean, [key: string]: unknown }>} */
export async function healthCheck() {
  if (!GATEWAY_URL) {
    return { gateway: "", online: false, error: "DA_GATEWAY_URL not set" };
  }
  try {
    const res = await fetch(`${GATEWAY_URL}/health`, {
      signal: AbortSignal.timeout(5_000),
    });
    const body = await res.json().catch(() => ({}));
    const online = Boolean(body?.ready ?? body?.success ?? res.ok);
    return { gateway: GATEWAY_URL, online, ...body };
  } catch (err) {
    return { gateway: GATEWAY_URL, online: false, error: err?.message || String(err) };
  }
}

export async function logDaGatewayBootHealth() {
  const status = await healthCheck();
  const line = `[0g-da] gateway ${status.gateway || "(unset)"} online=${status.online}`;
  if (status.online) console.log(line);
  else console.warn(line, status.error ? ` (${status.error})` : "");
}

/** @returns {Promise<object | null>} */
export async function getEventStatus(eventId) {
  if (!eventId || !GATEWAY_URL) return null;
  try {
    const res = await fetch(`${GATEWAY_URL}/v1/da/status/${encodeURIComponent(eventId)}`, {
      headers: ingestHeaders(false),
      signal: AbortSignal.timeout(STATUS_TIMEOUT),
    });
    if (!res.ok) {
      if (res.status === 404) return { found: false };
      throw new Error(`Status check ${res.status}`);
    }
    const raw = await res.json();
    const doc = raw?.data && typeof raw.data === "object" ? raw.data : raw;
    return {
      found: true,
      eventId: doc.eventId,
      status: doc.status,
      daReference: doc.daReference,
      daStatus: doc.daStatus,
      daBlobInfo: doc.daBlobInfo,
      error: doc.error,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  } catch (err) {
    console.warn(`[0g-da] status failed (${eventId}): ${err.message}`);
    return null;
  }
}

/** @returns {Promise<{ retrieved: boolean, [key: string]: unknown }>} */
export async function retrievePlayerEvent(eventId) {
  if (!eventId) return { retrieved: false, reason: "no_event_id" };
  if (!GATEWAY_URL) return { retrieved: false, reason: "gateway_not_configured" };

  try {
    const res = await fetch(`${GATEWAY_URL}/v1/da/retrieve/${encodeURIComponent(eventId)}`, {
      method: "POST",
      headers: ingestHeaders(),
      signal: AbortSignal.timeout(RETRIEVE_TIMEOUT),
    });

    if (res.status === 409) {
      const body = await res.json().catch(() => ({}));
      return { retrieved: false, reason: "not_finalized_yet", daStatus: body.daStatus };
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { retrieved: false, reason: body.message || `gateway_${res.status}` };
    }

    const doc = await res.json();
    let data = null;
    if (doc.retrieved?.dataBase64) {
      try {
        data = JSON.parse(Buffer.from(doc.retrieved.dataBase64, "base64").toString("utf-8"));
      } catch {
        data = doc.retrieved.dataBase64;
      }
    }

    return {
      retrieved: true,
      eventId: doc.eventId,
      daBlobInfo: doc.daBlobInfo,
      data,
    };
  } catch (err) {
    return { retrieved: false, reason: err.message };
  }
}

export function getGatewayBaseUrl() {
  return GATEWAY_URL.replace(/\/+$/, "");
}
