import { Router, Request, Response } from "express";
import { getDb, touchUpdatedAt, type Anime } from "../db.js";
import { AniListTracker } from "../tracker/anilist.js";

const router = Router();

// ─── GET /api/anime ──────────────────────────────────────────────────────────
// Query params: status, format, search, page, limit

router.get("/", (req: Request, res: Response) => {
  const db = getDb();
  const { status, format, search, page = "1", limit = "50" } = req.query;

  let sql = "SELECT * FROM anime WHERE 1=1";
  const params: (string | number)[] = [];

  if (status) {
    sql += " AND status = ?";
    params.push(String(status));
  }
  if (format) {
    sql += " AND format = ?";
    params.push(String(format));
  }
  if (search) {
    sql +=
      " AND (title_romaji LIKE ? OR title_english LIKE ? OR title_native LIKE ? OR alt_title LIKE ?)";
    const like = `%${search}%`;
    params.push(like, like, like, like);
  }

  sql += " ORDER BY updated_at DESC";

  const pageNum = Math.max(1, parseInt(String(page), 10));
  const limitNum = Math.max(1, parseInt(String(limit), 10));
  const offset = (pageNum - 1) * limitNum;
  sql += " LIMIT ? OFFSET ?";
  params.push(limitNum, offset);

  const rows = db.prepare(sql).all(...params) as Anime[];

  const anime = rows.map((a) => ({
    ...a,
    genres: a.genres ? JSON.parse(a.genres) : [],
  }));

  res.json({ data: anime, page: pageNum, limit: limitNum });
});

// ─── GET /api/anime/:id ───────────────────────────────────────────────────────

router.get("/:id", (req: Request, res: Response) => {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM anime WHERE id = ?")
    .get(req.params.id) as Anime | undefined;

  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  res.json({ ...row, genres: row.genres ? JSON.parse(row.genres) : [] });
});

// ─── POST /api/anime ──────────────────────────────────────────────────────────

