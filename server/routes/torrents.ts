import { Router, Request, Response } from "express";
import { exec } from "child_process";
import { getDb } from "../db.js";
import path from "path";
import fs from "fs";

const router = Router();

// ─── GET /api/torrents/search?q=... ──────────────────────────────────────────

router.get("/search", async (req: Request, res: Response) => {
  const q = req.query.q as string;
  if (!q || q.trim().length < 2) {
    res.status(400).json({ error: "Query must be at least 2 characters" });
    return;
  }

  try {
    const url = `https://feed.animetosho.org/json?qx=1&q=${encodeURIComponent(q.trim())}`;
    const response = await fetch(url, {
      headers: { "User-Agent": "AniTrack/1.0" },
    });

    if (!response.ok) {
      res.status(response.status).json({ error: "AnimeTosho returned an error" });
      return;
    }

    const data = await response.json() as any[];

    const results = data.map((item: any) => ({
      title: item.title ?? "Unknown",
      link: item.magnet_uri || item.torrent_url || null,
      size: item.total_size
        ? formatSize(item.total_size)
        : "Unknown",
      seeders: item.seeders ?? 0,
      leechers: item.leechers ?? 0,
    })).filter((r: any) => r.link);

    res.json({ data: results });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[torrents] Search error:", msg);
    res.status(500).json({ error: "Search failed" });
  }
});

// ─── POST /api/torrents/download ──────────────────────────────────────────────
// Body: { link, titleRomaji, animeId? }

router.post("/download", (req: Request, res: Response) => {
  const { link, titleRomaji, animeId } = req.body;

  if (!link || !titleRomaji) {
    res.status(400).json({ error: "link and titleRomaji are required" });
    return;
  }

  const db = getDb();

  // Get base folder from settings
  const baseRow = db
    .prepare("SELECT value FROM settings WHERE key = 'base_folder'")
    .get() as { value: string } | undefined;
  const baseFolder = baseRow?.value ?? "";

  // Get per-series override path if animeId provided
  let savePath: string;
  if (animeId) {
    const animeRow = db
      .prepare("SELECT download_path FROM anime WHERE id = ?")
      .get(animeId) as { download_path: string | null } | undefined;
    if (animeRow?.download_path) {
      savePath = animeRow.download_path;
    } else {
      savePath = baseFolder
        ? path.join(baseFolder, sanitizeFolderName(titleRomaji))
        : sanitizeFolderName(titleRomaji);
    }
  } else {
    savePath = baseFolder
      ? path.join(baseFolder, sanitizeFolderName(titleRomaji))
      : sanitizeFolderName(titleRomaji);
  }

  // Ensure save directory exists
  if (savePath && !fs.existsSync(savePath)) {
    try { fs.mkdirSync(savePath, { recursive: true }); } catch { /* ignore */ }
  }

  // Get torrent client path from settings
  const clientRow = db
    .prepare("SELECT value FROM settings WHERE key = 'torrent_client_path'")
    .get() as { value: string } | undefined;
  const clientPath = clientRow?.value?.trim() ?? "";

  if (clientPath) {
    // Silent injection into torrent client
    const isQbt = clientPath.toLowerCase().includes("qbittorrent");
    let command: string;

    if (isQbt) {
      command = `"${clientPath}" --save-path="${savePath}" --skip-dialog=true "${link}"`;
    } else {
      // Generic client (Transmission, Deluge, etc.) — just pass the link
      command = `"${clientPath}" "${link}"`;
    }

    exec(command, (err) => {
      if (err) console.error("[torrents] Client launch error:", err.message);
    });

    res.json({ success: true, method: "client", savePath });
  } else {
    // No client configured — open with system default magnet handler
    const opener =
      process.platform === "win32" ? "start" :
      process.platform === "darwin" ? "open" :
      "xdg-open";

    exec(`${opener} "${link}"`, (err) => {
      if (err) console.error("[torrents] System open error:", err.message);
    });

    res.json({ success: true, method: "system", savePath: null });
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sanitizeFolderName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
    .replace(/\.+$/, "")
    .trim();
}

function formatSize(bytes: number): string {
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(1)} GB`;
  if (bytes >= 1048576)    return `${(bytes / 1048576).toFixed(0)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

export default router;
