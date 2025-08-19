import fs from "fs";
import path from "path";
import { Readable } from "stream";

const CACHE_DIR = process.env.CACHE_DIR || "./cache/orig";
const OGSOURCE_BASE = process.env.OGSOURCE_BASE;
const READ_MS = Number(process.env.HTTP_READ_TIMEOUT_MS || 15000);
const MAX_BYTES = Number(process.env.HTTP_MAX_CONTENT_BYTES || 5 * 1024 * 1024);

export default function imageRoutes(app) {
  app.get("/img/h/:hash", async (req, res) => {
    const raw = req.params?.hash || req.query?.hash || req.originalUrl.split("/").pop();
    const hash = (raw || "").trim();
    const filePath = path.join(CACHE_DIR, hash);

    try {
      await fs.promises.access(filePath, fs.constants.R_OK);
      const stat = await fs.promises.stat(filePath);
      res.setHeader("Content-Length", stat.size);
      res.setHeader("Content-Type", "application/octet-stream");
      return fs.createReadStream(filePath).pipe(res);
    } catch (_) {}

    const url = `${OGSOURCE_BASE}${encodeURIComponent(hash)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), READ_MS);

    let upstream;
    try {
      upstream = await fetch(url, { signal: controller.signal });
    } catch (e) {
      clearTimeout(timer);
      return res.status(502).send("upstream fetch error");
    }
    clearTimeout(timer);

    if (!upstream.ok || !upstream.body) return res.status(502).send("bad upstream response");

    const lenHeader = upstream.headers?.get ? upstream.headers.get("content-length") : null;
    const contentLen = lenHeader ? Number(lenHeader) : 0;
    if (contentLen && contentLen > MAX_BYTES) return res.status(413).send("payload too large");

    const ctype = upstream.headers?.get ? (upstream.headers.get("content-type") || "application/octet-stream") : "application/octet-stream";
    res.setHeader("Content-Type", ctype);

    const [toClient, toDisk] = upstream.body.tee();
    Readable.fromWeb(toClient).pipe(res);

    const tmpPath = `${filePath}.part`;
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await new Promise((resolve, reject) => {
      const ws = fs.createWriteStream(tmpPath);
      const ns = Readable.fromWeb(toDisk);
      ns.on("error", reject);
      ws.on("error", reject);
      ws.on("finish", resolve);
      ns.pipe(ws);
    }).catch(() => {});
    try { await fs.promises.rename(tmpPath, filePath); } catch {}
  });
}
