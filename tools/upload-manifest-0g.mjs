#!/usr/bin/env node
/**
 * Upload the image-label manifest JSON to 0G Storage.
 * Uses @0gfoundation/0g-ts-sdk (current Flow ABI with { data, submitter }).
 * The deprecated @0glabs/0g-ts-sdk causes mainnet flow.submit to revert with require(false).
 *
 * Requires a funded wallet: storage fee + gas (not just “balance > 0”).
 * Reuses backend .env:
 *   ONCHAIN_RPC_URL, ONCHAIN_PRIVATE_KEY (or ZG_STORAGE_PRIVATE_KEY)
 *   ZG_STORAGE_INDEXER_URL — default https://indexer-storage-turbo.0g.ai
 *   ZG_UPLOAD_TASK_SIZE — default 10
 *   ZG_UPLOAD_EXPECTED_REPLICA — default 1
 *
 * Usage: node tools/upload-manifest-0g.mjs [path/to/manifest.json]
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { ethers } from "ethers";
import { Indexer, ZgFile } from "@0gfoundation/0g-ts-sdk";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "..");
loadEnv({ path: path.join(backendRoot, ".env") });

const DEFAULT_INDEXER =
  (process.env.ZG_STORAGE_INDEXER_URL || "").trim() ||
  "https://indexer-storage-turbo.0g.ai";

const RPC = (process.env.ONCHAIN_RPC_URL || "").trim();
let PK = (process.env.ONCHAIN_PRIVATE_KEY || "").trim();
if (!PK) PK = (process.env.ZG_STORAGE_PRIVATE_KEY || "").trim();
if (!PK.startsWith("0x")) PK = `0x${PK}`;

const defaultFile = path.join(backendRoot, "data/guesstheai-image-label-manifest.json");
const filePath = path.resolve(process.argv[2] || defaultFile);

function die(msg, code = 1) {
  console.error(msg);
  process.exit(code);
}

async function main() {
  if (!RPC) die("Set ONCHAIN_RPC_URL in guess_the_ai_backend/.env");
  if (!PK || PK === "0x") die("Set ONCHAIN_PRIVATE_KEY (or ZG_STORAGE_PRIVATE_KEY) in .env");
  if (!fs.existsSync(filePath)) die(`File not found: ${filePath}`);

  const indexerUrl = DEFAULT_INDEXER;
  console.log("File:", filePath);
  console.log("RPC:", RPC);
  console.log("Indexer:", indexerUrl);
  console.log("Signer:", new ethers.Wallet(PK).address);

  const provider = new ethers.JsonRpcProvider(RPC);
  const signer = new ethers.Wallet(PK, provider);
  const bal = await provider.getBalance(signer.address);
  if (bal === 0n) {
    die(`Wallet ${signer.address} has 0 OG — fund it before upload`);
  }
  console.log(`Balance: ${ethers.formatEther(bal)} OG (${bal.toString()} wei)`);
  if (bal < ethers.parseEther("0.001")) {
    console.warn(
      "[warn] Very low OG balance. Upload needs storage fee + gas; errors like insufficient funds during estimateGas are usually fixed by topping up."
    );
  }

  const file = await ZgFile.fromFilePath(filePath);
  try {
    const [tree, merkleErr] = await file.merkleTree();
    if (merkleErr) die(`merkleTree failed: ${merkleErr}`);

    const rootHash = tree.rootHash();
    console.log("\nStorage root (use for IMAGE_LABEL_MANIFEST_STORAGE_ROOT):");
    console.log(rootHash);

    const indexer = new Indexer(indexerUrl);
    console.log("\nUploading…");
    const taskSize = Math.max(Number(process.env.ZG_UPLOAD_TASK_SIZE || 10), 1);
    const expectedReplica = Math.max(Number(process.env.ZG_UPLOAD_EXPECTED_REPLICA || 1), 1);

    const [result, uploadErr] = await indexer.upload(file, RPC, signer, {
      tags: "0x",
      taskSize,
      expectedReplica,
      finalityRequired: String(process.env.ZG_UPLOAD_FINALITY || "true").toLowerCase() !== "false"
    });
    if (uploadErr) {
      const msg = String(uploadErr?.message ?? uploadErr);
      die(
        `${msg}\n\n` +
          "If insufficient funds: add OG (storage fee shown in logs + gas for estimateGas/submit).\n" +
          "If execution reverted on Flow.submit: caused by obsolete @0glabs/0g-ts-sdk; this script uses @0gfoundation/0g-ts-sdk with the correct mainnet ABI."
      );
    }

    console.log("\nDone.", result);
    console.log("\nAppend to .env:");
    console.log(`IMAGE_LABEL_MANIFEST_STORAGE_ROOT=${result?.rootHash || rootHash}`);
  } finally {
    await file.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
