import { verifyBrowserToken } from "./jwt.js";

function normalizeWallet(w) {
    return String(w || "").trim().toLowerCase();
}

export const putWalletAdd = async (req, res, next) => {

    try {
        const jwt = req.body?.jwt;
        const source = req.body?.source;

        if (jwt && source) {
            if (source !== "browser") {
                return res.status(401).json({ success: false, message: "invalid request" });
            }

            const decodedData = await verifyBrowserToken(jwt);
            const walletAddress = decodedData?.walletAddress;
            req.walletAddress = walletAddress;

            next();
            if (!walletAddress) {
                return res.status(400).json({ success: false, message: "invalid walletAddress" });
            }
        } else {
            const walletAddress = normalizeWallet(req.body?.walletAddress);
            if (!walletAddress) {
                return res.status(400).json({ success: false, message: "invalid walletAddress" });
            }
            req.walletAddress = walletAddress;

            next();
        }
    } catch (err) {
        return res.status(400).json({ success: false, message: "invalid login" });
    }
}