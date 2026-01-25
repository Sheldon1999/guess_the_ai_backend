import { isAddress } from "viem";
import { users, dailyLogins, gateWallets } from "../lib/mongo.js";
import { generateAuthToken, verifyBrowserToken } from "../middleware/jwt.js";
import { recordUserRegistration } from "../lib/onchain/index.js";
import { readUserFromRedis, writeUserToRedis } from "../lib/docCache.js";
import { createEmbeddedWalletForUser, getWalletById, isPrivyConfigured } from "../lib/privy.js";

const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

const normalizeString = (value) => (typeof value === "string" ? value.trim() : "");
const normalizeEmail = (value) => normalizeString(value).toLowerCase();
const normalizeWallet = (value) => normalizeString(value).toLowerCase();

const DEBUG_V2_LOGIN = ["1", "true", "yes", "on"].includes(
  String(process.env.DEBUG_V2_LOGIN || "").toLowerCase()
);

const maskValue = (value) => {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.length <= 8) return `${trimmed.slice(0, 2)}***`;
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
};

const summarizeMeta = (meta) => {
  if (!isPlainObject(meta)) return { keys: [] };
  return {
    keys: Object.keys(meta),
    hasEmail: Boolean(meta.email),
    hasPrivyUserId: Boolean(meta.privyUserId),
    hasDiscord: Boolean(meta.discord || meta.discordUserId),
    hasWallet: Boolean(meta.address || meta.walletAddress || meta.embeddedWalletAddress),
  };
};

const logV2 = (level, stage, data) => {
  if (!DEBUG_V2_LOGIN) return;
  const prefix = `[v2/login] ${stage}`;
  if (level === "error") {
    console.error(prefix, data);
  } else if (level === "warn") {
    console.warn(prefix, data);
  } else {
    console.log(prefix, data);
  }
};

const provisionEmbeddedWallet = async (privyUserId, reason, walletId) => {
  if (!privyUserId) {
    logV2("warn", "privy_wallet_skipped", { reason: "missing_privy_user_id" });
    return { skipped: true, reason: "missing_privy_user_id" };
  }
  if (!isPrivyConfigured()) {
    logV2("warn", "privy_wallet_skipped", { reason: "privy_not_configured" });
    return { skipped: true, reason: "privy_not_configured" };
  }

  if (walletId) {
    logV2("info", "privy_wallet_get_start", {
      reason,
      privyUserId: maskValue(privyUserId),
      walletId: maskValue(walletId),
    });
    try {
      const existing = await getWalletById(walletId);
      if (existing?.skipped) {
        logV2("warn", "privy_wallet_skipped", {
          reason: existing.reason || "privy_not_configured",
        });
      } else if (existing?.address) {
        logV2("info", "privy_wallet_get_success", {
          reason,
          walletAddress: maskValue(existing.address),
        });
        return {
          id: existing?.id || walletId,
          address: existing.address,
          chainType: existing?.chain_type || existing?.chainType,
        };
      }
    } catch (error) {
      const status = Number(error?.statusCode || error?.status);
      if (status && status !== 404) {
        logV2("error", "privy_wallet_get_failed", {
          reason,
          error: error?.message || error,
        });
        return { error, code: "wallet_lookup_failed" };
      }
      logV2("warn", "privy_wallet_get_not_found", {
        reason,
        walletId: maskValue(walletId),
      });
    }
  }

  logV2("info", "privy_wallet_create_start", {
    reason,
    privyUserId: maskValue(privyUserId),
  });

  try {
    const wallet = await createEmbeddedWalletForUser(privyUserId);
    if (wallet?.skipped) {
      logV2("warn", "privy_wallet_skipped", {
        reason: wallet.reason || "privy_not_configured",
      });
      return wallet;
    }
    if (wallet?.reused) {
      logV2("info", "privy_wallet_reused", {
        reason,
        walletAddress: maskValue(wallet.address),
      });
      return wallet;
    }
    if (!wallet?.address) {
      logV2("warn", "privy_wallet_create_no_address", { reason });
      return { error: "missing_address" };
    }
    logV2("info", "privy_wallet_create_success", {
      reason,
      walletAddress: maskValue(wallet.address),
    });
    return wallet;
  } catch (error) {
    logV2("error", "privy_wallet_create_failed", {
      reason,
      error: error?.message || error,
    });
    return { error };
  }
};

