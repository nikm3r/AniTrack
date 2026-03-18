import { Router, Request, Response } from "express";
import { spawn, ChildProcess } from "child_process";
import path from "path";
import fs from "fs";
import os from "os";
import { getDb } from "../db.js";
import {
  setActivePlayer, clearActivePlayer, getController, installVlcLua, MpvController,
} from "../sync/playerController.js";
import { io } from "../index.js";

const router = Router();

// ─── Playback session ─────────────────────────────────────────────────────────

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
  clearActivePlayer();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function guessEpisode(filename: string, totalEpisodes?: number | null): number | null {
  const base = path.basename(filename);
  const clean = base.replace(/\.[^.]+$/, "").replace(/\[[0-9A-Fa-f]{6,8}\]/g, "").trim();
  const patterns = [
    /[Ee][Pp]?(\d{1,3})/,
    / - (\d{2,3})[\s\[.]/,
    /\s(\d{2,3})[\s\[.]/,
    /_(\d{2,3})[_\[.]/,
  ];
  for (const re of patterns) {
    const m = clean.match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      if (totalEpisodes && n > totalEpisodes) continue;
      return n;
    }
  }
  return null;
}

function getSettings() {
  const db = getDb();
  const rows = db.prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

function findPlayer(): { exe: string; args: (filePath: string, forSync: boolean) => string[]; type: "mpv" | "vlc" } | null {
  const db = getDb();
  const playerPathRow = db.prepare("SELECT value FROM settings WHERE key = 'player_path'").get() as { value: string } | undefined;
  const playerModeRow = db.prepare("SELECT value FROM settings WHERE key = 'player_mode'").get() as { value: string } | undefined;

  const customPath = playerPathRow?.value?.trim();
  const playerMode = playerModeRow?.value?.trim() || "mpv";

  const ipcSocket = MpvController.getSocketPath();

  const mpvArgs = (f: string, forSync: boolean) => {
    const args = ["--no-terminal", "--force-window=yes", `--input-ipc-server=${ipcSocket}`];
    if (forSync) args.push("--pause");
    args.push(f);
    return args;
  };

  // VLC gets a random port for the syncplay lua intf
  const vlcLuaPort = 10000 + Math.floor(Math.random() * 45000);
  const vlcArgs = (f: string, forSync: boolean) => {
    const args = [
      "--extraintf=luaintf",
      "--lua-intf=syncplay",
      `--lua-config=syncplay={port="${vlcLuaPort}"}`,
      "--no-quiet",
      "--no-input-fast-seek",
    ];
    if (forSync) args.push("--start-paused");
    args.push(f);
    return args;
  };

  if (customPath && fs.existsSync(customPath)) {
    const isVlc = customPath.toLowerCase().includes("vlc");
    return isVlc
      ? { exe: customPath, args: vlcArgs, type: "vlc" }
      : { exe: customPath, args: mpvArgs, type: "mpv" };
  }

  const mpvCandidates = [
    "mpv", "/usr/local/bin/mpv", "/opt/homebrew/bin/mpv", "/usr/bin/mpv",
    "C:\\Program Files\\mpv\\mpv.exe",
    "/Applications/mpv.app/Contents/MacOS/mpv",
  ];
  const vlcCandidates = [
    "vlc", "/usr/bin/vlc", "/usr/local/bin/vlc",
    "/Applications/VLC.app/Contents/MacOS/VLC",
    "C:\\Program Files\\VideoLAN\\VLC\\vlc.exe",
    "C:\\Program Files (x86)\\VideoLAN\\VLC\\vlc.exe",
  ];

  const ordered = playerMode === "vlc"
    ? [
        { paths: vlcCandidates, args: vlcArgs, type: "vlc" as const },
        { paths: mpvCandidates, args: mpvArgs, type: "mpv" as const },
      ]
    : [
        { paths: mpvCandidates, args: mpvArgs, type: "mpv" as const },
        { paths: vlcCandidates, args: vlcArgs, type: "vlc" as const },
      ];

  for (const candidate of ordered) {
    for (const p of candidate.paths) {
      if (path.isAbsolute(p)) {
        if (fs.existsSync(p)) return { exe: p, args: candidate.args, type: candidate.type };
      } else {
        return { exe: p, args: candidate.args, type: candidate.type };
      }
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

  if (!anime) { res.status(404).json({ error: "Anime not found" }); return; }
  if (!fs.existsSync(filePath)) { res.status(400).json({ error: `File not found: ${filePath}` }); return; }

  if (session) {
    try { session.process?.kill(); } catch {}
    clearSession();
  }

  const player = findPlayer();
  if (!player) {
    res.status(500).json({ error: "No supported video player found. Please install MPV or VLC, or set a custom path in Settings." });
    return;
  }

  // Always install VLC lua interface when using VLC so sync is always ready
  if (player.type === "vlc") {
    const resourcesPath = (process as any).resourcesPath || path.join(process.cwd(), "resources");
    const installed = installVlcLua(resourcesPath, player.exe);
    console.log(`[playback] VLC lua install: ${installed ? "ok" : "failed"} (src: ${resourcesPath}, exe: ${player.exe})`);
  }

  const episode = guessEpisode(filePath, anime.total_episodes);
  const trackAfterMs = Math.max(0, trackingDelaySecs) * 1000;

  let proc: ChildProcess | null = null;
  try {
    proc = spawn(player.exe, player.args(filePath, forSync), { detached: true, stdio: "ignore" });
    proc.unref();
    proc.on("error", (err) => {
      console.error(`[playback] Player spawn error: ${err.message}`);
      clearSession();
    });
  } catch (e) {
    res.status(500).json({ error: `Failed to launch player: ${e instanceof Error ? e.message : String(e)}` });
    return;
  }

  // Always register player controller so sync-control works regardless of forSync flag
  {
    const argsStr = player.args(filePath, forSync).join(" ");
    const vlcPortMatch = argsStr.match(/port="(\d+)"/);
    const vlcPort = vlcPortMatch ? parseInt(vlcPortMatch[1]) : undefined;
    setActivePlayer(player.type, vlcPort);
  }

  session = {
    animeId, episode, filePath, forSync,
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
    session.secondsRemaining = Math.max(0, Math.round((trackAfterMs - (Date.now() - session.startedAt)) / 1000));
  }, 1000);

  session.trackTimer = setTimeout(async () => {
    if (!session || session.animeId !== animeId) return;
    try {
      const currentEp = session.episode;
      if (currentEp != null) {
        // Always update to the current episode — even if it matches existing progress
        // so AniList always gets notified
        const newProgress = Math.max(anime.progress, currentEp);
        const port = process.env.SERVER_PORT || 3000;
        await fetch(`http://localhost:${port}/api/anime/${animeId}/progress`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ progress: newProgress, forceAnilistUpdate: true }),
        });
        try {
          await fetch(`http://localhost:${port}/api/anime/${animeId}/episodes/${currentEp}/watch`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ watched: true }),
          });
        } catch {}
        // Notify frontend to update without full reload
        io.emit("progress:updated", { animeId, episode: currentEp, progress: newProgress });
        console.log(`[playback] Tracked anime ${animeId} ep ${currentEp} -> progress ${newProgress}`);
      }
      session.tracked = true;
      session.secondsRemaining = 0;
    } catch (e) {
      console.error("[playback] Tracking failed:", e);
    }
  }, trackAfterMs);

  proc.on("close", () => {
    const clearDelay = Math.max(trackAfterMs + 3000, 10_000);
    setTimeout(() => { if (session?.animeId === animeId) clearSession(); }, clearDelay);
  });

  res.json({ launched: true, player: player.exe, playerType: player.type, animeId, episode, filePath, trackAfterSecs: trackingDelaySecs });
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

