import crypto from "node:crypto";
import { isAddress, recoverMessageAddress } from "viem";
import { normalizeWallet } from "../utils/normalize.js";

const CHALLENGE_TTL_SEC = Math.max(
  Number(process.env.WALLET_CHALLENGE_TTL_SEC || 300),
  60
);
const CHALLENGE_PREFIX = "auth:challenge:v1";
let redisClient = null;

async function getRedis() {
  if (redisClient) return redisClient;
  const mod = await import("../lib/redis.js");
  redisClient = mod.default;
  return redisClient;
}

export function buildChallengeMessage({ walletAddress, nonce, issuedAtIso, expiresAtIso }) {
  return [
    "Guess The AI - Wallet Login Challenge",
    `Wallet: ${walletAddress}`,
    `Nonce: ${nonce}`,
    `IssuedAt: ${issuedAtIso}`,
    `ExpiresAt: ${expiresAtIso}`,
    "Purpose: Prove wallet ownership for login.",
  ].join("\n");
}

function challengeKey(walletAddress) {
  return `${CHALLENGE_PREFIX}:${walletAddress.toLowerCase()}`;
}

export async function createWalletChallenge(rawWalletAddress) {
  const walletAddress = normalizeWallet(rawWalletAddress);
  if (!walletAddress || !isAddress(walletAddress)) {
    const e = new Error("invalid wallet address");
    e.statusCode = 400;
    throw e;
  }

  const nonce = crypto.randomBytes(16).toString("hex");
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + CHALLENGE_TTL_SEC * 1000);
  const challengeMessage = buildChallengeMessage({
    walletAddress,
    nonce,
    issuedAtIso: issuedAt.toISOString(),
    expiresAtIso: expiresAt.toISOString(),
  });

  const payload = {
    walletAddress,
    nonce,
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    challengeMessage,
  };

  const redis = await getRedis();
  await redis.set(challengeKey(walletAddress), JSON.stringify(payload), "EX", CHALLENGE_TTL_SEC);
  return { ...payload, expiresInSec: CHALLENGE_TTL_SEC };
}

export async function verifyWalletChallenge({ walletAddress: rawWalletAddress, signature }) {
  const walletAddress = normalizeWallet(rawWalletAddress);
  if (!walletAddress || !isAddress(walletAddress)) {
    const e = new Error("invalid wallet address");
    e.statusCode = 400;
    throw e;
  }
  if (!signature || typeof signature !== "string") {
    const e = new Error("signature is required");
    e.statusCode = 400;
    throw e;
  }

  const key = challengeKey(walletAddress);
  const redis = await getRedis();
  const raw = await redis.get(key);
  if (!raw) {
    const e = new Error("challenge expired or not found");
    e.statusCode = 401;
    throw e;
  }
  const challenge = JSON.parse(raw);
  if (!challenge?.challengeMessage) {
    const e = new Error("invalid challenge state");
    e.statusCode = 500;
    throw e;
  }

  const recovered = await recoverMessageAddress({
    message: challenge.challengeMessage,
    signature,
  });
  if (normalizeWallet(recovered) !== walletAddress) {
    const e = new Error("signature does not match wallet");
    e.statusCode = 401;
    throw e;
  }

  // one-time challenge to prevent replay
  await redis.del(key);
  return { walletAddress, nonce: challenge.nonce };
}

