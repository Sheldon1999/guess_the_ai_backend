import { verifyBrowserToken } from "./jwt.js";

function normalizeWallet(w) {
    return String(w || "").trim().toLowerCase();
}

export const putWalletAdd = async (req, res, next) => {

    try {
        const jwt = req.body?.jwt;
        const source = req.body?.source;

        console.log("[MIDDLEWARE] got req body:::::: ", req.body);

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

            if(req.body?.sessionWallet && req.body.sessionWallet === "VERIFIED"){
                req.isGateUser = true;
            }
            else {
                req.isGateUser = false;
            }

            console.log("[MIDDLEWARE] got sessionWallet in req:::::: ", req.isGateUser);

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
