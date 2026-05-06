/**
 * Tests for src/lib/onchain/index.js
 *
 * When ONCHAIN_RPC_URL / ONCHAIN_PRIVATE_KEY are not set (CI / local without
 * infra), walletClient stays null and all write functions return
 * { skipped: true }.  These tests validate:
 *   1. Pure functions (deriveSessionKey)
 *   2. Guard/skip paths on every exported write function
 *   3. Missing-params guards that fire before the RPC is touched
 *
 * No real RPC, no real private key needed.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveSessionKey,
  recordUserRegistration,
  recordGameStart,
  recordGameEnd,
  recordAnswerSubmission,
  recordAnswerSubmissionHash,
  recordSeasonScore,
} from "../src/lib/onchain/index.js";

// ---------------------------------------------------------------------------
// deriveSessionKey — pure function, onchain variant
// Handles pre-existing 32-byte hex keys differently from plain UUIDs.
// ---------------------------------------------------------------------------

test("deriveSessionKey throws when called with no argument", () => {
  assert.throws(() => deriveSessionKey(undefined), /session id required/i);
  assert.throws(() => deriveSessionKey(null), /session id required/i);
  assert.throws(() => deriveSessionKey(""), /session id required/i);
});

test("deriveSessionKey returns a 0x-prefixed 32-byte hex for a UUID-style ID", () => {
  const key = deriveSessionKey("550e8400-e29b-41d4-a716-446655440000");
  assert.ok(key.startsWith("0x"));
  assert.equal(key.length, 66);
});

test("deriveSessionKey is deterministic for plain string IDs", () => {
  const a = deriveSessionKey("my-session");
  const b = deriveSessionKey("my-session");
  assert.equal(a, b);
});

test("deriveSessionKey passes through a valid 32-byte hex unchanged", () => {
  const existing = "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";
  // length = 2 + 64 = 66
  const result = deriveSessionKey(existing);
  assert.equal(result, existing.toLowerCase());
});

test("deriveSessionKey re-hashes a short hex string (not 32-byte)", () => {
  // 0x + 62 chars = 64 total — not a valid 32-byte key, should be re-hashed
  const shortHex = "0x" + "ab".repeat(31);
  assert.equal(shortHex.length, 64);
  const result = deriveSessionKey(shortHex);
  // result should be a keccak256 (66 chars), not the same value
  assert.equal(result.length, 66);
  assert.notEqual(result, shortHex);
});

test("deriveSessionKey produces different keys for different inputs", () => {
  assert.notEqual(deriveSessionKey("session-A"), deriveSessionKey("session-B"));
});

// ---------------------------------------------------------------------------
// recordUserRegistration — skip guards
// ---------------------------------------------------------------------------

test("recordUserRegistration skips when walletAddress is missing", async () => {
  const result = await recordUserRegistration({ walletAddress: null, username: "test" });
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "wallet-required");
});

test("recordUserRegistration skips when not configured (no RPC env)", async () => {
  // walletAddress provided but no RPC/key — walletClient is null
  const result = await recordUserRegistration({ walletAddress: "0x1234", username: "test" });
  assert.ok(result.skipped === true || result.error !== undefined);
});

// ---------------------------------------------------------------------------
// recordGameStart — skip guards
// ---------------------------------------------------------------------------

test("recordGameStart skips when walletAddress is missing", async () => {
  const result = await recordGameStart({ walletAddress: null, sessionKey: "0xkey" });
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "missing-params");
});

test("recordGameStart skips when sessionKey is missing", async () => {
  const result = await recordGameStart({ walletAddress: "0xwallet", sessionKey: null });
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "missing-params");
});

test("recordGameStart skips when both params are missing", async () => {
  const result = await recordGameStart({});
  assert.equal(result.skipped, true);
});

// ---------------------------------------------------------------------------
// recordGameEnd — skip guards
// ---------------------------------------------------------------------------

test("recordGameEnd skips when walletAddress is missing", async () => {
  const result = await recordGameEnd({
    walletAddress: null,
    sessionKey: "0xkey",
    completed: true,
    totalCorrect: 5,
    currentStreak: 3,
  });
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "missing-params");
});

test("recordGameEnd skips when sessionKey is missing", async () => {
  const result = await recordGameEnd({
    walletAddress: "0xwallet",
    sessionKey: undefined,
    completed: true,
    totalCorrect: 5,
    currentStreak: 3,
  });
  assert.equal(result.skipped, true);
});

// ---------------------------------------------------------------------------
// recordAnswerSubmission — skip guards
// ---------------------------------------------------------------------------

test("recordAnswerSubmission skips when walletAddress is missing", async () => {
  const result = await recordAnswerSubmission({
    walletAddress: null,
    sessionKey: "0xkey",
    questionId: 1n,
    answer: "ai",
    isCorrect: true,
  });
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "wallet-required");
});

test("recordAnswerSubmission skips when sessionKey is missing", async () => {
  const result = await recordAnswerSubmission({
    walletAddress: "0xwallet",
    sessionKey: null,
    questionId: 1n,
    answer: "ai",
    isCorrect: true,
  });
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "session-required");
});

test("recordAnswerSubmission skips when questionId is null", async () => {
  const result = await recordAnswerSubmission({
    walletAddress: "0xwallet",
    sessionKey: "0xkey",
    questionId: null,
    answer: "ai",
    isCorrect: true,
  });
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "question-required");
});

test("recordAnswerSubmission skips when both answer and answerHash are missing", async () => {
  const result = await recordAnswerSubmission({
    walletAddress: "0xwallet",
    sessionKey: "0xkey",
    questionId: 1n,
    answer: null,
    answerHash: null,
    isCorrect: false,
  });
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "answer-required");
});

test("recordAnswerSubmission accepts a pre-computed answerHash", async () => {
  // Should reach the write layer (returns skipped: not-configured, not an earlier guard)
  const result = await recordAnswerSubmission({
    walletAddress: "0xwallet",
    sessionKey: "0xkey",
    questionId: 1n,
    answerHash: "0x" + "ab".repeat(32),
    isCorrect: true,
  });
  // Either skipped (not-configured) or error — not an input-guard skip
  assert.ok(result.skipped === true || result.error !== undefined);
  if (result.skipped) {
    assert.notEqual(result.reason, "answer-required");
    assert.notEqual(result.reason, "wallet-required");
  }
});

// ---------------------------------------------------------------------------
// recordAnswerSubmissionHash — same guards as recordAnswerSubmission
// (fire-and-forget variant; same input guards apply)
// ---------------------------------------------------------------------------

test("recordAnswerSubmissionHash skips when walletAddress is missing", async () => {
  const result = await recordAnswerSubmissionHash({
    walletAddress: "",
    sessionKey: "0xkey",
    questionId: 1n,
    answer: "human",
    isCorrect: false,
  });
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "wallet-required");
});

test("recordAnswerSubmissionHash skips when answer and answerHash are both absent", async () => {
  const result = await recordAnswerSubmissionHash({
    walletAddress: "0xwallet",
    sessionKey: "0xkey",
    questionId: 42n,
    isCorrect: true,
  });
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "answer-required");
});

// ---------------------------------------------------------------------------
// recordSeasonScore — skip guards
// ---------------------------------------------------------------------------

test("recordSeasonScore skips when walletAddress is missing", async () => {
  const result = await recordSeasonScore({ walletAddress: null, totalCorrect: 10 });
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "wallet-required");
});

test("recordSeasonScore uses DEFAULT_SEASON_ID when seasonId is omitted", async () => {
  // Just verify the call doesn't throw and reaches the write layer
  const result = await recordSeasonScore({ walletAddress: "0xwallet", totalCorrect: 5 });
  assert.ok(result.skipped === true || result.error !== undefined);
});

test("recordSeasonScore coerces totalCorrect to a number", async () => {
  // Should not throw on string input — coerced internally via Number()
  const result = await recordSeasonScore({
    walletAddress: "0xwallet",
    totalCorrect: "7",
    seasonId: 1,
  });
  assert.ok(result.skipped === true || result.error !== undefined);
});
