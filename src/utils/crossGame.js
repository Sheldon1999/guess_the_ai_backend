import { classifyCrossGamePerformance } from './crossGameDifficulty.js';

export function withGuessTheAiCrossGame(profile) {
  if (!profile) return profile;
  return {
    ...profile,
    crossGame: classifyCrossGamePerformance('guessTheAi', profile.streak || 0),
  };
}
