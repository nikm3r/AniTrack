import { Router, Request, Response } from "express";
import { getDb } from "../db.js";
import { AniListTracker } from "../tracker/anilist.js";
import { MALTracker } from "../tracker/mal.js";
import type { TrackerUserListEntry, ITracker } from "../tracker/types.js";
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
  // MAL statuses (already normalized by MALTracker.getUserList, but belt-and-suspenders)
  watching:      "WATCHING",
  completed:     "COMPLETED",
  plan_to_watch: "PLANNING",
  dropped:       "DROPPED",
  on_hold:       "PAUSED",
};

// ─── Image cache ──────────────────────────────────────────────────────────────

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

// ─── GET /api/tracker/proxy-image ─────────────────────────────────────────────
// Canonical proxy-image with disk cache.

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
      "api-cdn.myanimelist.net",
      "myanimelist.net",
      "img.anisearch.com",
      "media.kitsu.app",
    ];
    if (!allowedHosts.some(h => url.hostname.endsWith(h))) {
      res.status(403).json({ error: "Host not allowed" });
      return;
    }

    const cacheDir = getImageCacheDir();
    const filename = urlToFilename(imageUrl);
    const filepath = path.join(cacheDir, filename);

    if (fs.existsSync(filepath)) {
      res.setHeader("Cache-Control", "public, max-age=604800");
      res.setHeader("X-Cache", "HIT");
      res.sendFile(filepath);
      return;
    }

    const response = await fetch(imageUrl);
    if (!response.ok) {
      res.status(response.status).send("Upstream error");
      return;
    }

    const contentType = response.headers.get("content-type") ?? "image/jpeg";
    const buffer = Buffer.from(await response.arrayBuffer());

    fs.writeFile(filepath, buffer, () => {});

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=604800");
    res.setHeader("X-Cache", "MISS");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(buffer);
  } catch (err: unknown) {
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

  if (!tokenRow?.value?.trim()) {
    res.status(401).json({ error: `No ${trackerName} token configured` });
    return;
  }

  const token = tokenRow.value.trim();

  try {
    // FIX: No longer hardcodes AniListTracker — picks the right tracker based on setting.
    let tracker: ITracker;
    if (trackerName === "mal") {
      tracker = new MALTracker();
    } else {
      tracker = new AniListTracker();
    }

    const entries: TrackerUserListEntry[] = await tracker.getUserList(token);

    // SAFETY: An empty list almost always means the tracker API failed or is down.
    // Never wipe the local library based on an empty response — bail out instead.
    if (!entries || entries.length === 0) {
      const existingCount = (db.prepare("SELECT COUNT(*) as c FROM anime").get() as { c: number }).c;
      if (existingCount > 0) {
        console.warn("[import-list] Tracker returned empty list but local library is not empty — skipping import to avoid data loss");
        res.status(503).json({ error: "Tracker returned no data (likely down). Library preserved.", synced: 0, skipped: true });
        return;
      }
    }

    // Determine which DB column holds this tracker's ID
    const trackerIdCol = trackerName === "mal" ? "mal_id" : "anilist_id";

    const upsert = db.prepare(`
      INSERT INTO anime (
        ${trackerIdCol}, title_romaji, title_english, title_native,
        cover_image, banner_image, status, score, progress,
        total_episodes, format, season, season_year,
        genres, description, average_score
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(${trackerIdCol}) DO UPDATE SET
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

    // Save user-set fields BEFORE wiping the table
    const userFields = db.prepare(
      `SELECT ${trackerIdCol} as tid, alt_title, download_path, notes FROM anime WHERE ${trackerIdCol} IS NOT NULL`
    ).all() as { tid: number; alt_title: string | null; download_path: string | null; notes: string | null }[];
    const userFieldMap = new Map(userFields.map(r => [r.tid, r]));

    let synced = 0;
    let updated = 0;
    let newCount = 0;

    // FIX: DELETE is inside the transaction — atomic, no partial state on failure.
    // FIX: new vs updated determined from pre-delete snapshot, not a SELECT after clearing.
    const importAll = db.transaction(() => {
      db.prepare("DELETE FROM anime").run();

      for (const entry of entries) {
        const trackerId = Number(entry.trackerId);
        const wasExisting = userFieldMap.has(trackerId);

        const mappedStatus = STATUS_MAP[entry.status] ?? entry.status;

        upsert.run(
          trackerId,
          entry.titleRomaji,
          entry.titleEnglish ?? null,
          entry.titleNative ?? null,
          entry.coverImage ?? null,
          entry.bannerImage ?? null,
          mappedStatus,
          entry.score ?? null,
          entry.progress,
          entry.totalEpisodes ?? null,
          entry.format ?? null,
          entry.season ?? null,
          entry.seasonYear ?? null,
          entry.genres?.length ? JSON.stringify(entry.genres) : null,
          entry.description ?? null,
          entry.averageScore ?? null
        );

        // Restore user-set fields
        const saved = userFieldMap.get(trackerId);
        if (saved && (saved.alt_title || saved.download_path || saved.notes)) {
          db.prepare(
            `UPDATE anime SET alt_title = ?, download_path = ?, notes = ? WHERE ${trackerIdCol} = ?`
          ).run(saved.alt_title ?? null, saved.download_path ?? null, saved.notes ?? null, trackerId);
        }

        synced++;
        if (wasExisting) { updated++; } else { newCount++; }
      }
    });

    importAll();

    // Cache cover images in the background
    const coverUrls = entries
      .map(e => e.coverImage)
      .filter((u): u is string => Boolean(u));

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
