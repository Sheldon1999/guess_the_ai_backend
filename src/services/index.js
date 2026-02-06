/**
 * Services Index
 * Centralized service exports
 *
 * All business logic is organized here following:
 * - SOLID principles
 * - Single Responsibility
 * - Max 150 lines per function
 * - Max 3 parameters per function
 */

// Core services
export * as userService from './userService.js';
export * as gameService from './gameService.js';
export * as answerService from './answerService.js';
export * as sessionService from './sessionService.js';
export * as leaderboardService from './leaderboardService.js';
export * as eligibilityService from './eligibilityService.js';

// Handler services (lower-level)
export * as answerHandler from './answerHandler.js';
export * as imageSelector from './imageSelector.js';

// External integration services
export * as gateService from './gate.js';
export * as authService from './auth.js';
