/**
 * Normalization utilities for consistent data handling
 */

/**
 * Normalize any string value (trim whitespace)
 * @param {string} value - String to normalize
 * @returns {string} Normalized string or empty string
 */
export function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Normalize wallet address to lowercase
 * @param {string} wallet - Wallet address
 * @returns {string|null} Normalized wallet or null
 */
export function normalizeWallet(wallet) {
  if (!wallet || typeof wallet !== 'string') return null;
  return wallet.trim().toLowerCase();
}

/**
 * Normalize image hash
 * @param {string} hash - Image hash
 * @returns {string|null} Normalized hash or null
 */
export function normalizeHash(hash) {
  if (!hash || typeof hash !== 'string') return null;
  return hash.trim().toLowerCase();
}

/**
 * Normalize guess to valid values
 * @param {string} guess - User guess ('ai' or 'human')
 * @returns {'ai'|'human'|null} Normalized guess or null
 */
export function normalizeGuess(guess) {
  if (!guess || typeof guess !== 'string') return null;
  const normalized = guess.trim().toLowerCase();
  if (normalized === 'ai' || normalized === 'human') {
    return normalized;
  }
  return null;
}

/**
 * Normalize email address
 * @param {string} email - Email address
 * @returns {string|null} Normalized email or null
 */
export function normalizeEmail(email) {
  if (!email || typeof email !== 'string') return null;
  return email.trim().toLowerCase();
}

/**
 * Normalize username (trim whitespace, limit length)
 * @param {string} username - Username
 * @param {number} maxLength - Maximum allowed length (default 30)
 * @returns {string|null} Normalized username or null
 */
export function normalizeUsername(username, maxLength = 30) {
  if (!username || typeof username !== 'string') return null;
  const trimmed = username.trim();
  if (trimmed.length === 0 || trimmed.length > maxLength) return null;
  return trimmed;
}
