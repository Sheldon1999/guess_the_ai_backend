/**
 * Game Service
 * Business logic for game/image operations
 * Max 150 lines per function, max 3 parameters
 */

import { fetchUserProfile, fetchImageMeta } from '../lib/docCache.js';
import {
  pickRandomImagesFromQueue,
  pickRandomImageFromBackup
} from './imageSelector.js';

/**
 * Get next single image for user
 * @param {string} walletAddress - User wallet
 * @returns {Promise<{status: number, body?: Object}>} Result with image data
 */
export async function getNextImage(walletAddress) {
  // Ensure user profile is cached for fast answer processing
  await fetchUserProfile(walletAddress);

  return await pickRandomImageFromBackup(walletAddress);
}

/**
 * Get next 10 images for user
 * @param {string} walletAddress - User wallet
 * @returns {Promise<{status: number, body?: Object}>} Result with image list
 */
export async function getNext10Images(walletAddress) {
  // Ensure user profile is cached for fast answer processing
  await fetchUserProfile(walletAddress);

  return await pickRandomImagesFromQueue(walletAddress);
}

/**
 * Get image metadata by hash
 * @param {string} hash - Image hash
 * @returns {Promise<Object|null>} Image metadata or null
 */
export async function getImageMeta(hash) {
  return await fetchImageMeta(hash);
}
