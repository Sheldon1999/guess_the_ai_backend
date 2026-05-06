import { users } from "../lib/mongo.js";
import { normalizeWallet } from "../utils/normalize.js";
import { protect } from "../middleware/jwt.js";
import {
  getEventStatus,
  getGatewayBaseUrl,
  healthCheck,
  isGatewayConfigured,
  retrievePlayerEvent,
} from "../services/daGatewayInspectService.js";

/**
 * Operational / debug parity with Highway Hustle — wallet-scoped lookups.
 */

export default function daPublicRoutes(app) {
  app.get("/api/da/snapshot", protect, async (req, res) => {
    try {
      const raw = req.query.wallet;
      const walletAddress = normalizeWallet(typeof raw === "string" ? raw : "");
      if (!walletAddress) {
        return res.status(400).json({
          success: false,
          message: "Missing or invalid wallet query parameter",
        });
      }
      if (normalizeWallet(req.user?.walletAddress) !== walletAddress) {
        return res.status(403).json({ success: false, message: "Forbidden wallet scope" });
      }
      const user = await users
        .findOne(
          { walletAddress },
          { projection: { walletAddress: 1, daGatewaySnapshot: 1 } },
        )
        .catch(() => null);
      if (!user) {
        return res.status(404).json({ success: false, message: "User not found" });
      }
      const snap = user.daGatewaySnapshot;
      if (!snap?.eventId) {
        return res.json({
          success: true,
          snapshot: null,
          message: "No DA gateway event recorded yet for this wallet",
        });
      }
      return res.json({
        success: true,
        snapshot: {
          eventId: snap.eventId,
          event: snap.event,
          daStatus: snap.daStatus,
          daReference: snap.daReference ?? null,
          daBlobInfo: snap.daBlobInfo ?? null,
          snapshotAt: snap.snapshotAt,
          gatewayStatusUrl: `${getGatewayBaseUrl()}/v1/da/status/${snap.eventId}`,
        },
      });
    } catch (err) {
      console.error("[daPublicRoutes] snapshot", err);
      return res.status(500).json({ success: false, message: "Internal server error" });
    }
  });

  app.get("/api/da/status", protect, async (req, res) => {
    try {
      if (!isGatewayConfigured()) {
        return res.status(503).json({
          success: false,
          message: "DA gateway not configured (DA_GATEWAY_URL)",
        });
      }
      const raw = req.query.wallet;
      const walletAddress = normalizeWallet(typeof raw === "string" ? raw : "");
      if (!walletAddress) {
        return res.status(400).json({
          success: false,
          message: "Missing or invalid wallet query parameter",
        });
      }
      if (normalizeWallet(req.user?.walletAddress) !== walletAddress) {
        return res.status(403).json({ success: false, message: "Forbidden wallet scope" });
      }
      const user = await users
        .findOne({ walletAddress }, { projection: { daGatewaySnapshot: 1 } })
        .catch(() => null);
      if (!user) {
        return res.status(404).json({ success: false, message: "User not found" });
      }
      const eventId = user.daGatewaySnapshot?.eventId;
      if (!eventId) {
        return res.json({
          success: true,
          found: false,
          message: "No DA gateway event recorded yet for this wallet",
        });
      }

      const status = await getEventStatus(eventId);
      const ds = String(status?.daStatus || "").toLowerCase();
      if (status?.daBlobInfo && (ds === "confirmed" || ds === "finalized")) {
        await users.updateOne(
          { walletAddress },
          {
            $set: {
              "daGatewaySnapshot.daStatus": status.daStatus,
              "daGatewaySnapshot.daReference": status.daReference,
              "daGatewaySnapshot.daBlobInfo": status.daBlobInfo,
            },
          },
        ).catch(() => {});
      }

      return res.json({ success: true, walletAddress, eventId, ...status });
    } catch (err) {
      console.error("[daPublicRoutes] status", err);
      return res.status(500).json({ success: false, message: "Internal server error" });
    }
  });

  app.get("/api/da/retrieve", protect, async (req, res) => {
    try {
      if (!isGatewayConfigured()) {
        return res.status(503).json({
          success: false,
          message: "DA gateway not configured (DA_GATEWAY_URL)",
        });
      }
      const raw = req.query.wallet;
      const walletAddress = normalizeWallet(typeof raw === "string" ? raw : "");
      if (!walletAddress) {
        return res.status(400).json({
          success: false,
          message: "Missing or invalid wallet query parameter",
        });
      }
      if (normalizeWallet(req.user?.walletAddress) !== walletAddress) {
        return res.status(403).json({ success: false, message: "Forbidden wallet scope" });
      }
      const user = await users
        .findOne({ walletAddress }, { projection: { daGatewaySnapshot: 1 } })
        .catch(() => null);
      if (!user) {
        return res.status(404).json({ success: false, message: "User not found" });
      }
      const eventId = user.daGatewaySnapshot?.eventId;
      if (!eventId) {
        return res.json({
          success: true,
          retrieved: false,
          message: "No DA gateway event for this wallet",
        });
      }
      const result = await retrievePlayerEvent(eventId);
      return res.json({ success: true, walletAddress, eventId, ...result });
    } catch (err) {
      console.error("[daPublicRoutes] retrieve", err);
      return res.status(500).json({ success: false, message: "Internal server error" });
    }
  });

  app.get("/api/da/health", protect, async (_req, res) => {
    try {
      const da = await healthCheck();
      return res.json({ success: true, da });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  });
}
