import { normalizeWallet } from '../utils/normalize.js';

const TARGET_STREAK = 10;
const REWARD_ID = 'muscle';
const REWARD_TYPE = 'vehicle';
const DESTINATION_GAME = 'highway_hustle';
const CONTEST_ID = 'highway_hustle_muscle_streak_10';
const REWARD_TITLE = 'Muscle Monster';
const REWARD_NOTE = 'Log into Highway Hustle with the same wallet to find this car in your garage.';
const GRANT_NOTE = 'Unlocked in Guess The AI by reaching a best streak of 10.';
const REQUEST_TIMEOUT_MS = Math.max(
  Number(process.env.HIGHWAY_HUSTLE_API_TIMEOUT_MS || 6000),
  1000
);
const grantedWallets = new Set();

function getHighwayApiBaseUrl() {
  return String(process.env.HIGHWAY_HUSTLE_API_BASE_URL || '')
    .trim()
    .replace(/\/$/, '');
}

function getRewardGrantSecret() {
  return String(process.env.HIGHWAY_HUSTLE_REWARD_GRANT_SECRET || '').trim();
}

function toSafeStreak(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.trunc(numeric));
}

function buildContestReward(bestStreak, overrides = {}) {
  const currentBestStreak = toSafeStreak(bestStreak);
  const unlocked = Boolean(
    overrides.unlocked ?? (currentBestStreak >= TARGET_STREAK || overrides.granted)
  );
  const granted = Boolean(overrides.granted);
  const status = overrides.status || (granted ? 'granted' : unlocked ? 'eligible' : 'locked');

  return {
    id: CONTEST_ID,
    title: REWARD_TITLE,
    targetStreak: TARGET_STREAK,
    currentBestStreak,
    rewardId: REWARD_ID,
    rewardType: REWARD_TYPE,
    destinationGame: DESTINATION_GAME,
    unlocked,
    granted,
    justGranted: Boolean(overrides.justGranted),
    status,
    note: overrides.note || REWARD_NOTE
  };
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function fetchRewardStatus(walletAddress) {
  if (grantedWallets.has(walletAddress)) {
    return { granted: true };
  }

  const baseUrl = getHighwayApiBaseUrl();
  if (!baseUrl) {
    return { granted: false, configured: false };
  }

  try {
    const response = await fetch(
      `${baseUrl}/player/rewards?user=${encodeURIComponent(walletAddress)}`,
      {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      }
    );

    if (!response.ok) {
      return { granted: false, configured: true, error: `http_${response.status}` };
    }

    const payload = await readJson(response);
    const rewards = Array.isArray(payload?.rewards) ? payload.rewards : [];
    const match = rewards.find((reward) => (
      String(reward?.rewardId || '').trim().toLowerCase() === REWARD_ID &&
      String(reward?.rewardType || '').trim().toLowerCase() === REWARD_TYPE
    ));

    if (!match) {
      return { granted: false, configured: true };
    }

    grantedWallets.add(walletAddress);
    return {
      granted: true,
      configured: true,
      note: String(match?.note || '').trim() || REWARD_NOTE
    };
  } catch (error) {
    console.error('[HighwayHustleContest] reward status fetch failed:', error);
    return { granted: false, configured: true, error: 'fetch_failed' };
  }
}

async function grantReward(walletAddress) {
  const baseUrl = getHighwayApiBaseUrl();
  const secret = getRewardGrantSecret();

  if (!baseUrl || !secret) {
    return { granted: false, configured: false };
  }

  try {
    const response = await fetch(`${baseUrl}/player/rewards/grant`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'x-contest-grant-secret': secret
      },
      body: JSON.stringify({
        walletAddress,
        rewardId: REWARD_ID,
        rewardType: REWARD_TYPE,
        note: GRANT_NOTE
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });

    if (!response.ok) {
      return { granted: false, configured: true, error: `http_${response.status}` };
    }

    const payload = await readJson(response);
    if (!payload?.success || !payload?.granted) {
      return { granted: false, configured: true, error: payload?.code || 'grant_failed' };
    }

    grantedWallets.add(walletAddress);
    return {
      granted: true,
      configured: true,
      created: Boolean(payload?.created),
      note: String(payload?.reward?.note || '').trim() || REWARD_NOTE
    };
  } catch (error) {
    console.error('[HighwayHustleContest] reward grant failed:', error);
    return { granted: false, configured: true, error: 'grant_failed' };
  }
}

export async function resolveContestReward(walletAddress, bestStreak, options = {}) {
  const normalizedWallet = normalizeWallet(walletAddress) || '';
  const safeBestStreak = toSafeStreak(bestStreak);
  const shouldForceSync = Boolean(options.forceSync);

  if (!normalizedWallet) {
    return buildContestReward(safeBestStreak);
  }

  const rewardStatus = shouldForceSync || safeBestStreak >= TARGET_STREAK
    ? await fetchRewardStatus(normalizedWallet)
    : { granted: grantedWallets.has(normalizedWallet) };

  if (rewardStatus.granted) {
    return buildContestReward(safeBestStreak, {
      granted: true,
      status: 'granted',
      note: rewardStatus.note || REWARD_NOTE
    });
  }

  if (safeBestStreak < TARGET_STREAK) {
    return buildContestReward(safeBestStreak, { status: 'locked' });
  }

  const grantStatus = await grantReward(normalizedWallet);
  if (grantStatus.granted) {
    return buildContestReward(safeBestStreak, {
      granted: true,
      justGranted: grantStatus.created,
      status: 'granted',
      note: grantStatus.note || REWARD_NOTE
    });
  }

  if (!getHighwayApiBaseUrl() || !getRewardGrantSecret()) {
    return buildContestReward(safeBestStreak, {
      unlocked: true,
      status: 'eligible',
      note: REWARD_NOTE
    });
  }

  return buildContestReward(safeBestStreak, {
    unlocked: true,
    status: 'eligible',
    note: 'Reward unlocked. Highway Hustle sync is still catching up for this wallet.'
  });
}

export async function attachContestRewardToProfile(profile, walletAddress, options = {}) {
  if (!profile) return null;

  const contestReward = await resolveContestReward(
    walletAddress,
    profile?.streak,
    options
  );

  return {
    ...profile,
    contestReward
  };
}

export async function attachContestRewardToResponse(response, walletAddress, options = {}) {
  if (!response) return response;

  const contestReward = await resolveContestReward(
    walletAddress,
    response?.profile?.streak,
    options
  );

  return {
    ...response,
    contestReward
  };
}
