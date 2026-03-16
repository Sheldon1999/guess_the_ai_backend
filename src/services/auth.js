/**
 * Auth Service
 * Main authentication logic for loginV2
 * Refactored to use helper services
 */

import { isAddress } from "viem";
import { users, dailyLogins, gateWallets } from "../lib/mongo.js";
import { generateAuthToken, verifyBrowserToken } from "../middleware/jwt.js";
import { recordUserRegistration } from "../lib/onchain/index.js";
import { readUserFromRedis, writeUserToRedis } from "../lib/docCache.js";
import { createGateUserRedis, getGateUserRedis } from "./gate.js";
import { normalizeWallet as normalizeWalletUtil } from "../utils/normalize.js";
import {
  findCanonicalUserByWallet,
  createOrGetUserByWallet
} from "../lib/userStore.js";
import { generatePlayerUsername } from "../utils/crypto.js";

// Import from helper services
import {
  isPlainObject,
  maskValue,
  gateAuthLog,
  resolveWalletType,
  summarizeMeta,
  logV2,
  createHttpError,
  buildUserPayload
} from "./authHelpers.js";

import {
  mergePrivyMeta,
  normalizePrivyMeta,
  buildPrivySearchFilters,
  buildPrivyIdentifiers
} from "./privyMetaService.js";

import {
  provisionEmbeddedWallet,
  resolveWalletAddresses,
  applyProvisionedWalletToContext,
  resolveWalletCandidate
} from "./walletProvisionService.js";

const normalizeWallet = (value) => normalizeWalletUtil(value) || "";

/**
 * Verify JWT and extract wallet address
 */
async function verifyJwtWallet(request, walletFromJwtOverride = "") {
  const overrideWallet = normalizeWallet(walletFromJwtOverride);
  if (!request.jwt) return overrideWallet || "";

  if (request.source !== "browser") {
    logV2("warn", "jwt_rejected", { reason: "invalid source" });
    throw createHttpError(401, "invalid request");
  }

  if (overrideWallet) {
    logV2("info", "jwt_verified", { walletAddress: maskValue(overrideWallet) });
    return overrideWallet;
  }

  try {
    const decodedData = await verifyBrowserToken(request.jwt);
    const walletFromJwt = normalizeWallet(decodedData?.walletAddress);
    logV2("info", "jwt_verified", { walletAddress: maskValue(walletFromJwt) });
    return walletFromJwt;
  } catch {
    logV2("warn", "jwt_invalid", {});
    throw createHttpError(401, "invalid token");
  }
}

/**
 * Build incoming metadata from request
 */
function buildIncomingMeta(request, walletFromJwt) {
  let incomingMeta = isPlainObject(request.privyMetaData) ? { ...request.privyMetaData } : {};

  const metaFields = ['privyUserId', 'email', 'discordUserId', 'discord', 'otherId'];
  for (const field of metaFields) {
    if (request[field]) incomingMeta[field] = request[field];
  }

  if (Array.isArray(request.otherIds)) incomingMeta.otherIds = request.otherIds;
  if (request.type && !incomingMeta.type) incomingMeta.type = request.type;
  if (request.sessionWallet === "VERIFIED" && !incomingMeta.type) incomingMeta.type = "gate_wallet";
  if (request.walletAddress && !incomingMeta.walletAddress) incomingMeta.walletAddress = request.walletAddress;
  if (request.walletAddress && !incomingMeta.address) incomingMeta.address = request.walletAddress;
  if (walletFromJwt && !incomingMeta.walletAddress) incomingMeta.walletAddress = walletFromJwt;
  if (walletFromJwt && !incomingMeta.address) incomingMeta.address = walletFromJwt;

  return normalizePrivyMeta(incomingMeta);
}

/**
 * Ensure identifiers are present
 */
function ensureIdentifiersPresent(context) {
  if (context.externalWalletAddress || context.embeddedWalletAddress || context.identifiers.length) {
    return;
  }
  logV2("warn", "missing_identifiers", {});
  throw createHttpError(400, "missing identifiers");
}

/**
 * Find user document by various identifiers
 */
