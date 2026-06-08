import crypto from 'node:crypto';
import redis from '../lib/redis.js';
import { images } from '../lib/mongo.js';
import { fetchImageMeta, fetchUserProfile, safeParse, updateCachedUser } from '../lib/docCache.js';
import { localRandomIndex } from '../lib/random.js';
import {
  READY_QUEUE_KEY,
  READY_AI_POOL_KEY,
  READY_HUMAN_POOL_KEY,
  docImageKey
} from '../lib/redisKeys.js';
import { normalizeGuess, normalizeHash } from '../utils/normalize.js';
import * as answerService from './answerService.js';
import { recordModeAnswerOnchain } from './answerService.js';
import { getRandomTemplate, supportedGameModes } from './gameQuestionConfigService.js';
import { fireHintGeneration } from './hintService.js';
import {
  generateOddOneOutPercentages,
  generateMultiSelectPercentages,
  generateCardFlipProbabilities
} from './percentageService.js';
import { attachContestRewardToResponse } from './highwayHustleContestService.js';

const LABEL_TOPUP_BATCH = Math.max(Number(process.env.GAME_LABEL_POOL_TOPUP || 2000), 100);
const MAX_POOL_ATTEMPTS = 5;
const SAMPLE_OVERSAMPLE_MULTIPLIER = 4;
const READY_QUEUE_SAMPLE_MULTIPLIER = 6;

function buildImageUrl(hash) {
  return `/api/img/h/${encodeURIComponent(hash)}`;
}

function poolKeyForLabel(label) {
  return label === 'ai' ? READY_AI_POOL_KEY : READY_HUMAN_POOL_KEY;
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function shuffle(items) {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function toUniqueHashes(list) {
  const unique = new Set();
  for (const item of list || []) {
    const hash = normalizeHash(item);
    if (hash) unique.add(hash);
  }
  return Array.from(unique);
}

function toProfileResponse(profile) {
  if (!profile) return null;
  return {
    username: profile.username,
    correctAnswers: profile.correctAnswers,
    currentStreak: profile.currentStreak,
    streak: profile.streak,
    rank: profile.rank,
    dungeonTitle: profile.dungeonTitle
  };
}

function toSafeInt(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.trunc(numeric));
}

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.trunc(numeric);
}

async function applyModeProgress(walletAddress, { delta = 0, isCorrectRound = false } = {}) {
  const safeDelta = toInt(delta, 0);

  const updatedProfile = await updateCachedUser(walletAddress, (current) => {
    const correctAnswers = toSafeInt(current?.correctAnswers);
    const currentStreak = toSafeInt(current?.currentStreak);
    const bestStreak = toSafeInt(current?.streak);

    const nextCurrentStreak = isCorrectRound ? currentStreak + 1 : 0;
    const nextBestStreak = Math.max(bestStreak, nextCurrentStreak);

    return {
      ...current,
      correctAnswers: Math.max(0, correctAnswers + safeDelta),
      currentStreak: nextCurrentStreak,
      streak: nextBestStreak,
      // Let cache helper recalculate rank/title from updated counters.
      rank: null,
      dungeonTitle: null
    };
  }).catch(() => null);

  if (updatedProfile) {
    return toProfileResponse(updatedProfile);
  }

  return toProfileResponse(await fetchUserProfile(walletAddress).catch(() => null));
}

async function safeRecordModeAnswerOnchain(walletAddress, params) {
  try {
    const result = recordModeAnswerOnchain(walletAddress, params);
    if (result && typeof result.then === 'function') {
      return await result.catch((error) => {
        console.error('[gameModeService] safeRecordModeAnswerOnchain promise rejected:', error);
        return null;
      });
    }
    return result != null ? result : null;
  } catch (error) {
    console.error('[gameModeService] safeRecordModeAnswerOnchain failed:', error);
    return null;
  }
}

async function cacheLabelDocs(docs, label) {
  if (!docs.length) return;

  const pipeline = redis.pipeline();
  const poolKey = poolKeyForLabel(label);

  for (const doc of docs) {
    const hash = normalizeHash(doc?.hash);
    if (!hash) continue;

    pipeline.sadd(poolKey, hash);
    pipeline.set(docImageKey(hash), JSON.stringify({
      hash,
      imageId: String(doc?._id || hash),
      label
    }));
  }

  await pipeline.exec();
}

