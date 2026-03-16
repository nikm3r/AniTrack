import { Router, Request, Response } from "express";
import { getDb, type Episode } from "../db.js";

const router = Router({ mergeParams: true });

// ─── GET /api/anime/:animeId/episodes ─────────────────────────────────────────

router.get("/", (req: Request, res: Response) => {
  const db = getDb();
  const { animeId } = req.params;

  const rows = db
    .prepare(
      "SELECT * FROM episodes WHERE anime_id = ? ORDER BY episode_number ASC"
    )
    .all(animeId) as Episode[];

  res.json({ data: rows });
});

// ─── POST /api/anime/:animeId/episodes ────────────────────────────────────────

router.post("/", (req: Request, res: Response) => {
  const db = getDb();
  const animeId = parseInt(req.params.animeId, 10);

  const { episode_number, title, air_date, watched = false, file_path } =
    req.body;

  if (typeof episode_number !== "number") {
    res.status(400).json({ error: "episode_number is required" });
    return;
  }

  try {
    const result = db
      .prepare(`
        INSERT INTO episodes (anime_id, episode_number, title, air_date, watched, file_path)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(
        animeId,
        episode_number,
        title ?? null,
        air_date ?? null,
        watched ? 1 : 0,
        file_path ?? null
      );

    const created = db
      .prepare("SELECT * FROM episodes WHERE id = ?")
      .get(result.lastInsertRowid) as Episode;
    res.status(201).json(created);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("UNIQUE")) {
      res.status(409).json({ error: "Episode already exists" });
    } else {
      res.status(500).json({ error: msg });
    }
  }
});

// ─── PATCH /api/anime/:animeId/episodes/:epNum/watch ──────────────────────────

router.patch("/:epNum/watch", (req: Request, res: Response) => {
  const db = getDb();
  const animeId = parseInt(req.params.animeId, 10);
  const epNum = parseInt(req.params.epNum, 10);
  const { watched = true } = req.body;

  const ep = db
    .prepare(
      "SELECT * FROM episodes WHERE anime_id = ? AND episode_number = ?"
    )
    .get(animeId, epNum) as Episode | undefined;

  if (!ep) {
    res.status(404).json({ error: "Episode not found" });
    return;
  }

  db.prepare(
    `UPDATE episodes SET watched = ?, watched_at = ? WHERE anime_id = ? AND episode_number = ?`
  ).run(watched ? 1 : 0, watched ? new Date().toISOString() : null, animeId, epNum);

  // Sync anime progress: count watched episodes
  const watchedCount = (
    db
      .prepare(
        "SELECT COUNT(*) as cnt FROM episodes WHERE anime_id = ? AND watched = 1"
      )
      .get(animeId) as { cnt: number }
  ).cnt;

  db.prepare(
    "UPDATE anime SET progress = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(watchedCount, animeId);

  const updated = db
    .prepare(
      "SELECT * FROM episodes WHERE anime_id = ? AND episode_number = ?"
    )
    .get(animeId, epNum) as Episode;
  res.json(updated);
});

// ─── DELETE /api/anime/:animeId/episodes/:epNum ───────────────────────────────

router.delete("/:epNum", (req: Request, res: Response) => {
  const db = getDb();
  const result = db
    .prepare(
      "DELETE FROM episodes WHERE anime_id = ? AND episode_number = ?"
    )
    .run(req.params.animeId, req.params.epNum);

  if (result.changes === 0) {
    res.status(404).json({ error: "Episode not found" });
    return;
  }

  res.status(204).send();
});

// ─── POST /api/anime/:animeId/episodes/bulk ───────────────────────────────────
// Bulk upsert episodes (used when syncing from AniList)

router.post("/bulk", (req: Request, res: Response) => {
  const db = getDb();
  const animeId = parseInt(req.params.animeId, 10);
  const { episodes } = req.body;

  if (!Array.isArray(episodes)) {
    res.status(400).json({ error: "episodes must be an array" });
    return;
  }

  const upsert = db.prepare(`
    INSERT INTO episodes (anime_id, episode_number, title, air_date)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(anime_id, episode_number) DO UPDATE SET
      title = excluded.title,
      air_date = excluded.air_date
  `);

  const upsertMany = db.transaction(
    (eps: { episode_number: number; title?: string; air_date?: string }[]) => {
      for (const ep of eps) {
        upsert.run(animeId, ep.episode_number, ep.title ?? null, ep.air_date ?? null);
      }
    }
  );

  try {
    upsertMany(episodes);
    const all = db
      .prepare(
        "SELECT * FROM episodes WHERE anime_id = ? ORDER BY episode_number ASC"
      )
      .all(animeId) as Episode[];
    res.json({ data: all, count: all.length });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

export default router;
