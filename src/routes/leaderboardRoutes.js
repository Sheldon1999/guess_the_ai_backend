/**
 * Leaderboard Routes
 * Route definitions - only call controllers
 */

import {
  getAllTimeLeaderboardHandler,
  getGateUsersLeaderboardHandler
} from '../controllers/leaderboardController.js';

export default function leaderboardRoutes(app) {
  // All-time leaderboard
  app.get('/api/leaderboard/alltime', getAllTimeLeaderboardHandler);

  // Gate users leaderboard
  app.get('/api/leaderboard/gateUsers', getGateUsersLeaderboardHandler);
}