async function topupPoolFromMongo(label, neededCount) {
  const sampleSize = Math.max(neededCount * SAMPLE_OVERSAMPLE_MULTIPLIER, LABEL_TOPUP_BATCH);

  const cursor = images.aggregate([
    {
      $match: {
        isActive: { $ne: false },
        label: { $regex: `^${label}$`, $options: 'i' }
      }
    },
    {
      $project: {
        _id: 1,
        hash: 1
      }
    },
    {
      $sample: { size: sampleSize }
    }
  ]);

  const docs = [];
  for await (const doc of cursor) {
    if (doc?.hash) docs.push(doc);
  }

  if (!docs.length) {
    return 0;
  }

  await cacheLabelDocs(docs, label);
  return docs.length;
}

async function ensurePoolCapacity(label, count) {
  if (count <= 0) return true;

  const key = poolKeyForLabel(label);
  let available = Number(await redis.scard(key)) || 0;

  if (available >= count) {
    return true;
  }

  await topupPoolFromMongo(label, count - available);
  available = Number(await redis.scard(key)) || 0;

  return available >= count;
}

async function sampleReadyQueueHashes(sampleSize) {
  if (sampleSize <= 0) return [];

  const queueLength = Number(await redis.llen(READY_QUEUE_KEY)) || 0;
  if (!queueLength) return [];

  const indexes = new Set();
  const target = Math.min(sampleSize, queueLength);
  const maxAttempts = target * READY_QUEUE_SAMPLE_MULTIPLIER;
  let attempts = 0;

  while (indexes.size < target && attempts < maxAttempts) {
    attempts += 1;
    indexes.add(localRandomIndex(queueLength));
  }

  if (!indexes.size) return [];

  const pipeline = redis.pipeline();
  for (const idx of indexes) {
    pipeline.lindex(READY_QUEUE_KEY, idx);
  }

  const rows = await pipeline.exec();
  return rows
    .map(([, value]) => normalizeHash(value))
    .filter(Boolean);
}

async function getTruthByHashes(hashes) {
  const unique = toUniqueHashes(hashes);
  if (!unique.length) return new Map();

  const pipeline = redis.pipeline();
  unique.forEach((hash) => pipeline.get(docImageKey(hash)));
  const rows = await pipeline.exec();

  const truthMap = new Map();
  const misses = [];

  rows.forEach((row, index) => {
    const raw = row?.[1];
    const parsed = safeParse(raw);
    const truth = normalizeGuess(parsed?.label);

    if (truth) {
      truthMap.set(unique[index], truth);
      return;
    }

    misses.push(unique[index]);
  });

  if (!misses.length) {
    return truthMap;
  }

  const fallback = await Promise.all(misses.map((hash) => fetchImageMeta(hash).catch(() => null)));

  fallback.forEach((meta, idx) => {
    const hash = misses[idx];
    const truth = normalizeGuess(meta?.label);
    if (truth) {
      truthMap.set(hash, truth);
    }
  });

  return truthMap;
}

async function sampleHashesByLabel(label, count, exclude = new Set()) {
  if (count <= 0) return [];

  await ensurePoolCapacity(label, count);

  const key = poolKeyForLabel(label);
  const picked = new Set();

  for (let attempt = 0; attempt < MAX_POOL_ATTEMPTS && picked.size < count; attempt += 1) {
    const need = count - picked.size;
    const requestSize = Math.max(need * SAMPLE_OVERSAMPLE_MULTIPLIER, need);

    const sampled = asArray(await redis.srandmember(key, requestSize));

    for (const value of sampled) {
      const hash = normalizeHash(value);
      if (!hash || exclude.has(hash)) continue;
      picked.add(hash);
      if (picked.size >= count) break;
    }
  }

  if (picked.size >= count) {
    return Array.from(picked).slice(0, count);
  }

  const fallbackNeed = count - picked.size;
  const fallbackCandidates = await sampleReadyQueueHashes(fallbackNeed * SAMPLE_OVERSAMPLE_MULTIPLIER);
  const truthMap = await getTruthByHashes(fallbackCandidates);

  for (const hash of fallbackCandidates) {
    if (picked.size >= count) break;
    if (exclude.has(hash)) continue;
    if (truthMap.get(hash) !== label) continue;
    picked.add(hash);
  }

  return Array.from(picked).slice(0, count);
}

