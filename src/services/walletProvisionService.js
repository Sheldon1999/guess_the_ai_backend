/**
 * Wallet Provision Service
 * Handles wallet provisioning and resolution
 * Max 150 lines
 */

import { isAddress } from "viem";
import { createEmbeddedWalletForUser, getWalletById, isPrivyConfigured } from "../lib/privy.js";
import { logV2, maskValue, createHttpError } from "./authHelpers.js";
import { normalizePrivyMeta } from "./privyMetaService.js";
import { normalizeWallet as normalizeWalletUtil } from "../utils/normalize.js";

const normalizeWallet = (value) => normalizeWalletUtil(value) || "";

/**
 * Provision an embedded wallet for a user
 * @param {Object} options - Provision options
 * @param {string} options.privyUserId - Privy user ID
 * @param {string} options.reason - Reason for provisioning
 * @param {string} options.walletId - Existing wallet ID (optional)
 * @returns {Promise<Object>} Wallet result
 */
export async function provisionEmbeddedWallet({ privyUserId, reason, walletId }) {
  if (!privyUserId) {
    logV2("warn", "privy_wallet_skipped", { reason: "missing_privy_user_id" });
    return { skipped: true, reason: "missing_privy_user_id" };
  }

  if (!isPrivyConfigured()) {
    logV2("warn", "privy_wallet_skipped", { reason: "privy_not_configured" });
    return { skipped: true, reason: "privy_not_configured" };
  }

  // Try to get existing wallet if walletId provided
  if (walletId) {
    const existingWallet = await tryGetExistingWallet({ walletId, privyUserId, reason });
    if (existingWallet) return existingWallet;
  }

  // Create new wallet
  return await createNewWallet({ privyUserId, reason });
}

/**
 * Try to get existing wallet by ID
 */
async function tryGetExistingWallet({ walletId, privyUserId, reason }) {
  logV2("info", "privy_wallet_get_start", {
    reason,
    privyUserId: maskValue(privyUserId),
    walletId: maskValue(walletId)
  });

  try {
    const existing = await getWalletById(walletId);
    if (existing?.skipped) {
      logV2("warn", "privy_wallet_skipped", { reason: existing.reason || "privy_not_configured" });
      return null;
    }
    if (existing?.address) {
      logV2("info", "privy_wallet_get_success", { reason, walletAddress: maskValue(existing.address) });
      return {
        id: existing?.id || walletId,
        address: existing.address,
        chainType: existing?.chain_type || existing?.chainType
      };
    }
  } catch (error) {
    const status = Number(error?.statusCode || error?.status);
    if (status && status !== 404) {
      logV2("error", "privy_wallet_get_failed", { reason, error: error?.message || error });
      return { error, code: "wallet_lookup_failed" };
    }
    logV2("warn", "privy_wallet_get_not_found", { reason, walletId: maskValue(walletId) });
  }
  return null;
}

/**
 * Create new embedded wallet
 */
async function createNewWallet({ privyUserId, reason }) {
  logV2("info", "privy_wallet_create_start", { reason, privyUserId: maskValue(privyUserId) });

  try {
    const wallet = await createEmbeddedWalletForUser(privyUserId);

    if (wallet?.skipped) {
      logV2("warn", "privy_wallet_skipped", { reason: wallet.reason || "privy_not_configured" });
      return wallet;
    }
    if (wallet?.reused) {
      logV2("info", "privy_wallet_reused", { reason, walletAddress: maskValue(wallet.address) });
      return wallet;
    }
    if (!wallet?.address) {
      logV2("warn", "privy_wallet_create_no_address", { reason });
      return { error: "missing_address" };
    }

    logV2("info", "privy_wallet_create_success", { reason, walletAddress: maskValue(wallet.address) });
    return wallet;
  } catch (error) {
    logV2("error", "privy_wallet_create_failed", { reason, error: error?.message || error });
    return { error };
  }
}

/**
 * Resolve wallet addresses from request and metadata
 * @param {Object} options - Resolution options
 * @returns {Object} External and embedded wallet addresses
 */
export function resolveWalletAddresses({ request, walletFromJwt, incomingMeta }) {
  const externalCandidate = normalizeWallet(
    request.walletAddress || walletFromJwt || incomingMeta.walletAddress || incomingMeta.address
  );
  const externalWalletAddress = externalCandidate && isAddress(externalCandidate) ? externalCandidate : "";

  const embeddedCandidate = normalizeWallet(incomingMeta.embeddedWalletAddress);
  const embeddedWalletAddress = embeddedCandidate && isAddress(embeddedCandidate) ? embeddedCandidate : "";

  return { externalWalletAddress, embeddedWalletAddress };
}

/**
 * Apply provisioned wallet to context
 * @param {Object} context - Auth context
 * @param {Object} wallet - Provisioned wallet
 */
export function applyProvisionedWalletToContext(context, wallet) {
  if (!wallet?.address) return;

  context.incomingMeta.embeddedWalletAddress = wallet.address;
  if (wallet.id) context.incomingMeta.privyWalletId = wallet.id;
  if (wallet.chainType) context.incomingMeta.privyWalletChainType = wallet.chainType;

  context.incomingMeta = normalizePrivyMeta(context.incomingMeta);
  context.embeddedWalletAddress = normalizeWallet(context.incomingMeta.embeddedWalletAddress);
}

/**
 * Resolve wallet candidate from user doc and context
 * @param {Object} userDoc - User document
 * @param {Object} context - Auth context
 * @returns {string} Resolved wallet address
 */
export function resolveWalletCandidate(userDoc, context) {
  return normalizeWallet(
    userDoc.walletAddress ||
    context.externalWalletAddress ||
    context.embeddedWalletAddress ||
    userDoc?.privyMetaData?.embeddedWalletAddress ||
    userDoc?.privyMetaData?.walletAddress ||
    userDoc?.privyMetaData?.address
  );
}
