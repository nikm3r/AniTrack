import { Router, Request, Response } from "express";
import { syncEngine } from "../sync/syncEngine.js";
import { getDb } from "../db.js";

const router = Router();

// POST /api/sync/join
router.post("/join", (req: Request, res: Response) => {
  const { roomId, username } = req.body;
  if (!roomId || !username) {
    res.status(400).json({ error: "roomId and username are required" });
    return;
  }

  const db = getDb();
  const hubUrlRow = db.prepare("SELECT value FROM settings WHERE key = 'hub_url'").get() as { value: string } | undefined;
  const hubUrl = hubUrlRow?.value || "https://anitrack-hub.onrender.com";

  syncEngine.join(username, roomId, hubUrl, (status) => {
    // Status updates are polled via /api/sync/status
  });

  res.json({ ok: true, roomId, username, hubUrl });
});

// POST /api/sync/leave
router.post("/leave", (_req: Request, res: Response) => {
  syncEngine.leave();
  res.json({ ok: true });
});

// GET /api/sync/status
router.get("/status", (_req: Request, res: Response) => {
  res.json(syncEngine.getStatus());
});

export default router;