function buildQuestionResponse(mode, template, hashes, roundId, percentageMap) {
  const normalizedHashes = shuffle(toUniqueHashes(hashes)).slice(0, template.imageCount);
  const imagesList = normalizedHashes.map((hash) => {
    const baseImage = {
      id: hash,
      hash,
      url: buildImageUrl(hash)
    };
    if (percentageMap && percentageMap[hash] !== undefined) {
      if (typeof percentageMap[hash] === 'object') {
        baseImage.percentage = percentageMap[hash].percentage;
        baseImage.percentageLabel = percentageMap[hash].label;
      } else {
        baseImage.percentage = percentageMap[hash];
      }
    }
    return baseImage;
  });
  const choiceMeta = buildQuestionChoices(mode, template);

  return {
    mode,
    roundId: roundId || null,
    templateKey: template.templateKey,
    questionText: template.questionText || null,
    questionSubtext: template.questionSubtext || null,
    variant: template.variant || null,
    askingFor: template.askingFor || null,
    imageCount: template.imageCount,
    aiCount: Number.isInteger(template.aiCount) ? template.aiCount : null,
    humanCount: Number.isInteger(template.humanCount) ? template.humanCount : null,
    config: {
      timeLimitSec: Number.isInteger(template.timeLimitSec) ? template.timeLimitSec : null,
      lives: Number.isInteger(template.lives) ? template.lives : null
    },
    choiceType: choiceMeta.choiceType,
    choices: choiceMeta.choices,
    images: imagesList
  };
}

async function resolveTemplateCounts(template) {
  if (Number.isInteger(template.aiCount) && Number.isInteger(template.humanCount)) {
    return {
      aiCount: template.aiCount,
      humanCount: template.humanCount
    };
  }

  const rollAi = Math.random() > 0.5;
  return {
    aiCount: rollAi ? 1 : 0,
    humanCount: rollAi ? 0 : 1
  };
}

export async function getModeQuestion(mode, variant = null) {
  const normalizedMode = String(mode || '').trim().toLowerCase();

  if (!supportedGameModes().includes(normalizedMode)) {
    throw new Error(`Unsupported mode: ${normalizedMode}`);
  }

  const template = await getRandomTemplate(normalizedMode, variant);
  const { aiCount, humanCount } = await resolveTemplateCounts(template);

  const exclude = new Set();
  const aiHashes = await sampleHashesByLabel('ai', aiCount, exclude);
  aiHashes.forEach((hash) => exclude.add(hash));

  const humanHashes = await sampleHashesByLabel('human', humanCount, exclude);

  const allHashes = [...aiHashes, ...humanHashes];

  if (allHashes.length < template.imageCount) {
    throw new Error(`Insufficient cached hashes for mode ${normalizedMode}`);
  }

  const roundId = crypto.randomUUID();

  // Fire-and-forget hint for modes with ≤2 images (classic uses its own path)
  if (normalizedMode === 'duel' || normalizedMode === 'rapidfire') {
    fireHintGeneration(roundId, allHashes, normalizedMode).catch(() => { });
  }

  // Pre-calculate percentages for multi-image modes
  let percentageMap = null;
  if (['oddoneout', 'multiselect', 'cardflip'].includes(normalizedMode)) {
    const truthMap = await getTruthByHashes(allHashes);
    if (normalizedMode === 'oddoneout') {
      const oddHash = aiCount === 1 ? aiHashes[0] : humanHashes[0];
      percentageMap = generateOddOneOutPercentages(allHashes, truthMap, oddHash, roundId);
    } else if (normalizedMode === 'multiselect') {
      percentageMap = generateMultiSelectPercentages(allHashes, truthMap, template.askingFor, roundId);
    } else if (normalizedMode === 'cardflip') {
      percentageMap = generateCardFlipProbabilities(allHashes, truthMap, roundId);
    }
  }

  const response = buildQuestionResponse(normalizedMode, template, allHashes, roundId, percentageMap);

  return response;
}

function buildScore(delta, correctCount, wrongCount) {
  return {
    delta,
    correctCount,
    wrongCount
  };
}

function buildQuestionChoices(mode, template) {
  if (mode === 'classic' || mode === 'cardflip' || mode === 'rapidfire') {
    return {
      choiceType: 'binary',
      choices: [
        { value: 'ai', label: 'AI' },
        { value: 'human', label: 'Human' }
      ]
    };
  }

  if (mode === 'duel') {
    return {
      choiceType: 'single-image',
      choices: [
        { value: '0', label: 'A' },
        { value: '1', label: 'B' }
      ]
    };
  }

  if (mode === 'oddoneout') {
    const count = Number.isInteger(template.imageCount) ? template.imageCount : 5;
    return {
      choiceType: 'single-image',
      choices: Array.from({ length: count }, (_, idx) => ({
        value: String(idx),
        label: `Image ${idx + 1}`
      }))
    };
  }

  return {
    choiceType: 'multi-image',
    choices: [
      {
        value: template.askingFor || 'ai',
        label: `Select all ${(template.askingFor || 'ai').toUpperCase()} images`
      }
    ]
  };
}