async function findUserDoc(context) {
  let userDoc = null;
  let foundBy = "";

  if (context.externalWalletAddress) {
    userDoc = await findCanonicalUserByWallet(context.externalWalletAddress, {
      logLabel: "auth.findUserDoc.externalWallet",
    });
    if (userDoc) foundBy = "wallet";
  }

  if (!userDoc && context.embeddedWalletAddress) {
    userDoc = await findCanonicalUserByWallet(context.embeddedWalletAddress, {
      logLabel: "auth.findUserDoc.embeddedWallet",
    });
    if (userDoc) foundBy = "embedded_wallet";
  }

  if (!userDoc) {
    const privyFilters = buildPrivySearchFilters(context.incomingMeta);
    if (privyFilters.length) {
      userDoc = await users.findOne({ $or: privyFilters });
      if (userDoc) foundBy = "privyMeta";
    }
  }

  if (!userDoc && context.identifiers.length) {
    userDoc = await users.findOne({
      $expr: {
        $gt: [{
          $size: {
            $setIntersection: [
              context.identifiers,
              { $map: { input: { $objectToArray: { $ifNull: ["$privyMetaData", {}] } }, as: "item", in: "$$item.v" } }
            ]
          }
        }, 0]
      }
    });
    if (userDoc) foundBy = "identifier";
  }

  if (userDoc?.walletAddress) {
    const canonicalUserDoc = await findCanonicalUserByWallet(userDoc.walletAddress, {
      logLabel: `auth.findUserDoc.${foundBy || "reconcile"}`,
    });
    if (canonicalUserDoc) {
      userDoc = canonicalUserDoc;
    }
  }

  return { userDoc, foundBy };
}

/**
 * Resolve wallet for existing user
 */
async function resolveWalletForExistingUser(context, userDoc) {
  let mergedPrivyMeta = mergePrivyMeta(userDoc?.privyMetaData, context.incomingMeta);
  let resolvedWallet = resolveWalletCandidate(userDoc, context);

  if (!resolvedWallet || !isAddress(resolvedWallet)) {
    const provisioned = await provisionEmbeddedWallet({
      privyUserId: context.incomingMeta?.privyUserId || userDoc?.privyMetaData?.privyUserId,
      reason: "attach_missing_wallet",
      walletId: context.incomingMeta?.privyWalletId || userDoc?.privyMetaData?.privyWalletId
    });

    if (provisioned?.code === "wallet_lookup_failed") {
      throw createHttpError(502, "wallet lookup failed", "wallet_lookup_failed");
    }

    applyProvisionedWalletToContext(context, provisioned);
    mergedPrivyMeta = mergePrivyMeta(userDoc?.privyMetaData, context.incomingMeta);
    resolvedWallet = resolveWalletCandidate(userDoc, context);
  }

  if (!resolvedWallet || !isAddress(resolvedWallet)) {
    logV2("warn", "wallet_pending", { identifiers: context.identifiers.length });
    throw createHttpError(409, "wallet address not available yet", "wallet_address_pending");
  }

  return { resolvedWallet, mergedPrivyMeta };
}

/**
 * Update existing user document
 */
async function updateExistingUserDoc(context, userDoc, resolvedWallet, mergedPrivyMeta) {
  const update = {};
  const set = { updatedAt: context.now };

  if (!userDoc.walletAddress || normalizeWallet(userDoc.walletAddress) !== resolvedWallet) {
    const walletOwner = await findCanonicalUserByWallet(resolvedWallet, {
      projection: { _id: 1, walletAddress: 1 },
      logLabel: "auth.updateExistingUserDoc.walletOwner",
    });
    if (walletOwner && String(walletOwner._id) !== String(userDoc._id)) {
      logV2("warn", "wallet_conflict", { walletAddress: maskValue(resolvedWallet) });
      throw createHttpError(409, "wallet already linked to another account", "wallet_conflict");
    }
    update.walletAddress = resolvedWallet;
  }

  if (Object.keys(mergedPrivyMeta).length) {
    update.privyMetaData = mergedPrivyMeta;
  }

  if (Object.keys(update).length) {
    await users.updateOne({ _id: userDoc._id }, { $set: { ...update, ...set } });
    const nextDoc = { ...userDoc, ...update, updatedAt: context.now };
    if (update.privyMetaData) {
      logV2("info", "meta_updated", { walletAddress: maskValue(resolvedWallet), meta: summarizeMeta(update.privyMetaData) });
    }
    return nextDoc;
  }

  await users.updateOne({ _id: userDoc._id }, { $set: set });
  return { ...userDoc, updatedAt: context.now };
}

/**
 * Upsert daily login record
 */
