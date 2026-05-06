import test from "node:test";
import assert from "node:assert/strict";
import { evaluateAbuseCounts } from "../src/middleware/gameAbuseGuard.js";

test("evaluateAbuseCounts allows normal traffic", () => {
  const verdict = evaluateAbuseCounts({
    walletCount: 5,
    ipCount: 10,
    fpCount: 1,
  });
  assert.equal(verdict.blocked, false);
});

test("evaluateAbuseCounts rate-limits high velocity", () => {
  const verdict = evaluateAbuseCounts({
    walletCount: 9999,
    ipCount: 10,
    fpCount: 1,
  });
  assert.equal(verdict.blocked, true);
  assert.equal(verdict.code, "RATE_LIMITED");
});

test("evaluateAbuseCounts blocks repeated payload anomaly", () => {
  const verdict = evaluateAbuseCounts({
    walletCount: 5,
    ipCount: 10,
    fpCount: 9999,
  });
  assert.equal(verdict.blocked, true);
  assert.equal(verdict.code, "ABUSE_DETECTED");
});

