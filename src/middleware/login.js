import { verifyBrowserToken, extractBrowserJwtWallet } from "./jwt.js";
import { normalizeWallet as normalizeWalletUtil } from "../utils/normalize.js";

const normalizeWallet = (w) => normalizeWalletUtil(w) || "";

export const putWalletAdd = async (req, res, next) => {

    try {
        const jwt = req.body?.jwt;
        const source = req.body?.source;
        if (!jwt || source !== "browser") {
            return res.status(401).json({
                success: false,
                message: "jwt login is required (source=browser)"
            });
        }

        const decodedData = await verifyBrowserToken(jwt);
        const rawWalletAddress = extractBrowserJwtWallet(decodedData);
        if (!rawWalletAddress) {
            return res.status(400).json({ success: false, message: "invalid walletAddress" });
        }
        req.rawWalletAddress = rawWalletAddress;
        req.walletAddress = normalizeWallet(req.rawWalletAddress);

        next();
    } catch (err) {
        return res.status(400).json({ success: false, message: "invalid login" });
    }
}
