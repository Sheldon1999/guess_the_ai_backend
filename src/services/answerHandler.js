/**
 * Answer Handler Service
 * Handles answer processing with Redis and MongoDB fallback
 *
 * Responsibilities:
 * - Process user answers from Redis cache
 * - Fallback to MongoDB when Redis unavailable
 * - Fallback to backup data when both fail
 * - Calculate user stats (streak, rank, title)
 */

import { fetchImageMeta, fetchUserProfile, writeUserToRedis } from '../lib/docCache.js';
import { rankFromCorrect, titleFromStreak, rankSwitchExpression, titleSwitchExpression } from '../lib/rank.js';
import backupAnswerList from '../lib/backup_answer.js';
import { getTruthLabel } from '../lib/kv.js';
import { images, users } from '../lib/mongo.js';
import { findCanonicalUserByWallet } from '../lib/userStore.js';
import { normalizeHash, normalizeGuess } from '../utils/normalize.js';

/**
 * Format user profile for API response
 * @param {Object} userProfile - Raw user profile
 * @returns {Object|null} Formatted profile response
 */
function formatProfileResponse(userProfile) {
  if (!userProfile) return null;
  return {
    username: userProfile.username,
    correctAnswers: userProfile.correctAnswers,
    currentStreak: userProfile.currentStreak,
    streak: userProfile.streak,
    rank: userProfile.rank,
    dungeonTitle: userProfile.dungeonTitle
  };
}

/**
 * Calculate updated user stats based on answer correctness
 * @param {Object} currentProfile - Current user profile
 * @param {boolean} isCorrectAnswer - Whether answer was correct
 * @returns {Object} Updated stats
 */
function calculateUpdatedStats(currentProfile, isCorrectAnswer) {
  const correctAnswersCount = isCorrectAnswer
    ? currentProfile.correctAnswers + 1
    : currentProfile.correctAnswers;

  const currentStreakCount = isCorrectAnswer
    ? currentProfile.currentStreak + 1
    : 0;

  const maxStreakCount = isCorrectAnswer
    ? Math.max(currentStreakCount, currentProfile.streak)
    : currentProfile.streak;

  return {
    correctAnswers: correctAnswersCount,
    currentStreak: currentStreakCount,
    streak: maxStreakCount,
    rank: rankFromCorrect(correctAnswersCount),
    dungeonTitle: titleFromStreak(maxStreakCount)
  };
}

/**
 * Get truth label from backup answer list
 * @param {string} imageHash - Image hash to lookup
 * @returns {string|null} Truth label ('ai' or 'human') or null
 */
function getTruthFromBackup(imageHash) {
  const matchingEntry = backupAnswerList.find(item => item.file_name === imageHash);
  return matchingEntry ? normalizeGuess(matchingEntry.answer) : null;
}

/**
 * Get image ID from MongoDB
 * @param {string} imageHash - Image hash
 * @returns {Promise<string|null>} Image ID or null
 */
async function getImageIdFromDatabase(imageHash) {
  const normalizedHash = normalizeHash(imageHash);
  if (!normalizedHash) return null;

  const imageDocument = await images.findOne(
    { hash: normalizedHash },
    { projection: { _id: 1, hash: 1, label: 1, imageId: 1 } }
  );

  if (imageDocument?.imageId) return imageDocument.imageId;
  if (imageDocument?._id) return String(imageDocument._id);
  return null;
}

/**
 * Handle answer using Redis cache (fast path)
 * Falls back to MongoDB if cache miss
 *
 * @param {string} walletAddress - User wallet address
 * @param {string} imageHash - Image hash
 * @param {string} userGuess - User's guess ('ai' or 'human')
 * @returns {Promise<Object>} Answer result with profile
 */
export async function handleRedisAnswer(walletAddress, imageHash, userGuess) {
  try {
    const currentTimestamp = new Date();

    const imageMeta = await fetchImageMeta(imageHash);
    if (!imageMeta?.imageId) {
      return await handleMongoAnswer(walletAddress, imageHash, userGuess);
    }

    const truthLabel = normalizeGuess(imageMeta.label);
    if (!truthLabel) {
      return await handleMongoAnswer(walletAddress, imageHash, userGuess);
    }

    const userProfile = await fetchUserProfile(walletAddress);
    if (!userProfile) {
      return await handleMongoAnswer(walletAddress, imageHash, userGuess);
    }

    const isCorrectAnswer = userGuess === truthLabel;
    const updatedStats = calculateUpdatedStats(userProfile, isCorrectAnswer);

    const updatedProfile = {
      ...userProfile,
      ...updatedStats,
      lastUpdatedAt: currentTimestamp.toISOString()
    };

    await writeUserToRedis(updatedProfile, true);

    return {
      profile: formatProfileResponse(updatedProfile),
      imageId: imageMeta.imageId,
      truth: truthLabel,
      correct: isCorrectAnswer,
      isCorrect: isCorrectAnswer
    };
  } catch (error) {
    console.error('[AnswerHandler] handleRedisAnswer error:', error);
    return null;
  }
}