function buildModeAnswer(mode, results, score, profile = null, extra = {}) {
  return {
    mode,
    results,
    score,
    profile,
    ...extra
  };
}

async function buildModeAnswerWithContest(walletAddress, mode, results, score, profile = null, extra = {}) {
  const response = buildModeAnswer(mode, results, score, profile, extra);
  return await attachContestRewardToResponse(response, walletAddress);
}

function normalizeSelectedSet(selectedHashes) {
  return new Set(toUniqueHashes(selectedHashes));
}

export async function answerClassic(walletAddress, payload = {}) {
  const hash = normalizeHash(payload.hash);
  const guess = normalizeGuess(payload.guess);
  const isBackup = Boolean(payload.isBackup);

  if (!hash) {
    throw new Error('Hash is required');
  }

  if (!guess) {
    throw new Error("Guess must be 'ai' or 'human'");
  }

  const classicResponse = await answerService.processAnswer({
    walletAddress,
    hash,
    guess,
    isBackup
  });

  if (!classicResponse) {
    throw new Error('Unable to process classic answer');
  }

  const isCorrect = Boolean(classicResponse?.isCorrect ?? classicResponse?.correct);

  return {
    ...classicResponse,
    mode: 'classic',
    results: [{
      hash,
      guess,
      truth: classicResponse.truth || null,
      isCorrect
    }],
    score: buildScore(isCorrect ? 1 : 0, isCorrect ? 1 : 0, isCorrect ? 0 : 1)
  };
}

export async function answerMultiSelect(walletAddress, payload = {}) {
  const hashes = toUniqueHashes(payload.hashes);
  const selectedSet = normalizeSelectedSet(payload.selectedHashes);
  const askingFor = normalizeGuess(payload.askingFor) || 'ai';

  if (!hashes.length) {
    throw new Error('hashes must be a non-empty array');
  }

  const truthMap = await getTruthByHashes(hashes);

  let correctCount = 0;
  let wrongCount = 0;
  let wrongSelectedCount = 0;

  const results = hashes.map((hash) => {
    const truth = truthMap.get(hash) || null;
    const selected = selectedSet.has(hash);
    const shouldSelect = truth === askingFor;
    const isCorrect = truth ? selected === shouldSelect : false;

    if (isCorrect) correctCount += 1;
    else {
      wrongCount += 1;
      if (selected && !shouldSelect) {
        wrongSelectedCount += 1;
      }
    }

    return {
      hash,
      truth,
      selected,
      shouldSelect,
      isCorrect
    };
  });

  const delta = wrongSelectedCount > 0 ? 0 : correctCount;
  const isPerfectRound = wrongCount === 0 && hashes.length > 0;
  const profile = await applyModeProgress(walletAddress, {
    delta,
    isCorrectRound: isPerfectRound
  });

  const onchain = await safeRecordModeAnswerOnchain(walletAddress, {
    primaryHash: hashes[0],
    answer: askingFor,
    isCorrect: isPerfectRound,
    profile
  });

  return await buildModeAnswerWithContest(walletAddress, 'multiselect', results, buildScore(delta, correctCount, wrongCount), profile, {
    askingFor,
    ...(onchain?.transactionHash ? { onchain } : {})
  });
}

export async function answerDuel(walletAddress, payload = {}) {
  const hashes = toUniqueHashes(payload.hashes).slice(0, 2);
  const selectedHash = normalizeHash(payload.selectedHash);
  const askingFor = normalizeGuess(payload.askingFor) || 'ai';
  const variant = String(payload.variant || 'normal').toLowerCase();

  if (hashes.length !== 2) {
    throw new Error('Duel requires exactly 2 hashes');
  }

  if (!selectedHash || !hashes.includes(selectedHash)) {
    throw new Error('selectedHash must be one of the provided hashes');
  }

  const truthMap = await getTruthByHashes(hashes);
  const selectedTruth = truthMap.get(selectedHash) || null;
  const isCorrect = selectedTruth === askingFor;

  const results = hashes.map((hash) => ({
    hash,
    truth: truthMap.get(hash) || null,
    selected: hash === selectedHash,
    isCorrect: hash === selectedHash ? isCorrect : true
  }));

  const delta = variant === 'speed'
    ? (isCorrect ? 2 : -1)
    : (isCorrect ? 1 : 0);
  const profile = await applyModeProgress(walletAddress, {
    delta,
    isCorrectRound: isCorrect
  });

  const onchain = await safeRecordModeAnswerOnchain(walletAddress, {
    primaryHash: selectedHash,
    answer: selectedHash,
    isCorrect,
    profile
  });

  return await buildModeAnswerWithContest(walletAddress, 'duel', results, buildScore(delta, isCorrect ? 1 : 0, isCorrect ? 0 : 1), profile, {
    askingFor,
    variant,
    selectedHash,
    ...(onchain?.transactionHash ? { onchain } : {})
  });
}

