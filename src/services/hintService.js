/**
 * Hint Service
 *
 * Generates 1-2 line gameplay hints per round using Cloudflare Workers AI,
 * then stores them in Redis for polling by the frontend.
 * Also fires a blind ping to 0G inference to keep their usage metrics alive.
 *
 * Exports:
 *   fireHintGeneration(roundId, hashes, mode)  – fire-and-forget
 *   getHintForRound(roundId)                   – read for polling endpoint
 */

import redis from '../lib/redis.js';
import { images } from '../lib/mongo.js';
import { hintRoundKey, HINT_ROUND_TTL_SEC } from '../lib/redisKeys.js';
import { chatCompletion, isConfigured } from '../lib/cfInference.js';
import { fireBlindPing } from '../lib/zgInference.js';
import { normalizeHash } from '../utils/normalize.js';

const MODE_LABELS = {
  classic: 'Classic (single image — is it AI or human?)',
  multiselect: 'Multi-Select (multiple images — select all AI-generated ones)',
  duel: 'Duel (two images side-by-side — pick the AI one)',
  oddoneout: 'Odd One Out (five images — one is different, find it)',
  cardflip: 'Card Flip (deck of cards — guess each one)',
  rapidfire: 'Rapid Fire (quick-fire guessing)',
};

const SYSTEM_PROMPT =
  'You write cryptic 1-2 line gameplay hints for "Guess the AI" — a game ' +
  'where players identify whether images are AI-generated or photographed ' +
  'by a human. NEVER reveal the answer or say whether any image is AI or ' +
  'human. Focus on subtle visual cues the player should inspect. ' +
  'Keep the hint under 25 words total. Return ONLY the hint text, nothing else.';

/**
 * Build user prompt from image descriptions and game mode.
 */
function buildUserPrompt(descriptions, mode) {
  const modeLabel = MODE_LABELS[mode] || mode;
  const lines = [`Game mode: ${modeLabel}`, `Images in this round: ${descriptions.length}`, ''];

  descriptions.forEach((desc, idx) => {
    const label = `Image ${idx + 1}`;
    const text = desc.baseDescription || desc.hintSourceText || '(no description available)';
    // Truncate very long descriptions to keep prompt size reasonable
    const truncated = text.length > 600 ? text.slice(0, 600) + '…' : text;
    lines.push(`${label} description: "${truncated}"`);
  });

  lines.push('', 'Write one short hint for this round.');
  return lines.join('\n');
}

/**
 * Fetch baseDescription + label for a list of hashes from MongoDB.
 * Returns an array of { hash, label, baseDescription }.
 */
async function fetchDescriptions(hashes) {
  const normalized = hashes.map((h) => normalizeHash(h)).filter(Boolean);
  if (!normalized.length) return [];

  const cursor = images.find(
    { hash: { $in: normalized } },
    {
      projection: {
        hash: 1,
        label: 1,
        baseDescription: 1,
        hintSourceText: 1,
      },
    }
  );

  const results = [];
  for await (const doc of cursor) {
    results.push({
      hash: doc.hash,
      label: doc.label || '',
      baseDescription: doc.baseDescription || '',
      hintSourceText: doc.hintSourceText || '',
    });
  }

  return results;
}

/**
 * Generate a hint for a round and store it in Redis.
 * This function is designed to be called fire-and-forget (no await at call site).
 *
 * @param {string} roundId - Unique round identifier
 * @param {string[]} hashes - Image hashes in this round
 * @param {string} mode - Game mode (classic, duel, etc.)
 */
