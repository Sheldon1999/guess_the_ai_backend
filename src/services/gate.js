import { gateWallets } from "../lib/mongo.js";
import { docGateUserKey } from "../lib/redisKeys.js";
import redis from "../lib/redis.js";
import { rankFromCorrect, titleFromStreak } from "../lib/rank.js";

const gateDebugLog = (...args) => {
    if (process.env.GATE_DEBUG === "1") {
        console.log("[gate-gateCache]", ...args);
    }
};

export async function flushGateUsers() {
    const keyPrefix = docGateUserKey("");
    const matchPattern = `${keyPrefix}*`;
    const operations = [];
    gateDebugLog("flushGateUsers start", { keyPrefix, matchPattern });

    let cursor = "0";
    do {
        const [next, keys] = await redis.scan(cursor, "MATCH", matchPattern, "COUNT", 200);
        cursor = next;
        if (!keys.length) continue;

        const values = await redis.mget(keys);
        for (let i = 0; i < keys.length; i += 1) {
            const raw = values[i];
            if (!raw) continue;

            let payload;
            try {
                payload = JSON.parse(raw);
            } catch {
                continue;
            }
            if (!payload || typeof payload !== "object") continue;

            const key = keys[i];
            const walletAddress = key.startsWith(keyPrefix)
                ? key.slice(keyPrefix.length)
                : key;
            if (!walletAddress) continue;

            const updatePayload = {
                correctAnswers: Number(payload.correctAnswers) || 0,
                currentStreak: Number(payload.currentStreak) || 0,
                streak: Number(payload.streak) || 0,
                rank: payload.rank || rankFromCorrect(Number(payload.correctAnswers) || 0),
                dungeonTitle: payload.dungeonTitle || titleFromStreak(Number(payload.streak) || 0),
                type: payload.type || "normal",
                walletAddress
            };
            if (typeof payload.username === "string" && payload.username.trim()) {
                updatePayload.username = payload.username;
            }

            operations.push({
                updateOne: {
                    filter: { walletAddress },
                    update: { $set: updatePayload }
                }
            });
        }
    } while (cursor !== "0");

    if (!operations.length) {
        gateDebugLog("flushGateUsers no operations");
        return { flushed: 0 };
    }

    await gateWallets.bulkWrite(operations, { ordered: false });
    gateDebugLog("flushGateUsers bulkWrite", { operations: operations.length });
    return { flushed: operations.length };
}

export async function createGateUserRedis(wallet, username, walletType = "normal") {
    const isGateUserExisted = await getGateUserRedis(wallet);
    if (isGateUserExisted) {
        gateDebugLog("createGateUserRedis skipped, already cached", { wallet });
        return;
    }
    const payload = {
        correctAnswers: 0,
        currentStreak: 0,
        streak: 0,
        username: username,
        type: walletType
    };
    payload.walletAddress = wallet;
    payload.rank = rankFromCorrect(0);
    payload.dungeonTitle = titleFromStreak(0);
    gateDebugLog("createGateUserRedis", { wallet, username, walletType });
    const userKey = docGateUserKey(wallet);
    await redis.set(userKey, JSON.stringify(payload));
}

export async function getGateUserRedis(wallet) {
    const userKey = docGateUserKey(wallet);
    const cached = await redis.get(userKey);
    gateDebugLog("getGateUserRedis", { wallet, hit: Boolean(cached) });
    return JSON.parse(cached);
}

export async function updateGateUserScoreRedis(wallet, hasCorrectAnswer) {
    const payload = await getGateUserRedis(wallet);
    let correctAnswers = payload.correctAnswers;
    let currentStreak = payload.currentStreak;
    let streak = payload.streak;
    if (hasCorrectAnswer) {
        correctAnswers = correctAnswers + 1;
        currentStreak = currentStreak + 1;
        if (currentStreak > streak) {
            streak = currentStreak;
        }
    } else {
        currentStreak = 0;
    }

    const updatedPayload = {
        correctAnswers: correctAnswers,
        currentStreak: currentStreak,
        streak: streak,
        username: payload.username,
        type: payload.type || "normal",
        walletAddress: payload.walletAddress || wallet,
        rank: rankFromCorrect(correctAnswers),
        dungeonTitle: titleFromStreak(streak)
    }
    const userKey = docGateUserKey(wallet);
    gateDebugLog("updateGateUserScoreRedis", { wallet, hasCorrectAnswer, updatedPayload });
    await redis.set(userKey, JSON.stringify(updatedPayload));
}

