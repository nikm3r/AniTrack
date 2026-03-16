import { Router, Request, Response } from "express";
import { getDb } from "../db.js";
import { AniListTracker } from "../tracker/anilist.js";
import type { TrackerUserListEntry } from "../tracker/types.js";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const router = Router();

const STATUS_MAP: Record<string, string> = {
  CURRENT:   "WATCHING",
  COMPLETED: "COMPLETED",
  PLANNING:  "PLANNING",
  DROPPED:   "DROPPED",
  PAUSED:    "PAUSED",
  REPEATING: "WATCHING",
};

// ─── Image cache directory ────────────────────────────────────────────────────

function getImageCacheDir(): string {
  const base =
    process.env.USER_DATA_PATH ||
    path.join(process.env.HOME || "~", ".anitrack");
  const dir = path.join(base, "images");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function urlToFilename(imageUrl: string): string {
  const hash = crypto.createHash("md5").update(imageUrl).digest("hex");
  const ext = path.extname(new URL(imageUrl).pathname) || ".jpg";
  return `${hash}${ext}`;
}

async function downloadAndCache(imageUrl: string): Promise<string | null> {
  const cacheDir = getImageCacheDir();
  const filename = urlToFilename(imageUrl);
  const filepath = path.join(cacheDir, filename);

  // Already cached
  if (fs.existsSync(filepath)) return filepath;

  try {
    const response = await fetch(imageUrl);
    if (!response.ok) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(filepath, buffer);
    return filepath;
  } catch {
    return null;
  }
}

// ─── GET /api/proxy-image ─────────────────────────────────────────────────────
// Serves from local disk cache if available, fetches and caches if not,
// falls back gracefully if offline and not yet cached.

router.get("/proxy-image", async (req: Request, res: Response) => {
  const imageUrl = req.query.url as string;
  if (!imageUrl) {
    res.status(400).json({ error: "url query param required" });
    return;
  }

  try {
    const url = new URL(imageUrl);
    const allowedHosts = [
      "s4.anilist.co",
      "cdn.myanimelist.net",
      "img.anisearch.com",
    ];
    if (!allowedHosts.some(h => url.hostname.endsWith(h))) {
      res.status(403).json({ error: "Host not allowed" });
      return;
    }

    const cacheDir = getImageCacheDir();
    const filename = urlToFilename(imageUrl);
    const filepath = path.join(cacheDir, filename);

    // Serve from disk cache if available
    if (fs.existsSync(filepath)) {
      res.setHeader("Cache-Control", "public, max-age=604800"); // 7 days
      res.setHeader("X-Cache", "HIT");
      res.sendFile(filepath);
      return;
    }

    // Not cached — fetch from remote
    const response = await fetch(imageUrl);
    if (!response.ok) {
      res.status(response.status).send("Upstream error");
      return;
    }

    const contentType = response.headers.get("content-type") ?? "image/jpeg";
    const buffer = Buffer.from(await response.arrayBuffer());

    // Save to disk cache (fire and forget — don't block the response)
    fs.writeFile(filepath, buffer, () => {});

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=604800");
    res.setHeader("X-Cache", "MISS");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(buffer);
  } catch (err: unknown) {
    // If we're offline and not cached, return 503 so the UI can show a placeholder
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[proxy-image] Error:", msg);
    res.status(503).json({ error: "Image unavailable offline" });
  }
});

// ─── POST /api/tracker/import-list ───────────────────────────────────────────

router.post("/import-list", async (req: Request, res: Response) => {
  const db = getDb();

  const trackerName: string =
    (req.body?.tracker as string) ||
    (db.prepare("SELECT value FROM settings WHERE key = 'active_tracker'").get() as any)?.value ||
    "anilist";

  const tokenRow = db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(`${trackerName}_token`) as { value: string } | undefined;

  if (!tokenRow?.value) {
    res.status(401).json({ error: `No ${trackerName} token configured` });
    return;
  }

  try {
    const tracker = new AniListTracker();
    const entries: TrackerUserListEntry[] = await tracker.getUserList(tokenRow.value);

    const upsert = db.prepare(`
      INSERT INTO anime (
        anilist_id, title_romaji, title_english, title_native,
        cover_image, banner_image, status, score, progress,
        total_episodes, format, season, season_year,
        genres, description, average_score
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(anilist_id) DO UPDATE SET
        title_romaji    = excluded.title_romaji,
        title_english   = excluded.title_english,
        title_native    = excluded.title_native,
        cover_image     = excluded.cover_image,
        banner_image    = excluded.banner_image,
        status          = excluded.status,
        score           = excluded.score,
        progress        = excluded.progress,
        total_episodes  = excluded.total_episodes,
        format          = excluded.format,
        season          = excluded.season,
        season_year     = excluded.season_year,
        genres          = excluded.genres,
        description     = excluded.description,
        average_score   = excluded.average_score,
        updated_at      = datetime('now')
    `);

    let synced = 0;
    let updated = 0;
    let newCount = 0;

    const importAll = db.transaction(() => {
      for (const entry of entries) {
        const existing = db
          .prepare("SELECT id FROM anime WHERE anilist_id = ?")
          .get(Number(entry.trackerId));

        const mappedStatus = STATUS_MAP[entry.status] ?? entry.status;

        upsert.run(
          Number(entry.trackerId),
          entry.titleRomaji,
          entry.titleEnglish ?? null,
          (entry as any).titleNative ?? null,
          entry.coverImage ?? null,
          (entry as any).bannerImage ?? null,
          mappedStatus,
          entry.score ?? null,
          entry.progress,
          entry.totalEpisodes ?? null,
          entry.format ?? null,
          (entry as any).season ?? null,
          (entry as any).seasonYear ?? null,
          (entry as any).genres ? JSON.stringify((entry as any).genres) : null,
          (entry as any).description ?? null,
          (entry as any).averageScore ?? null
        );

        synced++;
        if (existing) { updated++; } else { newCount++; }
      }
    });

    importAll();

    // Cache all cover images to disk in the background
    const coverUrls = entries
      .map(e => e.coverImage)
      .filter((u): u is string => Boolean(u));

    // Don't await — let it run in background
    Promise.allSettled(coverUrls.map(url => downloadAndCache(url)))
      .then(results => {
        const cached = results.filter(r => r.status === "fulfilled" && r.value).length;
        console.log(`[images] Cached ${cached}/${coverUrls.length} cover images to disk`);
      });

    res.json({ synced, updated, new: newCount });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[import-list] Error:", msg);
    res.status(500).json({ error: msg });
  }
});

export default router;
