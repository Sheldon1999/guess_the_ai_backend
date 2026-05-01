/**
 * Decentralized verification (manifest hosted on 0G Storage).
 */

import {
  verifyImageLabelHandler,
  purgeManifestCacheHandler
} from "../controllers/manifestVerifyController.js";

export default function verifyRoutes(app) {
  app.get("/api/verify/image-label", verifyImageLabelHandler);
  app.post("/api/verify/image-label", verifyImageLabelHandler);
  app.post("/api/verify/image-label/cache/purge", purgeManifestCacheHandler);
}