export async function updateGateUsernameRedis(wallet, newUsername) {
    const payload = await getGateUserRedis(wallet);
    const updatedPayload = {
        correctAnswers: payload.correctAnswers,
        currentStreak: payload.currentStreak,
        streak: payload.streak,
        type: payload.type || "normal",
        walletAddress: payload.walletAddress || wallet,
        rank: payload.rank,
        dungeonTitle: payload.dungeonTitle,
        username: newUsername
    }
    const userKey = docGateUserKey(wallet);
    await redis.set(userKey, JSON.stringify(updatedPayload));
}

/**
 * Get gate wallet leaderboard with pagination
 * @param {number} limit - Max entries per page (default 10)
 * @param {string} type - Filter type ('all' or specific type like 'gate_wallet')
 * @param {number} page - Page number (1-based, default 1)
 * @param {string} currentWallet - Optional wallet to find user's rank
 * @returns {Promise<Object>} Leaderboard result with pagination info
 */
export async function getGateWalletLeaderboard(limit = 10, type = "all", page = 1, currentWallet = null) {
    const safeLimit = Math.max(Number(limit) || 10, 1);
    const safePage = Math.max(Number(page) || 1, 1);
    const offset = (safePage - 1) * safeLimit;

    const keyPrefix = docGateUserKey("");
    const matchPattern = `${keyPrefix}*`;
    const entries = [];

    let cursor = "0";
    do {
        const [next, keys] = await redis.scan(cursor, "MATCH", matchPattern, "COUNT", 200);
        cursor = next;
        if (!keys.length) continue;

        const values = await redis.mget(keys);
        for (let i = 0; i < keys.length; i += 1) {
            const raw = values[i];
            if (!raw) continue;

            let payload;
            try {
                payload = JSON.parse(raw);
            } catch {
                continue;
            }

            const key = keys[i];
            const walletAddress = key.startsWith(keyPrefix)
                ? key.slice(keyPrefix.length)
                : key;
            if (!walletAddress) continue;

            // Filter by type - only include entries matching the provided type
            // If type is "all", no filtering is done
            const entryType = payload.type;
            if (type !== "all" && entryType !== type) continue;

            entries.push({
                walletAddress,
                username: String(payload.username),
                correctAnswers: Number(payload.correctAnswers) || 0,
                currentStreak: Number(payload.currentStreak) || 0,
                streak: Number(payload.streak) || 0,
                type: String(payload.type),
                rank: payload.rank,
                dungeonTitle: payload.dungeonTitle
            });
        }
    } while (cursor !== "0");

    gateDebugLog("getGateWalletLeaderboard candidates", { limit: safeLimit, page: safePage, total: entries.length });

    // Sort all entries
    entries.sort((a, b) => {
        if (b.correctAnswers !== a.correctAnswers) return b.correctAnswers - a.correctAnswers;
        if (b.streak !== a.streak) return b.streak - a.streak;
        return b.currentStreak - a.currentStreak;
    });

    const totalCount = entries.length;
    const totalPages = Math.ceil(totalCount / safeLimit);

    // Find current user's rank if wallet provided
    let currentUserRank = null;
    if (currentWallet) {
        const normalizedWallet = currentWallet.toLowerCase();
        const userIndex = entries.findIndex(e => e.walletAddress.toLowerCase() === normalizedWallet);
        if (userIndex !== -1) {
            currentUserRank = userIndex + 1;
        }
    }

    // Paginate
    const paginatedEntries = entries.slice(offset, offset + safeLimit).map((entry) => ({
        rank: entry?.rank || "E",
        username: entry.username,
        walletAddress: entry.walletAddress,
        correctAnswers: entry.correctAnswers,
        currentStreak: entry.currentStreak,
        streak: entry.streak,
    }));

    return {
        data: paginatedEntries,
        pagination: {
            page: safePage,
            limit: safeLimit,
            totalCount,
            totalPages,
            hasNextPage: safePage < totalPages,
            hasPrevPage: safePage > 1
        },
        currentUserRank
    };
}
