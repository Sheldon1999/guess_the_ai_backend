#!/usr/bin/env node
/**
 * Build a compact JSON manifest from guesstheai.guesstheai_images.json.
 * Upload the output to 0G Storage, then set IMAGE_LABEL_MANIFEST_STORAGE_ROOT in .env to the storage root.
 *
 * Manifest shape (schemaVersion 2): { schemaVersion, name, entryCount, entries: { "0x…": "ai"|"human" } }
 *
 * Usage:
 *   node tools/build-image-manifest.mjs [input.json] [output.json]
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function normalizeImageHash(h) {
  let s = String(h || "").trim().toLowerCase();
  if (!s) return "";
  if (!s.startsWith("0x")) s = `0x${s}`;
  return s;
}

const defaultIn = path.resolve(__dirname, "../../guesstheai.guesstheai_images.json");
const defaultOut = path.resolve(__dirname, "../data/guesstheai-image-label-manifest.json");

const inputPath = path.resolve(process.argv[2] || defaultIn);
const outputPath = path.resolve(process.argv[3] || defaultOut);

if (!fs.existsSync(inputPath)) {
  console.error("Input not found:", inputPath);
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(inputPath, "utf8"));
if (!Array.isArray(raw)) {
  console.error("Expected top-level JSON array");
  process.exit(1);
}

const entries = {};
let skipped = 0;
for (const doc of raw) {
  const hash = normalizeImageHash(doc?.hash);
  const label = String(doc?.label || "").trim().toLowerCase();
  if (!hash || (label !== "ai" && label !== "human")) {
    skipped++;
    continue;
  }
  const prev = entries[hash];
  if (prev && prev !== label) {
    console.warn("Duplicate hash conflicting; keeping first:", hash);
    continue;
  }
  if (!prev) entries[hash] = label;
}

const manifest = {
  schemaVersion: 2,
  name: "Guess The AI",
  entryCount: Object.keys(entries).length,
  entries
};

const body = `${JSON.stringify(manifest)}\n`;
const fileSha256 = crypto.createHash("sha256").update(body, "utf8").digest("hex");

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, body, "utf8");

const stat = fs.statSync(outputPath);
console.log("Wrote:", outputPath);
console.log("Entries:", manifest.entryCount, "Skipped rows:", skipped);
console.log("Bytes:", stat.size);
console.log("manifestFileSha256:", fileSha256);
console.log("\nUpload to 0G Storage, then set IMAGE_LABEL_MANIFEST_STORAGE_ROOT=<storage root>");
console.log("Optional record: IMAGE_LABEL_MANIFEST_SHA256=" + fileSha256);
