/**
 * Game Routes
 * Route definitions - only call controllers
 */

import { protect } from '../middleware/jwt.js';
import {
  getNextImageHandler,
  getNext10ImagesHandler,
  submitAnswerHandler,
  isGateUserEligibleHandler,
  checkGateEligibilityHandler,
  awardGateUserHandler,
  checkGalaxyEligibilityHandler,
  isGalaxyUserEligibleHandler
} from '../controllers/gameController.js';

export default function gameRoutes(app) {
  // Get next single image
  app.post('/api/game/next', protect, getNextImageHandler);

  // Get next 10 images
  app.get('/api/game/next10', protect, getNext10ImagesHandler);

  // Submit answer
  app.post('/api/game/ans', protect, submitAnswerHandler);

  // Check gate user eligibility (authenticated)
  app.get('/api/game/isGateUserEligible', protect, isGateUserEligibleHandler);

  // Check gate eligibility by address (public)
  app.get('/api/game/check-gate-user-eligibility/:address?', checkGateEligibilityHandler);

  // Award gate user
  app.put('/api/game/awardGateUser', protect, awardGateUserHandler);

  // Check Galaxy reward eligibility (public)
  app.get('/api/galaxy/check-galaxy-reward-eligibility', checkGalaxyEligibilityHandler);

  // Check Galaxy user eligibility (authenticated)
  app.get('/api/game/isGalaxyUserEligible', protect, isGalaxyUserEligibleHandler);
}
