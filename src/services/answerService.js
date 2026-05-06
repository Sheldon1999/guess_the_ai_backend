/**
 * Answer Service
 * Business logic for answer processing
 * Max 150 lines per function, max 3 parameters
 */

import redis from '../lib/redis.js';
import {
  handleBackupAnswer,
  handleMongoAnswer,
  handleRedisAnswer
} from './answerHandler.js';
import { getGateUserRedis, updateGateUserScoreRedis } from './gate.js';
import { loadSession } from './sessionService.js';
import { recordAnswerSubmissionHash, recordSeasonScore } from '../lib/onchain/index.js';
import { toQuestionId } from '../utils/crypto.js';
import { publishDaAnswerGatewayEvent } from './daGateway.js';

function extractTransactionHash(result) {
  if (!result || typeof result !== 'object') return null;
  const candidates = [
    result.transactionHash,
    result.hash,
    result.txHash,
    result.receipt?.transactionHash,
    result.error?.transactionHash
  ];
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) return value;
  }
  return null;
}

/**
 * Process a user's answer submission
 * @param {Object} params - Answer parameters
 * @returns {Promise<Object>} Answer result with profile
 */
export async function processAnswer(params) {
  const { walletAddress, hash, guess, isBackup } = params;
  const startedAtMs = Date.now();

  // Get answer result based on Redis availability
  const answerResult = await getAnswerResult({
    walletAddress,
    hash,
    guess,
    isBackup
  });

  if (!answerResult) {
    return null;
  }

  // Build response
  const response = buildAnswerResponse(answerResult, hash, guess);

  // Update gate user stats if applicable
  await updateGateStats(walletAddress, response);

  // Record to blockchain and attach tx hash if available
  const onchain = await recordOnchainWithHash(walletAddress, response, hash, guess);
  if (onchain?.transactionHash) {
    response.onchain = onchain;
  }

  await recordDaAnswerEvent({
    walletAddress,
    hash,
    guess,
    isCorrect: response.correct,
    latencyMs: Date.now() - startedAtMs
  });

  return response;
}

async function claimOnchainSubmissionLock({ walletAddress, sessionKey, questionId }) {
  if (!walletAddress || !sessionKey || questionId === undefined || questionId === null) {
    return false;
  }
  const key = `onchain:submission:${walletAddress.toLowerCase()}:${sessionKey}:${questionId}`;
  const claimed = await redis.set(key, "1", "EX", 60 * 60 * 24, "NX");
  return claimed === "OK";
}

/**
 * Get answer result from appropriate handler
 * @param {Object} params - Handler parameters
 * @returns {Promise<Object|null>} Answer result
 */
async function getAnswerResult(params) {
  const { walletAddress, hash, guess, isBackup } = params;

  if (redis.status !== 'ready') {
    return await handleMongoAnswer(walletAddress, hash, guess);
  }

  if (isBackup) {
    return await handleBackupAnswer(walletAddress, hash, guess);
  }

  return await handleRedisAnswer(walletAddress, hash, guess);
}

/**
 * Build answer response object
 * @param {Object} answerResult - Raw answer result
 * @param {string} hash - Image hash
 * @param {string} guess - User guess
 * @returns {Object} Formatted response
 */
function buildAnswerResponse(answerResult, hash, guess) {
  const { profile, imageId, truth, correct } = answerResult;

  const isCorrect = typeof correct === 'boolean'
    ? correct
    : (truth ? guess === truth : null);

  const profileResponse = formatProfileResponse(profile);

  return {
    correct: isCorrect,
    isCorrect,
    truth,
    imageId: imageId ?? hash,
    hash,
    profile: profileResponse,
    gateStats: null
  };
}

/**
 * Format profile for response
 * @param {Object} profile - User profile
 * @returns {Object} Formatted profile
 */
function formatProfileResponse(profile) {
  return {
    username: profile?.username,
    correctAnswers: profile?.correctAnswers,
    currentStreak: profile?.currentStreak,
    streak: profile?.streak,
    rank: profile?.rank,
    dungeonTitle: profile?.dungeonTitle
  };
}

/**
 * Update gate user stats if applicable
 * @param {string} walletAddress - User wallet
 * @param {Object} response - Answer response (mutated)
 */
