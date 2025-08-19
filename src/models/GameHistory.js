import mongoose from "mongoose";

const gameHistorySchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  imageId: { type: mongoose.Schema.Types.ObjectId, ref: "Image", required: true },
  guess: { type: String, enum: ["ai", "human"], required: true },
  correct: { type: Boolean, required: true },
  playedAt: { type: Date, default: Date.now },
});

export default mongoose.model("GameHistory", gameHistorySchema, "gamehistory");
