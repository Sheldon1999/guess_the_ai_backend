// Mongo-only truth labels for now
import { images } from "./mongo.js";
const norm = (s) => String(s || "").trim().toLowerCase();

export async function getTruthLabel(hash) {
  const doc = await images.findOne({ hash }, { projection: { _id: 0, label: 1 } });
  const v = norm(doc?.label);
  if (v === "ai" || v === "human") return v;
  throw new Error("truth label unavailable in Mongo");
}
