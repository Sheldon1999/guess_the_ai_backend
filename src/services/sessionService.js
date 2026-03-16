/**
 * Session Service
 * Business logic for game session management
 * Max 150 lines per function, max 3 parameters
 */

import { randomUUID } from 'node:crypto';
import redis from '../lib/redis.js';
import { sessionKey, SESSION_TTL_SEC } from '../lib/redisKeys.js';
import { findCanonicalUserByWallet } from '../lib/userStore.js';
import {
  deriveSessionKey,
  recordGameStart,
  recordGameEnd
} from '../lib/onchain/index.js';

/**
 * Get Redis key for session
 * @param {string} wallet - Wallet address
 * @returns {string} Redis key
 */
function getSessionKey(wallet) {
  return sessionKey(wallet);
}

/**
 * Load session from Redis
 * @param {string} wallet - Wallet address
 * @returns {Promise<Object|null>} Session or null
 */
export async function loadSession(wallet) {
  const raw = await redis.get(getSessionKey(wallet));
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch (error) {
    console.warn('[SessionService] Unable to parse session:', error);
    return null;
  }
}

/**
 * Persist session to Redis
 * @param {string} wallet - Wallet address
 * @param {Object} session - Session data
 * @returns {Promise<Object|null>} Persisted session
 */
export async function persistSession(wallet, session) {
  if (!session) return null;

  await redis.set(
    getSessionKey(wallet),
    JSON.stringify(session),
    'EX',
    SESSION_TTL_SEC
  );

  return session;
}

/**
 * Clear session from Redis
 * @param {string} wallet - Wallet address
 */
export async function clearSession(wallet) {
  await redis.del(getSessionKey(wallet));
}

/**
 * Start a new game session
 * @param {string} walletAddress - User wallet
 * @param {Object} options - Session options
 * @returns {Promise<Object>} Session data
 */
export async function startSession(walletAddress, options = {}) {
  const { forceNew = false, sessionId: providedId } = options;

  let session = await loadSession(walletAddress);
  const shouldCreate = !session || forceNew;

  if (shouldCreate) {
    session = await createNewSession(walletAddress, providedId);
  } else {
    session = await refreshSession(walletAddress, session);
  }

  return {
    sessionId: session.sessionId,
    startedAt: session.startedAt,
    totalGuesses: session.totalGuesses || 0,
    correctGuesses: session.correctGuesses || 0
  };
}

/**
 * Create a new session
 * @param {string} walletAddress - User wallet
 * @param {string} providedId - Optional session ID
 * @returns {Promise<Object>} New session
 */
async function createNewSession(walletAddress, providedId) {
  const now = new Date().toISOString();
  const sessionId = providedId?.trim() || randomUUID();
  const sessionKeyValue = deriveSessionKey(sessionId);

  const session = {
    sessionId,
    sessionKey: sessionKeyValue,
    startedAt: now,
    lastUpdatedAt: now,
    totalGuesses: 0,
    correctGuesses: 0
  };

  await persistSession(walletAddress, session);

  // Record to blockchain (fire-and-forget)
  recordGameStart({ walletAddress, sessionKey: sessionKeyValue })
    .then(result => {
      if (result?.error) {
        console.error('[SessionService] Onchain game start error:', result.error);
      }
    })
    .catch(error => {
      console.error('[SessionService] Onchain game start exception:', error);
    });

  return session;
}

/**
 * Refresh existing session timestamp
 * @param {string} walletAddress - User wallet
 * @param {Object} session - Existing session
 * @returns {Promise<Object>} Updated session
 */
async function refreshSession(walletAddress, session) {
  session.lastUpdatedAt = new Date().toISOString();
  await persistSession(walletAddress, session);
  return session;
}

/**
 * End a game session
 * @param {string} walletAddress - User wallet
 * @param {Object} options - End options
 * @returns {Promise<Object>} Session summary
 */
export async function endSession(walletAddress, options = {}) {
  const { sessionId: providedId, completed = true } = options;

  const session = await loadSession(walletAddress);

  if (!session) {
    return { error: 'No active session', statusCode: 404 };
  }

  // Validate session ID if provided
  if (providedId && session.sessionId !== providedId) {
    return { error: 'Session mismatch', statusCode: 409 };
  }

  // Clear the session
  await clearSession(walletAddress);

  // Get user stats for onchain recording
  const userStats = await getUserStats(walletAddress);

  // Record to blockchain
  const onchainResult = await recordGameEndOnchain({
    walletAddress,
    session,
    completed,
    stats: userStats
  });

  return buildEndSessionResponse(session, userStats, onchainResult);
}

/**
 * Get user stats for session end
 * @param {string} walletAddress - User wallet
 * @returns {Promise<Object>} User stats
 */
async function getUserStats(walletAddress) {
  const userDoc = await findCanonicalUserByWallet(walletAddress, {
    projection: { correctAnswers: 1, currentStreak: 1 },
    logLabel: 'sessionService.getUserStats'
  });

  return {
    correctAnswers: userDoc?.correctAnswers ?? 0,
    currentStreak: userDoc?.currentStreak ?? 0
  };
}

/**
 * Record game end to blockchain
 * @param {Object} options - Recording options
 * @param {string} options.walletAddress - User wallet
 * @param {Object} options.session - Session data
 * @param {boolean} options.completed - Whether session was completed
 * @param {Object} options.stats - User stats
 * @returns {Promise<Object>} Blockchain result
 */
async function recordGameEndOnchain({ walletAddress, session, completed, stats }) {
  return await recordGameEnd({
    walletAddress,
    sessionKey: session.sessionKey,
    completed,
    totalCorrect: stats.correctAnswers,
    currentStreak: stats.currentStreak
  });
}

/**
 * Build end session response
 * @param {Object} session - Session data
 * @param {Object} stats - User stats
 * @param {Object} onchainResult - Blockchain result
 * @returns {Object} Response data
 */
function buildEndSessionResponse(session, stats, onchainResult) {
  return {
    sessionId: session.sessionId,
    startedAt: session.startedAt,
    totalGuesses: session.totalGuesses || 0,
    correctGuesses: session.correctGuesses || 0,
    totals: {
      correctAnswers: stats.correctAnswers,
      currentStreak: stats.currentStreak
    },
    onchain: onchainResult?.hash
      ? { transactionHash: onchainResult.hash }
      : null
  };
}
