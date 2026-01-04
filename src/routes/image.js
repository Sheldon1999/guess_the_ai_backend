const BACKUP_BASE_URL = (process.env.BACKUP_BASE_URL || "https://guess-the-ai.sfo3.cdn.digitaloceanspaces.com/game/cache/backup").replace(/\/+$/, "");

export default function imageRoutes(app) {
  app.get("/api/img/h/:hash", async (req, res) => {
    try {
      const raw = req.params?.hash || req.query?.hash || req.originalUrl.split("/").pop();
      const hash = (raw || "").trim();
      if (!hash) {
        return res.status(400).json({ error: "hash required" });
      }

      if (BACKUP_BASE_URL) {
        const fileName = hash.toLowerCase().endsWith(".jpg") ? hash : `${hash}.jpg`;
        const target = `${BACKUP_BASE_URL}/${encodeURIComponent(fileName)}`;
        return res.redirect(302, target);
      }
    } catch (err) {
      return res.status(404).json({ error: "not found" });
    }
  });
}
