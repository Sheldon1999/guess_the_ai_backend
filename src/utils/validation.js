/**
 * Validation utilities for request validation
 */

import { isAddress } from 'viem';

/**
 * Validate wallet address (EVM)
 * @param {string} wallet - Wallet address to validate
 * @returns {boolean} True if valid
 */
export function isValidWallet(wallet) {
  if (!wallet || typeof wallet !== 'string') return false;
  return isAddress(wallet);
}

/**
 * Validate hash string (non-empty)
 * @param {string} hash - Hash to validate
 * @returns {boolean} True if valid
 */
export function isValidHash(hash) {
  return typeof hash === 'string' && hash.trim().length > 0;
}

/**
 * Validate guess value
 * @param {string} guess - Guess to validate
 * @returns {boolean} True if valid ('ai' or 'human')
 */
export function isValidGuess(guess) {
  if (!guess || typeof guess !== 'string') return false;
  const normalized = guess.trim().toLowerCase();
  return normalized === 'ai' || normalized === 'human';
}

/**
 * Validate username
 * @param {string} username - Username to validate
 * @param {number} maxLength - Maximum allowed length
 * @returns {{valid: boolean, error?: string}} Validation result
 */
export function validateUsername(username, maxLength = 30) {
  if (!username || typeof username !== 'string') {
    return { valid: false, error: 'Username is required' };
  }
  const trimmed = username.trim();
  if (trimmed.length === 0) {
    return { valid: false, error: 'Username cannot be empty' };
  }
  if (trimmed.length > maxLength) {
    return { valid: false, error: `Username cannot exceed ${maxLength} characters` };
  }
  return { valid: true };
}

/**
 * Validate email format
 * @param {string} email - Email to validate
 * @returns {boolean} True if valid email format
 */
export function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email.trim());
}

/**
 * Validate pagination parameters
 * @param {number|string} limit - Limit value
 * @param {number|string} offset - Offset value
 * @param {number} maxLimit - Maximum allowed limit
 * @returns {{limit: number, offset: number}} Validated pagination
 */
export function validatePagination(limit, offset, maxLimit = 200) {
  const parsedLimit = Math.min(Math.max(1, Number(limit) || 50), maxLimit);
  const parsedOffset = Math.max(0, Number(offset) || 0);
  return { limit: parsedLimit, offset: parsedOffset };
}

/**
 * Validate required fields in an object
 * @param {Object} obj - Object to validate
 * @param {string[]} requiredFields - Array of required field names
 * @returns {{valid: boolean, missing?: string[]}} Validation result
 */
export function validateRequired(obj, requiredFields) {
  if (!obj || typeof obj !== 'object') {
    return { valid: false, missing: requiredFields };
  }
  const missing = requiredFields.filter(field => {
    const value = obj[field];
    return value === undefined || value === null || value === '';
  });
  return { valid: missing.length === 0, missing };
}