async function updateGateStats(walletAddress, response) {
  const cachedGateUser = await getGateUserRedis(walletAddress);

  if (!cachedGateUser) return;

  await updateGateUserScoreRedis(walletAddress, response.correct);

  const updatedGateUser = await getGateUserRedis(walletAddress);
  response.profile.campaign = formatProfileResponse(updatedGateUser);
  response.gateStats = updatedGateUser;
}

/**
 * Record a new game mode answer to blockchain.
 * Called by gameModeService for cardflip, rapidfire, duel, oddoneout, multiselect.
 * @param {string} walletAddress - User wallet
 * @param {Object} params - { primaryHash, answer, isCorrect, profile }
 */
export async function recordModeAnswerOnchain(walletAddress, { primaryHash, answer, isCorrect, profile }) {
  try {
    const session = await loadSession(walletAddress);
    const sessionKey = session?.sessionKey;
    if (!sessionKey) return null;

    const questionId = toQuestionId(primaryHash);
    const lockGranted = await claimOnchainSubmissionLock({ walletAddress, sessionKey, questionId });
    if (!lockGranted) {
      return null;
    }

    const submission = await recordAnswerSubmissionHash({
      walletAddress,
      sessionKey,
      questionId,
      answer,
      isCorrect
    });
    const transactionHash = extractTransactionHash(submission);

    if (submission?.error) {
      console.error('[AnswerService] onchain submission error:', submission.error);
    }

    if (isCorrect && profile?.correctAnswers != null) {
      recordSeasonScore({
        walletAddress,
        totalCorrect: profile.correctAnswers
      })
        .then(result => {
          if (result?.error) {
            console.error('[AnswerService] onchain leaderboard error:', result.error);
          }
        })
        .catch(error => {
          console.error('[AnswerService] onchain leaderboard exception:', error);
        });
    }

    publishDaAnswerGatewayEvent({
      flow: "game_mode",
      walletAddress,
      sessionKey,
      sessionId: session?.sessionId ?? null,
      hash: primaryHash,
      guess: answer,
      isCorrect: Boolean(isCorrect),
      latencyMs: 0,
      ts: new Date().toISOString()
    });

    if (transactionHash) {
      return { transactionHash };
    }
  } catch {
    // Session not found or onchain failure — non-blocking
  }

  return null;
}

async function recordDaAnswerEvent({ walletAddress, hash, guess, isCorrect, latencyMs }) {
  try {
    const session = await loadSession(walletAddress);
    const sessionKey = session?.sessionKey;
    if (!sessionKey) return;

    publishDaAnswerGatewayEvent({
      flow: "classic",
      walletAddress,
      sessionKey,
      sessionId: session?.sessionId ?? null,
      hash,
      guess,
      isCorrect: Boolean(isCorrect),
      latencyMs: Number(latencyMs) || 0,
      ts: new Date().toISOString()
    });
  } catch (error) {
    console.error('[AnswerService] DA gateway publish error:', error);
  }
}

/**
 * Record answer to blockchain (fire-and-forget)
 * @param {string} walletAddress - User wallet
 * @param {Object} response - Answer response
 * @param {string} hash - Image hash
 */
async function recordOnchainWithHash(walletAddress, response, hash, guess) {
  // Get session for blockchain recording
  try {
    const session = await loadSession(walletAddress);
    const sessionKey = session?.sessionKey;
    const questionId = toQuestionId(response.imageId ?? hash);
    if (!sessionKey) return null;
    const lockGranted = await claimOnchainSubmissionLock({ walletAddress, sessionKey, questionId });
    if (!lockGranted) return null;

    const submission = await recordAnswerSubmissionHash({
      walletAddress,
      sessionKey,
      questionId,
      answer: guess,
      isCorrect: response.correct
    });
    const transactionHash = extractTransactionHash(submission);

    if (submission?.error) {
      console.error('[AnswerService] onchain submission error:', submission.error);
    }

    if (response.correct && response.profile?.correctAnswers != null) {
      recordSeasonScore({
        walletAddress,
        totalCorrect: response.profile.correctAnswers
      })
        .then(result => {
          if (result?.error) {
            console.error('[AnswerService] onchain leaderboard error:', result.error);
          }
        })
        .catch(error => {
          console.error('[AnswerService] onchain leaderboard exception:', error);
        });
    }

    if (transactionHash) {
      return { transactionHash };
    }
  } catch {
    // Session not found or onchain failure
  }
  return null;
}
