// src/routes/user
import { users, dailyLogins, gateWallets } from "../lib/mongo.js";
import { decodeBrowserJwtOptional, generateAuthToken, protect } from "../middleware/jwt.js";
import { recordUserRegistration } from "../lib/onchain/index.js";
import {
  writeUserToRedis,
  fetchUserProfile,
  readUserFromRedis
} from "../lib/docCache.js";
import { putWalletAdd } from "../middleware/login.js";
import { loginV2 } from "../services/auth.js";

export default function userRoutes(app) {

  // V2 LOGIN (Privy-aware)
  app.post("/api/v2/login", decodeBrowserJwtOptional, async (req, res) => {
    try {
      const data = await loginV2(req.body, { walletFromJwt: req.walletFromJwt });
      return res.json({ success: true, data });
    } catch (e) {
      const statusCode = Number(e?.statusCode) || 500;
      if (statusCode >= 500) {
        console.error("v2/login error:", e);
      }
      const payload = { success: false, message: e?.message || "internal error" };
      if (e?.code) payload.code = e.code;
      return res.status(statusCode).json(payload);
    }
  });

  // REGISTER (create or update username if exists)
  app.post("/api/user/login", putWalletAdd, async (req, res) => {
    try {

      const walletAddress = req.walletAddress;
      const walletAddressOriginal = req.rawWalletAddress || walletAddress;
      const privyMetaData = req.body?.privyMetaData;
      const shouldStorePrivyMetaData = Boolean(
        privyMetaData &&
        typeof privyMetaData === "object"
      );
      const isAccountExisted = await users.findOne({ walletAddress });
      let username = '';
      const now = new Date();
      if (!isAccountExisted) {

        username = `Player_${Date.now()}`;

        const setOnInsert = {
          walletAddress,
          walletAddressOriginal,
          correctAnswers: 0,
          currentStreak: 0,
          streak: 0,
          rank: "E",
          dungeonTitle: "Newbie",
          createdAt: now,
          username,
          nameUpdated: false,
          lastUpdatedAt: now,
          lastFlushedAt: now,
          ...(shouldStorePrivyMetaData ? { privyMetaData } : {}),
        };

        const set = {
          updatedAt: now
        };

        await users.updateOne(
          { walletAddress },
          { $setOnInsert: setOnInsert, $set: set },
          { upsert: true }
        );
        recordUserRegistration({ walletAddress, username })
          .catch((e) => console.error("onchain register error:", e));
      } else {
        username = isAccountExisted?.username;
        let existingPrivyMetaData = isAccountExisted?.privyMetaData || {};
        if (shouldStorePrivyMetaData) {
          await users.updateOne(
            { walletAddress, privyMetaData: { $exists: false } },
            { $set: { "privyMetaData": { ...existingPrivyMetaData, ...privyMetaData } } }
          );
        }
        if (!isAccountExisted?.walletAddressOriginal) {
          await users.updateOne(
            { walletAddress, walletAddressOriginal: { $exists: false } },
            { $set: { walletAddressOriginal } }
          );
        }
      }
      let nameUpdated = isAccountExisted?.nameUpdated ?? false;

      const loginDay = new Date();
      const dayStart = new Date(Date.UTC(
        loginDay.getUTCFullYear(),
        loginDay.getUTCMonth(),
        loginDay.getUTCDate()
      ));

      await dailyLogins.updateOne(
        { walletAddress, day: dayStart },
        {
          $setOnInsert: {
            walletAddress,
            day: dayStart,
          },
        },
        { upsert: true }
      );

      // Generate JWT token with just the wallet address
      const token = await generateAuthToken({ _id: walletAddress, wallet: walletAddress, username });

      const cached = await readUserFromRedis(walletAddress);

      if (!cached) {
        const cacheDoc = isAccountExisted
          ? {
            ...isAccountExisted,
            walletAddress,
            username,
            lastUpdatedAt: isAccountExisted.lastUpdatedAt || now,
            lastFlushedAt: isAccountExisted.lastFlushedAt || now,
          }
          : {
            walletAddress,
            username,
            correctAnswers: 0,
            currentStreak: 0,
            streak: 0,
            rank: "E",
            dungeonTitle: "Newbie",
            lastUpdatedAt: now,
            lastFlushedAt: now,
          };
        await writeUserToRedis(cacheDoc);
      }

      const loginType = String(req.body?.privyMetaData?.type || "Unknown").trim();
      await gateWallets.updateOne(
        { walletAddress },
        {
          $setOnInsert: { walletAddress, hasAwarded: false },
          $addToSet: { loginTypes: loginType }
        },
        { upsert: true }
      );

      return res.json({ success: true, data: { token, username, nameUpdated: nameUpdated } });
    } catch (e) {
      console.error("user/login error:", e);
      return res.status(500).json({ success: false, message: "internal error" });
    }
  });

  app.put(
    "/api/user/updateUsername",
    protect,
    async (req, res) => {
      try {
        const walletAddress = req.user.walletAddress;
        const now = new Date();
        const nowIso = now.toISOString();

        const username = req.body.username.trim();
        if (!username) {
          return res.status(400).json({
            success: false,
            message: "username cannot be empty"
          });
        }
        if (username.length > 30) {
          return res.status(400).json({
            success: false,
            message: "username too long"
          });
        }

        const updates = {};
        updates.username = username;
        updates.updatedAt = now;
        updates.lastUpdatedAt = now;
        updates.lastFlushedAt = now;
        updates.nameUpdated = true;
        const result = await users.updateOne(
          { walletAddress, },
          { $set: updates }
        );

        if (result.matchedCount === 0) {
          return res.status(404).json({
            success: false,
            message: "user not found"
          });
        }

        let responseUser = null;
        const cachedUser = await readUserFromRedis(walletAddress);
        if (cachedUser) {
          const cacheDoc = {
            ...cachedUser,
            ...(updates.username ? { username: updates.username } : {}),
            lastUpdatedAt: nowIso,
            lastFlushedAt: cachedUser.lastFlushedAt || cachedUser.lastUpdatedAt,
          };
          responseUser = await writeUserToRedis(cacheDoc, true);
        } else {
          const updatedUser = await users.findOne(
            { walletAddress },
            {
              projection: {
                // _id: 1,
                // createdAt: 1,
                // updatedAt: 1
                walletAddress: 1,
                username: 1,
                correctAnswers: 1,
                currentStreak: 1,
                streak: 1,
                rank: 1,
                dungeonTitle: 1,
                lastUpdatedAt: 1,
                lastFlushedAt: 1,
              }
            }
          );
          if (!updatedUser) {
            return res.status(404).json({
              success: false,
              message: "user not found"
            });
          }
          const cacheDoc = {
            ...updatedUser,
            lastUpdatedAt: updatedUser?.lastUpdatedAt || now,
            lastFlushedAt: updatedUser?.lastFlushedAt || now,
          };
          responseUser = await writeUserToRedis(cacheDoc, true);
        }

        return res.json({
          success: true,
          data: responseUser
        });
      } catch (e) {
        console.error("user/updateUsername error:", e);
        return res.status(500).json({
          success: false,
          message: "internal error"
        });
      }
    }
  );

  // GET PROFILE
  app.get(
    "/api/user/profile",
    protect,  // JWT authentication middleware
    async (req, res) => {
      try {
        // Get walletAddress from the authenticated user's JWT
        const walletAddress = req.user.walletAddress;

        const profile = await fetchUserProfile(walletAddress);

        if (!profile) {
          return res.status(404).json({
            success: false,
            message: "user not found"
          });
        }

        return res.json({
          success: true,
          data: profile
        });
      } catch (e) {
        console.error("user/get error:", e);
        return res.status(500).json({
          success: false,
          message: "internal error"
        });
      }
    }
  );
}