export async function fireHintGeneration(roundId, hashes, mode) {
  if (!isConfigured()) {
    console.warn('[hintService] Cloudflare AI not configured, skipping hint generation');
    return;
  }

  try {
    // 1. Fetch descriptions from MongoDB
    const descriptions = await fetchDescriptions(hashes);

    if (!descriptions.length) {
      console.warn(`[hintService] no descriptions found for round ${roundId}`);
      return;
    }

    // Check if at least one image has a description
    const hasAnyDescription = descriptions.some(
      (d) => d.baseDescription || d.hintSourceText
    );

    if (!hasAnyDescription) {
      console.warn(`[hintService] no baseDescription/hintSourceText for round ${roundId}`);
      return;
    }

    // 2. Build prompt and call Cloudflare AI
    const userPrompt = buildUserPrompt(descriptions, mode);

    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ];

    // Blind ping 0G — fire-and-forget, result discarded
    fireBlindPing(messages);

    const hint = await chatCompletion(
      messages,
      { temperature: 0.5, maxTokens: 80, timeoutMs: 30_000 }
    );

    if (!hint) {
      console.warn(`[hintService] Cloudflare returned empty hint for round ${roundId}`);
      return;
    }

    // 3. Store in Redis with TTL
    const key = hintRoundKey(roundId);
    await redis.set(key, hint, 'EX', HINT_ROUND_TTL_SEC);

    console.log(`[hintService] hint ready for round ${roundId}: "${hint.slice(0, 60)}..."`);
  } catch (err) {
    // Fire-and-forget: log but don't throw
    console.error(`[hintService] hint generation failed for round ${roundId}:`, err.message);
  }
}

/**
 * Read hint for a round (called by the polling endpoint).
 *
 * @param {string} roundId
 * @returns {Promise<{ ready: boolean, hint?: string }>}
 */
export async function getHintForRound(roundId) {
  if (!roundId) {
    return { ready: false };
  }

  const key = hintRoundKey(roundId);
  const hint = await redis.get(key);

  if (hint) {
    return { ready: true, hint };
  }

  return { ready: false };
}

// ---------------------------------------------------------------------------
// Per-image hint generation (Classic mode)
// ---------------------------------------------------------------------------

/**
 * Generate a hint for a single image and store it in Redis.
 * Designed to be fire-and-forget.
 *
 * @param {{ hash: string, baseDescription: string, hintSourceText: string }} desc
 */
async function generateSingleImageHint(desc) {
  const text = desc.baseDescription || desc.hintSourceText || '';
  if (!text) return;

  const truncated = text.length > 600 ? text.slice(0, 600) + '…' : text;

  try {
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content:
          `Game mode: Classic (single image — is it AI or human?)\n` +
          `Image description: "${truncated}"\n\n` +
          `Write one short hint for this image.`,
      },
    ];

    // Blind ping 0G — fire-and-forget, result discarded
    fireBlindPing(messages);

    const hint = await chatCompletion(
      messages,
      { temperature: 0.5, maxTokens: 80, timeoutMs: 30_000 }
    );

    if (hint) {
      const key = hintRoundKey(desc.hash);
      await redis.set(key, hint, 'EX', HINT_ROUND_TTL_SEC);
      console.log(`[hintService] hint ready for ${desc.hash.slice(0, 16)}…: "${hint.slice(0, 50)}…"`);
    }
  } catch (err) {
    console.warn(`[hintService] hint failed for ${desc.hash.slice(0, 16)}…: ${err.message}`);
  }
}

/**
 * Fire independent hint generation for each image in a batch (classic mode).
 * Each image gets its own background 0G call — whichever finishes first
 * writes to Redis immediately, so hints arrive progressively.
 * Fire-and-forget — call without await.
 *
 * @param {string[]} hashes - Image hashes in this batch
 */
export async function fireHintGenerationBatch(hashes) {
  if (!isConfigured()) return;
  if (!hashes?.length) return;

  try {
    const descriptions = await fetchDescriptions(hashes);
    if (!descriptions.length) return;

    // Fire each one independently — do NOT await them together
    for (const desc of descriptions) {
      if (desc.baseDescription || desc.hintSourceText) {
        generateSingleImageHint(desc).catch(() => {});
      }
    }

    console.log(`[hintService] fired ${descriptions.length} independent hint tasks`);
  } catch (err) {
    console.error('[hintService] batch hint dispatch failed:', err.message);
  }
}

