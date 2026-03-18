import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Globe, MonitorPlay, MessageSquare, Send, UserCheck,
  Trash2, RotateCcw, CheckCircle2, XCircle, Users,
  Play, Wifi, WifiOff, LogOut, Radio,
} from "lucide-react";
import { io, Socket } from "socket.io-client";
import { api } from "../api";
import type { Anime } from "../types/anime";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PlaylistItem { mediaId: number; title: string; epNum: number; }
interface RoomData { playlist: PlaylistItem[]; currentIndex: number; readyUsers: Record<string, boolean>; users: string[]; }
interface ChatMessage { sender: string; text: string; system?: boolean; }
interface Props { anime: Anime[]; settings: any; }

// ─── Sync constants (mirrors Syncplay) ────────────────────────────────────────

const SEEK_THRESHOLD = 1.0;          // seconds — both player and global must differ by this to count as a seek
const REWIND_THRESHOLD = 4.0;        // seconds ahead — force seek back
const SLOWDOWN_THRESHOLD = 1.5;      // seconds ahead — slow down playback rate
const SLOWDOWN_RESET_THRESHOLD = 0.1;// seconds — resume normal speed
const SLOWDOWN_RATE = 0.95;          // playback rate when slowing down
const POLL_INTERVAL = 200;           // ms between player polls — fast enough for responsive sync

// ─── Helpers ──────────────────────────────────────────────────────────────────

function epLabel(n: number): string {
  return `Episode ${String(n).padStart(2, "0")}`;
}

