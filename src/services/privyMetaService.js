/**
 * Privy Meta Service
 * Handles Privy metadata operations
 * Max 150 lines
 */

import { isPlainObject } from './authHelpers.js';
import {
  normalizeString,
  normalizeEmail as normalizeEmailUtil,
  normalizeWallet as normalizeWalletUtil
} from '../utils/normalize.js';

const normalizeEmail = (value) => normalizeEmailUtil(value) || "";
const normalizeWallet = (value) => normalizeWalletUtil(value) || "";

/**
 * Sanitize a metadata value
 * @param {*} value - Value to sanitize
 * @returns {*} Sanitized value or undefined
 */
export const sanitizeMetaValue = (value) => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (Array.isArray(value)) {
    const cleaned = value
      .map((item) => (typeof item === "string" ? item.trim() : item))
      .filter((item) => item !== "" && item !== undefined && item !== null);
    return cleaned.length ? cleaned : undefined;
  }
  if (value === null || value === undefined) return undefined;
  return value;
};

/**
 * Merge Privy metadata objects
 * @param {Object} base - Base metadata
 * @param {Object} incoming - Incoming metadata
 * @returns {Object} Merged metadata
 */
export const mergePrivyMeta = (base, incoming) => {
  const merged = isPlainObject(base) ? { ...base } : {};
  if (!isPlainObject(incoming)) return merged;

  for (const [key, value] of Object.entries(incoming)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") {
      continue;
    }
    const sanitized = sanitizeMetaValue(value);
    if (sanitized === undefined) continue;
    merged[key] = sanitized;
  }
  return merged;
};

/**
 * Normalize Privy metadata fields
 * @param {Object} meta - Metadata to normalize
 * @returns {Object} Normalized metadata
 */
export const normalizePrivyMeta = (meta) => {
  const normalized = mergePrivyMeta({}, meta);

  const stringFields = ['email', 'address', 'walletAddress', 'embeddedWalletAddress'];
  const walletFields = ['address', 'walletAddress', 'embeddedWalletAddress'];
  const trimFields = ['privyUserId', 'discord', 'discordUserId', 'otherId', 'type'];

  // Normalize email
  if (typeof normalized.email === "string") {
    normalized.email = normalizeEmail(normalized.email);
    if (!normalized.email) delete normalized.email;
  }

  // Normalize wallet fields
  for (const field of walletFields) {
    if (typeof normalized[field] === "string") {
      normalized[field] = normalizeWallet(normalized[field]);
      if (!normalized[field]) delete normalized[field];
    }
  }

  // Normalize string fields
  for (const field of trimFields) {
    if (typeof normalized[field] === "string") {
      normalized[field] = normalizeString(normalized[field]);
      if (field === 'type') normalized[field] = normalized[field].toLowerCase();
      if (!normalized[field]) delete normalized[field];
    }
  }

  // Normalize otherIds array
  if (Array.isArray(normalized.otherIds)) {
    const cleaned = normalized.otherIds
      .map((item) => (typeof item === "string" ? item.trim() : item))
      .filter((item) => item !== "" && item !== undefined && item !== null);
    if (cleaned.length) {
      normalized.otherIds = cleaned;
    } else {
      delete normalized.otherIds;
    }
  }

  return normalized;
};

/**
 * Build MongoDB search filters from Privy metadata
 * @param {Object} meta - Privy metadata
 * @returns {Array} MongoDB filter array
 */
export const buildPrivySearchFilters = (meta) => {
  if (!isPlainObject(meta)) return [];

  const filters = [];
  const fields = [
    'privyUserId', 'email', 'discordUserId', 'discord',
    'otherId', 'address', 'walletAddress', 'embeddedWalletAddress'
  ];

  for (const field of fields) {
    if (meta[field]) {
      filters.push({ [`privyMetaData.${field}`]: meta[field] });
    }
  }

  if (Array.isArray(meta.otherIds)) {
    for (const id of meta.otherIds) {
      if (typeof id === "string" && id) {
        filters.push({ "privyMetaData.otherIds": id });
      }
    }
  }

  return filters;
};

/**
 * Build identifier list from Privy metadata
 * @param {Object} meta - Privy metadata
 * @returns {Array<string>} Identifier list
 */
export const buildPrivyIdentifiers = (meta) => {
  if (!isPlainObject(meta)) return [];

  const identifiers = [];
  const fields = [
    'privyUserId', 'email', 'discordUserId', 'discord',
    'otherId', 'address', 'walletAddress', 'embeddedWalletAddress'
  ];

  for (const field of fields) {
    if (meta[field]) identifiers.push(meta[field]);
  }

  if (Array.isArray(meta.otherIds)) {
    identifiers.push(...meta.otherIds);
  }

  return identifiers
    .filter((value) => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);
};
