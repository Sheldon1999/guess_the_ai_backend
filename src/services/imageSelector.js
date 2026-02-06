/**
 * Image Selector Service
 * Handles random image selection for the game
 *
 * Responsibilities:
 * - Select random images from Redis queue
 * - Select random images from backup list
 * - Build image response objects
 */

import { localRandomIndex } from '../lib/random.js';
import redis from '../lib/redis.js';
import { READY_QUEUE_KEY } from '../lib/redisKeys.js';
import { images } from '../lib/mongo.js';
import backupAnswerList from '../lib/backup_answer.js';

const IMAGE_BATCH_SIZE = 10;
const MAX_SAMPLE_ATTEMPTS_MULTIPLIER = 3;

/**
 * Build image URL from hash
 * @param {string} imageHash - Image hash
 * @returns {string} Image API URL
 */
function buildImageUrl(imageHash) {
  return `/api/img/h/${encodeURIComponent(imageHash)}`;
}

/**
 * Sample unique random indexes from a range
 * @param {number} listLength - Total list length
 * @param {number} sampleCount - Number of samples needed
 * @returns {Promise<number[]>} Array of unique indexes
 */
async function sampleUniqueIndexes(listLength, sampleCount = 1) {
  try {
    if (!Number.isInteger(listLength) || listLength <= 0) return [];

    const targetCount = Math.min(sampleCount, listLength);
    const selectedIndexes = new Set();
    const maxAttempts = listLength * MAX_SAMPLE_ATTEMPTS_MULTIPLIER;
    let attemptCount = 0;

    while (selectedIndexes.size < targetCount && attemptCount < maxAttempts) {
      attemptCount++;
      const randomIndex = localRandomIndex(listLength);
      selectedIndexes.add(randomIndex);
    }

    return Array.from(selectedIndexes);
  } catch (error) {
    console.error('[ImageSelector] sampleUniqueIndexes error:', error);
    return [];
  }
}

/**
 * Fetch image hashes from Redis by indexes
 * @param {number[]} indexes - Array of list indexes
 * @returns {Promise<string[]>} Array of image hashes
 */
async function fetchHashesByIndexes(indexes) {
  if (!indexes.length) return [];

  const redisPipeline = redis.multi();
  indexes.forEach(index => redisPipeline.lindex(READY_QUEUE_KEY, index));

  const pipelineResults = await redisPipeline.exec();
  return pipelineResults
    .map(([, hashValue]) => hashValue)
    .filter(Boolean);
}

/**
 * Get image ID from MongoDB
 * @param {string} imageHash - Image hash
 * @returns {Promise<string|null>} Image ID or null
 */
async function getImageIdFromDatabase(imageHash) {
  const imageDocument = await images.findOne(
    { hash: imageHash },
    { projection: { _id: 1, hash: 1, label: 1, imageId: 1 } }
  );

  return imageDocument?.imageId || null;
}

/**
 * Build image response object
 * @param {string} imageHash - Image hash
 * @param {string} imageId - Image ID (optional)
 * @returns {Object} Image response object
 */
function buildImageResponse(imageHash, imageId = null) {
  return {
    imageId: String(imageId ?? imageHash),
    hash: imageHash,
    url: buildImageUrl(imageHash)
  };
}

/**
 * Pick 10 random images from Redis queue
 * @param {string} walletAddress - User wallet (for logging)
 * @returns {Promise<{status: number, body: Object|null}>} Response with image list
 */
export async function pickRandomImagesFromQueue(walletAddress) {
  try {
    const queueLength = await redis.llen(READY_QUEUE_KEY);

    if (!queueLength) {
      return { status: 204, body: null };
    }

    const randomIndexes = await sampleUniqueIndexes(queueLength, IMAGE_BATCH_SIZE);
    if (!randomIndexes.length) {
      return { status: 204, body: null };
    }

    const selectedHashes = await fetchHashesByIndexes(randomIndexes);
    if (!selectedHashes.length) {
      return { status: 204, body: null };
    }

    const imageList = await Promise.all(
      selectedHashes.map(async (imageHash) => {
        const imageId = await getImageIdFromDatabase(imageHash);
        return buildImageResponse(imageHash, imageId);
      })
    );

    return {
      status: 200,
      body: { image_list: imageList }
    };
  } catch (error) {
    console.error('[ImageSelector] pickRandomImagesFromQueue error:', error);
    return { status: 204, body: null };
  }
}

/**
 * Pick a single random image from backup list
 * @param {string} walletAddress - User wallet (for logging)
 * @returns {Promise<{status: number, body: Object|null}>} Response with single image
 */
export async function pickRandomImageFromBackup(walletAddress) {
  try {
    const backupListLength = backupAnswerList.length;

    if (!backupListLength) {
      return { status: 204, body: null };
    }

    const [selectedIndex] = await sampleUniqueIndexes(backupListLength, 1);

    if (selectedIndex === null || selectedIndex === undefined) {
      return { status: 204, body: null };
    }

    const selectedEntry = backupAnswerList[selectedIndex];
    const imageHash = selectedEntry?.file_name;

    if (!imageHash) {
      return { status: 204, body: null };
    }

    return {
      status: 200,
      body: buildImageResponse(imageHash)
    };
  } catch (error) {
    console.error('[ImageSelector] pickRandomImageFromBackup error:', error);
    return { status: 204, body: null };
  }
}

// Backward compatible exports with old names
export const pick10RandomHashes = pickRandomImagesFromQueue;
export const pickBackupImage = pickRandomImageFromBackup;
