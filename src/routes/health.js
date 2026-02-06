/**
 * Health Routes
 * Route definitions for health check endpoints
 */

import {
  healthCheckHandler,
  dependenciesHealthHandler
} from '../controllers/healthController.js';

export default function healthRoutes(app) {
  app.get('/api/health', healthCheckHandler);
  app.get('/api/health/deps', dependenciesHealthHandler);
}
