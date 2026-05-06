/**
 * Tests for answerService pure helpers.
 *
 * answerService imports redis + mongo at module level, so we test its pure
 * logic via the shared utils it now delegates to (extractTransactionHash,
 * toQuestionId, deriveSessionKey in utils/crypto.js).
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  extractTransactionHash,
  toQuestionId,
  deriveSessionKey,
} from "../src/utils/crypto.js";

// ---------------------------------------------------------------------------
// extractTransactionHash
// ---------------------------------------------------------------------------

test("extractTransactionHash returns null for falsy input", () => {
  assert.equal(extractTransactionHash(null), null);
  assert.equal(extractTransactionHash(undefined), null);
  assert.equal(extractTransactionHash("string"), null);
  assert.equal(extractTransactionHash(0), null);
});

test("extractTransactionHash reads result.hash (viem writeContract return)", () => {
  const hash = "0xabc123";
  assert.equal(extractTransactionHash({ hash }), hash);
});

test("extractTransactionHash reads result.transactionHash", () => {
  const hash = "0xdeadbeef";
  assert.equal(extractTransactionHash({ transactionHash: hash }), hash);
});

test("extractTransactionHash reads result.receipt.transactionHash", () => {
  const hash = "0x111222";
  assert.equal(
    extractTransactionHash({ receipt: { transactionHash: hash } }),
    hash
  );
});

test("extractTransactionHash reads result.txHash", () => {
  const hash = "0xfeedcafe";
  assert.equal(extractTransactionHash({ txHash: hash }), hash);
});

test("extractTransactionHash reads result.error.transactionHash (pending tx)", () => {
  const hash = "0xpending";
  assert.equal(
    extractTransactionHash({ error: { transactionHash: hash } }),
    hash
  );
});

test("extractTransactionHash prefers hash over receipt.transactionHash", () => {
  // hash is first in the candidate list
  assert.equal(
    extractTransactionHash({
      hash: "0xfirst",
      receipt: { transactionHash: "0xsecond" },
    }),
    "0xfirst"
  );
});

test("extractTransactionHash returns null when only empty strings present", () => {
  assert.equal(extractTransactionHash({ hash: "", transactionHash: "  " }), null);
});

// ---------------------------------------------------------------------------
// toQuestionId
// ---------------------------------------------------------------------------

test("toQuestionId returns a BigInt for a valid string", () => {
  const id = toQuestionId("QmSomeImageHash");
  assert.equal(typeof id, "bigint");
});

test("toQuestionId is deterministic — same input gives same BigInt", () => {
  const a = toQuestionId("abc");
  const b = toQuestionId("abc");
  assert.equal(a, b);
});

test("toQuestionId returns different values for different inputs", () => {
  assert.notEqual(toQuestionId("image1"), toQuestionId("image2"));
});

test("toQuestionId returns null for empty string", () => {
  assert.equal(toQuestionId(""), null);
});

test("toQuestionId returns null for non-string input", () => {
  assert.equal(toQuestionId(null), null);
  assert.equal(toQuestionId(42), null);
  assert.equal(toQuestionId({}), null);
});

test("toQuestionId returns a positive BigInt (can be used as uint256)", () => {
  const id = toQuestionId("some-image-hash");
  assert.ok(id > 0n);
});

// ---------------------------------------------------------------------------
// deriveSessionKey (utils/crypto version — used by sessionService)
// ---------------------------------------------------------------------------

test("deriveSessionKey returns a 0x-prefixed hex string", () => {
  const key = deriveSessionKey("my-session-id");
  assert.ok(key.startsWith("0x"));
  assert.equal(key.length, 66); // 0x + 64 hex chars = keccak256 output
});

test("deriveSessionKey is deterministic", () => {
  assert.equal(deriveSessionKey("session-abc"), deriveSessionKey("session-abc"));
});

test("deriveSessionKey produces different keys for different session IDs", () => {
  assert.notEqual(deriveSessionKey("s1"), deriveSessionKey("s2"));
});

test("deriveSessionKey throws on empty string", () => {
  assert.throws(() => deriveSessionKey(""), { message: /sessionId is required/ });
});

test("deriveSessionKey throws on null", () => {
  assert.throws(() => deriveSessionKey(null), { message: /sessionId is required/ });
});

// ---------------------------------------------------------------------------
// Cross-function contract: same image hash always produces the same questionId
// (critical: prevents duplicate onchain submissions for the same image)
// ---------------------------------------------------------------------------

test("toQuestionId is stable across calls — duplicate submission guard relies on this", () => {
  const hash = "QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco";
  const first = toQuestionId(hash);
  const second = toQuestionId(hash);
  assert.equal(first, second);
  assert.equal(typeof first, "bigint");
});
