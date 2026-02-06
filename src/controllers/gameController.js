/**
 * Game Controller
 * Handles game-related HTTP requests with validation
 */

import * as gameService from '../services/gameService.js';
import * as answerService from '../services/answerService.js';
import * as eligibilityService from '../services/eligibilityService.js';
import {
  sendSuccess,
  sendError,
  sendValidationError,
  sendServerError
} from '../utils/response.js';
import { isValidHash, isValidGuess } from '../utils/validation.js';
import { normalizeGuess, normalizeHash, normalizeWallet } from '../utils/normalize.js';

/**
 * Get next single image
 * POST /api/game/next
 */
export async function getNextImageHandler(req, res) {
  try {
    const wallet = req.user.walletAddress;

    const result = await gameService.getNextImage(wallet);

    if (result.status === 204) {
      return res.status(204).send();
    }

    return res.json(result.body);
  } catch (error) {
    return sendServerError(res, error, 'GameController.getNextImage');
  }
}

/**
 * Get next 10 images
 * GET /api/game/next10
 */
export async function getNext10ImagesHandler(req, res) {
  try {
    const wallet = req.user.walletAddress;

    const result = await gameService.getNext10Images(wallet);

    if (result.status === 204) {
      return res.status(204).send();
    }

    return res.json(result.body);
  } catch (error) {
    return sendServerError(res, error, 'GameController.getNext10Images');
  }
}

/**
 * Submit answer
 * POST /api/game/ans
 */
export async function submitAnswerHandler(req, res) {
  try {
    const walletAddress = req.user.walletAddress;
    const hash = normalizeHash(req.body?.hash);
    const guess = normalizeGuess(req.body?.guess);
    const isBackup = Boolean(req.body?.isBackup);

    // Validate inputs
    if (!hash) {
      return sendValidationError(res, 'Hash is required');
    }
    if (!guess) {
      return sendValidationError(res, "Guess must be 'ai' or 'human'");
    }

    const result = await answerService.processAnswer({
      walletAddress,
      hash,
      guess,
      isBackup
    });

    if (!result) {
      return sendError(res, 'Unable to process answer', 500);
    }

    return res.json(result);
  } catch (error) {
    return sendServerError(res, error, 'GameController.submitAnswer');
  }
}

/**
 * Check if gate user is eligible
 * GET /api/game/isGateUserEligible
 */
export async function isGateUserEligibleHandler(req, res) {
  try {
    const walletAddress = req.user.walletAddress;

    const isEligible = await eligibilityService.checkGateUserEligibility(walletAddress);

    return sendSuccess(res, { isGateUserEligible: isEligible });
  } catch (error) {
    return sendServerError(res, error, 'GameController.isGateUserEligible');
  }
}

/**
 * Check gate user eligibility by address
 * GET /api/game/check-gate-user-eligibility/:address?
 */
export async function checkGateEligibilityHandler(req, res) {
  try {
    const walletAddress = normalizeWallet(
      req.params?.address || req.query?.address
    );

    if (!walletAddress) {
      return res.status(400).json({
        error: 'Address required',
        result: false,
        isEligible: false
      });
    }

    const result = await eligibilityService.checkGateEligibilityByAddress(walletAddress);

    return res.status(200).json(result);
  } catch (error) {
    return sendServerError(res, error, 'GameController.checkGateEligibility');
  }
}

/**
 * Award gate user
 * PUT /api/game/awardGateUser
 */
export async function awardGateUserHandler(req, res) {
  try {
    const walletAddress = req.user.walletAddress;

    await eligibilityService.awardGateUser(walletAddress);

    return sendSuccess(res, { awarded: true });
  } catch (error) {
    return sendServerError(res, error, 'GameController.awardGateUser');
  }
}

/**
 * Check Galaxy reward eligibility
 * GET /api/galaxy/check-galaxy-reward-eligibility
 */
export async function checkGalaxyEligibilityHandler(req, res) {
  try {
    const addressParam = normalizeWallet(req.query?.address);

    if (!addressParam) {
      return res.status(200).json({
        message: 'Address required',
        code: 200,
        data: { is_eligible: false }
      });
    }

    const isEligible = await eligibilityService.checkGalaxyEligibility(addressParam);

    return res.status(200).json({
      message: isEligible ? 'successful' : 'failed, user does not exist',
      code: 200,
      data: { is_eligible: isEligible }
    });
  } catch (error) {
    console.error('[GameController] checkGalaxyEligibility error:', error);
    return res.status(204).json({
      message: 'Internal error',
      code: 204,
      data: { is_eligible: false }
    });
  }
}

/**
 * Check if Galaxy user is eligible (authenticated)
 * GET /api/game/isGalaxyUserEligible
 */
export async function isGalaxyUserEligibleHandler(req, res) {
  try {
    const walletAddress = req.user.walletAddress;

    const isEligible = await eligibilityService.checkGalaxyUserEligibility(walletAddress);

    return sendSuccess(res, { isGalaxyUserEligible: isEligible });
  } catch (error) {
    return sendServerError(res, error, 'GameController.isGalaxyUserEligible');
  }
}