async function upsertDailyLogin(walletAddress, now) {
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  await dailyLogins.updateOne(
    { walletAddress, day: dayStart },
    { $setOnInsert: { walletAddress, day: dayStart } },
    { upsert: true }
  );
}

/**
 * Write cache if missing
 */
async function writeCacheIfMissing(walletAddress, userDoc, username, now) {
  const cached = await readUserFromRedis(walletAddress);
  if (cached) return;
  await writeUserToRedis({
    ...userDoc,
    walletAddress,
    username,
    lastUpdatedAt: userDoc.lastUpdatedAt || now,
    lastFlushedAt: userDoc.lastFlushedAt || now
  });
}

/**
 * Ensure gate wallet user exists
 */
async function ensureGateWalletUser(context, walletAddress, username, walletType) {
  const isGateUser = context.request?.sessionWallet === "VERIFIED" || context.incomingMeta?.type === "gate_wallet";
  gateAuthLog("ensureGateWalletUser start", { walletAddress, sessionWallet: context.request?.sessionWallet, incomingType: context.incomingMeta?.type, isGateUser });
  const gateUpdate = {
    $setOnInsert: { walletAddress, hasAwarded: false },
  };
  if (Object.keys(context.incomingMeta || {}).length) {
    gateUpdate.$set = { privyMetaData: context.incomingMeta };
  }

  const gateResult = await gateWallets.updateOne(
    { walletAddress },
    gateUpdate,
    { upsert: true }
  );
  const gateDocExists = gateResult.matchedCount > 0;

  const cachedGateUser = await getGateUserRedis(walletAddress);
  if (!cachedGateUser && username && walletType) {
    await createGateUserRedis(walletAddress, username, walletType);
  }

  gateAuthLog("ensureGateWalletUser complete", { walletAddress, gateDocExists, isGateUser });
  return isGateUser || gateDocExists || gateResult.upsertedCount > 0;
}

/**
 * Handle existing user login
 */
async function handleExistingUserLogin(context, userDoc, foundBy) {
  const { resolvedWallet, mergedPrivyMeta } = await resolveWalletForExistingUser(context, userDoc);
  const updatedUserDoc = await updateExistingUserDoc(context, userDoc, resolvedWallet, mergedPrivyMeta);

  await upsertDailyLogin(resolvedWallet, context.now);

  const username = updatedUserDoc?.username || generatePlayerUsername();
  const nameUpdated = updatedUserDoc?.nameUpdated ?? false;

  const token = await generateAuthToken({ _id: resolvedWallet, wallet: resolvedWallet, username });
  await writeCacheIfMissing(resolvedWallet, updatedUserDoc, username, context.now);

  const walletType = resolveWalletType(context);
  const isGateUser = await ensureGateWalletUser(context, resolvedWallet, username, walletType);
  gateAuthLog("existing user login creating gate redis entry", { wallet: resolvedWallet, username, walletType });
  await createGateUserRedis(resolvedWallet, username, walletType);

  const responseUser = buildUserPayload({ ...updatedUserDoc, walletAddress: resolvedWallet, username }, updatedUserDoc?.privyMetaData, normalizeWallet);

  logV2("info", "success", { walletAddress: maskValue(resolvedWallet), foundBy: foundBy || "existing", hasGateUser: isGateUser, nameUpdated });

  return { token, username, nameUpdated, user: responseUser, foundBy };
}

/**
 * Handle new user creation
 */
