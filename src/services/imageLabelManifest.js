/**
 * Load compact image label manifest from 0G Storage (indexer) using a fixed root in env.
 * Cached in memory so verification requests stay fast.
 */

const ROOT = (process.env.IMAGE_LABEL_MANIFEST_STORAGE_ROOT || "").trim();
const LOCAL_PATH = (process.env.IMAGE_LABEL_MANIFEST_LOCAL_PATH || "").trim();
const INDEXER_BASE = (process.env.OG_IMAGE_BASE_URL || "https://indexer-storage-turbo.0g.ai/file?root=").trim();
const FETCH_TIMEOUT_MS = Math.max(Number(process.env.IMAGE_LABEL_MANIFEST_FETCH_MS || 12000), 3000);
const CACHE_TTL_MS = Math.max(Number(process.env.IMAGE_LABEL_MANIFEST_CACHE_MS || 300000), 60000);

/** @type {{ loadedAt: number, manifest: object, map: Map<string, string> } | null} */
let cache = null;

function buildIndexerUrl(storageRoot) {
  const base = INDEXER_BASE.endsWith("=") ? INDEXER_BASE : `${INDEXER_BASE.replace(/\/?$/, "/")}`;
  if (base.includes("root=")) return `${base}${encodeURIComponent(storageRoot)}`;
  return `${base}${encodeURIComponent(storageRoot)}`;
}

function normalizeHash(h) {
  let s = String(h || "").trim().toLowerCase();
  if (!s) return "";
  if (!s.startsWith("0x")) s = `0x${s}`;
  return s;
}

/** @returns {Map<string, string>} hash -> ai|human */
function buildLookupMap(manifest) {
  const map = new Map();
  const entries = manifest?.entries;
  if (!entries || typeof entries !== "object") return map;
  const v = manifest.schemaVersion;
  for (const [k, raw] of Object.entries(entries)) {
    const key = normalizeHash(k);
    if (!key) continue;
    let label = null;
    if (v >= 2 && typeof raw === "string") {
      label = raw.trim().toLowerCase();
    } else if (raw && typeof raw === "object" && raw.label != null) {
      label = String(raw.label || "").trim().toLowerCase();
    }
    if (label !== "ai" && label !== "human") continue;
    map.set(key, label);
  }
  return map;
}

async function fetchText(url) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" }
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${text?.slice(0, 120)}`);
    }
    return text;
  } finally {
    clearTimeout(t);
  }
}

function parseManifest(jsonText) {
  const manifest = JSON.parse(jsonText);
  if (!manifest || typeof manifest !== "object") throw new Error("invalid manifest");
  if (manifest.schemaVersion !== 2 && manifest.schemaVersion !== 1) {
    throw new Error(`unsupported schemaVersion ${manifest.schemaVersion}`);
  }
  if (!manifest.entries || typeof manifest.entries !== "object") throw new Error("missing entries");
  return manifest;
}

/**
 * Reload manifest from 0G (or local file if configured).
 */
export async function loadImageLabelManifest() {
  let jsonText;

  if (LOCAL_PATH) {
    const fs = await import("node:fs/promises");
    jsonText = await fs.readFile(LOCAL_PATH, "utf8");
  } else {
    if (!ROOT) {
      throw new Error("IMAGE_LABEL_MANIFEST_STORAGE_ROOT or IMAGE_LABEL_MANIFEST_LOCAL_PATH is not set");
    }
    jsonText = await fetchText(buildIndexerUrl(ROOT));
  }

  const manifest = parseManifest(jsonText);
  const map = buildLookupMap(manifest);
  cache = { loadedAt: Date.now(), manifest, map };
  return cache;
}

export function manifestConfigured() {
  return Boolean(ROOT || LOCAL_PATH);
}

async function ensureCache() {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) return cache;
  return await loadImageLabelManifest();
}

/**
 * @returns {Promise<string | null>} ai | human
 */
export async function getTruthFromManifest(imageHash) {
  const norm = normalizeHash(imageHash);
  if (!norm) return null;
  const { map } = await ensureCache();
  return map.get(norm) || null;
}

/**
 * @param {string} imageHash
 * @param {'ai'|'human'} guess
 */
export async function verifyGuessAgainstManifest(imageHash, guess) {
  const truthLabel = await getTruthFromManifest(imageHash);
  if (!truthLabel) {
    return {
      resolved: false,
      reason: "unknown_hash",
      message: "This image hash is not in the published manifest.",
      verifiedAgainstRoot: ROOT || null
    };
  }
  const matched = Boolean(guess && truthLabel === guess);
  return {
    resolved: true,
    correctLabel: truthLabel,
    userGuess: guess,
    userWasCorrect: matched,
    verifiedAgainstRoot: ROOT || null,
    localManifest: LOCAL_PATH ? true : false
  };
}

export async function invalidateManifestCache() {
  cache = null;
}
