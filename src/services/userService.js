/**
 * User Service
 * Business logic for user operations
 * Max 150 lines per function, max 3 parameters
 */

import { users, dailyLogins, gateWallets } from '../lib/mongo.js';
import { generateAuthToken } from '../middleware/jwt.js';
import { recordUserRegistration } from '../lib/onchain/index.js';
import {
  writeUserToRedis,
  fetchUserProfile,
  readUserFromRedis
} from '../lib/docCache.js';
import {
  getGateUserRedis,
  updateGateUsernameRedis
} from './gate.js';
import { generatePlayerUsername } from '../utils/crypto.js';
import { publishDaEvent } from './daGateway.js';

/**
 * Login or register a user
 * @param {Object} params - Login parameters
 * @returns {Promise<Object>} Login result with token
 */
export async function loginOrRegister(params) {
  const { walletAddress, walletAddressOriginal, privyMetaData, loginType } = params;

  const shouldStorePrivyMetaData = Boolean(
    privyMetaData && typeof privyMetaData === 'object'
  );

  const existingUser = await users.findOne({ walletAddress });
  const now = new Date();

  let username;
  let nameUpdated;

  if (!existingUser) {
    // Create new user
    const result = await createNewUser({
      walletAddress,
      walletAddressOriginal,
      privyMetaData: shouldStorePrivyMetaData ? privyMetaData : null,
      now
    });
    username = result.username;
    nameUpdated = false;
  } else {
    // Update existing user
    username = existingUser.username;
    nameUpdated = existingUser.nameUpdated ?? false;
    await updateExistingUser({
      walletAddress,
      walletAddressOriginal,
      privyMetaData: shouldStorePrivyMetaData ? privyMetaData : null,
      existingUser
    });
  }

  // Record daily login
  await recordDailyLogin(walletAddress);

  // Generate JWT token
  const token = await generateAuthToken({
    _id: walletAddress,
    wallet: walletAddress,
    username
  });

  // Ensure user is cached
  await ensureUserCached({ walletAddress, existingUser, username, timestamp: now });

  // Create gate wallet entry
  await ensureGateWallet(walletAddress, loginType);

  publishDaEvent({
    eventType: "session.login",
    data: {
      flow: "legacy",
      walletAddress,
      loginType,
      nameUpdated,
      isNewUser: !existingUser
    }
  });

  return { token, username, nameUpdated };
}

/**
 * Create a new user
 * @param {Object} params - User creation parameters
 * @returns {Promise<Object>} Created user info
 */
async function createNewUser(params) {
  const { walletAddress, walletAddressOriginal, privyMetaData, now } = params;

  const username = generatePlayerUsername();

  const setOnInsert = {
    walletAddress,
    walletAddressOriginal,
    correctAnswers: 0,
    currentStreak: 0,
    streak: 0,
    rank: 'E',
    dungeonTitle: 'Newbie',
    createdAt: now,
    username,
    nameUpdated: false,
    lastUpdatedAt: now,
    lastFlushedAt: now,
    ...(privyMetaData ? { privyMetaData } : {})
  };

  await users.updateOne(
    { walletAddress },
    { $setOnInsert: setOnInsert, $set: { updatedAt: now } },
    { upsert: true }
  );

  // Fire-and-forget onchain registration
  recordUserRegistration({ walletAddress, username })
    .catch(e => console.error('[UserService] onchain register error:', e));

  return { username };
}

/**
 * Update existing user metadata
 * @param {Object} params - Update parameters
 */
async function updateExistingUser(params) {
  const { walletAddress, walletAddressOriginal, privyMetaData, existingUser } = params;

  if (privyMetaData) {
    const existingMeta = existingUser.privyMetaData || {};
    await users.updateOne(
      { walletAddress, privyMetaData: { $exists: false } },
      { $set: { privyMetaData: { ...existingMeta, ...privyMetaData } } }
    );
  }

  if (!existingUser.walletAddressOriginal) {
    await users.updateOne(
      { walletAddress, walletAddressOriginal: { $exists: false } },
      { $set: { walletAddressOriginal } }
    );
  }
}

/**
 * Record daily login
 * @param {string} walletAddress - User wallet address
 */
async function recordDailyLogin(walletAddress) {
  const now = new Date();
  const dayStart = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate()
  ));

  await dailyLogins.updateOne(
    { walletAddress, day: dayStart },
    { $setOnInsert: { walletAddress, day: dayStart } },
    { upsert: true }
  );
}

