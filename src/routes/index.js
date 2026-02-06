/**
 * Routes Index
 * Centralized route registration
 */

import userRoutes from './userRoutes.js';
import gameRoutes from './gameRoutes.js';
import sessionRoutes from './sessionRoutes.js';
import leaderboardRoutes from './leaderboardRoutes.js';
import healthRoutes from './health.js';
import imageRoutes from './image.js';

/**
 * Register all routes
 * @param {Express} app - Express application
 */
export function registerRoutes(app) {
  userRoutes(app);
  gameRoutes(app);
  sessionRoutes(app);
  leaderboardRoutes(app);
  healthRoutes(app);
  imageRoutes(app);
}

// Export individual route modules for backward compatibility
export {
  userRoutes,
  gameRoutes,
  sessionRoutes,
  leaderboardRoutes,
  healthRoutes,
  imageRoutes
};