/**
 * Handle answer using MongoDB (fallback path)
 * Uses aggregation pipeline for atomic updates
 *
 * @param {string} walletAddress - User wallet address
 * @param {string} imageHash - Image hash
 * @param {string} userGuess - User's guess ('ai' or 'human')
 * @returns {Promise<Object>} Answer result with profile
 */
export async function handleMongoAnswer(walletAddress, imageHash, userGuess) {
  try {
    const currentTimestamp = new Date();

    let imageId;
    let truthLabel;

    try {
      imageId = await getImageIdFromDatabase(imageHash);
      truthLabel = await getTruthLabel(imageHash);
    } catch (dbError) {
      // Fallback to backup data
      imageId = imageHash;
      truthLabel = getTruthFromBackup(imageHash);
    }

    const isCorrectAnswer = truthLabel ? userGuess === truthLabel : false;
    const existingUser = await findCanonicalUserByWallet(walletAddress, {
      projection: {
        _id: 1,
        username: 1,
        correctAnswers: 1,
        currentStreak: 1,
        streak: 1,
        rank: 1,
        dungeonTitle: 1
      },
      logLabel: 'answerHandler.handleMongoAnswer'
    });

    if (!existingUser) {
      return null;
    }

    // MongoDB aggregation expressions for atomic update
    const baseCorrectAnswers = { $ifNull: ['$correctAnswers', 0] };
    const baseCurrentStreak = { $ifNull: ['$currentStreak', 0] };
    const baseStreak = { $ifNull: ['$streak', 0] };

    const updatedCorrectAnswers = isCorrectAnswer
      ? { $add: [baseCorrectAnswers, 1] }
      : baseCorrectAnswers;

    const updatedCurrentStreak = isCorrectAnswer
      ? { $add: [baseCurrentStreak, 1] }
      : 0;

    const computedMaxStreak = isCorrectAnswer
      ? { $cond: [{ $gt: ['$currentStreak', baseStreak] }, '$currentStreak', baseStreak] }
      : baseStreak;

    const rankExpression = rankSwitchExpression('$correctAnswers');
    const dungeonTitleExpression = titleSwitchExpression(computedMaxStreak);

    const updateResult = await users.findOneAndUpdate(
      { _id: existingUser._id },
      [
        {
          $set: {
            correctAnswers: updatedCorrectAnswers,
            currentStreak: updatedCurrentStreak
          }
        },
        {
          $set: {
            streak: computedMaxStreak,
            rank: rankExpression,
            dungeonTitle: dungeonTitleExpression,
            updatedAt: currentTimestamp,
            lastUpdatedAt: currentTimestamp,
            lastFlushedAt: currentTimestamp
          }
        }
      ],
      {
        returnDocument: 'after',
        projection: {
          username: 1,
          correctAnswers: 1,
          currentStreak: 1,
          streak: 1,
          rank: 1,
          dungeonTitle: 1
        }
      }
    );

    const updatedProfile = updateResult?.value || updateResult;

    return {
      profile: formatProfileResponse(updatedProfile),
      imageId: imageId ?? imageHash,
      truth: truthLabel,
      correct: isCorrectAnswer,
      isCorrect: isCorrectAnswer
    };
  } catch (error) {
    console.error('[AnswerHandler] handleMongoAnswer error:', error);
    return null;
  }
}

/**
 * Handle answer using backup data (emergency fallback)
 * Uses local answer list when database is unavailable
 *
 * @param {string} walletAddress - User wallet address
 * @param {string} imageHash - Image hash
 * @param {string} userGuess - User's guess ('ai' or 'human')
 * @returns {Promise<Object>} Answer result with profile
 */
export async function handleBackupAnswer(walletAddress, imageHash, userGuess) {
  try {
    const currentTimestamp = new Date();

    const truthLabel = getTruthFromBackup(imageHash);
    const isCorrectAnswer = userGuess === truthLabel;

    const userProfile = await fetchUserProfile(walletAddress);
    if (!userProfile) return null;

    const updatedStats = calculateUpdatedStats(userProfile, isCorrectAnswer);

    const updatedProfile = {
      ...userProfile,
      ...updatedStats,
      lastUpdatedAt: currentTimestamp.toISOString()
    };

    await writeUserToRedis(updatedProfile, true);

    return {
      profile: formatProfileResponse(updatedProfile),
      imageId: imageHash,
      truth: truthLabel,
      correct: isCorrectAnswer,
      isCorrect: isCorrectAnswer
    };
  } catch (error) {
    console.error('[AnswerHandler] handleBackupAnswer error:', error);
    return null;
  }
}
