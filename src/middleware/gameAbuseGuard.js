import crypto from "node:crypto";
let redisClient = null;

async function getRedis() {
  if (redisClient) return redisClient;
  const mod = await import("../lib/redis.js");
  redisClient = mod.default;
  return redisClient;
}

const WINDOW_SEC = Math.max(Number(process.env.ABUSE_WINDOW_SEC || 60), 10);
const ANSWER_PER_WALLET = Math.max(Number(process.env.ABUSE_ANSWER_PER_WALLET_PER_MIN || 120), 20);
const ANSWER_PER_IP = Math.max(Number(process.env.ABUSE_ANSWER_PER_IP_PER_MIN || 240), 40);
const FINGERPRINT_REPEAT_CAP = Math.max(
  Number(process.env.ABUSE_DUPLICATE_PAYLOAD_CAP_PER_MIN || 30),
  5
);

const bucket = () => Math.floor(Date.now() / (WINDOW_SEC * 1000));
const ipKey = (ip, b) => `abuse:ans:ip:${ip || "unknown"}:${b}`;
const walletKey = (w, b) => `abuse:ans:wallet:${String(w || "").toLowerCase()}:${b}`;
const fpKey = (w, fp, b) => `abuse:ans:fp:${String(w || "").toLowerCase()}:${fp}:${b}`;

function payloadFingerprint(body) {
  const stable = JSON.stringify(body || {});
  return crypto.createHash("sha1").update(stable).digest("hex");
}

async function bumpAndRead(key) {
  const redis = await getRedis();
  const v = await redis.incr(key);
  if (v === 1) await redis.expire(key, WINDOW_SEC);
  return v;
}

export function evaluateAbuseCounts({ walletCount, ipCount, fpCount }) {
  if (walletCount > ANSWER_PER_WALLET || ipCount > ANSWER_PER_IP) {
    return {
      blocked: true,
      status: 429,
      code: "RATE_LIMITED",
      message: "Too many answer requests. Slow down.",
    };
  }
  if (fpCount > FINGERPRINT_REPEAT_CAP) {
    return {
      blocked: true,
      status: 429,
      code: "ABUSE_DETECTED",
      message: "Suspicious repeated payload detected.",
    };
  }
  return { blocked: false };
}

export async function gameAnswerAbuseGuard(req, res, next) {
  try {
    const b = bucket();
    const walletAddress = req.user?.walletAddress || "";
    const ip = req.ip || req.socket?.remoteAddress || "unknown";
    const fp = payloadFingerprint(req.body);

    const [walletCount, ipCount, fpCount] = await Promise.all([
      bumpAndRead(walletKey(walletAddress, b)),
      bumpAndRead(ipKey(ip, b)),
      bumpAndRead(fpKey(walletAddress, fp, b)),
    ]);

    const verdict = evaluateAbuseCounts({ walletCount, ipCount, fpCount });
    if (verdict.blocked) {
      return res.status(verdict.status).json({
        success: false,
        message: verdict.message,
        code: verdict.code,
      });
    }

    return next();
  } catch (error) {
    // Fail-open for availability; log and continue
    console.warn("[abuse-guard] soft-fail:", error?.message || error);
    return next();
  }
}

