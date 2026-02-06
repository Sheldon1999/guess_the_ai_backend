/**
 * Leaderboard Service
 * Business logic for leaderboard operations
 * Max 150 lines per function, max 3 parameters
 */

import { topAllTime } from '../lib/leaderboard.js';
import { flushDirtyUsers } from '../lib/docCache.js';
import { flushGateUsers, getGateWalletLeaderboard } from './gate.js';

/**
 * Get all-time leaderboard with pagination
 * @param {Object} params - Parameters object
 * @param {number} params.limit - Max entries per page
 * @param {number} params.page - Page number (1-based)
 * @param {string} params.currentWallet - Optional wallet for user rank
 * @returns {Promise<Object>} Leaderboard result with pagination
 */
export async function getAllTimeLeaderboard({ limit = 10, page = 1, currentWallet = null }) {
  // Flush dirty users to ensure fresh data
  await flushDirtyUsers().catch(err => {
    console.warn('[LeaderboardService] Flush failed:', err);
  });

  return await topAllTime(limit, page, currentWallet);
}

/**
 * Get gate users leaderboard with pagination
 * @param {Object} params - Parameters object
 * @param {number} params.limit - Max entries per page
 * @param {string} params.type - Filter type ('all' or specific)
 * @param {number} params.page - Page number (1-based)
 * @param {string} params.currentWallet - Optional wallet for user rank
 * @returns {Promise<Object>} Leaderboard result with pagination
 */
export async function getGateUsersLeaderboard({ limit = 10, type = 'all', page = 1, currentWallet = null }) {
  // Flush gate users to ensure fresh data
  await flushGateUsers().catch(err => {
    console.warn('[LeaderboardService] Gate flush failed:', err);
  });

  const result = await getGateWalletLeaderboard(limit, type, page, currentWallet);

  return {
    success: true,
    data: result.data,
    pagination: result.pagination,
    currentUserRank: result.currentUserRank
  };
}
