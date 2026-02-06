/**
 * Eligibility Service
 * Business logic for user eligibility checks
 * Max 150 lines per function, max 3 parameters
 */

import { gateWallets, users } from '../lib/mongo.js';
import { getGateUserRedis } from './gate.js';

/**
 * Check if gate user is eligible for reward
 * @param {string} walletAddress - User wallet
 * @returns {Promise<boolean>} Eligibility status
 */
export async function checkGateUserEligibility(walletAddress) {
  const gateWallet = await gateWallets.findOne(
    { walletAddress },
    { projection: { _id: 0, hasAwarded: 1, 'privyMetaData.type': 1 } }
  );

  if (!gateWallet) return false;

  const hasGateLoginType = gateWallet.privyMetaData?.type === 'gate_wallet';

  return Boolean(gateWallet) && !gateWallet.hasAwarded && hasGateLoginType;
}

/**
 * Check gate eligibility by wallet address (public endpoint)
 * @param {string} walletAddress - User wallet
 * @returns {Promise<Object>} Eligibility result with details
 */
export async function checkGateEligibilityByAddress(walletAddress) {
  const gateUser = await getGateUserRedis(walletAddress);

  if (!gateUser) {
    return {
      message: 'User not found',
      result: false,
      isEligible: false
    };
  }

  const maxStreak = gateUser.streak || 0;
  const currentStreak = gateUser.currentStreak || 0;
  const isEligible = maxStreak >= 5;

  return {
    message: 'successful',
    result: isEligible,
    isEligible,
    data: {
      maxStreak,
      currentStreak
    }
  };
}

/**
 * Award gate user (mark as awarded)
 * @param {string} walletAddress - User wallet
 */
export async function awardGateUser(walletAddress) {
  await gateWallets.updateOne(
    { walletAddress },
    { $set: { hasAwarded: true } }
  );
}

/**
 * Check Galaxy reward eligibility (public endpoint)
 * @param {string} normalizedAddress - Normalized wallet address
 * @returns {Promise<boolean>} Eligibility status
 */
export async function checkGalaxyEligibility(normalizedAddress) {
  // Try to find user by privyMetaData values
  const matchedUser = await findUserByPrivyMeta(normalizedAddress);
  const walletAddress = matchedUser?.walletAddress || normalizedAddress;

  const cachedGateUser = walletAddress
    ? await getGateUserRedis(walletAddress)
    : null;

  if (!cachedGateUser) return false;

  const maxStreak = cachedGateUser.streak || 0;
  return maxStreak >= 5;
}

/**
 * Check Galaxy user eligibility (authenticated)
 * @param {string} walletAddress - User wallet
 * @returns {Promise<boolean>} Eligibility status
 */
export async function checkGalaxyUserEligibility(walletAddress) {
  const existingUser = await users.findOne(
    { walletAddress },
    { projection: { _id: 1 } }
  );

  if (!existingUser) return false;

  const cachedGateUser = await getGateUserRedis(walletAddress);

  if (!cachedGateUser) return false;

  // Must have exactly streak=5 AND currentStreak=5
  return cachedGateUser.streak === 5 && cachedGateUser.currentStreak === 5;
}

/**
 * Find user by privy metadata values
 * @param {string} address - Address to search for
 * @returns {Promise<Object|null>} User document or null
 */
async function findUserByPrivyMeta(address) {
  return await users.findOne(
    {
      $expr: {
        $in: [
          address,
          {
            $map: {
              input: { $objectToArray: { $ifNull: ['$privyMetaData', {}] } },
              as: 'item',
              in: { $toLower: '$$item.v' }
            }
          }
        ]
      }
    },
    { projection: { _id: 1, walletAddress: 1 } }
  );
}
