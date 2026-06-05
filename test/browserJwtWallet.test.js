import test from "node:test";
import assert from "node:assert/strict";
import { extractBrowserJwtWallet } from "../src/middleware/jwt.js";

test("extractBrowserJwtWallet supports camelCase walletAddress claims", () => {
  assert.equal(
    extractBrowserJwtWallet({ walletAddress: "0x41AC1fEcb45A8989f547c2822f7E2723eaF5f3d7" }),
    "0x41ac1fecb45a8989f547c2822f7e2723eaf5f3d7",
  );
});

test("extractBrowserJwtWallet supports snake_case wallet_address claims", () => {
  assert.equal(
    extractBrowserJwtWallet({ wallet_address: "0x41AC1fEcb45A8989f547c2822f7E2723eaF5f3d7" }),
    "0x41ac1fecb45a8989f547c2822f7e2723eaf5f3d7",
  );
});

test("extractBrowserJwtWallet returns empty string for missing claims", () => {
  assert.equal(extractBrowserJwtWallet({}), "");
});
