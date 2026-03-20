import { Router, Request, Response } from "express";
import { getDb } from "../db.js";
import { AniListTracker } from "../tracker/anilist.js";

const router = Router();
const tracker = new AniListTracker();

// ─── GET /api/browse/season ───────────────────────────────────────────────────
// Fetch anime airing in a specific season from AniList

router.get("/season", async (req: Request, res: Response) => {
  const { season, year } = req.query;

  if (!season || !year) {
    res.status(400).json({ error: "season and year are required" });
    return;
  }

  const validSeasons = ["WINTER", "SPRING", "SUMMER", "FALL"];
  if (!validSeasons.includes(String(season).toUpperCase())) {
    res.status(400).json({ error: "Invalid season" });
    return;
  }

  const yearNum = parseInt(String(year), 10);
  if (isNaN(yearNum) || yearNum < 1990 || yearNum > 2030) {
    res.status(400).json({ error: "Invalid year" });
    return;
  }

  try {
    const results = await tracker.getSeasonAnime(String(season).toUpperCase(), yearNum);
    res.json(results);
  } catch (e) {
    console.error("[browse] Season fetch failed:", e);
    res.status(500).json({ error: e instanceof Error ? e.message : "Failed to fetch season" });
  }
});

// ─── POST /api/browse/add ─────────────────────────────────────────────────────
// Add an anime from browse to the local library

router.post("/add", async (req: Request, res: Response) => {
  const { anilistId, status = 'PLANNING' } = req.body;

  if (!anilistId) {
    res.status(400).json({ error: "anilistId is required" });
    return;
  }

  const db = getDb();

  // Check if already exists
  const existing = db.prepare("SELECT * FROM anime WHERE anilist_id = ?").get(anilistId);
  if (existing) {
    res.json(existing);
    return;
  }

  try {
    // Fetch full details from AniList
    const detail = await tracker.getAnime(String(anilistId));

    const now = new Date().toISOString();
    const result = db.prepare(`
      INSERT INTO anime (
        anilist_id, title_romaji, title_english, title_native,
        cover_image, banner_image, status, score, progress,
        total_episodes, format, season, season_year, genres,
        description, average_score, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      anilistId,
      detail.titleRomaji,
      detail.titleEnglish ?? null,
      detail.titleNative ?? null,
      detail.coverImage ?? null,
      detail.bannerImage ?? null,
      status,
      detail.totalEpisodes ?? null,
      detail.format ?? null,
      detail.season ?? null,
      detail.seasonYear ?? null,
      JSON.stringify(detail.genres ?? []),
      detail.description ?? null,
      detail.averageScore ?? null,
      now,
      now,
    );

    const added = db.prepare("SELECT * FROM anime WHERE id = ?").get(result.lastInsertRowid);
    console.log(`[browse] Added anime: ${detail.titleRomaji}`);
    res.json(added);
  } catch (e) {
    console.error("[browse] Add failed:", e);
    res.status(500).json({ error: e instanceof Error ? e.message : "Failed to add anime" });
  }
});

export default router;
