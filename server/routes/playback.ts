import { Router, Request, Response } from "express";
import { spawn, ChildProcess } from "child_process";
import path from "path";
import fs from "fs";
import { getDb } from "../db.js";

const router = Router();

interface PlaybackSession {
  animeId: number;
  episode: number | null;
  filePath: string;
  forSync: boolean;
  startedAt: number;
  trackAfterMs: number;
  tracked: boolean;
  secondsRemaining: number;
  process: ChildProcess | null;
  trackTimer: ReturnType<typeof setTimeout> | null;
  tickInterval: ReturnType<typeof setInterval> | null;
}

let session: PlaybackSession | null = null;

function clearSession() {
  if (session?.trackTimer) clearTimeout(session.trackTimer);
  if (session?.tickInterval) clearInterval(session.tickInterval);
  session = null;
}

function guessEpisode(filename: string): number | null {
  const patterns = [
    /[Ee][Pp]?(\d{1,3})/,
    / - (\d{2,3})[\s\[.]/,
    /\s(\d{2,3})[\s\[.]/,
    /_(\d{2,3})[_\[.]/,
  ];
  for (const re of patterns) {
    const m = path.basename(filename).match(re);
    if (m) return parseInt(m[1], 10);
  }
  return null;
}

function findPlayer(): { exe: string; args: (filePath: string) => string[] } | null {
  const db = getDb();

  // Check for custom player path in settings first
  const playerPathRow = db.prepare("SELECT value FROM settings WHERE key = 'player_path'").get() as { value: string } | undefined;
  const playerModeRow = db.prepare("SELECT value FROM settings WHERE key = 'player_mode'").get() as { value: string } | undefined;

  const customPath = playerPathRow?.value?.trim();
  const playerMode = playerModeRow?.value?.trim() || "mpv";

  // If user set a custom path, use it directly
  if (customPath && fs.existsSync(customPath)) {
    const isVlc = customPath.toLowerCase().includes("vlc");
    return {
      exe: customPath,
      args: isVlc ? (f: string) => [f] : (f: string) => ["--no-terminal", "--force-window=yes", f],
    };
  }

  // Build candidate list based on player_mode setting
  const mpvCandidates = [
    "mpv",
    "/usr/local/bin/mpv",
    "/opt/homebrew/bin/mpv",
    "/usr/bin/mpv",
    "C:\\Program Files\\mpv\\mpv.exe",
    "/Applications/mpv.app/Contents/MacOS/mpv",
  ];

  const vlcCandidates = [
    "vlc",
    "/usr/bin/vlc",
    "/usr/local/bin/vlc",
    "/Applications/VLC.app/Contents/MacOS/VLC",
    "C:\\Program Files\\VideoLAN\\VLC\\vlc.exe",
    "C:\\Program Files (x86)\\VideoLAN\\VLC\\vlc.exe",
  ];

  // Try preferred player first, then fallback
  const ordered = playerMode === "vlc"
    ? [
        { paths: vlcCandidates, args: (f: string) => [f] },
        { paths: mpvCandidates, args: (f: string) => ["--no-terminal", "--force-window=yes", f] },
      ]
    : [
        { paths: mpvCandidates, args: (f: string) => ["--no-terminal", "--force-window=yes", f] },
        { paths: vlcCandidates, args: (f: string) => [f] },
      ];

  for (const candidate of ordered) {
    for (const p of candidate.paths) {
      try {
        if (path.isAbsolute(p)) {
          if (fs.existsSync(p)) return { exe: p, args: candidate.args };
        } else {
          // Non-absolute — try via PATH, will fail at spawn if not found
          return { exe: p, args: candidate.args };
        }
      } catch { /* not found, try next */ }
    }
  }
  return null;
}

// ─── POST /api/playback/launch ────────────────────────────────────────────────

router.post("/launch", async (req: Request, res: Response) => {
  const { animeId, filePath, forSync = false, trackingDelaySecs = 180 } = req.body;

  if (!animeId || !filePath) {
    res.status(400).json({ error: "animeId and filePath are required" });
    return;
  }

  const db = getDb();
  const anime = db.prepare("SELECT * FROM anime WHERE id = ?").get(animeId) as
    | { id: number; progress: number; total_episodes: number | null; status: string }
    | undefined;

  if (!anime) {
    res.status(404).json({ error: "Anime not found" });
    return;
  }

  if (!fs.existsSync(filePath)) {
    res.status(400).json({ error: `File not found: ${filePath}` });
    return;
  }

  if (session) {
    try { session.process?.kill(); } catch { /* ignore */ }
    clearSession();
  }

  const player = findPlayer();
  if (!player) {
    res.status(500).json({
      error: "No supported video player found. Please install MPV or VLC, or set a custom player path in Settings.",
    });
    return;
  }

  const episode = guessEpisode(filePath);
  const trackAfterMs = Math.max(30, trackingDelaySecs) * 1000;

  let proc: ChildProcess | null = null;
  try {
    proc = spawn(player.exe, player.args(filePath), {
      detached: true,
      stdio: "ignore",
    });
    proc.unref();

    // Catch spawn errors (player not found in PATH)
    proc.on("error", (err) => {
      console.error(`[playback] Player spawn error: ${err.message}`);
      clearSession();
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: `Failed to launch player: ${msg}` });
    return;
  }

  session = {
    animeId,
    episode,
    filePath,
    forSync,
    startedAt: Date.now(),
    trackAfterMs,
    tracked: false,
    secondsRemaining: trackingDelaySecs,
    process: proc,
    trackTimer: null,
    tickInterval: null,
  };

  session.tickInterval = setInterval(() => {
    if (!session) return;
    session.secondsRemaining = Math.max(
      0,
      Math.round((trackAfterMs - (Date.now() - session.startedAt)) / 1000)
    );
  }, 1000);

  session.trackTimer = setTimeout(async () => {
    if (!session || session.animeId !== animeId) return;
    try {
      const currentEp = session.episode;
      if (currentEp != null) {
        const newProgress = Math.max(anime.progress, currentEp);
        await fetch(`http://localhost:3000/api/anime/${animeId}/progress`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ progress: newProgress }),
        });
        try {
          await fetch(`http://localhost:3000/api/anime/${animeId}/episodes/${currentEp}/watch`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ watched: true }),
          });
        } catch { /* episode row may not exist */ }
      }
      session.tracked = true;
      session.secondsRemaining = 0;
      console.log(`[playback] Tracked anime ${animeId} ep ${episode ?? "?"} after ${trackingDelaySecs}s`);

      const ioReq = req as Request & { io?: { to: (r: string) => { emit: (e: string, d: unknown) => void } } };
      if (ioReq.io) {
        ioReq.io.to(`anime:${animeId}`).emit("progress:updated", { animeId, episode: currentEp, progress: currentEp });
      }
    } catch (e) {
      console.error("[playback] Tracking failed:", e);
    }
  }, trackAfterMs);

  proc.on("close", () => {
    console.log(`[playback] Player exited for anime ${animeId}`);
    setTimeout(() => {
      if (session?.animeId === animeId) clearSession();
    }, 10_000);
  });

  res.json({ launched: true, player: player.exe, animeId, episode, filePath, trackAfterSecs: trackingDelaySecs });
});

// ─── GET /api/playback/status ─────────────────────────────────────────────────

router.get("/status", (_req: Request, res: Response) => {
  if (!session) { res.json({ active: false }); return; }
  res.json({
    active: true,
    animeId: session.animeId,
    episode: session.episode,
    filePath: session.filePath,
    forSync: session.forSync,
    tracked: session.tracked,
    secondsRemaining: session.secondsRemaining,
    elapsedSecs: Math.round((Date.now() - session.startedAt) / 1000),
  });
});

// ─── POST /api/playback/stop ──────────────────────────────────────────────────

router.post("/stop", (_req: Request, res: Response) => {
  if (!session) { res.json({ stopped: false, reason: "No active session" }); return; }
  try { session.process?.kill(); } catch { /* ignore */ }
  clearSession();
  res.json({ stopped: true });
});

export default router;
