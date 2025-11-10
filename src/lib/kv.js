// Mongo-only truth labels for now
import { fetchImageMeta } from "./docCache.js";
const norm = (s) => String(s || "").trim().toLowerCase();

export async function getTruthLabel(hash) {
  const doc = await fetchImageMeta(hash);
  const v = norm(doc?.label);
  if (v === "ai" || v === "human") return v;
  throw new Error("truth label unavailable in Mongo");
}
