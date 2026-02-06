/**
 * Session Controller
 * Handles game session HTTP requests
 */

import * as sessionService from '../services/sessionService.js';
import {
  sendSuccess,
  sendError,
  sendServerError
} from '../utils/response.js';

/**
 * Start a new game session
 * POST /api/game/session/start
 */
export async function startSessionHandler(req, res) {
  try {
    const walletAddress = req.user.walletAddress;
    const forceNew = Boolean(req.body?.forceNew);
    const sessionId = String(req.body?.sessionId || '').trim() || undefined;

    const session = await sessionService.startSession(walletAddress, {
      forceNew,
      sessionId
    });

    return sendSuccess(res, session);
  } catch (error) {
    return sendServerError(res, error, 'SessionController.startSession');
  }
}

/**
 * End current game session
 * POST /api/game/session/end
 */
export async function endSessionHandler(req, res) {
  try {
    const walletAddress = req.user.walletAddress;
    const sessionId = String(req.body?.sessionId || '').trim() || undefined;
    const completed = typeof req.body?.completed === 'boolean'
      ? req.body.completed
      : true;

    const result = await sessionService.endSession(walletAddress, {
      sessionId,
      completed
    });

    if (result.error) {
      const statusCode = result.statusCode || 400;
      return res.status(statusCode).json({
        success: false,
        message: result.error
      });
    }

    return sendSuccess(res, result);
  } catch (error) {
    return sendServerError(res, error, 'SessionController.endSession');
  }
}
