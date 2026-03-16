import { Router, Request, Response } from "express";
import { getDb } from "../db.js";

const router = Router();

const DEFAULTS: Record<string, string> = {
  base_folder: "",
  anilist_token: "",
  anilist_client_id: "",
  mal_token: "",
  active_tracker: "anilist",
  language: "romaji",
  auto_update_tracker: "true",
  tracking_delay: "180",
  player_mode: "mpv",
  player_path: "",
  torrent_client_path: "",
  nickname: "",
  hub_url: "https://anitrack-hub.onrender.com",
};

// ─── GET /api/settings ────────────────────────────────────────────────────────

router.get("/", (_req: Request, res: Response) => {
  const db = getDb();
  const rows = db.prepare("SELECT key, value FROM settings").all() as {
    key: string; value: string;
  }[];
  const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  res.json({ ...DEFAULTS, ...stored });
});

// ─── GET /api/settings/:key ───────────────────────────────────────────────────

router.get("/:key", (req: Request, res: Response) => {
  const db = getDb();
  const row = db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(req.params.key) as { value: string } | undefined;

  if (!row) {
    const def = DEFAULTS[req.params.key];
    if (def !== undefined) {
      res.json({ key: req.params.key, value: def });
    } else {
      res.status(404).json({ error: "Setting not found" });
    }
    return;
  }
  res.json({ key: req.params.key, value: row.value });
});

// ─── PUT /api/settings/:key ───────────────────────────────────────────────────

router.put("/:key", (req: Request, res: Response) => {
  const db = getDb();
  const { value } = req.body;
  if (value === undefined || value === null) {
    res.status(400).json({ error: "value is required" });
    return;
  }
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(req.params.key, String(value));
  res.json({ key: req.params.key, value: String(value) });
});

// ─── PATCH /api/settings ─────────────────────────────────────────────────────

router.patch("/", (req: Request, res: Response) => {
  const db = getDb();
  const updates = req.body as Record<string, unknown>;

  if (!updates || typeof updates !== "object" || Array.isArray(updates)) {
    res.status(400).json({ error: "Body must be a key-value object" });
    return;
  }

  const upsert = db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  );

  const upsertMany = db.transaction((entries: [string, string][]) => {
    for (const [key, value] of entries) upsert.run(key, value);
  });

  const entries = Object.entries(updates).map(
    ([k, v]) => [k, String(v)] as [string, string]
  );
  upsertMany(entries);

  const rows = db.prepare("SELECT key, value FROM settings").all() as {
    key: string; value: string;
  }[];
  const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  res.json({ ...DEFAULTS, ...stored });
});

export default router;
