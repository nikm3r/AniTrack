import { Router, Request, Response } from "express";
import fs from "fs";
import path from "path";
import { getDb } from "../db.js";

const router = Router();

const VIDEO_EXTS = new Set([
  ".mkv", ".mp4", ".avi", ".mov", ".wmv", ".flv",
  ".webm", ".m4v", ".ts", ".m2ts",
]);

function isVideoFile(name: string): boolean {
  return VIDEO_EXTS.has(path.extname(name).toLowerCase());
}

// ─── GET /api/files/scan/:animeId ─────────────────────────────────────────────
// Scan the anime's download folder and return found video files

router.get("/scan/:animeId", (req: Request, res: Response) => {
  const db = getDb();
  const animeId = parseInt(req.params.animeId, 10);

  const anime = db
    .prepare("SELECT id, title_romaji, download_path FROM anime WHERE id = ?")
    .get(animeId) as
    | { id: number; title_romaji: string; download_path: string | null }
    | undefined;

  if (!anime) {
    res.status(404).json({ error: "Anime not found" });
    return;
  }

  // Resolve folder: explicit path > BaseFolder/Romaji Title
  let folder = anime.download_path;

  if (!folder) {
    const baseRow = db
      .prepare("SELECT value FROM settings WHERE key = 'base_folder'")
      .get() as { value: string } | undefined;
    const base = baseRow?.value ?? "";

    if (!base) {
      res.status(400).json({
        error:
          "No download path set for this anime and no base folder configured",
      });
      return;
    }

    folder = path.join(base, sanitizeFolderName(anime.title_romaji));
  }

  if (!fs.existsSync(folder)) {
    res.json({ folder, files: [], exists: false });
    return;
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(folder, { withFileTypes: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `Cannot read folder: ${msg}` });
    return;
  }

  // Flat scan — no subfolders per spec
  const files = entries
    .filter((e) => e.isFile() && isVideoFile(e.name))
    .map((e) => ({
      name: e.name,
      fullPath: path.join(folder!, e.name),
      size: fs.statSync(path.join(folder!, e.name)).size,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  res.json({ folder, files, exists: true });
});

// ─── GET /api/files/base-folder ───────────────────────────────────────────────

router.get("/base-folder", (_req: Request, res: Response) => {
  const db = getDb();
  const row = db
    .prepare("SELECT value FROM settings WHERE key = 'base_folder'")
    .get() as { value: string } | undefined;

  res.json({ base_folder: row?.value ?? "" });
});

// ─── PUT /api/files/base-folder ───────────────────────────────────────────────

router.put("/base-folder", (req: Request, res: Response) => {
  const db = getDb();
  const { path: folderPath } = req.body;

  if (!folderPath || typeof folderPath !== "string") {
    res.status(400).json({ error: "path is required" });
    return;
  }

  const resolved = path.resolve(folderPath);

  if (!fs.existsSync(resolved)) {
    res.status(400).json({ error: "Folder does not exist" });
    return;
  }

  db.prepare(
    "INSERT INTO settings (key, value) VALUES ('base_folder', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(resolved);

  res.json({ base_folder: resolved });
});

// ─── POST /api/files/resolve-path ─────────────────────────────────────────────
// Compute the expected download path for a given romaji title

router.post("/resolve-path", (req: Request, res: Response) => {
  const db = getDb();
  const { title_romaji, override_base } = req.body;

  if (!title_romaji) {
    res.status(400).json({ error: "title_romaji is required" });
    return;
  }

  const baseRow = db
    .prepare("SELECT value FROM settings WHERE key = 'base_folder'")
    .get() as { value: string } | undefined;

  const base = override_base ?? baseRow?.value ?? "";

  if (!base) {
    res.status(400).json({ error: "No base folder configured" });
    return;
  }

  const folder = path.join(base, sanitizeFolderName(title_romaji));
  res.json({ path: folder, exists: fs.existsSync(folder) });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Strip characters that are illegal in directory names on Windows/macOS/Linux.
 * Preserves Unicode letters so Japanese titles work fine.
 */
function sanitizeFolderName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
    .replace(/\.\s*$/, "")
    .trim();
}

export { sanitizeFolderName };
export default router;
