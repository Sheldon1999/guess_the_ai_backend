import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
  walletAddress: {
    type: String,
    required: true,
    unique: true,
    index: true,
    lowercase: true,
  },
  username: { type: String, required: true },

  // Gameplay stats
  correctAnswers: { type: Number, default: 0 },   // total correct answers
  streak: { type: Number, default: 0 },           // longest streak
  currentStreak: { type: Number, default: 0 },    // ongoing streak

  // Derived values (we still persist them for quick lookup)
  rank: { type: String, default: "E" },           // E, D, C, B, A, S, S+, S++
  dungeonTitle: { type: String, default: "Newbie" }, // Newbie, Warrior, etc.

  // Meta
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

// auto-update `updatedAt`
userSchema.pre("save", function (next) {
  this.updatedAt = new Date();
  next();
});

export default mongoose.model("User", userSchema, "guesstheai");
