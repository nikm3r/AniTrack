import { Router, Request, Response } from "express";
import { getDb } from "../db.js";
import { AniListTracker } from "../tracker/anilist.js";
import type { TrackerSearchResult, TrackerAnimeDetail } from "../tracker/types.js";

const router = Router();

function getTracker(name: string) {
  switch (name) {
    case "anilist":
      return new AniListTracker();
    case "mal":
      // MAL slot: return new MALTracker();
      throw new Error("MAL tracker not yet implemented");
    default:
      throw new Error(`Unknown tracker: ${name}`);
  }
}

function getActiveTrackerName(): string {
  const db = getDb();
  const row = db
    .prepare("SELECT value FROM settings WHERE key = 'active_tracker'")
    .get() as { value: string } | undefined;
  return row?.value ?? "anilist";
}

// ─── GET /api/tracker/search?q=... ───────────────────────────────────────────

router.get("/search", async (req: Request, res: Response) => {
  const q = req.query.q as string;
  if (!q || q.trim().length < 2) {
    res.status(400).json({ error: "Query must be at least 2 characters" });
    return;
  }

  const trackerName = (req.query.tracker as string) || getActiveTrackerName();

  try {
    const tracker = getTracker(trackerName);
    const results: TrackerSearchResult[] = await tracker.search(q.trim());
    res.json({ data: results, tracker: trackerName });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// ─── GET /api/tracker/anime/:id ───────────────────────────────────────────────

router.get("/anime/:id", async (req: Request, res: Response) => {
  const trackerName =
    (req.query.tracker as string) || getActiveTrackerName();

  try {
    const tracker = getTracker(trackerName);
    const detail: TrackerAnimeDetail = await tracker.getAnime(req.params.id);
    res.json({ data: detail, tracker: trackerName });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// ─── POST /api/tracker/sync/:animeId ─────────────────────────────────────────
// Pull latest metadata from tracker and update local DB

router.post("/sync/:animeId", async (req: Request, res: Response) => {
  const db = getDb();
  const animeId = parseInt(req.params.animeId, 10);
  const trackerName =
    (req.body.tracker as string) || getActiveTrackerName();

  const local = db
    .prepare("SELECT * FROM anime WHERE id = ?")
    .get(animeId) as { anilist_id: number | null; mal_id: number | null } | undefined;

  if (!local) {
    res.status(404).json({ error: "Anime not found in library" });
    return;
  }

  const trackerId =
    trackerName === "anilist" ? local.anilist_id : local.mal_id;

  if (!trackerId) {
    res
      .status(400)
      .json({ error: `No ${trackerName} ID linked to this anime` });
    return;
  }

  try {
    const tracker = getTracker(trackerName);
    const detail = await tracker.getAnime(String(trackerId));

    db.prepare(`
      UPDATE anime SET
        title_romaji   = ?,
        title_english  = ?,
        title_native   = ?,
        cover_image    = ?,
        banner_image   = ?,
        total_episodes = ?,
        format         = ?,
        season         = ?,
        season_year    = ?,
        genres         = ?,
        updated_at     = datetime('now')
      WHERE id = ?
    `).run(
      detail.titleRomaji,
      detail.titleEnglish ?? null,
      detail.titleNative ?? null,
      detail.coverImage ?? null,
      detail.bannerImage ?? null,
      detail.totalEpisodes ?? null,
      detail.format ?? null,
      detail.season ?? null,
      detail.seasonYear ?? null,
      detail.genres ? JSON.stringify(detail.genres) : null,
      animeId
    );

    const updated = db.prepare("SELECT * FROM anime WHERE id = ?").get(animeId);
    res.json({ data: updated, synced: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// ─── GET /api/tracker/user-list ───────────────────────────────────────────────
// Fetch user's list from the tracker service

router.get("/user-list", async (req: Request, res: Response) => {
  const db = getDb();
  const trackerName =
    (req.query.tracker as string) || getActiveTrackerName();

  const tokenRow = db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(`${trackerName}_token`) as { value: string } | undefined;

  if (!tokenRow?.value) {
    res.status(401).json({ error: `No ${trackerName} token configured` });
    return;
  }

  try {
    const tracker = getTracker(trackerName);
    const list = await tracker.getUserList(tokenRow.value);
    res.json({ data: list, tracker: trackerName });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

export default router;
