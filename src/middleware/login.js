import { verifyBrowserToken } from "./jwt.js";
import { normalizeWallet as normalizeWalletUtil } from "../utils/normalize.js";

const normalizeWallet = (w) => normalizeWalletUtil(w) || "";

export const putWalletAdd = async (req, res, next) => {

    try {
        const jwt = req.body?.jwt;
        const source = req.body?.source;

        if (jwt && source) {
            if (source !== "browser") {
                return res.status(401).json({ success: false, message: "invalid request" });
            }

            const decodedData = await verifyBrowserToken(jwt);
            const rawWalletAddress = String(decodedData?.walletAddress || "").trim();
            if (!rawWalletAddress) {
                return res.status(400).json({ success: false, message: "invalid walletAddress" });
            }
            req.rawWalletAddress = rawWalletAddress;
            req.walletAddress = normalizeWallet(req.rawWalletAddress);

            next();
        } else {
            const rawWalletAddress = String(req.body?.walletAddress || "").trim();
            if (!rawWalletAddress) {
                return res.status(400).json({ success: false, message: "invalid walletAddress" });
            }
            req.rawWalletAddress = rawWalletAddress;
            req.walletAddress = normalizeWallet(rawWalletAddress);

            next();
        }
    } catch (err) {
        return res.status(400).json({ success: false, message: "invalid login" });
    }
}
