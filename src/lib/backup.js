import { backupImageAnswerKey, BACKUP_QUEUE_KEY } from "./redisKeys.js";
import redis from "./redis.js";
import { deriveAnswerForFile } from "./backupQueue.js";
import { isEligibleForUser, loadSession, normalizeGuess, persistSession, recordExposure } from "../routes/game.js";
import { fetchUserProfile, writeUserToRedis } from "./docCache.js";
import { rankFromCorrect, titleFromStreak } from "./rank.js";

export async function fetchImageAns(name) {
    const cached = await redis.get(backupImageAnswerKey(name));
    if (cached) return String(cached).trim();

    const ans = deriveAnswerForFile(name)
    await redis.set(backupImageAnswerKey(name), ans);
    return ans;
}

const MAX_ATTEMPTS = Number(process.env.MAX_ATTEMPTS_FINDING_UNUSED_HASH || 30);

export async function pickEligibleBackupImage(wallet) {
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const name = await redis.lpop(BACKUP_QUEUE_KEY);
    if (!name) {
      continue;
    }
    const okUser = await isEligibleForUser(wallet, name);
    if (okUser) {
      await redis.rpush(BACKUP_QUEUE_KEY, name); // keep in rotation
      await recordExposure(wallet, name);
        return {
          status: 200,
          body: {
            imageId: name,
            hash: name,
            url: `/api/img/h/${encodeURIComponent(name)}`,
          },
        };
    } else {
      await redis.rpush(BACKUP_QUEUE_KEY, name);
    }
  }

  return { status: 204, body: null };
}

export async function handleBackupAnswer(req, res) {
    try {
        const wallet = req.user.walletAddress;
        const name = String(req.body?.hash || "").trim();
        const guess = normalizeGuess(req.body?.guess);
        const sessionId = String(req.body?.sessionId || "").trim();

        if (!name) return res.status(400).json({ error: "name required" });
        if (!guess) {
            return res.status(400).json({ error: "guess must be 'ai' or 'human'" });
        }

        const now = new Date();

        const ans = await fetchImageAns(name);
        const truth = normalizeGuess(ans);

        const correct = guess === truth;

        const session = await loadSession(wallet);
        if (session && (!sessionId || session.sessionId === sessionId)) {
            session.totalGuesses = (session.totalGuesses || 0) + 1;
            if (correct) {
                session.correctGuesses = (session.correctGuesses || 0) + 1;
            }
            session.lastUpdatedAt = now.toISOString();
            await persistSession(wallet, session);
        }

        const profile = await fetchUserProfile(wallet);

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

        return res.json({
            correct,
            truth,
            imageId: name,
            name,
            profile: profileResponse,
        });
    } catch (error) {
        console.error("game/ans error:", error);
        return res.status(500).json({ error: "internal server error" });
    }
}