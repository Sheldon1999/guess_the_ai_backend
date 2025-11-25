import { fetchImageMeta } from "../lib/docCache.js";
import { fetchUserProfile, writeUserToRedis } from "../lib/docCache.js";
import { rankFromCorrect, titleFromStreak, rankSwitchExpression, titleSwitchExpression } from "../lib/rank.js";
import answerList from "../lib/backup_answer.js";
import { getTruthLabel } from "../lib/kv.js";
import { images } from "../lib/mongo.js";

function normalizeGuess(g) {
    const v = String(g || "")
        .trim()
        .toLowerCase();
    return v === "ai" || v === "human" ? v : null;
}

export async function handleRedisAnswer(walletAddress, hash, guess) {
    try {

        const now = new Date();

        const imageMeta = await fetchImageMeta(hash);
        if (!imageMeta?.imageId) return handleMongoAnswer(walletAddress, hash, guess);
        const imageId = imageMeta.imageId;
        const truth = normalizeGuess(imageMeta.label);
        if (!truth) return handleMongoAnswer(walletAddress, hash, guess);

        const correct = guess === truth;

        const profile = await fetchUserProfile(wallet);
        if (!profile) return handleMongoAnswer(walletAddress, hash, guess);

        const nextCorrectAnswers = correct ? profile.correctAnswers + 1 : profile.correctAnswers;
        const nextCurrentStreak = correct ? profile.currentStreak + 1 : 0;
        const nextStreak = correct ? Math.max(nextCurrentStreak, profile.streak) : profile.streak;
        const updatedProfile = {
            ...profile,
            correctAnswers: nextCorrectAnswers,
            currentStreak: nextCurrentStreak,
            streak: nextStreak,
            rank: rankFromCorrect(nextCorrectAnswers),
            dungeonTitle: titleFromStreak(nextStreak),
            lastUpdatedAt: now.toISOString(),
        };
        await writeUserToRedis(updatedProfile, true);
        return { updatedProfile, imageId, truth };
    } catch (err) {
        console.error("[SERVICE] service: answer; method: handleRedisAnswer; error: ", err);
    }
}

const getBackupTruth = (hash) => {
    const entry = answerList.find((item) => item.file_name === hash);
    return entry ? normalizeGuess(entry.answer) : null;
};

async function getImageIdFromMongo(hash) {
    const image = await images.findOne(
        { hash: normHash },
        { projection: { _id: 1, hash: 1, label: 1 } }
    );;
    if (image?.imageId) return image.imageId;
}

export async function handleMongoAnswer(walletAddress, hash, guess) {
    try {
        const now = new Date();

        let imageId, truth;
        try {
            imageId = await getImageIdFromMongo(hash);
            truth = await getTruthLabel(hash);
        } catch (e) {
            try {
                imageId = hash;
                truth = getBackupTruth(imageId);
            } catch (err) {
                console.log("[SERVICE] service: answer; method: handleBackupInMongoAnswer; error: ", err);
            }
        }

        const correct = guess === truth;

        const baseCorrectAnswers = { $ifNull: ["$correctAnswers", 0] };
        const baseCurrentStreak = { $ifNull: ["$currentStreak", 0] };
        const baseStreak = { $ifNull: ["$streak", 0] };

        const updatedCorrectAnswers = correct
            ? { $add: [baseCorrectAnswers, 1] }
            : baseCorrectAnswers;
        const updatedCurrentStreak = correct
            ? { $add: [baseCurrentStreak, 1] }
            : 0;
        const computedStreak = correct
            ? {
                $cond: [
                    { $gt: ["$currentStreak", baseStreak] },
                    "$currentStreak",
                    baseStreak,
                ],
            }
            : baseStreak;

        const rankExpression = rankSwitchExpression("$correctAnswers");
        const dungeonTitleExpression = titleSwitchExpression(computedStreak);

        const profileResult = await users.findOneAndUpdate(
            { walletAddress: walletAddress },
            [
                {
                    $set: {
                        correctAnswers: updatedCorrectAnswers,
                        currentStreak: updatedCurrentStreak,
                    },
                },
                {
                    $set: {
                        streak: computedStreak,
                        rank: rankExpression,
                        dungeonTitle: dungeonTitleExpression,
                        updatedAt: now,
                        lastUpdatedAt: now,
                        lastFlushedAt: now,
                    },
                },
            ],
            {
                returnDocument: "after",
                projection: {
                    username: 1,
                    correctAnswers: 1,
                    currentStreak: 1,
                    streak: 1,
                    rank: 1,
                    dungeonTitle: 1,
                },
            }
        );

        return { profileResult, imageId, truth }
    } catch (err) {
        console.error("[SERVICE] service: answer; method: handleMongoAnswer; error: ", err);
    }
}

export async function handleBackupAnswer(walletAddress, hash, guess) {
    try {
        const now = new Date();

        const ans = getBackupTruth(hash);
        const truth = normalizeGuess(ans);

        const correct = guess === truth;

        const profile = await fetchUserProfile(walletAddress);

        const nextCorrectAnswers = correct ? profile.correctAnswers + 1 : profile.correctAnswers;
        const nextCurrentStreak = correct ? profile.currentStreak + 1 : 0;
        const nextStreak = correct ? Math.max(nextCurrentStreak, profile.streak) : profile.streak;
        const updatedProfile = {
            ...profile,
            correctAnswers: nextCorrectAnswers,
            currentStreak: nextCurrentStreak,
            streak: nextStreak,
            rank: rankFromCorrect(nextCorrectAnswers),
            dungeonTitle: titleFromStreak(nextStreak),
            lastUpdatedAt: now.toISOString(),
        };
        await writeUserToRedis(updatedProfile, true);

        const profileResponse = {
            username: updatedProfile.username,
            correctAnswers: updatedProfile.correctAnswers,
            currentStreak: updatedProfile.currentStreak,
            streak: updatedProfile.streak,
            rank: updatedProfile.rank,
            dungeonTitle: updatedProfile.dungeonTitle,
        };

        return {
            profileResponse,
            hash,
            truth
        };
    } catch (err) {
        console.error("[SERVICE] service: answer; method: handleBackupAnswer; error: ", err);
    }
}
