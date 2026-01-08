// src/routes/game
import redis from "../lib/redis.js";
import { protect } from '../middleware/jwt.js';
import { fetchUserProfile } from "../lib/docCache.js";
import { handleBackupAnswer, handleMongoAnswer, handleRedisAnswer } from "../service/answer.js";
import { pick10RandomHashes, pickBackupImage } from "../service/game.js";
import { gateWallets } from "../lib/mongo.js";

function normalizeGuess(g) {
    const v = String(g || "")
        .trim()
        .toLowerCase();
    return v === "ai" || v === "human" ? v : null;
}

export default function gameRoutes(app) {
  app.post(
    "/api/game/next",
    protect,
    async (req, res) => {
      try {
        const wallet = req.user.walletAddress;

        // putting player data to redis for fast ans
        await fetchUserProfile(wallet);

        let result = await pickBackupImage(wallet);

        if (result.status === 200) return res.json(result.body);
        if (result.status === 204) return res.status(204).send();
      } catch (error) {
        console.error("game/next error:", error);
        return res.status(500).json({ error: "internal server error" });
      }
    }
  );

  app.get(
    "/api/game/next10",
    protect,
    async (req, res) => {
      try {
        const wallet = req.user.walletAddress;
        // putting player data to redis for fast ans
        await fetchUserProfile(wallet);

        let result = await pick10RandomHashes(wallet);

        if (result.status === 200) return res.json(result.body);
        if (result.status === 204) return res.status(204).send();
      } catch (err) {
        console.error("[API] url: /api/game/next10; error: ", err);
        return res.status(500).json({ error: "internal server error" });
      }
    }
  );

  app.post(
    "/api/game/ans",
    protect,
    async (req, res) => {
      try {
        const walletAddress = req.user.walletAddress;
        const hash = String(req.body?.hash || "").trim();
        const guess = normalizeGuess(req.body?.guess);

        if (!hash) return res.status(400).json({ error: "hash required" });
        if (!guess) {
          return res.status(400).json({ error: "guess must be 'ai' or 'human'" });
        }

        let profileResp = null; 
        let imageIdResp = null;
        let truthResp = null;
        let correctResp = null;

        let redisRunning = true;
        redis.on("error", () => { redisRunning = false });
        let answerResult;
        if (redisRunning) {
          const isBackup = req.body.isBackup || false;
          if (isBackup) {
            answerResult = await handleBackupAnswer(walletAddress, hash, guess);
          }
          else {
            answerResult = await handleRedisAnswer(walletAddress, hash, guess);
          }
        } else {
          answerResult = await handleMongoAnswer(walletAddress, hash, guess);
        }
        if (!answerResult) {
          return res.status(500).json({ error: "unable to process answer" });
        }
        profileResp = answerResult.profile;
        imageIdResp = answerResult.imageId ?? hash;
        truthResp = answerResult.truth;
        correctResp = typeof answerResult.correct === "boolean"
          ? answerResult.correct
          : (truthResp ? guess === truthResp : null);

        // console.log(profileResp);
        const profileResponse = {
          username: profileResp?.username,
          correctAnswers: profileResp?.correctAnswers,
          currentStreak: profileResp?.currentStreak,
          streak: profileResp?.streak,
          rank: profileResp?.rank,
          dungeonTitle: profileResp?.dungeonTitle,
        };

        return res.json({
          correct: correctResp,
          isCorrect: correctResp,
          truth: truthResp,
          imageId: imageIdResp,
          hash,
          profile: profileResponse,
        });
      } catch (err) {
        console.error("[API] url: /api/game/ans; error: ", err);
        return res.status(500).json({ error: "internal server error" });
      }
    }
  );

  app.get(
    "/api/game/isGateUserEligible",
    protect,
    async (req, res) => {
      const walletAddress = req.user.walletAddress;
      try {
        const gateWallet = await gateWallets.findOne(
          { walletAddress },
          { projection: { _id: 0, hasAwarded: 1 } }
        );

        const isGateUserEligible = !Boolean(gateWallet?.hasAwarded);

        return res.status(200).json({ success: true, isGateUserEligible });
      } catch (err) {
        console.error("[API] url: /api/game/hasGateUserAwarded; error: ", err);
        return res.status(500).json({ error: "internal server error" });
      }
    }
  );

  app.put(
    "/api/game/awardGateUser",
    protect,
    async (req, res) => {
      const walletAddress = req.user.walletAddress;
      try{
        await gateWallets.updateOne(
          { walletAddress },
          { $set: { hasAwarded: true } }
        );

        res.status(200).json({ success: true });
      } catch (err) {
        console.error("[API] url: /api/game/awardGateWallet; error: ", err);
        res.status(500).json({ error: "internal server error" });
      }
    }
  )
}
