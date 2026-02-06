/**
 * Session Routes
 * Route definitions - only call controllers
 */

import { protect } from '../middleware/jwt.js';
import {
  startSessionHandler,
  endSessionHandler
} from '../controllers/sessionController.js';

// Re-export session utilities for backward compatibility
export { loadSession, persistSession, clearSession } from '../services/sessionService.js';
export { normalizeGuess } from '../utils/normalize.js';

export default function sessionRoutes(app) {
  // Start session
  app.post('/api/game/session/start', protect, startSessionHandler);

  // End session
  app.post('/api/game/session/end', protect, endSessionHandler);
}