const createHttpError = (statusCode, message, code) => {
  const err = new Error(message);
  err.statusCode = statusCode;
  if (code) err.code = code;
  return err;
};

const sanitizeMetaValue = (value) => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }
  if (Array.isArray(value)) {
    const cleaned = value
      .map((item) => (typeof item === "string" ? item.trim() : item))
      .filter((item) => item !== "" && item !== undefined && item !== null);
    return cleaned.length ? cleaned : undefined;
  }
  if (value === null || value === undefined) return undefined;
  return value;
};

const mergePrivyMeta = (base, incoming) => {
  const merged = isPlainObject(base) ? { ...base } : {};
  if (!isPlainObject(incoming)) return merged;
  for (const [key, value] of Object.entries(incoming)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") {
      continue;
    }
    const sanitized = sanitizeMetaValue(value);
    if (sanitized === undefined) continue;
    merged[key] = sanitized;
  }
  return merged;
};

const normalizePrivyMeta = (meta) => {
  const normalized = mergePrivyMeta({}, meta);
  if (typeof normalized.email === "string") {
    normalized.email = normalizeEmail(normalized.email);
    if (!normalized.email) delete normalized.email;
  }
  if (typeof normalized.address === "string") {
    normalized.address = normalizeWallet(normalized.address);
    if (!normalized.address) delete normalized.address;
  }
  if (typeof normalized.walletAddress === "string") {
    normalized.walletAddress = normalizeWallet(normalized.walletAddress);
    if (!normalized.walletAddress) delete normalized.walletAddress;
  }
  if (typeof normalized.embeddedWalletAddress === "string") {
    normalized.embeddedWalletAddress = normalizeWallet(normalized.embeddedWalletAddress);
    if (!normalized.embeddedWalletAddress) delete normalized.embeddedWalletAddress;
  }
  if (typeof normalized.privyUserId === "string") {
    normalized.privyUserId = normalizeString(normalized.privyUserId);
    if (!normalized.privyUserId) delete normalized.privyUserId;
  }
  if (typeof normalized.discord === "string") {
    normalized.discord = normalizeString(normalized.discord);
    if (!normalized.discord) delete normalized.discord;
  }
  if (typeof normalized.discordUserId === "string") {
    normalized.discordUserId = normalizeString(normalized.discordUserId);
    if (!normalized.discordUserId) delete normalized.discordUserId;
  }
  if (typeof normalized.otherId === "string") {
    normalized.otherId = normalizeString(normalized.otherId);
    if (!normalized.otherId) delete normalized.otherId;
  }
  if (Array.isArray(normalized.otherIds)) {
    const cleaned = normalized.otherIds
      .map((item) => (typeof item === "string" ? item.trim() : item))
      .filter((item) => item !== "" && item !== undefined && item !== null);
    if (cleaned.length) {
      normalized.otherIds = cleaned;
    } else {
      delete normalized.otherIds;
    }
  }
  if (typeof normalized.type === "string") {
    normalized.type = normalizeString(normalized.type).toLowerCase();
    if (!normalized.type) delete normalized.type;
  }
  return normalized;
};

const buildPrivySearchFilters = (meta) => {
  if (!isPlainObject(meta)) return [];
  const filters = [];
  if (meta.privyUserId) filters.push({ "privyMetaData.privyUserId": meta.privyUserId });
  if (meta.email) filters.push({ "privyMetaData.email": meta.email });
  if (meta.discordUserId) filters.push({ "privyMetaData.discordUserId": meta.discordUserId });
  if (meta.discord) filters.push({ "privyMetaData.discord": meta.discord });
  if (meta.otherId) filters.push({ "privyMetaData.otherId": meta.otherId });
  if (meta.address) filters.push({ "privyMetaData.address": meta.address });
  if (meta.walletAddress) filters.push({ "privyMetaData.walletAddress": meta.walletAddress });
  if (meta.embeddedWalletAddress) {
    filters.push({ "privyMetaData.embeddedWalletAddress": meta.embeddedWalletAddress });
  }
  if (Array.isArray(meta.otherIds)) {
    for (const id of meta.otherIds) {
      if (typeof id === "string" && id) {
        filters.push({ "privyMetaData.otherIds": id });
      }
    }
  }
  return filters;
};