async function handleNewUserCreation(context) {
  if (!context.externalWalletAddress && !context.embeddedWalletAddress) {
    const provisioned = await provisionEmbeddedWallet({
      privyUserId: context.incomingMeta?.privyUserId,
      reason: "create_user",
      walletId: context.incomingMeta?.privyWalletId
    });
    if (provisioned?.code === "wallet_lookup_failed") {
      throw createHttpError(502, "wallet lookup failed", "wallet_lookup_failed");
    }
    applyProvisionedWalletToContext(context, provisioned);
  }

  const walletToCreate = context.externalWalletAddress || context.embeddedWalletAddress;
  if (!walletToCreate) {
    logV2("warn", "wallet_pending", { identifiers: context.identifiers.length });
    throw createHttpError(409, "wallet address not available yet", "wallet_address_pending");
  }

  const username = generatePlayerUsername();
  const privyMetaToStore = Object.keys(context.incomingMeta).length ? context.incomingMeta : {};
  const walletType = resolveWalletType(context);

  logV2("info", "create_user", { walletAddress: maskValue(walletToCreate), meta: summarizeMeta(privyMetaToStore) });

  const result = await createOrGetUserByWallet({
    walletAddress: walletToCreate,
    walletAddressOriginal: walletToCreate,
    privyMetaData: Object.keys(privyMetaToStore).length ? privyMetaToStore : null,
    now: context.now,
    username,
    logLabel: "auth.handleNewUserCreation",
  });
  const createdDoc = result.userDoc || {
    walletAddress: walletToCreate,
    correctAnswers: 0,
    currentStreak: 0,
    streak: 0,
    rank: "E",
    dungeonTitle: "Newbie",
    createdAt: context.now,
    username,
    nameUpdated: false,
    lastUpdatedAt: context.now,
    lastFlushedAt: context.now,
    ...(Object.keys(privyMetaToStore).length ? { privyMetaData: privyMetaToStore } : {}),
  };
  const resolvedUsername = createdDoc.username || username;

  if (result.created && context.externalWalletAddress && isAddress(context.externalWalletAddress)) {
    recordUserRegistration({ walletAddress: context.externalWalletAddress, username: resolvedUsername }).catch((e) => console.error("onchain register error:", e));
  }

  await upsertDailyLogin(walletToCreate, context.now);

  const token = await generateAuthToken({ _id: walletToCreate, wallet: walletToCreate, username: resolvedUsername });
  await writeUserToRedis({ ...createdDoc, walletAddress: walletToCreate, username: resolvedUsername, lastUpdatedAt: createdDoc.lastUpdatedAt || context.now, lastFlushedAt: createdDoc.lastFlushedAt || context.now });

  const isGateUser = await ensureGateWalletUser(context, walletToCreate, resolvedUsername, walletType);
  gateAuthLog("login gate status", { wallet: walletToCreate, isGateUser, hasGateMeta: Boolean(context.incomingMeta?.type === "gate_wallet"), sessionWallet: context.request?.sessionWallet });

  const responseUser = buildUserPayload({ ...createdDoc, walletAddress: walletToCreate, username: resolvedUsername }, privyMetaToStore, normalizeWallet);

  logV2("info", "success", { walletAddress: maskValue(walletToCreate), foundBy: context.externalWalletAddress ? "created_wallet" : "created_embedded", hasGateUser: isGateUser, nameUpdated: false });

  gateAuthLog("login creating gate redis entry", { wallet: walletToCreate, username: resolvedUsername, walletType });
  const cachedGateUser = await getGateUserRedis(walletToCreate);
  if (!cachedGateUser) {
    await createGateUserRedis(walletToCreate, resolvedUsername, walletType);
  }

  return { token, username: resolvedUsername, nameUpdated: false, user: responseUser, foundBy: context.externalWalletAddress ? "created_wallet" : "created_embedded" };
}

/**
 * Main login V2 function
 * @param {Object} payload - Login payload
 * @param {Object} options - Login options
 * @returns {Promise<Object>} Login result
 */
export async function loginV2(payload, options = {}) {
  const request = isPlainObject(payload) ? payload : {};
  const requestOptions = isPlainObject(options) ? options : {};
  const now = new Date();

  logV2("info", "start", { hasJwt: Boolean(request.jwt), hasWallet: Boolean(request.walletAddress), source: request.source || "unknown", meta: summarizeMeta(request.privyMetaData) });

  const walletFromJwt = await verifyJwtWallet(request, requestOptions.walletFromJwt);
  const incomingMeta = buildIncomingMeta(request, walletFromJwt);
  const identifiers = buildPrivyIdentifiers(incomingMeta);
  const { externalWalletAddress, embeddedWalletAddress } = resolveWalletAddresses({ request, walletFromJwt, incomingMeta });

  const context = { request, now, incomingMeta, identifiers, externalWalletAddress, embeddedWalletAddress };

  ensureIdentifiersPresent(context);

  const { userDoc, foundBy } = await findUserDoc(context);

  logV2("info", "lookup_complete", { walletAddress: maskValue(context.externalWalletAddress || context.embeddedWalletAddress), foundBy: foundBy || "none", identifiers: context.identifiers.length, meta: summarizeMeta(context.incomingMeta) });

  if (userDoc) {
    return await handleExistingUserLogin(context, userDoc, foundBy);
  }

  return await handleNewUserCreation(context);
}
