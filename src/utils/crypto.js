/**
 * Crypto utilities for hashing and key derivation
 */

import { randomBytes } from 'node:crypto';
import { keccak256, toHex } from 'viem';

/**
 * Convert a value to BigInt question ID using keccak256
 * @param {string} value - Value to hash
 * @returns {BigInt|null} BigInt representation or null
 */
export function toQuestionId(value) {
  if (!value || typeof value !== 'string') return null;
  try {
    const hash = keccak256(toHex(value));
    return BigInt(hash);
  } catch {
    return null;
  }
}

/**
 * Derive session key from session ID
 * @param {string} sessionId - Session ID
 * @returns {string} Derived session key (hex)
 */
export function deriveSessionKey(sessionId) {
  if (!sessionId || typeof sessionId !== 'string') {
    throw new Error('sessionId is required');
  }
  return keccak256(toHex(sessionId));
}

/**
 * Generate a unique session ID
 * @returns {string} Unique session ID
 */
export function generateSessionId() {
  return `session_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
}

/**
 * Generate a random player username
 * @returns {string} Random username
 */
export function generatePlayerUsername() {
  return `Player_${randomBytes(4).toString('hex')}`;
}