// ─── POST /api/playback/sync-control ─────────────────────────────────────────
// Called by SyncWatch to control local player in response to hub commands

router.post("/sync-control", async (req: Request, res: Response) => {
  const { action, position, paused } = req.body;

  // Retry connecting a few times — player may have just launched
  let ctrl = null;
  for (let i = 0; i < 5; i++) {
    ctrl = await getController();
    if (ctrl) break;
    await new Promise(r => setTimeout(r, 800));
  }

  if (!ctrl) {
    res.status(503).json({ error: "No player connected" });
    return;
  }

  try {
    if (action === "seek" && position !== undefined) {
      await ctrl.seek(position);
    } else if (action === "setPaused" && paused !== undefined) {
      await ctrl.setPaused(paused);
    } else if (action === "seekAndPlay" && position !== undefined) {
      await ctrl.seek(position);
      await ctrl.setPaused(false);
    } else if (action === "getStatus") {
      const status = await ctrl.getStatus();
      res.json({ ok: true, status });
      return;
    } else {
      res.status(400).json({ error: "Unknown action" });
      return;
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: `Player control failed: ${e instanceof Error ? e.message : String(e)}` });
  }
});

// ─── POST /api/playback/stop ──────────────────────────────────────────────────

router.post("/stop", (_req: Request, res: Response) => {
  if (!session) { res.json({ stopped: false, reason: "No active session" }); return; }
  try { session.process?.kill(); } catch {}
  clearSession();
  res.json({ stopped: true });
});

export default router;
