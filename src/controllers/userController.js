/**
 * User Controller
 * Handles user-related HTTP requests with validation
 */

import { loginV2 } from '../services/auth.js';
import * as userService from '../services/userService.js';
import {
  createWalletChallenge,
  verifyWalletChallenge
} from '../services/walletChallengeService.js';
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
      walletFromJwt: req.walletFromJwt,
      clientIp: req.ip || req.socket?.remoteAddress || null,
      userAgent: req.get('user-agent') || null
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

/**
 * Create wallet-login challenge
 * POST /api/auth/challenge
 */
export async function createWalletChallengeHandler(req, res) {
  try {
    const walletAddress = req.body?.walletAddress;
    const challenge = await createWalletChallenge(walletAddress);
    return sendSuccess(res, {
      walletAddress: challenge.walletAddress,
      challengeMessage: challenge.challengeMessage,
      nonce: challenge.nonce,
      issuedAt: challenge.issuedAt,
      expiresAt: challenge.expiresAt,
      expiresInSec: challenge.expiresInSec
    });
  } catch (e) {
    const statusCode = Number(e?.statusCode) || 500;
    return res.status(statusCode).json({
      success: false,
      message: e?.message || "failed to create challenge",
      code: e?.code || "CHALLENGE_CREATE_FAILED"
    });
  }
}

/**
 * Verify challenge signature and login/register
 * POST /api/auth/wallet-login
 */
export async function walletSignatureLoginHandler(req, res) {
  try {
    const walletAddress = req.body?.walletAddress;
    const signature = req.body?.signature;

    const verified = await verifyWalletChallenge({ walletAddress, signature });
    const normalizedWallet = verified.walletAddress;

    const result = await userService.loginOrRegister({
      walletAddress: normalizedWallet,
      walletAddressOriginal: walletAddress,
      privyMetaData: null,
      loginType: "wallet_signature"
    });

    return sendSuccess(res, {
      ...result,
      authMethod: "wallet_signature",
      walletAddress: normalizedWallet
    });
  } catch (e) {
    const statusCode = Number(e?.statusCode) || 500;
    return res.status(statusCode).json({
      success: false,
      message: e?.message || "wallet signature login failed",
      code: e?.code || "WALLET_SIGNATURE_LOGIN_FAILED"
    });
  }
}
