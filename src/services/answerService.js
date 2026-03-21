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

/**
 * Process a user's answer submission
 * @param {Object} params - Answer parameters
 * @returns {Promise<Object>} Answer result with profile
 */
export async function processAnswer(params) {
  const { walletAddress, hash, guess, isBackup } = params;

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
  const onchain = await recordOnchainWithHash(walletAddress, response, hash);
  if (onchain?.transactionHash) {
    response.onchain = onchain;
  }

  return response;
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
 * Record a new game mode answer to blockchain (exported, fire-and-forget)
 * Called by gameModeService for cardflip, rapidfire, duel, oddoneout, multiselect.
 * @param {string} walletAddress - User wallet
 * @param {Object} params - { primaryHash, answer, isCorrect, profile }
 */
export async function recordModeAnswerOnchain(walletAddress, { primaryHash, answer, isCorrect, profile }) {
  try {
    const session = await loadSession(walletAddress);
    const sessionKey = session?.sessionKey;
    if (!sessionKey) return;

    const questionId = toQuestionId(primaryHash);

    const submission = await recordAnswerSubmissionHash({
      walletAddress,
      sessionKey,
      questionId,
      answer,
      isCorrect
    });

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
  } catch {
    // Session not found or onchain failure — non-blocking
  }
}

/**
 * Record answer to blockchain (fire-and-forget)
 * @param {string} walletAddress - User wallet
 * @param {Object} response - Answer response
 * @param {string} hash - Image hash
 */
async function recordOnchainWithHash(walletAddress, response, hash) {
  // Get session for blockchain recording
  try {
    const session = await loadSession(walletAddress);
    const sessionKey = session?.sessionKey;
    const questionId = toQuestionId(response.imageId ?? hash);
    if (!sessionKey) return null;

    const submission = await recordAnswerSubmissionHash({
      walletAddress,
      sessionKey,
      questionId,
      answer: response.truth,
      isCorrect: response.correct
    });

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

    if (submission?.hash) {
      return { transactionHash: submission.hash };
    }
  } catch {
    // Session not found or onchain failure
  }
  return null;
}
