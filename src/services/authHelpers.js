/**
 * Auth Helpers
 * Utility functions for authentication service
 * Max 150 lines
 */

const DEBUG_V2_LOGIN = ["1", "true", "yes", "on"].includes(
  String(process.env.DEBUG_V2_LOGIN || "").toLowerCase()
);

import { withGuessTheAiCrossGame } from '../utils/crossGame.js';

/**
 * Check if value is a plain object
 * @param {*} value - Value to check
 * @returns {boolean} True if plain object
 */
export const isPlainObject = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

/**
 * Mask sensitive value for logging
 * @param {string} value - Value to mask
 * @returns {string} Masked value
 */
export const maskValue = (value) => {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.length <= 8) return `${trimmed.slice(0, 2)}***`;
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
};

/**
 * Log gate authentication events
 * @param {string} stage - Log stage
 * @param {Object} data - Log data
 */
export const gateAuthLog = (stage, data) => {
  if (process.env.GATE_DEBUG === "1") {
    console.log(`[gate-auth] ${stage}`, data);
  }
};

/**
 * Resolve wallet type from context
 * @param {Object} context - Auth context
 * @returns {string} Wallet type
 */
export const resolveWalletType = (context) => {
  if (!context) return "normal";
  if (context.incomingMeta?.type) return context.incomingMeta.type;
  if (context.request?.sessionWallet === "VERIFIED") return "gate_wallet";
  return "normal";
};

/**
 * Summarize metadata for logging
 * @param {Object} meta - Metadata object
 * @returns {Object} Summary
 */
export const summarizeMeta = (meta) => {
  if (!isPlainObject(meta)) return { keys: [] };
  return {
    keys: Object.keys(meta),
    hasEmail: Boolean(meta.email),
    hasPrivyUserId: Boolean(meta.privyUserId),
    hasDiscord: Boolean(meta.discord || meta.discordUserId),
    hasWallet: Boolean(meta.address || meta.walletAddress || meta.embeddedWalletAddress)
  };
};

/**
 * Log V2 login events
 * @param {string} level - Log level (info, warn, error)
 * @param {string} stage - Log stage
 * @param {Object} data - Log data
 */
export const logV2 = (level, stage, data) => {
  if (!DEBUG_V2_LOGIN) return;
  const prefix = `[v2/login] ${stage}`;
  if (level === "error") {
    console.error(prefix, data);
  } else if (level === "warn") {
    console.warn(prefix, data);
  } else {
    console.log(prefix, data);
  }
};

/**
 * Create HTTP error with status code
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Error message
 * @param {string} code - Error code
 * @returns {Error} HTTP error
 */
export const createHttpError = (statusCode, message, code) => {
  const err = new Error(message);
  err.statusCode = statusCode;
  if (code) err.code = code;
  return err;
};

/**
 * Build user payload for response
 * @param {Object} doc - User document
 * @param {Object} privyMetaData - Privy metadata
 * @param {Function} normalizeWallet - Wallet normalizer
 * @returns {Object} User payload
 */
export const buildUserPayload = (doc, privyMetaData, normalizeWallet) => {
  const walletAddress = normalizeWallet(doc?.walletAddress);
  return withGuessTheAiCrossGame({
    walletAddress,
    username: doc?.username || `Player_${Date.now()}`,
    correctAnswers: Number(doc?.correctAnswers) || 0,
    currentStreak: Number(doc?.currentStreak) || 0,
    streak: Number(doc?.streak) || 0,
    rank: doc?.rank || "E",
    dungeonTitle: doc?.dungeonTitle || "Newbie",
    privyMetaData: isPlainObject(privyMetaData) ? privyMetaData : doc?.privyMetaData || {}
  });
};
