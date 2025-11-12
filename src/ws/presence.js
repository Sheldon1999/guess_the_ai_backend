// src/ws/presence.js
import { Server } from "socket.io";
import redis from "../lib/redis.js";
import { verifyToken } from "../middleware/jwt.js";
import { userActiveDaily } from "../lib/mongo.js";
import {
  presencePendingKey,
  presenceTotalKey,
  presenceTouchedKey,
  presenceTouchedScanPattern,
  PRESENCE_REDIS_TTL_SECONDS,
} from "../lib/redisKeys.js";

// ===== Config (same spirit as your old app; names are descriptive) =====
const CLIENT_FLUSH_MS = Number(process.env.PRESENCE_CLIENT_FLUSH_QUANTUM_MS || 60000);   // 60s
const DURABLE_BATCH_MS = Number(process.env.PRESENCE_DURABLE_BATCH_MS || 360000);        // 6 min
const REDIS_TTL_SECONDS = PRESENCE_REDIS_TTL_SECONDS;
const FLUSH_INTERVAL_MS = Number(process.env.PRESENCE_FLUSH_INTERVAL_MS || 60000);       // 60s

// ===== Helpers =====
function istDateKey(d = new Date()) {
  // Server-authoritative IST date key YYYY-MM-DD
  const s = d.toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
  const x = new Date(s);
  const yyyy = x.getFullYear();
  const mm = String(x.getMonth() + 1).padStart(2, "0");
  const dd = String(x.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// Redis key helpers
const kPending = (wa, dk) => presencePendingKey(wa, dk);  // integer ms
const kTotal = (wa, dk) => presenceTotalKey(wa, dk);      // integer ms
const kTouched = (wa) => presenceTouchedKey(wa);          // set of dateKeys

function isValidDelta(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return false;
  if (ms % CLIENT_FLUSH_MS !== 0) return false;   // only multiples of 60s
  if (ms > DURABLE_BATCH_MS) return false;        // cap one message at 6min
  return true;
}

// Atomic drain pending → Mongo (called ONLY at the designated times)
async function flushOne(walletAddress, dateKey) {
  const keyP = kPending(walletAddress, dateKey);

  // Atomically read old value and reset to 0
  const drainedRaw = await redis.getset(keyP, "0"); // returns previous value or null
  const incMs = Number(drainedRaw || 0);
  if (!incMs || incMs <= 0) {
    // getset nukes TTL; keep our expiry budget even when nothing flushed
    await redis.expire(keyP, REDIS_TTL_SECONDS).catch(() => {});
    return 0;
  }

  // Persist to Mongo (upsert)
  await userActiveDaily.updateOne(
    { walletAddress, dateLocal: dateKey },
    {
      $setOnInsert: { walletAddress, dateLocal: dateKey },
      $inc: { seconds: Math.floor(incMs / 1000) },
      $set: { updatedAt: new Date() }
    },
    { upsert: true }
  );

  // Keep TTL fresh
  await redis.expire(keyP, REDIS_TTL_SECONDS).catch(() => {});
  return incMs;
}

export function attachPresenceWS(httpServer) {
  const io = new Server(httpServer, {
    path: "/ws",
    transports: ["websocket"],
    cors: { origin: "*", credentials: true }
  });

  // Require JWT in handshake to bind socket → wallet
  io.use(async (socket, next) => {
    try {
      const bearer = socket.handshake.headers?.authorization || "";
      const token =
        socket.handshake.auth?.token ||
        (bearer.startsWith("Bearer ") ? bearer.slice(7) : "");
      if (!token) {
        return next(new Error("Unauthorized"));
      }

      const payload = await verifyToken(token);
      const walletAddress = String(payload.walletAddress || "").toLowerCase();
      if (!walletAddress) {
        return next(new Error("Unauthorized: no wallet in token"));
      }

      socket.user = { walletAddress, claims: payload };
      next();
    } catch (err) {
      next(new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    const wallet = socket.user.walletAddress;
    const forwarded = socket.handshake.headers?.["x-forwarded-for"];
    const ip =
      (typeof forwarded === "string" && forwarded.split(",")[0]?.trim()) ||
      socket.handshake.address ||
      "unknown";
    console.log("[websocket] connected: wallet: ", wallet, " ip: ", ip);
    let lastDateKey = istDateKey();

    // Client sends { deltaMs } in 60s quanta (or integer multiples up to 6min)
    socket.on("presence:add", async (payload = {}, ack) => {
      const hasAck = typeof ack === "function";
      try {
        const deltaMs = Number(payload?.deltaMs);
        if (!isValidDelta(deltaMs)) {
          if (hasAck) ack({ ok: false, reason: "bad_delta" });
          return;
        }

        // Server-authoritative IST day
        const dk = istDateKey();
        lastDateKey = dk;

        const keyP = kPending(wallet, dk);
        const keyT = kTotal(wallet, dk);

        // Single round-trip, minimal ops:
        // - INCRBY returns the *new* pending value (no separate GET needed)
        const pendingAfter = await redis.incrby(keyP, deltaMs);
        await redis.expire(keyP, REDIS_TTL_SECONDS);
        await redis.incrby(keyT, deltaMs);
        await redis.expire(keyT, REDIS_TTL_SECONDS);
        await redis.sadd(kTouched(wallet), dk);
        await redis.expire(kTouched(wallet), REDIS_TTL_SECONDS);

        // DESIGNATED DB WRITE: only when threshold is reached
        if (pendingAfter >= DURABLE_BATCH_MS) {
          const flushed = await flushOne(wallet, dk); // writes to DB here
          if (hasAck) {
            ack({
              ok: true,
              dateKey: dk,
              appliedMs: deltaMs,
              pendingMs: Math.max(0, pendingAfter - flushed),
              flushedMs: flushed,
              willFlushAtMs: DURABLE_BATCH_MS
            });
          }
          return;
        }

        if (hasAck) {
          ack({
            ok: true,
            dateKey: dk,
            appliedMs: deltaMs,
            pendingMs: Number(pendingAfter) || 0,
            willFlushAtMs: DURABLE_BATCH_MS
          });
        }
      } catch (e) {
        if (hasAck) ack({ ok: false, reason: "server_error" });
      }
    });

    // DESIGNATED DB WRITE: on disconnect, best-effort flush
    socket.on("disconnect", async (reason) => {
      console.log("[websocket]: disconnected: wallet: ", wallet, " ip: ", ip);
      try {
        const dk = lastDateKey || istDateKey();
        await flushOne(wallet, dk);
      } catch (e) {
        console.warn("disconnect flush error", e?.message || e);
      }
    });
  });

  // ---- Periodic flusher: ONLY flush threshold or previous-day buckets ----
  const interval = setInterval(async () => {
    try {
      const today = istDateKey();

      // iterate touched sets
      let cursor = "0";
      do {
        const [next, keys] = await redis.scan(cursor, "MATCH", presenceTouchedScanPattern, "COUNT", 200);
        cursor = next;

        for (const setKey of keys) {
          // setKey = <prefix>presence:user:{wallet}:touched
          const wallet = setKey.split(":")[2];
          if (!wallet) continue;

          const dks = await redis.smembers(setKey);
          for (const dk of dks) {
            const pKey = kPending(wallet, dk);

            // If it's a previous day, flush outright (rollover safety)
            if (dk !== today) {
              await flushOne(wallet, dk);
              continue;
            }

            // Same day: only flush when threshold reached
            const pending = Number(await redis.get(pKey)) || 0;
            if (pending >= DURABLE_BATCH_MS) {
              await flushOne(wallet, dk);
            }
          }
        }
      } while (cursor !== "0");
    } catch (e) {
      console.warn("periodic flush error", e?.message || e);
    }
  }, FLUSH_INTERVAL_MS);

  io.on("close", () => clearInterval(interval));

  return io;
}
