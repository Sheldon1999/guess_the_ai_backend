/**
 * Image Controller
 * Request handlers for image serving endpoints
 */

const BACKUP_BASE_URL = (
  process.env.BACKUP_BASE_URL ||
  'https://guess-the-ai.sfo3.cdn.digitaloceanspaces.com/game/cache/backup'
).replace(/\/+$/, '');

/**
 * Extract and validate hash from request
 * @param {Request} req - Express request
 * @returns {string|null} Validated hash or null
 */
function extractHash(req) {
  const rawHash = req.params?.hash || req.query?.hash || req.originalUrl.split('/').pop();
  return (rawHash || '').trim() || null;
}

/**
 * Build CDN URL for image
 * @param {string} hash - Image hash
 * @returns {string} Full CDN URL
 */
function buildCdnUrl(hash) {
  const fileName = hash.toLowerCase().endsWith('.jpg') ? hash : `${hash}.jpg`;
  return `${BACKUP_BASE_URL}/${encodeURIComponent(fileName)}`;
}

/**
 * Image by hash handler
 * Redirects to CDN backup URL
 * @param {Request} req - Express request
 * @param {Response} res - Express response
 */
export async function imageByHashHandler(req, res) {
  try {
    const hash = extractHash(req);

    if (!hash) {
      return res.status(400).json({ error: 'hash required' });
    }

    if (BACKUP_BASE_URL) {
      const targetUrl = buildCdnUrl(hash);
      return res.redirect(302, targetUrl);
    }

    return res.status(404).json({ error: 'not found' });
  } catch (error) {
    return res.status(404).json({ error: 'not found' });
  }
}
