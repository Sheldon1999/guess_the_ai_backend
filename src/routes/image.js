//src/routes/image
import fs from "fs";
import path from "path";
import { Readable } from "stream";

const BACKUP_CACHE_DIR = process.env.BACKUP_CACHE_DIR || "./cache/backup";

export default function imageRoutes(app) {
  app.get("/api/img/h/:hash", async (req, res) => {
    const raw = req.params?.hash || req.query?.hash || req.originalUrl.split("/").pop();
    const hash = (raw || "").trim();
    const filePath = path.join(BACKUP_CACHE_DIR, hash);

      await fs.promises.access(filePath, fs.constants.R_OK);
      const stat = await fs.promises.stat(filePath);
      res.setHeader("Content-Length", stat.size);
      res.setHeader("Content-Type", "application/octet-stream");
      return fs.createReadStream(filePath).pipe(res);
  });
}
