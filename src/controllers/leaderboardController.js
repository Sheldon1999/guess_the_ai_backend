/**
 * Leaderboard Controller
 * Handles leaderboard HTTP requests
 */

import * as leaderboardService from '../services/leaderboardService.js';
import { sendServerError } from '../utils/response.js';

/**
 * Get all-time leaderboard
 * GET /api/leaderboard/alltime
 * Query params: limit (default 10), page (default 1), wallet (optional - for current user rank)
 */
export async function getAllTimeLeaderboardHandler(req, res) {
  try {
    const limit = Math.min(Math.max(parseInt(req.query?.limit) || 10, 1), 100);
    const page = Math.max(parseInt(req.query?.page) || 1, 1);
    const currentWallet = req.query?.wallet || null;

    const result = await leaderboardService.getAllTimeLeaderboard({
      limit,
      page,
      currentWallet
    });

    // Set cache header
    res.set('Cache-Control', 'public, max-age=60');

    return res.json(result);
  } catch (error) {
    return sendServerError(res, error, 'LeaderboardController.getAllTime');
  }
}

/**
 * Get gate users leaderboard
 * GET /api/leaderboard/gateUsers
 * Query params: limit (default 10), type (default 'all'), page (default 1), wallet (optional - for current user rank)
 */
export async function getGateUsersLeaderboardHandler(req, res) {
  try {
    const limit = Math.min(Math.max(parseInt(req.query?.limit) || 10, 1), 100);
    const page = Math.max(parseInt(req.query?.page) || 1, 1);
    const type = req.query?.type || 'all';
    const currentWallet = req.query?.wallet || null;

    const result = await leaderboardService.getGateUsersLeaderboard({
      limit,
      type,
      page,
      currentWallet
    });

    // Set cache header
    res.set('Cache-Control', 'public, max-age=60');

    return res.json(result);
  } catch (error) {
    return sendServerError(res, error, 'LeaderboardController.getGateUsers');
  }
}
