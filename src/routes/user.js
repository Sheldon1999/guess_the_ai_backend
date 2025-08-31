import { users } from "../lib/mongo.js";
import { generateAuthToken } from "../middleware/jwt.js";
import { protect } from "../middleware/jwt.js";

function normalizeWallet(w) {
  return String(w || "").trim().toLowerCase();
}

// case-insensitive 0x + 40 hex chars
const WALLET_RE = /^0x[0-9a-z]{40}$/i;

export default function userRoutes(app) {

  // REGISTER (create or update username if exists)
  app.post("/user/login", async (req, res) => {
    try {
      const walletAddress = normalizeWallet(req.body?.walletAddress);
  
      if (!walletAddress) {
        return res.status(400).json({ success: false, message: "invalid walletAddress" });
      }
  
      const isAccountExisted = await users.findOne({ walletAddress });
      let username = '';
      if (!isAccountExisted) {
   
        username = `Player_${Date.now()}`;
    
        const setOnInsert = {
          walletAddress,
          correctAnswers: 0,
          currentStreak: 0,
          streak: 0,
          rank: "E",
          dungeonTitle: "Newbie",
          createdAt: new Date(),
          username,
          nameUpdated:false
        };
        const now = new Date();
        const set = {
          updatedAt: now
        };
    
        await users.updateOne(
          { walletAddress },
          { $setOnInsert: setOnInsert, $set: set },
          { upsert: true }
        );
      }
      else {
        username = isAccountExisted?.username;
      }
      // Generate JWT token with just the wallet address
      const token = await generateAuthToken({ _id: walletAddress, wallet:walletAddress,username });
  
      return res.json({ success: true, data: { token, username } });
    } catch (e) {
      console.error("user/login error:", e);
      return res.status(500).json({ success: false, message: "internal error" });
    }
  });

    // PATCH (username only)
  app.put(
    "/user/updateUsername", 
    protect,  // This will validate the JWT
    async (req, res) => {
      try {
        // Get walletAddress from the JWT token (set by protect middleware)
        const walletAddress = req.user.walletAddress;
        
        const isNameExisted  = await users.findOne({ username: req.body.username ,walletAddress:{ $ne: walletAddress }  });

        if(isNameExisted) {
          return res.status(400).json({ success: false, message: "username already exists" });
        }
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
          updates.username = username;
        }
        updates.updatedAt = new Date();
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
              dungeonTitle: 1
            }
          }
        );
  
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
    "/user/profile",
    protect,  // JWT authentication middleware
    async (req, res) => {
      try {
        // Get walletAddress from the authenticated user's JWT
        const walletAddress = req.user.walletAddress;
        
        const profile = await users.findOne(
          { walletAddress },
          {
            projection: {
              walletAddress:1,
              username: 1, 
              correctAnswers: 1, 
              currentStreak: 1, 
              streak: 1,
              rank: 1, 
              dungeonTitle: 1
              // , 
              // createdAt: 1, 
              // updatedAt: 1
            }
          }
        );
        
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
