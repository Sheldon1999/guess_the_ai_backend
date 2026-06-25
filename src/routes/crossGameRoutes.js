import { getCrossGameProgress, getLocalCrossGame } from '../services/crossGameService.js';

function walletFrom(req) {
  return req.query.walletAddress || req.query.wallet || req.query.user || req.query.address;
}

function sendError(res, err) {
  return res.status(err.statusCode || 502).json({
    success: false,
    error: err.message || 'Cross-game request failed',
  });
}

export default function crossGameRoutes(app) {
  app.get('/api/cross-game/local', async (req, res) => {
    try {
      const data = await getLocalCrossGame(walletFrom(req));
      return res.json({ success: true, data });
    } catch (err) {
      return sendError(res, err);
    }
  });

  app.get('/api/cross-game/progress', async (req, res) => {
    try {
      const data = await getCrossGameProgress(walletFrom(req));
      return res.json({ success: true, data });
    } catch (err) {
      return sendError(res, err);
    }
  });
}