router.post("/", (req: Request, res: Response) => {
  const db = getDb();
  const {
    anilist_id,
    mal_id,
    title_romaji,
    title_english,
    title_native,
    cover_image,
    banner_image,
    status = "PLANNING",
    score,
    progress = 0,
    total_episodes,
    format,
    season,
    season_year,
    genres,
    description,
    average_score,
    alt_title,
    download_path,
    notes,
    started_at,
    completed_at,
  } = req.body;

  if (!title_romaji) {
    res.status(400).json({ error: "title_romaji is required" });
    return;
  }

  const stmt = db.prepare(`
    INSERT INTO anime (
      anilist_id, mal_id, title_romaji, title_english, title_native,
      cover_image, banner_image, status, score, progress, total_episodes,
      format, season, season_year, genres, description, average_score,
      alt_title, download_path, notes, started_at, completed_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `);

  try {
    const result = stmt.run(
      anilist_id ?? null,
      mal_id ?? null,
      title_romaji,
      title_english ?? null,
      title_native ?? null,
      cover_image ?? null,
      banner_image ?? null,
      status,
      score ?? null,
      progress,
      total_episodes ?? null,
      format ?? null,
      season ?? null,
      season_year ?? null,
      genres ? JSON.stringify(genres) : null,
      description ?? null,
      average_score ?? null,
      alt_title ?? null,
      download_path ?? null,
      notes ?? null,
      started_at ?? null,
      completed_at ?? null
    );

    const created = db
      .prepare("SELECT * FROM anime WHERE id = ?")
      .get(result.lastInsertRowid) as Anime;
    res.status(201).json({
      ...created,
      genres: created.genres ? JSON.parse(created.genres) : [],
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("UNIQUE")) {
      res.status(409).json({ error: "Anime already exists in library" });
    } else {
      res.status(500).json({ error: msg });
    }
  }
});

// ─── PATCH /api/anime/:id ─────────────────────────────────────────────────────

router.patch("/:id", (req: Request, res: Response) => {
  const db = getDb();
  const id = parseInt(req.params.id, 10);

  const existing = db
    .prepare("SELECT * FROM anime WHERE id = ?")
    .get(id) as Anime | undefined;
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const allowed = [
    "status",
    "score",
    "progress",
    "notes",
    "alt_title",          // ← Phase 3: alternative title for torrent search
    "download_path",
    "started_at",
    "completed_at",
    "title_romaji",
    "title_english",
    "cover_image",
    "banner_image",
    "total_episodes",
    "genres",
    "description",
    "average_score",
  ];

  const updates: string[] = [];
  const values: (string | number | null)[] = [];

  for (const key of allowed) {
    if (key in req.body) {
      updates.push(`${key} = ?`);
      values.push(
        key === "genres" && Array.isArray(req.body[key])
          ? JSON.stringify(req.body[key])
          : req.body[key] ?? null
      );
    }
  }

  if (updates.length === 0) {
    res.status(400).json({ error: "No valid fields to update" });
    return;
  }

  updates.push("updated_at = datetime('now')");
  values.push(id);

  db.prepare(`UPDATE anime SET ${updates.join(", ")} WHERE id = ?`).run(
    ...values
  );

  const updated = db
    .prepare("SELECT * FROM anime WHERE id = ?")
    .get(id) as Anime;
  res.json({
    ...updated,
    genres: updated.genres ? JSON.parse(updated.genres) : [],
  });
});

// ─── DELETE /api/anime/:id ────────────────────────────────────────────────────

router.delete("/:id", (req: Request, res: Response) => {
  const db = getDb();
  const result = db
    .prepare("DELETE FROM anime WHERE id = ?")
    .run(req.params.id);

  if (result.changes === 0) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  res.status(204).send();
});


// ─── PATCH /api/anime/:id/score ──────────────────────────────────────────────

router.patch("/:id/score", async (req: Request, res: Response) => {
  const db = getDb();
  const id = parseInt(req.params.id, 10);
  const { score } = req.body;

  if (typeof score !== "number" || score < 0 || score > 10) {
    res.status(400).json({ error: "score must be a number between 0 and 10" });
    return;
  }

  const anime = db.prepare("SELECT * FROM anime WHERE id = ?").get(id) as any;
  if (!anime) { res.status(404).json({ error: "Not found" }); return; }

  // Update local DB
  db.prepare("UPDATE anime SET score = ?, updated_at = datetime('now') WHERE id = ?").run(score, id);

  // Push to AniList in background
  if (anime.anilist_id) {
    const tokenRow = db.prepare("SELECT value FROM settings WHERE key = 'anilist_token'").get() as { value: string } | undefined;
    if (tokenRow?.value) {
      const { AniListTracker } = await import("../tracker/anilist.js");
      const tracker = new AniListTracker();
      tracker.updateScore(tokenRow.value, String(anime.anilist_id), score)
        .then(() => console.log(`[anime] Score synced to AniList: ${anime.title_romaji} -> ${score}`))
        .catch(e => console.error("[anime] AniList score sync failed:", e));
    }
  }

  res.json({ ok: true, score });
});

// ─── PATCH /api/anime/:id/progress ───────────────────────────────────────────

router.patch("/:id/progress", (req: Request, res: Response) => {
  const db = getDb();
  const id = parseInt(req.params.id, 10);
  const { progress, status, forceAnilistUpdate = false } = req.body;

  if (typeof progress !== "number" || progress < 0) {
    res.status(400).json({ error: "progress must be a non-negative number" });
    return;
  }

  const existing = db
    .prepare("SELECT * FROM anime WHERE id = ?")
    .get(id) as Anime | undefined;
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  let newStatus = status ?? existing.status;

  // Auto-transition status based on progress
  if (progress === 0 && newStatus === "WATCHING") {
    newStatus = "PLANNING";
  } else if (
    existing.total_episodes &&
    progress >= existing.total_episodes &&
    newStatus === "WATCHING"
  ) {
    newStatus = "COMPLETED";
  } else if (progress > 0 && newStatus === "PLANNING") {
    newStatus = "WATCHING";
  }

  db.prepare(
    "UPDATE anime SET progress = ?, status = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(progress, newStatus, id);

  const updated = db
    .prepare("SELECT * FROM anime WHERE id = ?")
    .get(id) as Anime;

  // Push progress update to AniList in the background
  if (updated.anilist_id) {
    const tokenRow = db
      .prepare("SELECT value FROM settings WHERE key = 'anilist_token'")
      .get() as { value: string } | undefined;
    const autoUpdate = db
      .prepare("SELECT value FROM settings WHERE key = 'auto_update_tracker'")
      .get() as { value: string } | undefined;

    if (tokenRow?.value && autoUpdate?.value !== "false") {
      const tracker = new AniListTracker();
      tracker
        .updateProgress(tokenRow.value, String(updated.anilist_id), updated.progress, updated.status)
        .then(() => console.log(`[anime] AniList updated: anime ${updated.anilist_id} -> ep ${updated.progress}`))
        .catch((e) => console.error("[anime] AniList progress update failed:", e));
    }
  }

  res.json({
    ...updated,
    genres: updated.genres ? JSON.parse(updated.genres) : [],
  });
});

export default router;
