/**
 * Game Routes
 * Route definitions - only call controllers
 */

import { protect } from '../middleware/jwt.js';
import { gameAnswerAbuseGuard } from '../middleware/gameAbuseGuard.js';
import {
  getNextImageHandler,
  getNext10ImagesHandler,
  submitAnswerHandler,
  getClassicQuestionHandler,
  submitClassicModeAnswerHandler,
  getMultiSelectQuestionHandler,
  submitMultiSelectAnswerHandler,
  getDuelQuestionHandler,
  submitDuelAnswerHandler,
  getOddOneOutQuestionHandler,
  submitOddOneOutAnswerHandler,
  getCardFlipDeckHandler,
  submitCardFlipAnswerHandler,
  getRapidFireQuestionHandler,
  submitRapidFireAnswerHandler,
  getHintHandler,
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
  app.post('/api/game/ans', protect, gameAnswerAbuseGuard, submitAnswerHandler);

  // Classic mode APIs
  app.get('/api/game/classic/question', protect, getClassicQuestionHandler);
  app.post('/api/game/classic/answer', protect, gameAnswerAbuseGuard, submitClassicModeAnswerHandler);

  // Multi-select mode APIs
  app.get('/api/game/multiselect/question', protect, getMultiSelectQuestionHandler);
  app.post('/api/game/multiselect/answer', protect, gameAnswerAbuseGuard, submitMultiSelectAnswerHandler);

  // Duel mode APIs
  app.get('/api/game/duel/question', protect, getDuelQuestionHandler);
  app.post('/api/game/duel/answer', protect, gameAnswerAbuseGuard, submitDuelAnswerHandler);

  // Odd-one-out mode APIs
  app.get('/api/game/oddoneout/question', protect, getOddOneOutQuestionHandler);
  app.post('/api/game/oddoneout/answer', protect, gameAnswerAbuseGuard, submitOddOneOutAnswerHandler);

  // Card-flip mode APIs
  app.get('/api/game/cardflip/deck', protect, getCardFlipDeckHandler);
  app.post('/api/game/cardflip/answer', protect, gameAnswerAbuseGuard, submitCardFlipAnswerHandler);

  // Rapid-fire mode APIs
  app.get('/api/game/rapidfire/question', protect, getRapidFireQuestionHandler);
  app.post('/api/game/rapidfire/answer', protect, gameAnswerAbuseGuard, submitRapidFireAnswerHandler);

  // Hint polling
  app.get('/api/game/hint/:roundId', protect, getHintHandler);

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