const buildPrivyIdentifiers = (meta) => {
  if (!isPlainObject(meta)) return [];
  const identifiers = [];
  if (meta.privyUserId) identifiers.push(meta.privyUserId);
  if (meta.email) identifiers.push(meta.email);
  if (meta.discordUserId) identifiers.push(meta.discordUserId);
  if (meta.discord) identifiers.push(meta.discord);
  if (meta.otherId) identifiers.push(meta.otherId);
  if (meta.address) identifiers.push(meta.address);
  if (meta.walletAddress) identifiers.push(meta.walletAddress);
  if (meta.embeddedWalletAddress) identifiers.push(meta.embeddedWalletAddress);
  if (Array.isArray(meta.otherIds)) identifiers.push(...meta.otherIds);
  return identifiers
    .filter((value) => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);
};

const buildUserPayload = (doc, privyMetaData) => {
  const walletAddress = normalizeWallet(doc?.walletAddress);
  return {
    walletAddress,
    username: doc?.username || `Player_${Date.now()}`,
    correctAnswers: Number(doc?.correctAnswers) || 0,
    currentStreak: Number(doc?.currentStreak) || 0,
    streak: Number(doc?.streak) || 0,
    rank: doc?.rank || "E",
    dungeonTitle: doc?.dungeonTitle || "Newbie",
    privyMetaData: isPlainObject(privyMetaData) ? privyMetaData : doc?.privyMetaData || {}
  };
};

const verifyJwtWallet = async (request, walletFromJwtOverride = "") => {
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
};

const buildIncomingMeta = (request, walletFromJwt) => {
  let incomingMeta = isPlainObject(request.privyMetaData) ? { ...request.privyMetaData } : {};

  if (request.privyUserId) incomingMeta.privyUserId = request.privyUserId;
  if (request.email) incomingMeta.email = request.email;
  if (request.discordUserId) incomingMeta.discordUserId = request.discordUserId;
  if (request.discord) incomingMeta.discord = request.discord;
  if (request.otherId) incomingMeta.otherId = request.otherId;
  if (Array.isArray(request.otherIds)) incomingMeta.otherIds = request.otherIds;
  if (request.type && !incomingMeta.type) incomingMeta.type = request.type;
  if (request.sessionWallet === "VERIFIED" && !incomingMeta.type) {
    incomingMeta.type = "gate_wallet";
  }
  if (request.walletAddress && !incomingMeta.walletAddress) incomingMeta.walletAddress = request.walletAddress;
  if (request.walletAddress && !incomingMeta.address) incomingMeta.address = request.walletAddress;
  if (walletFromJwt && !incomingMeta.walletAddress) incomingMeta.walletAddress = walletFromJwt;
  if (walletFromJwt && !incomingMeta.address) incomingMeta.address = walletFromJwt;

  return normalizePrivyMeta(incomingMeta);
};

const resolveWalletAddresses = (request, walletFromJwt, incomingMeta) => {
  const externalWalletCandidate = normalizeWallet(
    request.walletAddress ||
      walletFromJwt ||
      incomingMeta.walletAddress ||
      incomingMeta.address
  );
  const externalWalletAddress =
    externalWalletCandidate && isAddress(externalWalletCandidate) ? externalWalletCandidate : "";

  const embeddedWalletCandidate = normalizeWallet(incomingMeta.embeddedWalletAddress);
  const embeddedWalletAddress =
    embeddedWalletCandidate && isAddress(embeddedWalletCandidate) ? embeddedWalletCandidate : "";

  return { externalWalletAddress, embeddedWalletAddress };
};

const applyProvisionedWalletToContext = (context, wallet) => {
  if (!wallet?.address) return;
  context.incomingMeta.embeddedWalletAddress = wallet.address;
  if (wallet.id) context.incomingMeta.privyWalletId = wallet.id;
  if (wallet.chainType) context.incomingMeta.privyWalletChainType = wallet.chainType;
  context.incomingMeta = normalizePrivyMeta(context.incomingMeta);
  context.embeddedWalletAddress = normalizeWallet(context.incomingMeta.embeddedWalletAddress);
};

const ensureIdentifiersPresent = (context) => {
  if (context.externalWalletAddress || context.embeddedWalletAddress || context.identifiers.length) {
    return;
  }
  logV2("warn", "missing_identifiers", {});
  throw createHttpError(400, "missing identifiers");
};

