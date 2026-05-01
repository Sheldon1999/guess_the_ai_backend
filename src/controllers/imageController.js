/**
 * Image Controller
 * Request handlers for image serving endpoints
 */

const BACKUP_BASE_URL = (
  process.env.BACKUP_BASE_URL ||
  'https://guess-the-ai.sfo3.cdn.digitaloceanspaces.com/game/cache/backup'
).replace(/\/+$/, '');
const OG_IMAGE_BASE_URL = (
  process.env.OG_IMAGE_BASE_URL ||
  'https://indexer-storage-turbo.0g.ai/file?root='
).trim();
const OG_FETCH_TIMEOUT_MS = Math.max(
  Number(process.env.OG_FETCH_TIMEOUT_MS || 1200),
  200
);

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
 * Build 0G indexer URL for image root hash
 * @param {string} hash - Image hash/root
 * @returns {string} Full 0G URL
 */
function build0gUrl(hash) {
  return `${OG_IMAGE_BASE_URL}${encodeURIComponent(hash)}`;
}

/**
 * Check whether remote image endpoint is currently reachable quickly
 * @param {string} targetUrl - URL to probe
 * @returns {Promise<boolean>} true if reachable, otherwise false
 */
async function canFetchFast(targetUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OG_FETCH_TIMEOUT_MS);
  try {
    const headResponse = await fetch(targetUrl, {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal
    });
    if (headResponse.ok) return true;
    // Some CDNs/indexers may reject HEAD; treat 405/403 as inconclusive and try GET probe.
    if (headResponse.status !== 405 && headResponse.status !== 403) return false;
  } catch {
    // Continue to GET probe before giving up.
  } finally {
    clearTimeout(timeout);
  }

  const getController = new AbortController();
  const getTimeout = setTimeout(() => getController.abort(), OG_FETCH_TIMEOUT_MS);
  try {
    const getResponse = await fetch(targetUrl, {
      method: 'GET',
      headers: { Range: 'bytes=0-0' },
      redirect: 'follow',
      signal: getController.signal
    });
    return getResponse.ok || getResponse.status === 206;
  } catch {
    return false;
  } finally {
    clearTimeout(getTimeout);
  }
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

    const ogUrl = build0gUrl(hash);
    const backupUrl = BACKUP_BASE_URL ? buildCdnUrl(hash) : null;

    if (OG_IMAGE_BASE_URL) {
      const reachable = await canFetchFast(ogUrl);
      if (reachable) {
        res.setHeader('x-image-source', '0g');
        return res.redirect(302, ogUrl);
      }
    }

    if (backupUrl) {
      res.setHeader('x-image-source', 'digitalocean-fallback');
      return res.redirect(302, backupUrl);
    }

    return res.status(404).json({ error: 'not found' });
  } catch (error) {
    return res.status(404).json({ error: 'not found' });
  }
}
