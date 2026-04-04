/**
 * Percentage Service
 *
 * Provides deterministic, hash-seeded percentages for multi-image game modes.
 * Ensures percentages sum to 100% when required and gives an edge to correct answers
 * while introducing enough noise to keep the game challenging.
 */

// Simple deterministic random number generator (LCG)
function createSeededRNG(seedStr) {
  let seed = 0;
  for (let i = 0; i < seedStr.length; i++) {
    seed = (seed << 5) - seed + seedStr.charCodeAt(i);
    seed |= 0; // Convert to 32bit int
  }
  seed = Math.abs(seed);

  return function nextRandom() {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
}

/**
 * Ensures an array of numeric weights perfectly sums to a target (100) using the
 * largest remainder method, while distributing them to perfectly match integer requirements.
 */
function normalizeTo100(weights) {
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  if (totalWeight === 0) return weights.map(() => 0);

  const rawPercentages = weights.map(w => (w / totalWeight) * 100);
  const floors = rawPercentages.map(p => Math.floor(p));
  const remainders = rawPercentages.map((p, i) => ({ val: p - Math.floor(p), idx: i }));
  
  let currentSum = floors.reduce((sum, val) => sum + val, 0);
  let deficit = 100 - currentSum;

  // Sort remainders descending to distribute the deficit
  remainders.sort((a, b) => b.val - a.val);

  for (let i = 0; i < deficit; i++) {
    floors[remainders[i].idx] += 1;
  }

  return floors;
}

/**
 * Generate Odd One Out percentages (sums to 100%).
 * 1 target gets highest score (~35-45%), 4 distractors share the rest.
 * We aggressively spike one distractor so it's not obvious.
 */
export function generateOddOneOutPercentages(hashes, truthMap, oddHash, roundId) {
  const rng = createSeededRNG(roundId + oddHash);
  
  // Base weights
  let weights = hashes.map((hash) => {
    const isTarget = hash === oddHash;
    if (isTarget) {
      // Base weight for target
      return 40 + (rng() * 10 - 5); // 35 to 45
    }
    // Base weight for distractors
    return 15 + (rng() * 10 - 5); // 10 to 20
  });

  // Pick a random distractor to heavily spike so it overlaps with target territory
  const distractorIndices = hashes.map((h, i) => h !== oddHash ? i : -1).filter(i => i !== -1);
  if (distractorIndices.length > 0) {
    const spikeIndex = distractorIndices[Math.floor(rng() * distractorIndices.length)];
    weights[spikeIndex] += 10 + Math.floor(rng() * 8); // Boost distractor by 10-18
  }

  const normalized = normalizeTo100(weights);

  // Map result back to hashes
  const result = {};
  hashes.forEach((hash, i) => {
    result[hash] = normalized[i];
  });
  
  return result;
}

/**
 * Generate Multi-Select percentages (sums to 100%).
 * Targets (askingFor) get higher chunk (~20-25%), distractors get lower (~8-12%).
 */
export function generateMultiSelectPercentages(hashes, truthMap, askingFor, roundId) {
  const rng = createSeededRNG(roundId + (askingFor || ''));
  
  let weights = hashes.map((hash) => {
    const truth = truthMap.get(hash);
    const isTarget = truth === askingFor;
    
    if (isTarget) {
      return 25 + (rng() * 10 - 5); // 20 to 30
    }
    return 10 + (rng() * 10 - 5); // 5 to 15
  });

  // Force one target to be suspiciously low, and one distractor suspiciously high
  const targetIndices = hashes.map((h, i) => truthMap.get(h) === askingFor ? i : -1).filter(i => i !== -1);
  const distractorIndices = hashes.map((h, i) => truthMap.get(h) !== askingFor ? i : -1).filter(i => i !== -1);

  if (targetIndices.length > 0 && distractorIndices.length > 0) {
    const dipTarget = targetIndices[Math.floor(rng() * targetIndices.length)];
    const spikeDistractor = distractorIndices[Math.floor(rng() * distractorIndices.length)];
    
    weights[dipTarget] = Math.max(5, weights[dipTarget] - 8); 
    weights[spikeDistractor] += 8;
  }

  const normalized = normalizeTo100(weights);

  const result = {};
  hashes.forEach((hash, i) => {
    result[hash] = normalized[i];
  });
  
  return result;
}

/**
 * Generate Card Flip percentages.
 * Independent 0-100% confidences per card. Tells user specifically what the confidence represents
 * e.g., "85% Human" or "72% AI".
 */
export function generateCardFlipProbabilities(hashes, truthMap, roundId) {
  const rng = createSeededRNG(roundId || hashes[0]);
  
  const result = {};
  hashes.forEach((hash) => {
    const truth = truthMap.get(hash);
    
    // Always return probability of being AI.
    // If it's AI, confidence is 65-85% AI.
    // If it's Human, confidence is 15-35% AI.
    let baseConfidence = Math.floor(65 + rng() * 21); // 65 to 85
    const isConfused = rng() > 0.8;
    if (isConfused) {
      baseConfidence = Math.floor(40 + rng() * 16); // 40 to 55
    }

    const aiProbability = truth === 'ai' ? baseConfidence : (100 - baseConfidence);

    result[hash] = aiProbability;
  });
  
  return result;
}