const findUserDoc = async (context) => {
  let userDoc = null;
  let foundBy = "";

  if (context.externalWalletAddress) {
    userDoc = await users.findOne({ walletAddress: context.externalWalletAddress });
    if (userDoc) foundBy = "wallet";
  }

  if (!userDoc && context.embeddedWalletAddress) {
    userDoc = await users.findOne({ walletAddress: context.embeddedWalletAddress });
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
        $gt: [
          {
            $size: {
              $setIntersection: [
                context.identifiers,
                {
                  $map: {
                    input: { $objectToArray: { $ifNull: ["$privyMetaData", {}] } },
                    as: "item",
                    in: "$$item.v",
                  },
                },
              ],
            },
          },
          0,
        ],
      },
    });
    if (userDoc) foundBy = "identifier";
  }

  return { userDoc, foundBy };
};

const resolveWalletCandidate = (userDoc, context) =>
  normalizeWallet(
    userDoc.walletAddress ||
      context.externalWalletAddress ||
      context.embeddedWalletAddress ||
      userDoc?.privyMetaData?.embeddedWalletAddress ||
      userDoc?.privyMetaData?.walletAddress ||
      userDoc?.privyMetaData?.address
  );

const resolveWalletForExistingUser = async (context, userDoc) => {
  let mergedPrivyMeta = mergePrivyMeta(userDoc?.privyMetaData, context.incomingMeta);
  let resolvedWallet = resolveWalletCandidate(userDoc, context);

  if (!resolvedWallet || !isAddress(resolvedWallet)) {
    const provisioned = await provisionEmbeddedWallet(
      context.incomingMeta?.privyUserId || userDoc?.privyMetaData?.privyUserId,
      "attach_missing_wallet",
      context.incomingMeta?.privyWalletId || userDoc?.privyMetaData?.privyWalletId
    );
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
};

const updateExistingUserDoc = async (context, userDoc, resolvedWallet, mergedPrivyMeta) => {
  const update = {};
  const set = { updatedAt: context.now };

  if (!userDoc.walletAddress || normalizeWallet(userDoc.walletAddress) !== resolvedWallet) {
    const walletOwner = await users.findOne({ walletAddress: resolvedWallet });
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
    await users.updateOne(
      { _id: userDoc._id },
      { $set: { ...update, ...set } }
    );
    const nextDoc = {
      ...userDoc,
      ...update,
      updatedAt: context.now,
    };
    if (update.privyMetaData) {
      logV2("info", "meta_updated", {
        walletAddress: maskValue(resolvedWallet),
        meta: summarizeMeta(update.privyMetaData)
      });
    }
    return nextDoc;
  }

  await users.updateOne({ _id: userDoc._id }, { $set: set });
  return { ...userDoc, updatedAt: context.now };
};

const upsertDailyLogin = async (walletAddress, now) => {
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  await dailyLogins.updateOne(
    { walletAddress, day: dayStart },
    { $setOnInsert: { walletAddress, day: dayStart } },
    { upsert: true }
  );
};

const writeCacheIfMissing = async (walletAddress, userDoc, username, now) => {
  const cached = await readUserFromRedis(walletAddress);
  if (cached) return;
  await writeUserToRedis({
    ...userDoc,
    walletAddress,
    username,
    lastUpdatedAt: userDoc.lastUpdatedAt || now,
    lastFlushedAt: userDoc.lastFlushedAt || now,
  });
};

const ensureGateWalletUser = async (context, walletAddress) => {
  const isGateUser =
    context.request?.sessionWallet === "VERIFIED" || context.incomingMeta?.type === "gate_wallet";
  if (!isGateUser) return false;
  const isGateUserExisted = await gateWallets.findOne({ walletAddress });
  if (!isGateUserExisted) {
    await gateWallets.insertOne({ walletAddress, hasAwarded: false });
  }
  return true;
};

export async function loginV2(payload, options = {}) {
  const request = isPlainObject(payload) ? payload : {};
  const requestOptions = isPlainObject(options) ? options : {};
  const now = new Date();
  logV2("info", "start", {
    hasJwt: Boolean(request.jwt),
    hasWallet: Boolean(request.walletAddress),
    source: request.source || "unknown",
    meta: summarizeMeta(request.privyMetaData)
  });

  const walletFromJwt = await verifyJwtWallet(request, requestOptions.walletFromJwt);
  const incomingMeta = buildIncomingMeta(request, walletFromJwt);
  const identifiers = buildPrivyIdentifiers(incomingMeta);
  const { externalWalletAddress, embeddedWalletAddress } = resolveWalletAddresses(
    request,
    walletFromJwt,
    incomingMeta
  );

  const context = {
    request,
    now,
    incomingMeta,
    identifiers,
    externalWalletAddress,
    embeddedWalletAddress,
  };

  ensureIdentifiersPresent(context);

  const { userDoc, foundBy } = await findUserDoc(context);

  logV2("info", "lookup_complete", {
    walletAddress: maskValue(context.externalWalletAddress || context.embeddedWalletAddress),
    foundBy: foundBy || "none",
    identifiers: context.identifiers.length,
    meta: summarizeMeta(context.incomingMeta)
  });

  if (userDoc) {
    const { resolvedWallet, mergedPrivyMeta } = await resolveWalletForExistingUser(context, userDoc);
    const updatedUserDoc = await updateExistingUserDoc(
      context,
      userDoc,
      resolvedWallet,
      mergedPrivyMeta
    );

    await upsertDailyLogin(resolvedWallet, now);

    const username = updatedUserDoc?.username || `Player_${Date.now()}`;
    const nameUpdated = updatedUserDoc?.nameUpdated ?? false;

    const token = await generateAuthToken({
      _id: resolvedWallet,
      wallet: resolvedWallet,
      username,
    });

    await writeCacheIfMissing(resolvedWallet, updatedUserDoc, username, now);

    const isGateUser = await ensureGateWalletUser(context, resolvedWallet);

    const responseUser = buildUserPayload(
      { ...updatedUserDoc, walletAddress: resolvedWallet, username },
      updatedUserDoc?.privyMetaData
    );

    logV2("info", "success", {
      walletAddress: maskValue(resolvedWallet),
      foundBy: foundBy || "existing",
      hasGateUser: isGateUser,
      nameUpdated
    });

    return { token, username, nameUpdated, user: responseUser, foundBy };
  }

  if (!context.externalWalletAddress && !context.embeddedWalletAddress) {
    const provisioned = await provisionEmbeddedWallet(
      context.incomingMeta?.privyUserId,
      "create_user",
      context.incomingMeta?.privyWalletId
    );
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

  const username = `Player_${Date.now()}`;
  const privyMetaToStore = Object.keys(context.incomingMeta).length ? context.incomingMeta : {};

  logV2("info", "create_user", {
    walletAddress: maskValue(walletToCreate),
    meta: summarizeMeta(privyMetaToStore)
  });

  const setOnInsert = {
    walletAddress: walletToCreate,
    correctAnswers: 0,
    currentStreak: 0,
    streak: 0,
    rank: "E",
    dungeonTitle: "Newbie",
    createdAt: now,
    username,
    nameUpdated: false,
    lastUpdatedAt: now,
    lastFlushedAt: now,
    ...(Object.keys(privyMetaToStore).length ? { privyMetaData: privyMetaToStore } : {}),
  };

  const result = await users.updateOne(
    { walletAddress: walletToCreate },
    { $setOnInsert: setOnInsert, $set: { updatedAt: now } },
    { upsert: true }
  );

  let createdDoc;
  if (result?.upsertedCount > 0) {
    createdDoc = setOnInsert;
  } else {
    createdDoc = await users.findOne({ walletAddress: walletToCreate });
  }

  if (context.externalWalletAddress && isAddress(context.externalWalletAddress)) {
    recordUserRegistration({ walletAddress: context.externalWalletAddress, username }).catch((e) =>
      console.error("onchain register error:", e)
    );
  }

  await upsertDailyLogin(walletToCreate, now);

  const token = await generateAuthToken({
    _id: walletToCreate,
    wallet: walletToCreate,
    username,
  });

  await writeUserToRedis({
    ...(createdDoc || setOnInsert),
    walletAddress: walletToCreate,
    username,
    lastUpdatedAt: now,
    lastFlushedAt: now,
  });

  const isGateUser = await ensureGateWalletUser(context, walletToCreate);

  const responseUser = buildUserPayload(
    { ...(createdDoc || setOnInsert), walletAddress: walletToCreate, username },
    privyMetaToStore
  );

  logV2("info", "success", {
    walletAddress: maskValue(walletToCreate),
    foundBy: context.externalWalletAddress ? "created_wallet" : "created_embedded",
    hasGateUser: isGateUser,
    nameUpdated: false
  });

  return {
    token,
    username,
    nameUpdated: false,
    user: responseUser,
    foundBy: context.externalWalletAddress ? "created_wallet" : "created_embedded",
  };
}
