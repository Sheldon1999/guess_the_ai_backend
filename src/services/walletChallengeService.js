import crypto from "node:crypto";
import { isAddress, getAddress } from "viem";
import { SiweMessage } from "siwe";
import { normalizeWallet } from "../utils/normalize.js";

const CHALLENGE_TTL_SEC = Math.max(
  Number(process.env.WALLET_CHALLENGE_TTL_SEC || 300),
  60
);
const NONCE_PREFIX = "auth:siwe:nonce:v1";
let redisClient = null;

async function getRedis() {
  if (redisClient) return redisClient;
  const mod = await import("../lib/redis.js");
  redisClient = mod.default;
  return redisClient;
}

function nonceKey(walletAddress) {
  return `${NONCE_PREFIX}:${walletAddress.toLowerCase()}`;
}

export async function createWalletChallenge(rawWalletAddress) {
  const normalized = normalizeWallet(rawWalletAddress);
  if (!normalized || !isAddress(normalized)) {
    const e = new Error("invalid wallet address");
    e.statusCode = 400;
    throw e;
  }
  const walletAddress = getAddress(normalized);

  const nonce = crypto.randomBytes(16).toString("hex");
  const issuedAt = new Date();

  const siweMessage = new SiweMessage({
    domain: process.env.APP_DOMAIN || "guesstheai.xyz",
    address: walletAddress,
    statement: "Sign in to Guess The AI",
    uri: process.env.APP_URI || "https://guesstheai.xyz",
    version: "1",
    chainId: Number(process.env.APP_CHAIN_ID || 1),
    nonce,
    issuedAt: issuedAt.toISOString(),
  });

  const challengeMessage = siweMessage.prepareMessage();

  const redis = await getRedis();
  await redis.set(nonceKey(walletAddress), nonce, "EX", CHALLENGE_TTL_SEC);

  return {
    walletAddress,
    nonce,
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(issuedAt.getTime() + CHALLENGE_TTL_SEC * 1000).toISOString(),
    challengeMessage,
    expiresInSec: CHALLENGE_TTL_SEC,
  };
}

export async function verifyWalletChallenge({ message, signature }) {
  if (!message || typeof message !== "string") {
    const e = new Error("message is required");
    e.statusCode = 400;
    throw e;
  }
  if (!signature || typeof signature !== "string") {
    const e = new Error("signature is required");
    e.statusCode = 400;
    throw e;
  }

  let siweMessage;
  try {
    siweMessage = new SiweMessage(message);
  } catch {
    const e = new Error("invalid SIWE message format");
    e.statusCode = 400;
    throw e;
  }

  const walletAddress = normalizeWallet(siweMessage.address);
  if (!walletAddress) {
    const e = new Error("could not extract wallet address from SIWE message");
    e.statusCode = 400;
    throw e;
  }

  const redis = await getRedis();
  const storedNonce = await redis.get(nonceKey(walletAddress));
  if (!storedNonce || storedNonce !== siweMessage.nonce) {
    const e = new Error("invalid or expired nonce");
    e.statusCode = 401;
    throw e;
  }

  let result;
  try {
    result = await siweMessage.verify({ signature });
  } catch {
    await redis.del(nonceKey(walletAddress));
    const e = new Error("SIWE verification failed");
    e.statusCode = 401;
    throw e;
  }

  if (!result.success) {
    await redis.del(nonceKey(walletAddress));
    const e = new Error("invalid SIWE signature");
    e.statusCode = 401;
    throw e;
  }

  await redis.del(nonceKey(walletAddress));
  return { walletAddress, nonce: siweMessage.nonce };
}
