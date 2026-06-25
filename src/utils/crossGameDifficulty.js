export const DIFFICULTY = Object.freeze({
  NONE: 'none',
  EASY: 'easy',
  MEDIUM: 'medium',
  HARD: 'hard',
});

export const CROSS_GAME_THRESHOLDS = Object.freeze({
  guessTheAi: Object.freeze({
    label: 'Guess the AI',
    metric: 'streak',
    thresholds: Object.freeze({ easy: 10, medium: 20, hard: 30 }),
  }),
});

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function classifyAtLeast(value, thresholds) {
  const score = toFiniteNumber(value);
  if (score === null) return DIFFICULTY.NONE;
  if (score >= thresholds.hard) return DIFFICULTY.HARD;
  if (score >= thresholds.medium) return DIFFICULTY.MEDIUM;
  if (score >= thresholds.easy) return DIFFICULTY.EASY;
  return DIFFICULTY.NONE;
}

export function classifyCrossGamePerformance(gameKey, value) {
  const config = CROSS_GAME_THRESHOLDS[gameKey];
  if (!config) {
    throw new Error(`Unknown cross-game key: ${gameKey}`);
  }

  return {
    gameKey,
    game: config.label,
    metric: config.metric,
    value: toFiniteNumber(value) ?? 0,
    difficulty: classifyAtLeast(value, config.thresholds),
    thresholds: config.thresholds,
  };
}
