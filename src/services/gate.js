import { gateWallets } from "../lib/mongo.js";
import { docGateUserKey } from "../lib/redisKeys";
import redis from "../lib/redis.js";

export async function flushGateUsers() {
    const keyPrefix = docGateUserKey("");
    const matchPattern = `${keyPrefix}*`;
    const operations = [];

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
                streak: Number(payload.streak) || 0
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

    if (!operations.length) return { flushed: 0 };

    await gateWallets.bulkWrite(operations, { ordered: false });
    return { flushed: operations.length };
}

export async function createGateUserRedis(wallet, username) {
    const payload = {
        correctAnswers: 0,
        currentStreak: 0,
        streak: 0,
        username: username
    };
    const userKey = docGateUserKey(wallet);
    await redis.set(userKey, JSON.stringify(payload));
}

export async function getGateUserRedis(wallet) {
    const userKey = docGateUserKey(wallet);
    const cached = await redis.get(userKey);
    return JSON.parse(cached);
}

export async function updateGateUserScoreRedis(wallet, hasCorrectAnswer) {
    const payload = await getGateUserRedis(wallet);
    let correctAnswers = payload.correctAnswers;
    let currentStreak = payload.currentStreak;
    let streak = payload.streak;
    if(hasCorrectAnswer) {
        correctAnswers = correctAnswers + 1;
        currentStreak = currentStreak + 1;
        if(currentStreak > streak){
            streak = currentStreak;
        }
    } else {
        currentStreak = 0;
    }

    const updatedPayload = {
        correctAnswers: correctAnswers,
        currentStreak: currentStreak,
        streak: streak,
        username: payload.username
    }
    const userKey = docGateUserKey(wallet);
    await redis.set(userKey, JSON.stringify(updatedPayload));
}

export async function updateGateUsernameRedis(wallet, newUsername) {
    const payload = await getGateUserRedis(wallet);
    const updatedPayload = {
        correctAnswers: payload.correctAnswers,
        currentStreak: payload.currentStreak,
        streak: payload.streak,
        username: newUsername
    }
    const userKey = docGateUserKey(wallet);
    await redis.set(userKey, JSON.stringify(updatedPayload));
}

export async function getGateWalletLeaderboard(limit) {
    const safeLimit = Math.max(Number(limit) || 0, 0);
    if (!safeLimit) return [];

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

            entries.push({
                walletAddress,
                username: String(payload.username),
                correctAnswers: Number(payload.correctAnswers) || 0,
                currentStreak: Number(payload.currentStreak) || 0,
                streak: Number(payload.streak) || 0
            });
        }
    } while (cursor !== "0");

    entries.sort((a, b) => {
        if (b.correctAnswers !== a.correctAnswers) return b.correctAnswers - a.correctAnswers;
        if (b.streak !== a.streak) return b.streak - a.streak;
        return b.currentStreak - a.currentStreak;
    });

    return entries.slice(0, safeLimit).map((entry, index) => ({
        rank: index + 1,
        username: entry.username,
        walletAddress: entry.walletAddress,
        correctAnswers: entry.correctAnswers,
        currentStreak: entry.currentStreak,
        streak: entry.streak
    }));
}
