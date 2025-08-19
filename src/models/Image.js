import mongoose from "mongoose";

const imageSchema = new mongoose.Schema({
  hash: {
    type: String,
    required: true,
    unique: true,
    index: true,
    lowercase: true,
  },
  uploadedAt: { type: Date, required: true, default: Date.now },

  // When image becomes eligible again
  expiresAt: { type: Date },

  // AI or human label (until 0g KV is working, stored in Mongo)
  label: { type: String, enum: ["ai", "human"], required: false },

  // Optionally track which users have seen it
  shownTo: [{ type: String, ref: "User" }],
});

export default mongoose.model("Image", imageSchema, "images");
