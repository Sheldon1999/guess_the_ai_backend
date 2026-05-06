/**
 * Health Routes
 * Route definitions for health check endpoints
 */

import {
  healthCheckHandler,
  dependenciesHealthHandler,
  daQueueHealthHandler
} from '../controllers/healthController.js';

export default function healthRoutes(app) {
  app.get('/api/health', healthCheckHandler);
  app.get('/api/health/deps', dependenciesHealthHandler);
  app.get('/api/health/da-queue', daQueueHealthHandler);
}