function formatTime(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function guessEpisode(filename: string, totalEpisodes?: number | null): number | null {
  const base = filename.split("/").pop()?.split("\\").pop() || filename;
  const clean = base.replace(/\.[^.]+$/, "").replace(/\[[0-9A-Fa-f]{6,8}\]/g, "").trim();
  const patterns = [/[Ee][Pp]?(\d{1,3})/, / - (\d{2,3})[\s\[.]/, /\s(\d{2,3})[\s\[.]/, /_(\d{2,3})[_\[.]/];
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

// ─── Join screen ──────────────────────────────────────────────────────────────

function JoinScreen({ onJoin, defaultNickname }: { onJoin: (nickname: string, roomId: string) => void; defaultNickname: string }) {
  const [nickname, setNickname] = useState(() => localStorage.getItem("sync_nickname") || defaultNickname || "");
  const [roomId, setRoomId] = useState(() => localStorage.getItem("last_room_id") || "");

  const handleJoin = () => {
    if (!nickname.trim() || !roomId.trim()) return;
    localStorage.setItem("sync_nickname", nickname.trim());
    localStorage.setItem("last_room_id", roomId.trim());
    onJoin(nickname.trim(), roomId.trim());
  };

  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="w-full max-w-md bg-zinc-900/60 border border-white/5 rounded-3xl p-10 shadow-2xl">
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mb-4">
            <Globe className="w-8 h-8 text-emerald-500" />
          </div>
          <h2 className="text-2xl font-bold text-zinc-100">Sync Watch</h2>
          <p className="text-sm text-zinc-500 mt-1">Watch together with friends</p>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2">Your Nickname</label>
            <input type="text" value={nickname} onChange={e => setNickname(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleJoin()} placeholder="e.g. AnimeEnthusiast"
              className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500/60 transition-all" />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2">Room ID</label>
            <input type="text" value={roomId} onChange={e => setRoomId(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleJoin()} placeholder="e.g. FridayNightBinge"
              className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500/60 transition-all" />
          </div>
          <button onClick={handleJoin} disabled={!nickname.trim() || !roomId.trim()}
            className="w-full bg-emerald-500 text-black py-4 rounded-xl font-bold text-sm hover:bg-emerald-400 transition-all mt-2 shadow-lg shadow-emerald-500/20 disabled:opacity-40 disabled:cursor-not-allowed">
            Enter Room
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main SyncWatch ───────────────────────────────────────────────────────────

export default function SyncWatch({ anime, settings }: Props) {
  const [isJoined, setIsJoined] = useState(false);
  const [nickname, setNickname] = useState("");
  const [roomId, setRoomId] = useState("");
  const [connected, setConnected] = useState(false);
  const [roomData, setRoomData] = useState<RoomData>({ playlist: [], currentIndex: 0, readyUsers: {}, users: [] });
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [localFileCache, setLocalFileCache] = useState<Record<number, any[]>>({});
  const [playerConnected, setPlayerConnected] = useState(false);
  const [localPosition, setLocalPosition] = useState<number | null>(null);
  const [syncStatus, setSyncStatus] = useState<"synced" | "syncing" | "idle">("idle");

  const socketRef = useRef<Socket | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const nicknameRef = useRef("");
  const roomIdRef = useRef("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Sync state (mirrors Syncplay client.py) ──────────────────────────────────
  // Global state = what the server last told us (the room's authoritative state)
  // Player state = what our local player is actually doing
  const globalPosition = useRef(0);       // last known global position
  const globalPaused = useRef(true);      // last known global paused state
  const lastGlobalUpdate = useRef<number | null>(null); // wall clock of last global update
  const playerPosition = useRef(0);       // last known local player position
  const playerPaused = useRef(true);      // last known local player paused state
  const lastPlayerUpdate = useRef<number | null>(null); // wall clock of last player update
  const speedChanged = useRef(false);     // whether we've slowed down playback
  const clientIgnoringOnTheFly = useRef(0); // how many of our own state reports to ignore
  const serverIgnoringOnTheFly = useRef(0); // how many server state reports to ignore
  const positionBeforeLastSeek = useRef(0);

  const hubUrl = settings?.hub_url || "https://anitrack-hub.onrender.com";
  const myName = nickname || settings?.nickname || "Guest";
  const isReady = roomData.readyUsers?.[myName] || false;
  const readyCount = Object.values(roomData.readyUsers ?? {}).filter(Boolean).length;
  const totalUsers = Object.keys(roomData.readyUsers ?? {}).length || 1;

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  // ── Get extrapolated global position (accounts for time elapsed since last update) ──
  const getGlobalPosition = useCallback((): number => {
    if (!lastGlobalUpdate.current) return 0;
    let pos = globalPosition.current;
    if (!globalPaused.current) {
      pos += (Date.now() / 1000) - lastGlobalUpdate.current;
    }
    return pos;
  }, []);

  // ── Get extrapolated player position ────────────────────────────────────────
  const getPlayerPosition = useCallback((): number => {
    if (!lastPlayerUpdate.current) {
      return lastGlobalUpdate.current ? getGlobalPosition() : 0;
    }
    let pos = playerPosition.current;
    if (!playerPaused.current) {
      pos += (Date.now() / 1000) - lastPlayerUpdate.current;
    }
    return pos;
  }, [getGlobalPosition]);

  // ── Apply a global state update to local player (mirrors _changePlayerStateAccordingToGlobalState) ──
  const applyGlobalState = useCallback(async (position: number, paused: boolean, doSeek: boolean, setBy: string | null, messageAge: number) => {
    // Compensate for network delay — advance position by messageAge
    if (!paused) position += messageAge;

    const wasGlobalPaused = globalPaused.current;
    globalPosition.current = position;
    globalPaused.current = paused;
    lastGlobalUpdate.current = Date.now() / 1000;

    const pauseChanged = paused !== wasGlobalPaused || paused !== playerPaused.current;
    const playerPos = getPlayerPosition();
    const diff = playerPos - position; // positive = we are ahead

    // Only apply if a player is running
    try {
      const sessionRes = await api.get<{ active: boolean }>("/api/playback/status");
      if (!sessionRes.active) return;
    } catch { return; }

    // First update — just jump to position
    if (!lastPlayerUpdate.current) {
      await api.post("/api/playback/sync-control", { action: "seekAndPlay", position });
      if (paused) await api.post("/api/playback/sync-control", { action: "setPaused", paused: true });
      return;
    }

    // Explicit seek from another user — jump to their position
    if (doSeek && setBy && setBy !== myName) {
      positionBeforeLastSeek.current = playerPos;
      await api.post("/api/playback/sync-control", { action: "seek", position });
      return;
    }

    // We are too far ahead — rewind
    if (diff > REWIND_THRESHOLD && !doSeek) {
      await api.post("/api/playback/sync-control", { action: "seek", position });
      return;
    }

    // We are slightly ahead — slow down (0.95x) to drift back into sync
    // We are back in sync — restore normal speed
    if (!paused) {
      if (diff > SLOWDOWN_THRESHOLD && !speedChanged.current) {
        speedChanged.current = true;
        setSyncStatus("syncing");
        // Note: speed control requires player-specific API — skip for now, rely on rewind
      } else if (diff < SLOWDOWN_RESET_THRESHOLD && speedChanged.current) {
        speedChanged.current = false;
        setSyncStatus("synced");
      }
    }

    // Pause/unpause changed
    if (pauseChanged) {
      if (paused) {
        await api.post("/api/playback/sync-control", { action: "setPaused", paused: true });
      } else {
        await api.post("/api/playback/sync-control", { action: "setPaused", paused: false });
      }
    }
  }, [myName, getPlayerPosition]);

  // ── Determine if local player state change counts as a seek ──────────────────
  // Mirrors Syncplay: seeked = playerDiff > threshold AND globalDiff > threshold
  const determineStateChange = useCallback((pos: number, paused: boolean): { pauseChange: boolean; seeked: boolean } => {
    const pauseChange = playerPaused.current !== paused && globalPaused.current !== paused;
    const playerDiff = Math.abs(getPlayerPosition() - pos);
    const globalDiff = Math.abs(getGlobalPosition() - pos);
    const seeked = playerDiff > SEEK_THRESHOLD && globalDiff > SEEK_THRESHOLD;
    return { pauseChange, seeked };
  }, [getPlayerPosition, getGlobalPosition]);

  // ── Send our state to the hub ────────────────────────────────────────────────
  const sendState = useCallback((position: number, paused: boolean, seeked: boolean, stateChange: boolean) => {
    if (!socketRef.current?.connected) return;
    if (!stateChange && !seeked) return; // Only send on actual changes or periodically

    const doSeek = seeked;
    if (doSeek) clientIgnoringOnTheFly.current += 1;

    const payload: any = {
      roomId: roomIdRef.current,
      position,
      paused,
      doSeek,
      setBy: nicknameRef.current,
    };

    if (serverIgnoringOnTheFly.current > 0 || clientIgnoringOnTheFly.current > 0) {
      payload.ignoringOnTheFly = {};
      if (serverIgnoringOnTheFly.current > 0) {
        payload.ignoringOnTheFly.server = serverIgnoringOnTheFly.current;
        serverIgnoringOnTheFly.current = 0;
      }
      if (clientIgnoringOnTheFly.current > 0) {
        payload.ignoringOnTheFly.client = clientIgnoringOnTheFly.current;
      }
    }

    socketRef.current.emit("state", payload);
  }, []);

  // ── Player poll (runs every 1s) ───────────────────────────────────────────────
  const startPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);

    pollRef.current = setInterval(async () => {
      if (!socketRef.current?.connected) return;

      try {
        // Check if a session is active first
        const sessionRes = await api.get<{ active: boolean }>("/api/playback/status");
        if (!sessionRes.active) {
          setPlayerConnected(false);
          return;
        }

        // Get current player position and paused state
        const res = await api.post<{ ok: boolean; status: any }>("/api/playback/sync-control", { action: "getStatus" });
        if (!res.ok || !res.status) { setPlayerConnected(false); return; }

        const { position, paused } = res.status;
        setPlayerConnected(true);
        setLocalPosition(position);

        const { pauseChange, seeked } = determineStateChange(position, paused);

        // Update player state refs
        playerPosition.current = position;
        playerPaused.current = paused;
        lastPlayerUpdate.current = Date.now() / 1000;

        // Send state on every poll — at 200ms this is fine and keeps everyone in sync
        const stateChange = pauseChange || seeked;
        sendState(position, paused, seeked, true);

        // Update sync status display
        if (lastGlobalUpdate.current) {
          const diff = Math.abs(position - getGlobalPosition());
          setSyncStatus(diff < 2 ? "synced" : "syncing");
        }
      } catch {
        setPlayerConnected(false);
      }
    }, POLL_INTERVAL);
  }, [determineStateChange, sendState, getGlobalPosition]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  // ── Socket connection ────────────────────────────────────────────────────────

  useEffect(() => {
    if (!isJoined) return;

    const socket = io(hubUrl, {
      autoConnect: true,
      reconnection: true,
      reconnectionDelay: 1000,
      transports: ["polling", "websocket"],
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      socket.emit("join-room", roomIdRef.current, nicknameRef.current);
      (window as any).__syncSocket = socket;
      setMessages(prev => [...prev, { sender: "system", text: `Connected to room "${roomIdRef.current}"`, system: true }]);
      startPolling();
    });

    socket.on("disconnect", () => {
      setConnected(false);
      stopPolling();
      setMessages(prev => [...prev, { sender: "system", text: "Disconnected from hub", system: true }]);
    });

    socket.on("connect_error", () => { setConnected(false); stopPolling(); });

    socket.on("playlist-updated", (data: RoomData) => setRoomData(data));

    socket.on("message", (msg: ChatMessage) => {
      setMessages(prev => [...prev, msg]);
      // Pause on user leave (mirrors Syncplay pauseOnLeave behaviour)
      if (msg.system && msg.text?.includes("left the room")) {
        api.post("/api/playback/sync-control", { action: "setPaused", paused: true }).catch(() => {});
        api.get<{ active: boolean }>("/api/playback/status").then(res => {
          if (res.active) {
            setMessages(prev => [...prev, { sender: "system", text: "Paused — someone left the room", system: true }]);
          }
        }).catch(() => {});
      }
    });

    // ── Core: receive state from another user (mirrors handleState in protocols.py) ──
    socket.on("state", ({ position, paused, doSeek, setBy, ignoringOnTheFly }: any) => {
      // Handle ignoringOnTheFly counters
      if (ignoringOnTheFly) {
        if (ignoringOnTheFly.server !== undefined) {
          serverIgnoringOnTheFly.current = ignoringOnTheFly.server;
          clientIgnoringOnTheFly.current = 0;
        }
        if (ignoringOnTheFly.client !== undefined) {
          if (ignoringOnTheFly.client === clientIgnoringOnTheFly.current) {
            clientIgnoringOnTheFly.current = 0;
          }
        }
      }

      // Only apply if we are not ignoring
      if (clientIgnoringOnTheFly.current === 0) {
        const messageAge = 0.05; // rough network delay estimate ~50ms
        applyGlobalState(position, paused, doSeek, setBy, messageAge);
      }
    });

    // Hub tells everyone to launch a specific episode
    socket.on("auto-launch-request", async (target: { mediaId: number; epNum: number }) => {
      const animeData = anime.find(a => a.id === target.mediaId || a.anilist_id === target.mediaId);
      if (!animeData) return;
      try {
        const res = await api.get<{ files: any[] }>(`/api/files/scan/${animeData.id}`);
        const file = res.files.find((f: any) => guessEpisode(f.name) === target.epNum);
        if (file) {
          await api.post("/api/playback/launch", {
            animeId: animeData.id,
            filePath: file.fullPath,
            forSync: true,
            trackingDelaySecs: parseInt(settings?.tracking_delay || "180"),
          });
          // Reset sync state for new episode
          globalPosition.current = 0;
          globalPaused.current = true;
          lastGlobalUpdate.current = null;
          playerPosition.current = 0;
          playerPaused.current = true;
          lastPlayerUpdate.current = null;
          setMessages(prev => [...prev, {
            sender: "system",
            text: `Launching ${animeData.title?.romaji || "episode"} Ep ${target.epNum}`,
            system: true,
          }]);
        }
      } catch (e) { console.error("[sync] Auto-launch failed:", e); }
    });

    return () => {
      stopPolling();
      socket.disconnect();
      (window as any).__syncSocket = null;
      socketRef.current = null;
      setConnected(false);
    };
  }, [isJoined, hubUrl, startPolling, stopPolling, applyGlobalState]);

  // ── Load local file cache ────────────────────────────────────────────────────

  useEffect(() => {
    if (!isJoined || roomData.playlist.length === 0) return;
    const ids = [...new Set(roomData.playlist.map(p => p.mediaId))];
    ids.forEach(async (mediaId) => {
      if (localFileCache[mediaId]) return;
      const animeData = anime.find(a => a.id === mediaId || a.anilist_id === mediaId);
      if (!animeData) return;
      try {
        const res = await api.get<{ files: any[] }>(`/api/files/scan/${animeData.id}`);
        setLocalFileCache(prev => ({ ...prev, [mediaId]: res.files }));
      } catch {}
    });
  }, [roomData.playlist, isJoined]);

  // ── Handlers ─────────────────────────────────────────────────────────────────

  const handleJoin = (nick: string, room: string) => {
    nicknameRef.current = nick;
    roomIdRef.current = room;
    setNickname(nick);
    setRoomId(room);
    setIsJoined(true);
  };

  const handleLeave = () => {
    stopPolling();
    socketRef.current?.emit("leave-room", { roomId: roomIdRef.current, username: nicknameRef.current });
    socketRef.current?.disconnect();
    setIsJoined(false);
    setRoomData({ playlist: [], currentIndex: 0, readyUsers: {}, users: [] });
    setMessages([]);
    setLocalPosition(null);
    setPlayerConnected(false);
    setSyncStatus("idle");
    globalPosition.current = 0;
    globalPaused.current = true;
    lastGlobalUpdate.current = null;
    playerPosition.current = 0;
    playerPaused.current = true;
    lastPlayerUpdate.current = null;
  };

  const toggleReady = () => {
    socketRef.current?.emit("toggle-ready", { roomId, user: myName, isReady: !isReady });
  };

  const launchEpisode = (item: PlaylistItem) => {
    socketRef.current?.emit("launch-specific", { roomId, mediaId: item.mediaId, epNum: item.epNum });
  };

  const removeFromQueue = (index: number) => {
    socketRef.current?.emit("remove-from-playlist", { roomId, index });
  };

  const clearQueue = () => {
    if (!window.confirm("Clear the entire queue?")) return;
    socketRef.current?.emit("clear-playlist", { roomId });
  };

  const sendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim()) return;
    socketRef.current?.emit("message", { roomId, sender: myName, text: newMessage.trim() });
    setNewMessage("");
  };

  const hasFile = (mediaId: number, epNum: number): boolean => {
    const files = localFileCache[mediaId] || [];
    return files.some((f: any) => guessEpisode(f.name) === epNum);
  };

  if (!isJoined) {
    return <JoinScreen onJoin={handleJoin} defaultNickname={settings?.nickname || ""} />;
  }

  return (
    <div className="flex flex-col h-full min-h-0">

      {/* Header */}
      <div className="flex items-center gap-4 mb-6 flex-shrink-0">
        <h1 className="text-2xl font-bold text-zinc-100 tracking-tight">Sync Watch</h1>
        <div className="flex items-center gap-2">
          {connected
            ? <><Wifi className="w-4 h-4 text-emerald-500" /><span className="text-xs text-emerald-500 font-medium">Connected</span></>
            : <><WifiOff className="w-4 h-4 text-zinc-600" /><span className="text-xs text-zinc-600">Connecting…</span></>
          }
        </div>

        {/* Sync indicator */}
        {playerConnected && localPosition !== null && (
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold border ${
            syncStatus === "synced"
              ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
              : syncStatus === "syncing"
              ? "bg-amber-500/10 border-amber-500/20 text-amber-400"
              : "bg-zinc-800 border-white/5 text-zinc-500"
          }`}>
            <Radio className="w-3 h-3" />
            {syncStatus === "synced" && `In sync · ${formatTime(localPosition)}`}
            {syncStatus === "syncing" && `Catching up… · ${formatTime(localPosition)}`}
            {syncStatus === "idle" && formatTime(localPosition)}
          </div>
        )}

        <div className="flex-1" />
        <button onClick={handleLeave}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 border border-white/8 text-zinc-500 hover:text-zinc-300 hover:bg-white/8 transition-all text-sm">
          <LogOut className="w-4 h-4" /> Leave Room
        </button>
      </div>

      <div className="flex flex-1 gap-5 min-h-0">

        {/* Left: Queue */}
        <div className="flex-1 flex flex-col min-h-0 bg-zinc-900/40 border border-white/5 rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between flex-shrink-0">
            <div>
              <div className="flex items-center gap-2">
                <MonitorPlay className="w-4 h-4 text-emerald-500" />
                <span className="font-bold text-zinc-200">Room: {roomId}</span>
              </div>
              <div className="flex items-center gap-3 mt-2">
                <button onClick={toggleReady}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${
                    isReady ? "bg-emerald-500 text-black border-emerald-400" : "bg-zinc-800 text-zinc-400 border-white/5 hover:border-white/10"
                  }`}>
                  <UserCheck className="w-3.5 h-3.5" />
                  {isReady ? "I'm Ready!" : "Mark Ready"}
                </button>
                <span className="text-[10px] text-zinc-600 uppercase font-bold tracking-wider">{readyCount} / {totalUsers} ready</span>
              </div>
            </div>
            <button onClick={clearQueue} title="Clear queue"
              className="w-8 h-8 rounded-xl bg-zinc-800 border border-white/5 flex items-center justify-center text-zinc-500 hover:text-red-400 transition-colors">
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-2">
            {roomData.playlist.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 gap-3 text-zinc-700 border-2 border-dashed border-white/5 rounded-2xl">
                <Play className="w-8 h-8" />
                <span className="text-sm">Queue is empty</span>
                <span className="text-xs">Right-click an anime → Add to Sync Play</span>
              </div>
            ) : roomData.playlist.map((item, idx) => {
              const isCurrent = idx === roomData.currentIndex;
              return (
                <div key={idx} onClick={() => launchEpisode(item)}
                  className={`flex items-center gap-4 p-4 rounded-xl border transition-all group cursor-pointer ${
                    isCurrent ? "bg-emerald-500/8 border-emerald-500/30" : "bg-black/20 border-white/5 hover:border-white/10 opacity-60 hover:opacity-100"
                  }`}>
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center font-mono text-xs font-bold flex-shrink-0 ${isCurrent ? "bg-emerald-500 text-black" : "bg-zinc-800 text-zinc-500"}`}>
                    {idx + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm text-zinc-200 truncate">{item.title}</p>
                    <p className="text-[10px] text-zinc-600 uppercase font-bold tracking-wider mt-0.5">{epLabel(item.epNum)}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {hasFile(item.mediaId, item.epNum)
                      ? <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                      : <XCircle className="w-5 h-5 text-red-500/40" />
                    }
                    <button onClick={e => { e.stopPropagation(); removeFromQueue(idx); }}
                      className="w-7 h-7 rounded-lg hover:bg-red-500/10 text-zinc-700 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: Users + Chat */}
        <div className="w-72 flex-shrink-0 flex flex-col gap-4 min-h-0">
          <div className="bg-zinc-900/40 border border-white/5 rounded-2xl overflow-hidden flex-shrink-0">
            <div className="px-4 py-3 border-b border-white/5 flex items-center gap-2">
              <Users className="w-4 h-4 text-zinc-500" />
              <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Users</span>
            </div>
            <div className="p-3 space-y-1">
              {[myName, ...Object.keys(roomData.readyUsers ?? {}).filter(u => u !== myName)].map(user => {
                const ready = roomData.readyUsers?.[user] || false;
                const isMe = user === myName;
                return (
                  <div key={user} className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${ready ? "bg-emerald-500" : "bg-zinc-700"}`} />
                    <span className={`text-sm truncate ${isMe ? "text-zinc-200 font-medium" : "text-zinc-400"}`}>
                      {user}{isMe && <span className="text-[10px] text-zinc-600 ml-1">(you)</span>}
                    </span>
                    {ready && <span className="ml-auto text-[10px] text-emerald-500 font-bold">READY</span>}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex-1 flex flex-col bg-zinc-900/40 border border-white/5 rounded-2xl overflow-hidden min-h-0">
            <div className="px-4 py-3 border-b border-white/5 flex items-center gap-2 flex-shrink-0">
              <MessageSquare className="w-4 h-4 text-zinc-500" />
              <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Chat</span>
            </div>
            <div className="flex-1 overflow-y-auto scrollbar-thin p-3 space-y-2 min-h-0">
              {messages.length === 0 && <p className="text-xs text-zinc-700 text-center mt-4">No messages yet</p>}
              {messages.map((msg, i) => {
                if (msg.system) return (
                  <div key={i} className="text-center">
                    <span className="text-[10px] text-zinc-700 italic">{msg.text}</span>
                  </div>
                );
                const isMe = msg.sender === myName;
                return (
                  <div key={i} className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}>
                    <span className="text-[9px] font-bold text-zinc-600 uppercase mb-0.5 px-1">{msg.sender}</span>
                    <div className={`px-3 py-2 rounded-2xl text-xs max-w-[90%] ${isMe ? "bg-emerald-500 text-black font-bold" : "bg-zinc-800 text-zinc-200"}`}>
                      {msg.text}
                    </div>
                  </div>
                );
              })}
              <div ref={chatEndRef} />
            </div>
            <form onSubmit={sendMessage} className="p-3 border-t border-white/5 flex gap-2 flex-shrink-0">
              <input type="text" value={newMessage} onChange={e => setNewMessage(e.target.value)}
                placeholder="Message…"
                className="flex-1 bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500/50 transition-all" />
              <button type="submit" disabled={!newMessage.trim()}
                className="w-8 h-8 bg-emerald-500 text-black rounded-xl flex items-center justify-center hover:bg-emerald-400 transition-all disabled:opacity-40">
                <Send className="w-3.5 h-3.5" />
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