/**
 * Ensure user is cached in Redis
 * @param {Object} options - Cache options
 * @param {string} options.walletAddress - User wallet
 * @param {Object} options.existingUser - Existing user doc or null
 * @param {string} options.username - Username
 * @param {Date} options.timestamp - Current timestamp
 */
async function ensureUserCached({ walletAddress, existingUser, username, timestamp }) {
  const cached = await readUserFromRedis(walletAddress);
  if (cached) return;

  const cacheDoc = existingUser
    ? {
        ...existingUser,
        walletAddress,
        username,
        lastUpdatedAt: existingUser.lastUpdatedAt || timestamp,
        lastFlushedAt: existingUser.lastFlushedAt || timestamp
      }
    : {
        walletAddress,
        username,
        correctAnswers: 0,
        currentStreak: 0,
        streak: 0,
        rank: 'E',
        dungeonTitle: 'Newbie',
        lastUpdatedAt: timestamp,
        lastFlushedAt: timestamp
      };

  await writeUserToRedis(cacheDoc);
}

/**
 * Ensure gate wallet entry exists
 * @param {string} walletAddress - User wallet
 * @param {string} loginType - Login type
 */
async function ensureGateWallet(walletAddress, loginType) {
  await gateWallets.updateOne(
    { walletAddress },
    {
      $setOnInsert: { walletAddress, hasAwarded: false },
      $addToSet: { loginTypes: loginType }
    },
    { upsert: true }
  );
}

/**
 * Update username
 * @param {string} walletAddress - User wallet
 * @param {string} newUsername - New username
 * @returns {Promise<Object|null>} Updated user or null
 */
export async function updateUsername(walletAddress, newUsername) {
  const now = new Date();
  const nowIso = now.toISOString();

  const updates = {
    username: newUsername,
    updatedAt: now,
    lastUpdatedAt: now,
    lastFlushedAt: now,
    nameUpdated: true
  };

  const result = await users.updateOne(
    { walletAddress },
    { $set: updates }
  );

  if (result.matchedCount === 0) {
    return null;
  }

  // Update cache
  let responseUser = await updateUserCache(walletAddress, updates, nowIso);

  // Update gate user if exists
  const cachedGateUser = await getGateUserRedis(walletAddress);
  if (cachedGateUser) {
    await updateGateUsernameRedis(walletAddress, newUsername);
    responseUser.campaign = await getGateUserRedis(walletAddress);
  }

  return responseUser;
}

/**
 * Update user cache after username change
 * @param {string} walletAddress - User wallet
 * @param {Object} updates - Field updates
 * @param {string} nowIso - ISO timestamp
 * @returns {Promise<Object>} Updated user
 */
async function updateUserCache(walletAddress, updates, nowIso) {
  const cachedUser = await readUserFromRedis(walletAddress);

  if (cachedUser) {
    const cacheDoc = {
      ...cachedUser,
      ...(updates.username ? { username: updates.username } : {}),
      lastUpdatedAt: nowIso,
      lastFlushedAt: cachedUser.lastFlushedAt || cachedUser.lastUpdatedAt
    };
    return await writeUserToRedis(cacheDoc, true);
  }

  // Fetch from DB if not cached
  const updatedUser = await users.findOne(
    { walletAddress },
    {
      projection: {
        walletAddress: 1,
        username: 1,
        correctAnswers: 1,
        currentStreak: 1,
        streak: 1,
        rank: 1,
        dungeonTitle: 1,
        lastUpdatedAt: 1,
        lastFlushedAt: 1
      }
    }
  );

  if (!updatedUser) return null;

  const cacheDoc = {
    ...updatedUser,
    lastUpdatedAt: updatedUser.lastUpdatedAt || new Date(),
    lastFlushedAt: updatedUser.lastFlushedAt || new Date()
  };

  return await writeUserToRedis(cacheDoc, true);
}

/**
 * Get user profile
 * @param {string} walletAddress - User wallet
 * @returns {Promise<Object|null>} User profile or null
 */
export async function getProfile(walletAddress) {
  const profile = await fetchUserProfile(walletAddress);

  if (!profile) return null;

  // Add campaign data if exists
  const cachedGateUser = await getGateUserRedis(walletAddress);
  if (cachedGateUser) {
    profile.campaign = cachedGateUser;
  }

  return profile;
}
