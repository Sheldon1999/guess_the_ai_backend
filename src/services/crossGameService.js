import { users } from '../lib/mongo.js';
import { classifyCrossGamePerformance } from '../utils/crossGameDifficulty.js';

export const CROSS_GAME_BACKENDS = Object.freeze({
  zeroDash: 'https://zerog-zerodash.onrender.com',
  zeroGpool: 'https://zerogpoolgame.onrender.com/api',
  guessTheAi: 'https://guesstheai.xyz/backend/api',
  highwayHustle: 'https://highway-hustle-backend.onrender.com/api',
});

function normalizeWallet(value) {
  return String(value || '').trim().toLowerCase();
}

function localUrl(baseUrl, walletAddress) {
  return `${baseUrl.replace(/\/+$/, '')}/cross-game/local?walletAddress=${encodeURIComponent(walletAddress)}`;
}

async function fetchJsonWithTimeout(url, timeoutMs = 5000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.success === false) {
      throw new Error(body?.error || body?.message || `HTTP ${response.status}`);
    }
    return body?.data || body;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getLocalCrossGame(walletAddress) {
  const wallet = normalizeWallet(walletAddress);
  if (!wallet) {
    const err = new Error('walletAddress is required');
    err.statusCode = 400;
    throw err;
  }

  const user = await users.findOne(
    { walletAddress: wallet },
    { projection: { walletAddress: 1, currentStreak: 1, streak: 1, correctAnswers: 1 } },
  );
  const streak = Number(user?.streak || 0);
  return {
    gameKey: 'guessTheAi',
    game: 'Guess the AI',
    walletAddress: wallet,
    available: Boolean(user),
    metrics: {
      streak,
      currentStreak: Number(user?.currentStreak || 0),
      correctAnswers: Number(user?.correctAnswers || 0),
    },
    crossGame: classifyCrossGamePerformance('guessTheAi', streak),
  };
}

export async function getCrossGameProgress(walletAddress) {
  const wallet = normalizeWallet(walletAddress);
  if (!wallet) {
    const err = new Error('walletAddress is required');
    err.statusCode = 400;
    throw err;
  }

  const games = await Promise.all(
    Object.entries(CROSS_GAME_BACKENDS).map(async ([gameKey, baseUrl]) => {
      try {
        return await fetchJsonWithTimeout(localUrl(baseUrl, wallet));
      } catch (error) {
        return {
          gameKey,
          walletAddress: wallet,
          available: false,
          error: error?.message || 'Cross-game backend unavailable',
        };
      }
    }),
  );

  return { walletAddress: wallet, games };
}
