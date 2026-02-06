/**
 * User Controller
 * Handles user-related HTTP requests with validation
 */

import { loginV2 } from '../services/auth.js';
import * as userService from '../services/userService.js';
import {
  sendSuccess,
  sendValidationError,
  sendServerError,
  sendNotFound
} from '../utils/response.js';
import { validateUsername } from '../utils/validation.js';

/**
 * Handle V2 login (Privy-aware)
 * POST /api/v2/login
 */
export async function loginV2Handler(req, res) {
  try {
    const data = await loginV2(req.body, {
      walletFromJwt: req.walletFromJwt
    });
    return sendSuccess(res, data);
  } catch (e) {
    const statusCode = Number(e?.statusCode) || 500;
    if (statusCode >= 500) {
      console.error('[UserController] v2/login error:', e);
    }
    const payload = {
      success: false,
      message: e?.message || 'Internal error'
    };
    if (e?.code) payload.code = e.code;
    return res.status(statusCode).json(payload);
  }
}

/**
 * Handle legacy login
 * POST /api/user/login
 */
export async function loginHandler(req, res) {
  try {
    const walletAddress = req.walletAddress;
    const walletAddressOriginal = req.rawWalletAddress || walletAddress;
    const privyMetaData = req.body?.privyMetaData;
    const loginType = String(privyMetaData?.type || 'Unknown').trim();

    const result = await userService.loginOrRegister({
      walletAddress,
      walletAddressOriginal,
      privyMetaData,
      loginType
    });

    return sendSuccess(res, result);
  } catch (e) {
    return sendServerError(res, e, 'UserController.login');
  }
}

/**
 * Handle username update
 * PUT /api/user/updateUsername
 */
export async function updateUsernameHandler(req, res) {
  try {
    const walletAddress = req.user.walletAddress;
    const username = req.body?.username;

    // Validate username
    const validation = validateUsername(username);
    if (!validation.valid) {
      return sendValidationError(res, validation.error);
    }

    const result = await userService.updateUsername(
      walletAddress,
      username.trim()
    );

    if (!result) {
      return sendNotFound(res, 'User');
    }

    return sendSuccess(res, result);
  } catch (e) {
    return sendServerError(res, e, 'UserController.updateUsername');
  }
}

/**
 * Handle get profile
 * GET /api/user/profile
 */
export async function getProfileHandler(req, res) {
  try {
    const walletAddress = req.user.walletAddress;

    const profile = await userService.getProfile(walletAddress);

    if (!profile) {
      return sendNotFound(res, 'User');
    }

    return sendSuccess(res, profile);
  } catch (e) {
    return sendServerError(res, e, 'UserController.getProfile');
  }
}
