// src/routes/game
import redis from "../lib/redis.js";
import { protect } from '../middleware/jwt.js';
import { fetchUserProfile } from "../lib/docCache.js";
import { handleBackupAnswer, handleMongoAnswer, handleRedisAnswer } from "../service/answer.js";
import { pick10RandomHashes, pickBackupImage } from "../service/game.js";
import { gateWallets, users } from "../lib/mongo.js";
import { getGateUserRedis, updateGateUserScoreRedis } from "../services/gate.js";

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
        const buildProfileResponse = (profile) => ({
          username: profile?.username,
          correctAnswers: profile?.correctAnswers,
          currentStreak: profile?.currentStreak,
          streak: profile?.streak,
          rank: profile?.rank,
          dungeonTitle: profile?.dungeonTitle,
        });

        let profileResponse = buildProfileResponse(profileResp);
        let gateStats = null;

        const cachedGateUser = await getGateUserRedis(walletAddress);
        console.log("cachedGateUser:", cachedGateUser);
        if (cachedGateUser) {
          await updateGateUserScoreRedis(walletAddress, correctResp);
          profileResp = await getGateUserRedis(walletAddress);
          profileResponse.campaign = buildProfileResponse(profileResp);
          gateStats = profileResp;
        }


        return res.json({
          correct: correctResp,
          isCorrect: correctResp,
          truth: truthResp,
          imageId: imageIdResp,
          hash,
          profile: profileResponse,
          gateStats,
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
          { projection: { _id: 0, hasAwarded: 1, "privyMetaData.type": 1 } }
        );

        const hasGateLoginType = gateWallet?.privyMetaData?.type === "gate_wallet";
        const isGateUserEligible = Boolean(gateWallet)
          && !gateWallet?.hasAwarded
          && hasGateLoginType;

        return res.status(200).json({ success: true, isGateUserEligible });
      } catch (err) {
        console.error("[API] url: /api/game/hasGateUserAwarded; error: ", err);
        return res.status(500).json({ error: "internal server error" });
      }
    }
  );

  app.get('/api/game/check-gate-user-eligibility', async (req, res) => {

    try {
      const walletAddress = String(req.query?.address || "").trim();
      if (!walletAddress) {
        return res.status(404).json({ error: "address required", isEligible: false });
      }

      const gateUser = await getGateUserRedis(walletAddress);
      console.log("gateUser:", gateUser);
      if(!gateUser) {
        return res.status(200).json({ message:"user not found", isEligible: false });
      }

      const maxStreak = gateUser?.streak || 0;
      let isEligible = false;
      if (maxStreak >= 5 && gateUser?.currentStreak >=5 ) {
        isEligible = true;
      }
      return res.status(200).json({ message: "successful", isEligible: isEligible });
    } catch (err) {
      console.error("[API] url: /api/game/check-gate-user-eligiblity; error: ", err);
      return res.status(500).json({ error: "internal server error", isEligible: false });  
    }
  })

  app.put(
    "/api/game/awardGateUser",
    protect,
    async (req, res) => {
      const walletAddress = req.user.walletAddress;
      try {

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
  );

  app.get(
    "/api/galaxy/check-galaxy-reward-eligibility",
    async (req, res) => {
      try {
        const addressParam = String(req.query?.address || "").trim();
        const normalizedAddress = addressParam.toLowerCase();
        if (!normalizedAddress) {
          return res.status(200).json({
            message: "address required",
            code: 200,
            data: { is_eligible: false },
          });
        }

        const matchedUser = await users.findOne(
          {
            $expr: {
              $in: [
                normalizedAddress,
                {
                  $map: {
                    input: { $objectToArray: { $ifNull: ["$privyMetaData", {}] } },
                    as: "item",
                    in: { $toLower: "$$item.v" },
                  },
                },
              ],
            },
          },
          { projection: { _id: 1, walletAddress: 1 } }
        );

        const walletAddress = matchedUser?.walletAddress || normalizedAddress;
        console.log("check walletAddress to get cached Gated Users", walletAddress);
        const cachedGateUser = walletAddress ? await getGateUserRedis(walletAddress) : null;

        console.log("cachedGateUser:", cachedGateUser);

        if (cachedGateUser) {
          const maxStreak = cachedGateUser?.streak || 0;
          let isEligible = false;
          if (maxStreak >= 5) {
            isEligible = true;
          }
          return res.status(200).json({
            message: "successful",
            code: 200,
            data: { is_eligible: isEligible },
          });
        }

        return res.status(200).json({
          message: "failed, user does not exist",
          code: 200,
          data: { is_eligible: false },
        });
      } catch (err) {
        console.error("[API] url: /api/galaxy/check-user-registered; error: ", err);
        return res.status(204).json({
          message: "internal error",
          code: 204,
          data: { is_eligible: false },
        });
      }
    }
  );

  app.get(
    "/api/game/isGalaxyUserEligible",
    protect,
    async (req, res) => {
      const walletAddress = req.user.walletAddress;
      try {
        // const isFestRunning = process.env.GALAXY_FESTIVAL;
        // if (!isFestRunning) {
        //   return res.status(200).json({ success: true, isGalaxyUserEligible: false });
        // }
        const existingUser = await users.findOne(
          { walletAddress },
          { projection: { _id: 1 } }
        );
        console.log("existingUser:", existingUser);

        if (!existingUser) {
          return res.status(200).json({ success: true, isGalaxyUserEligible: false });
        }

        console.log("check walletAddress to get cached Gated Users", walletAddress);
        const cachedGateUser = await getGateUserRedis(walletAddress);
        console.log("cachedGateUser:", cachedGateUser);
        if (!cachedGateUser) {
          return res.status(200).json({ success: true, isGalaxyUserEligible: false });
        }

        console.log("my cached Gate User; ", cachedGateUser);
        if (cachedGateUser.streak == 5 && cachedGateUser.currentStreak == 5) {
          return res.status(200).json({ success: true, isGalaxyUserEligible: true });
        }

        return res.status(200).json({ success: true, isGalaxyUserEligible: false });
      } catch (err) {
        console.error("[API] url: /api/game/isGalaxyUserEligible; error: ", err);
        return res.status(500).json({ error: "internal server error" });
      }
    }
  );
}
