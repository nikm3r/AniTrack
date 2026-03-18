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
interface RoomData {
  playlist: PlaylistItem[];
  currentIndex: number;
  readyUsers: Record<string, boolean>;
  users: string[];
}
interface ChatMessage { sender: string; text: string; system?: boolean; }
interface SyncState { position: number; paused: boolean; }
interface Props { anime: Anime[]; settings: any; }

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
  const [syncState, setSyncState] = useState<SyncState>({ position: 0, paused: true });
  const [localPosition, setLocalPosition] = useState<number | null>(null);
  const [playerConnected, setPlayerConnected] = useState(false);
  const [syncDiff, setSyncDiff] = useState<number | null>(null);

  const socketRef = useRef<Socket | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const nicknameRef = useRef("");
  const roomIdRef = useRef("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const syncStateRef = useRef<SyncState>({ position: 0, paused: true });

  const hubUrl = settings?.hub_url || "https://anitrack-hub.onrender.com";
  const myName = nickname || settings?.nickname || "Guest";
  const isReady = roomData.readyUsers?.[myName] || false;
  const readyCount = Object.values(roomData.readyUsers ?? {}).filter(Boolean).length;
  const totalUsers = Object.keys(roomData.readyUsers ?? {}).length || 1;

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  // Keep syncStateRef in sync with state
  useEffect(() => { syncStateRef.current = syncState; }, [syncState]);

  // ── Player polling loop ──────────────────────────────────────────────────────
  // Every 1s: get local player position, report to hub, apply hub commands

  const startPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);

    pollRef.current = setInterval(async () => {
      if (!socketRef.current?.connected) return;

      try {
        const res = await api.post<{ ok: boolean; status: any }>("/api/playback/sync-control", { action: "getStatus" });
        if (res.ok && res.status) {
          const { position, paused } = res.status;
          setLocalPosition(position);
          setPlayerConnected(true);

          // Report to hub
          socketRef.current?.emit("player-status", {
            roomId: roomIdRef.current,
            user: nicknameRef.current,
            position,
            paused,
          });

          // Calculate sync diff
          const auth = syncStateRef.current;
          setSyncDiff(Math.abs(position - auth.position));
        } else {
          setPlayerConnected(false);
        }
      } catch {
        setPlayerConnected(false);
      }
    }, 1000);
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
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

    socket.on("message", (msg: ChatMessage) => setMessages(prev => [...prev, msg]));

    // Hub's authoritative sync state changed (someone played/paused/seeked)
    socket.on("sync-state", (state: SyncState) => {
      setSyncState(state);
      syncStateRef.current = state;
    });

    // Hub tells this specific client to sync up
    socket.on("sync-command", async ({ target, position, paused }: { target: string; position: number; paused: boolean }) => {
      if (target !== nicknameRef.current) return;
      try {
        await api.post("/api/playback/sync-control", { action: "seekAndPlay", position });
        if (paused) {
          await api.post("/api/playback/sync-control", { action: "setPaused", paused: true });
        }
      } catch {
        // Player may not be running
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
          setMessages(prev => [...prev, {
            sender: "system",
            text: `Launched ${animeData.title?.romaji || "episode"} Ep ${target.epNum}`,
            system: true,
          }]);
        }
      } catch (e) {
        console.error("[sync] Auto-launch failed:", e);
      }
    });

    return () => {
      stopPolling();
      socket.disconnect();
      (window as any).__syncSocket = null;
      socketRef.current = null;
      setConnected(false);
    };
  }, [isJoined, hubUrl, startPolling, stopPolling]);

  // ── Load local file cache for queue items ────────────────────────────────────

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
    socketRef.current?.disconnect();
    setIsJoined(false);
    setRoomData({ playlist: [], currentIndex: 0, readyUsers: {}, users: [] });
    setMessages([]);
    setSyncState({ position: 0, paused: true });
    setLocalPosition(null);
    setPlayerConnected(false);
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

  // Manual play/pause/seek — broadcast to hub which then reconciles everyone
  const handlePlay = async () => {
    try {
      const res = await api.post<{ ok: boolean; status: any }>("/api/playback/sync-control", { action: "getStatus" });
      const pos = res.status?.position ?? syncState.position;
      socketRef.current?.emit("sync-play", { roomId, position: pos });
      await api.post("/api/playback/sync-control", { action: "setPaused", paused: false });
    } catch {}
  };

  const handlePause = async () => {
    try {
      const res = await api.post<{ ok: boolean; status: any }>("/api/playback/sync-control", { action: "getStatus" });
      const pos = res.status?.position ?? syncState.position;
      socketRef.current?.emit("sync-pause", { roomId, position: pos });
      await api.post("/api/playback/sync-control", { action: "setPaused", paused: true });
    } catch {}
  };

  const hasFile = (mediaId: number, epNum: number): boolean => {
    const files = localFileCache[mediaId] || [];
    return files.some((f: any) => guessEpisode(f.name) === epNum);
  };

  const inSync = syncDiff !== null && syncDiff < 2.5;

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

        {/* Sync status bar */}
        {playerConnected && localPosition !== null && (
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold border ${
            inSync
              ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
              : "bg-amber-500/10 border-amber-500/20 text-amber-400"
          }`}>
            <Radio className="w-3 h-3" />
            {inSync ? `In sync · ${formatTime(localPosition)}` : `Syncing… ${syncDiff !== null ? `${syncDiff.toFixed(1)}s off` : ""}`}
          </div>
        )}

        <div className="flex-1" />

        {/* Play / Pause controls */}
        {playerConnected && (
          <div className="flex gap-2">
            <button onClick={handlePause}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 border border-white/5 text-zinc-400 hover:text-zinc-200 text-xs font-bold transition-all">
              ⏸ Pause All
            </button>
            <button onClick={handlePlay}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500 text-black text-xs font-bold hover:bg-emerald-400 transition-all">
              ▶ Play All
            </button>
          </div>
        )}

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
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center font-mono text-xs font-bold flex-shrink-0 ${
                    isCurrent ? "bg-emerald-500 text-black" : "bg-zinc-800 text-zinc-500"
                  }`}>{idx + 1}</div>
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

          {/* Users list */}
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

          {/* Chat */}
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
