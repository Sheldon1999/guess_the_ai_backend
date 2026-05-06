import test from "node:test";
import assert from "node:assert/strict";
import { buildChallengeMessage } from "../src/services/walletChallengeService.js";

test("buildChallengeMessage includes wallet, nonce and expiry metadata", () => {
  const walletAddress = "0x1234567890abcdef1234567890abcdef12345678";
  const nonce = "abc123";
  const issuedAtIso = "2026-01-01T00:00:00.000Z";
  const expiresAtIso = "2026-01-01T00:05:00.000Z";

  const msg = buildChallengeMessage({ walletAddress, nonce, issuedAtIso, expiresAtIso });

  assert.ok(msg.includes(walletAddress));
  assert.ok(msg.includes(`Nonce: ${nonce}`));
  assert.ok(msg.includes(`IssuedAt: ${issuedAtIso}`));
  assert.ok(msg.includes(`ExpiresAt: ${expiresAtIso}`));
  assert.ok(msg.includes("Prove wallet ownership"));
});

