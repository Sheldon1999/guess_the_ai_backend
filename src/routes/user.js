// src/routes/user
import { users, dailyLogins, gateWallets } from "../lib/mongo.js";
import { generateAuthToken } from "../middleware/jwt.js";
import { protect } from "../middleware/jwt.js";
import { recordUserRegistration } from "../lib/onchain/index.js";
import {
  writeUserToRedis,
  fetchUserProfile,
  readUserFromRedis
} from "../lib/docCache.js";
import { putWalletAdd } from "../middleware/login.js";

export default function userRoutes(app) {

  // REGISTER (create or update username if exists)
  app.post("/api/user/login", putWalletAdd ,async (req, res) => {
    try {

      const walletAddress = req.walletAddress;
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
          correctAnswers: 0,
          currentStreak: 0,
          streak: 0,
          rank: "E",
          dungeonTitle: "Newbie",
          createdAt: now,
          username,
          nameUpdated:false,
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
        existingPrivyMetaData = isAccountExisted?.privyMetaData || {};
        if (shouldStorePrivyMetaData) {
          await users.updateOne(
            { walletAddress, privyMetaData: { $exists: false } },
            { $set: { "privyMetaData": {  ...existingPrivyMetaData, ...privyMetaData } } }
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
      const token = await generateAuthToken({ _id: walletAddress, wallet:walletAddress,username});

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

        if(req.isGateUser){
          const isGateUserExisted = await gateWallets.findOne({ walletAddress });
          if (!isGateUserExisted) {
            await gateWallets.insertOne({ walletAddress, hasAwarded: false});
          }
        }
  
      return res.json({ success: true, data: { token, username,  nameUpdated: nameUpdated  } });
    } catch (e) {
      console.error("user/login error:", e);
      return res.status(500).json({ success: false, message: "internal error" });
    }
  });

  // PATCH (username only)
  app.put(
    "/api/user/updateUsername", 
    protect,  // This will validate the JWT
    async (req, res) => {
      try {
        // Get walletAddress from the JWT token (set by protect middleware)
        const walletAddress = req.user.walletAddress;
        const now = new Date();

        const updates = {};
        if (typeof req.body?.username === "string") {
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

          const isNameExisted = await users.findOne(
            { username, walletAddress: { $ne: walletAddress } },
            { collation: { locale: "en", strength: 2 } }
          );
          if (isNameExisted) {
            return res.status(400).json({ success: false, message: "username already exists" });
          }
          updates.username = username;
        }
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
  
        // Return updated user data
        const updatedUser = await users.findOne(
          { walletAddress },
          {
            projection: {
              // _id: 1, 
              // createdAt: 1, 
              // updatedAt: 1
              walletAddress:1,
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

          const cacheDoc = {
            ...updatedUser,
            lastUpdatedAt: updatedUser?.lastUpdatedAt || now,
            lastFlushedAt: updatedUser?.lastFlushedAt || now,
            nameUpdated: true,
          };
          await writeUserToRedis(cacheDoc, true);
  
        return res.json({ 
          success: true, 
          data: updatedUser 
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