export async function answerOddOneOut(walletAddress, payload = {}) {
  const hashes = toUniqueHashes(payload.hashes);
  const selectedHash = normalizeHash(payload.selectedHash);
  const askingFor = normalizeGuess(payload.askingFor) || 'human';

  if (hashes.length !== 5) {
    throw new Error('Odd One Out requires exactly 5 hashes');
  }

  if (!selectedHash || !hashes.includes(selectedHash)) {
    throw new Error('selectedHash must be one of the provided hashes');
  }

  const truthMap = await getTruthByHashes(hashes);
  const targets = hashes.filter((hash) => truthMap.get(hash) === askingFor);

  if (targets.length !== 1) {
    throw new Error('Invalid odd-one-out composition for provided hashes');
  }

  const oddHash = targets[0];
  const isCorrect = selectedHash === oddHash;

  const results = hashes.map((hash) => ({
    hash,
    truth: truthMap.get(hash) || null,
    selected: hash === selectedHash,
    isCorrect: hash === selectedHash ? isCorrect : true
  }));

  const delta = isCorrect ? 5 : 0;
  const profile = await applyModeProgress(walletAddress, {
    delta,
    isCorrectRound: isCorrect
  });

  const onchain = await safeRecordModeAnswerOnchain(walletAddress, {
    primaryHash: selectedHash,
    answer: selectedHash,
    isCorrect,
    profile
  });

  return await buildModeAnswerWithContest(walletAddress, 'oddoneout', results, buildScore(delta, isCorrect ? 1 : 0, isCorrect ? 0 : 1), profile, {
    askingFor,
    oddHash,
    selectedHash,
    ...(onchain?.transactionHash ? { onchain } : {})
  });
}

export async function answerCardFlip(walletAddress, payload = {}) {
  const hash = normalizeHash(payload.hash);
  const guess = normalizeGuess(payload.guess);

  if (!hash) {
    throw new Error('Hash is required');
  }

  if (!guess) {
    throw new Error("Guess must be 'ai' or 'human'");
  }

  const truthMap = await getTruthByHashes([hash]);
  const truth = truthMap.get(hash) || null;
  const isCorrect = truth ? guess === truth : false;
  const profile = await applyModeProgress(walletAddress, {
    delta: isCorrect ? 1 : 0,
    isCorrectRound: isCorrect
  });

  const onchain = await safeRecordModeAnswerOnchain(walletAddress, {
    primaryHash: hash,
    answer: guess,
    isCorrect,
    profile
  });

  return await buildModeAnswerWithContest(walletAddress, 'cardflip', [{ hash, guess, truth, isCorrect }], buildScore(isCorrect ? 1 : 0, isCorrect ? 1 : 0, isCorrect ? 0 : 1), profile, {
    ...(onchain?.transactionHash ? { onchain } : {})
  });
}

export async function answerRapidFire(walletAddress, payload = {}) {
  const hash = normalizeHash(payload.hash);
  const guess = normalizeGuess(payload.guess);
  const combo = Number(payload.combo);

  if (!hash) {
    throw new Error('Hash is required');
  }

  if (!guess) {
    throw new Error("Guess must be 'ai' or 'human'");
  }

  const truthMap = await getTruthByHashes([hash]);
  const truth = truthMap.get(hash) || null;
  const isCorrect = truth ? guess === truth : false;

  const safeCombo = Number.isFinite(combo) ? Math.max(0, Math.trunc(combo)) : 0;
  const delta = isCorrect ? 3 : -1;
  const profile = await applyModeProgress(walletAddress, {
    delta,
    isCorrectRound: isCorrect
  });

  const onchain = await safeRecordModeAnswerOnchain(walletAddress, {
    primaryHash: hash,
    answer: guess,
    isCorrect,
    profile
  });

  return await buildModeAnswerWithContest(walletAddress, 'rapidfire', [{ hash, guess, truth, isCorrect }], buildScore(delta, isCorrect ? 1 : 0, isCorrect ? 0 : 1), profile, {
    comboUsed: safeCombo,
    ...(onchain?.transactionHash ? { onchain } : {})
  });
}
