/**
 * Verification against 0G-hosted image label manifest (decentralized source of truth).
 */

import {
  manifestConfigured,
  verifyGuessAgainstManifest,
  invalidateManifestCache
} from "../services/imageLabelManifest.js";
import { normalizeGuess } from "../utils/normalize.js";
import { normalizeHash } from "../utils/normalize.js";
import { sendSuccess, sendValidationError, sendServerError } from "../utils/response.js";

function parseBodyAndQuery(req) {
  const imageHash =
    req.body?.imageHash ??
    req.body?.hash ??
    req.query?.imageHash ??
    req.query?.hash ??
    "";
  const guessRaw = req.body?.guess ?? req.query?.guess ?? "";
  const guess = normalizeGuess(String(guessRaw));
  const hashNorm = normalizeHash(String(imageHash));
  return { imageHash: hashNorm, guess };
}

export async function verifyImageLabelHandler(req, res) {
  try {
    if (!manifestConfigured()) {
      return res.status(503).json({
        success: false,
        code: "manifest_not_configured",
        message: "Server has no IMAGE_LABEL_MANIFEST_STORAGE_ROOT (or LOCAL_PATH)."
      });
    }

    const { imageHash, guess } = parseBodyAndQuery(req);
    if (!imageHash || imageHash.length < 8) {
      return sendValidationError(res, "imageHash required");
    }
    if (!guess) {
      return sendValidationError(res, "guess must be ai or human");
    }

    const result = await verifyGuessAgainstManifest(imageHash, guess);
    return sendSuccess(res, result);
  } catch (e) {
    if (String(e?.message || "").includes("not set")) {
      return res.status(503).json({ success: false, message: e.message });
    }
    return sendServerError(res, e, "manifestVerifyController.verifyImageLabel");
  }
}

const PURGE_SECRET = (process.env.MANIFEST_PURGE_API_KEY || "").trim();

/** Force refetch manifest from 0G on next verification. Requires Authorization: Bearer <MANIFEST_PURGE_API_KEY> when configured. */
export async function purgeManifestCacheHandler(req, res) {
  try {
    if (PURGE_SECRET) {
      const auth = String(req.headers?.authorization || "");
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
      if (token !== PURGE_SECRET) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }
    } else {
      return res.status(403).json({
        success: false,
        code: "purge_disabled",
        message: "Set MANIFEST_PURGE_API_KEY to enable cache purge."
      });
    }
    await invalidateManifestCache();
    return sendSuccess(res, { cleared: true });
  } catch (e) {
    return sendServerError(res, e, "manifestVerifyController.purge");
  }
}
