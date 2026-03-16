import React, { useEffect, useRef, useState } from "react";
import {
  Play, Users, Search, Tag, FileEdit, SlidersHorizontal, ChevronRight,
  MonitorPlay, CheckCircle, PauseCircle, XCircle, BookmarkPlus, Check, X,
} from "lucide-react";
import { api } from "../api";
import type { Anime, AnimeStatus } from "../types/anime";

interface Props {
  onSearchRequest: (query: string) => void;
  x: number; y: number;
  anime: Anime;
  onClose: () => void;
  onUpdate: (updated: Partial<Anime> & { id: number }) => void;
}

interface ScannedFile { name: string; fullPath: string; size: number; }

interface Filters {
  group: string; quality: string; keywords: string; overridePath: string;
}

const STATUS_ITEMS: { value: AnimeStatus; label: string; icon: React.ReactNode }[] = [
  { value: "WATCHING",  label: "Currently Watching", icon: <MonitorPlay className="w-3.5 h-3.5" /> },
  { value: "COMPLETED", label: "Completed",          icon: <CheckCircle className="w-3.5 h-3.5" /> },
  { value: "PLANNING",  label: "Planning to Watch",  icon: <BookmarkPlus className="w-3.5 h-3.5" /> },
  { value: "PAUSED",    label: "On Hold",             icon: <PauseCircle className="w-3.5 h-3.5" /> },
  { value: "DROPPED",   label: "Dropped",             icon: <XCircle className="w-3.5 h-3.5" /> },
];

function epLabel(n: number): string {
  return `Episode ${String(n).padStart(2, "0")}`;
}

function guessEpisode(filename: string): number | null {
  const patterns = [/[Ee][Pp]?(\d{1,3})/, / - (\d{2,3})[\s\[.]/, /\s(\d{2,3})[\s\[.]/, /_(\d{2,3})[_\[.]/];
  for (const re of patterns) {
    const m = filename.match(re);
    if (m) return parseInt(m[1], 10);
  }
  return null;
}

function loadFilters(animeId: number): Filters {
  try {
    const saved = localStorage.getItem(`filters_${animeId}`);
    if (saved) return JSON.parse(saved);
  } catch { }
  return { group: "", quality: "1080p", keywords: "", overridePath: "" };
}

function saveFilters(animeId: number, filters: Filters) {
  localStorage.setItem(`filters_${animeId}`, JSON.stringify(filters));
}

export default function ContextMenu({ x, y, anime, onClose, onUpdate, onSearchRequest }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);
  const [altTitleInput, setAltTitleInput] = useState((anime as any).alt_title ?? "");
  const [showAltTitle, setShowAltTitle] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<Filters>(() => loadFilters(anime.id));
  const [files, setFiles] = useState<ScannedFile[] | null>(null);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [pos, setPos] = useState({ x, y });

  const showItem = (name: string) => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setHoveredItem(name);
  };

  const hideItem = () => {
    hideTimer.current = setTimeout(() => setHoveredItem(null), 150);
  };

  useEffect(() => {
    return () => { if (hideTimer.current) clearTimeout(hideTimer.current); };
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({
      x: x + rect.width > window.innerWidth ? x - rect.width : x,
      y: y + rect.height > window.innerHeight ? y - rect.height : y,
    });
  }, [x, y]);

  useEffect(() => {
    setLoadingFiles(true);
    api.get<{ files: ScannedFile[] }>(`/api/files/scan/${anime.id}`)
      .then(res => setFiles(res.files))
      .catch(() => setFiles([]))
      .finally(() => setLoadingFiles(false));
  }, [anime.id]);

  const sortedFiles = files
    ? [...files].sort((a, b) => (guessEpisode(a.name) ?? 999) - (guessEpisode(b.name) ?? 999))
    : [];

    const launchFile = async (filePath: string, forSync = false) => {
      if (forSync) {
        // Add to room queue via socket — do NOT launch locally
        const ep = guessEpisode(filePath.split("/").pop() || filePath);
        const socket = (window as any).__syncSocket;
        const roomId = localStorage.getItem("last_room_id");
        if (socket && roomId) {
          socket.emit("add-to-playlist", {
            roomId,
            item: { mediaId: anime.anilist_id ?? anime.id, title: anime.title_romaji, epNum: ep ?? 1 },
          });
        } else {
          alert("Join a Sync Watch room first!");
        }
      } else {
        try {
          await api.post("/api/playback/launch", {
            animeId: anime.id, filePath, trackingDelaySecs: 180,
          });
        } catch (e) { console.error("Launch failed", e); }
      }
      onClose();
    };

  const handleSetStatus = async (status: AnimeStatus) => {
    try {
      await api.patch(`/api/anime/${anime.id}`, { status });
      onUpdate({ id: anime.id, status });
    } catch (e) { console.error(e); }
    onClose();
  };

  const handleSetAltTitle = async () => {
    try {
      await api.patch(`/api/anime/${anime.id}`, { alt_title: altTitleInput });
      onUpdate({ id: anime.id, alt_title: altTitleInput } as any);
    } catch (e) { console.error(e); }
    onClose();
  };

  const handleSaveFilters = async () => {
    saveFilters(anime.id, filters);
    if (filters.overridePath !== (anime as any).download_path) {
      try {
        await api.patch(`/api/anime/${anime.id}`, { download_path: filters.overridePath || null });
        onUpdate({ id: anime.id, download_path: filters.overridePath || null });
      } catch (e) { console.error(e); }
    }
    onClose();
  };

  const handleTorrentSearch = () => {
    const f = loadFilters(anime.id);
    const title = (anime as any).alt_title || anime.title_romaji;
    const q = [title, f.group, f.quality, f.keywords].filter(Boolean).join(" ");
    onSearchRequest(q);
    onClose();
  };

  const Divider = () => <div className="h-px bg-white/5 my-1" />;

  const EpisodeFlyout = ({ forSync }: { forSync: boolean }) => {
    const key = forSync ? "sync" : "play";
    return (
      <div
        onMouseEnter={() => showItem(key)}
        onMouseLeave={hideItem}
        className="absolute left-full top-0 ml-1.5 w-64 bg-zinc-900 border border-white/10 rounded-xl shadow-2xl shadow-black/60 py-1.5 z-[902] max-h-72 overflow-y-auto scrollbar-thin"
      >
        {loadingFiles && <p className="text-xs text-zinc-600 px-4 py-2">Scanning folder…</p>}
        {!loadingFiles && sortedFiles.length === 0 && (
          <div className="px-4 py-3">
            <p className="text-xs text-zinc-500">No video files found</p>
            <p className="text-[10px] text-zinc-700 mt-1">Set your base folder in Settings first</p>
          </div>
        )}
        {sortedFiles.map((f, i) => {
          const ep = guessEpisode(f.name);
          return (
            <button key={i} onClick={() => launchFile(f.fullPath, forSync)}
              className="w-full px-4 py-2 text-left text-xs text-zinc-300 hover:bg-emerald-500/10 hover:text-emerald-400 transition-colors flex items-center gap-2">
              <Play className="w-3 h-3 flex-shrink-0" />
              {ep != null ? epLabel(ep) : f.name.slice(0, 35)}
            </button>
          );
        })}
      </div>
    );
  };

  const StatusFlyout = () => (
    <div
      onMouseEnter={() => showItem("status")}
      onMouseLeave={hideItem}
      className="absolute left-full top-0 ml-1.5 w-52 bg-zinc-900 border border-white/10 rounded-xl shadow-2xl shadow-black/60 py-1.5 z-[902]"
    >
      {STATUS_ITEMS.map(s => (
        <button key={s.value} onClick={() => handleSetStatus(s.value)}
          className={`flex items-center gap-2.5 w-full px-4 py-2.5 text-xs text-left transition-colors ${
            anime.status === s.value
              ? "text-emerald-400 bg-emerald-500/10"
              : "text-zinc-300 hover:bg-white/8 hover:text-zinc-100"
          }`}>
          <span className={anime.status === s.value ? "text-emerald-400" : "text-zinc-500"}>{s.icon}</span>
          {s.label}
          {anime.status === s.value && <Check className="w-3 h-3 ml-auto text-emerald-500" />}
        </button>
      ))}
    </div>
  );

  if (showAltTitle) {
    return (
      <>
        <div className="fixed inset-0 z-[900]" onClick={onClose} />
        <div ref={ref} style={{ left: pos.x, top: pos.y }} onClick={e => e.stopPropagation()}
          className="fixed z-[901] w-72 bg-zinc-900 border border-white/10 rounded-xl shadow-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-bold text-zinc-300">Set Alternative Title</p>
            <button onClick={onClose} className="text-zinc-600 hover:text-zinc-400"><X className="w-3.5 h-3.5" /></button>
          </div>
          <p className="text-[10px] text-zinc-600 mb-2">Used for torrent searches instead of the AniList title</p>
          <input autoFocus type="text" value={altTitleInput}
            onChange={e => setAltTitleInput(e.target.value)}
            placeholder={anime.title_romaji}
            className="w-full bg-black/50 border border-white/15 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500/50"
            onKeyDown={e => { if (e.key === "Enter") handleSetAltTitle(); if (e.key === "Escape") onClose(); }}
          />
          <div className="flex gap-2 mt-3">
            <button onClick={onClose} className="flex-1 py-2 bg-white/5 text-zinc-400 text-xs rounded-lg hover:bg-white/8 transition-colors">Cancel</button>
            <button onClick={handleSetAltTitle} className="flex-1 py-2 bg-emerald-500/15 text-emerald-400 text-xs font-medium rounded-lg hover:bg-emerald-500/25 transition-colors">Save</button>
          </div>
        </div>
      </>
    );
  }

  if (showFilters) {
    return (
      <>
        <div className="fixed inset-0 z-[900]" onClick={onClose} />
        <div ref={ref}
          style={{ left: Math.min(pos.x, window.innerWidth - 380), top: Math.min(pos.y, window.innerHeight - 400) }}
          onClick={e => e.stopPropagation()}
          className="fixed z-[901] w-96 bg-zinc-900 border border-white/10 rounded-2xl shadow-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="w-4 h-4 text-emerald-500" />
              <p className="text-sm font-bold text-zinc-200">Edit Filters</p>
            </div>
            <button onClick={onClose} className="text-zinc-600 hover:text-zinc-400"><X className="w-4 h-4" /></button>
          </div>
          <p className="text-xs text-zinc-600 mb-4 truncate">{anime.title_english || anime.title_romaji}</p>
          <div className="space-y-3">
            <div>
              <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1.5 block">Folder Override (full path)</label>
              <input type="text" value={filters.overridePath}
                onChange={e => setFilters(f => ({ ...f, overridePath: e.target.value }))}
                placeholder="Leave empty to use Base Folder / Title"
                className="w-full bg-black/50 border border-white/10 rounded-xl px-3 py-2.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500/50 font-mono" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1.5 block">Preferred Group</label>
                <input type="text" value={filters.group}
                  onChange={e => setFilters(f => ({ ...f, group: e.target.value }))}
                  placeholder="e.g. SubsPlease"
                  className="w-full bg-black/50 border border-white/10 rounded-xl px-3 py-2.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500/50" />
              </div>
              <div>
                <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1.5 block">Quality</label>
                <input type="text" value={filters.quality}
                  onChange={e => setFilters(f => ({ ...f, quality: e.target.value }))}
                  placeholder="e.g. 1080p"
                  className="w-full bg-black/50 border border-white/10 rounded-xl px-3 py-2.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500/50" />
              </div>
            </div>
            <div>
              <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1.5 block">Keywords / Tags</label>
              <input type="text" value={filters.keywords}
                onChange={e => setFilters(f => ({ ...f, keywords: e.target.value }))}
                placeholder="e.g. Dual-Audio, HEVC, BDRip"
                className="w-full bg-black/50 border border-white/10 rounded-xl px-3 py-2.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500/50" />
            </div>
          </div>
          <div className="flex gap-2 mt-5">
            <button onClick={onClose} className="flex-1 py-2.5 bg-white/5 text-zinc-400 text-sm rounded-xl hover:bg-white/8 transition-colors">Cancel</button>
            <button onClick={handleSaveFilters} className="flex-1 py-2.5 bg-emerald-500/15 text-emerald-400 text-sm font-medium rounded-xl hover:bg-emerald-500/25 transition-colors">Save & Apply</button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="fixed inset-0 z-[900]" onClick={onClose} />
      <div ref={ref} onClick={e => e.stopPropagation()} style={{ left: pos.x, top: pos.y }}
        className="fixed z-[901] w-60 bg-zinc-900 border border-white/10 rounded-xl shadow-2xl shadow-black/60 py-1.5">

        <div className="px-4 py-2.5 mb-0.5">
          <p className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest truncate">
            {anime.title_english || anime.title_romaji}
          </p>
        </div>
        <Divider />

        {/* Play Solo */}
        <div className="relative"
          onMouseEnter={() => showItem("play")}
          onMouseLeave={hideItem}>
          <button className="flex items-center gap-2.5 w-full px-4 py-2.5 text-left text-sm text-zinc-300 hover:bg-white/8 hover:text-zinc-100 transition-colors">
            <Play className="w-3.5 h-3.5 text-zinc-500" />
            <span className="flex-1">Play Solo</span>
            <ChevronRight className="w-3.5 h-3.5 text-zinc-600" />
          </button>
          {hoveredItem === "play" && <EpisodeFlyout forSync={false} />}
        </div>

        {/* Add to Sync Play */}
        <div className="relative"
          onMouseEnter={() => showItem("sync")}
          onMouseLeave={hideItem}>
          <button className="flex items-center gap-2.5 w-full px-4 py-2.5 text-left text-sm text-zinc-300 hover:bg-white/8 hover:text-zinc-100 transition-colors">
            <Users className="w-3.5 h-3.5 text-zinc-500" />
            <span className="flex-1">Add to Sync Play</span>
            <ChevronRight className="w-3.5 h-3.5 text-zinc-600" />
          </button>
          {hoveredItem === "sync" && <EpisodeFlyout forSync={true} />}
        </div>

        <Divider />

        {/* Search Torrents */}
        <button onClick={handleTorrentSearch}
          className="flex items-center gap-2.5 w-full px-4 py-2.5 text-left text-sm text-zinc-300 hover:bg-white/8 hover:text-zinc-100 transition-colors">
          <Search className="w-3.5 h-3.5 text-zinc-500" />
          Search Torrents
        </button>

        <Divider />

        {/* Set Status */}
        <div className="relative"
          onMouseEnter={() => showItem("status")}
          onMouseLeave={hideItem}>
          <button className="flex items-center gap-2.5 w-full px-4 py-2.5 text-left text-sm text-zinc-300 hover:bg-white/8 hover:text-zinc-100 transition-colors">
            <Tag className="w-3.5 h-3.5 text-zinc-500" />
            <span className="flex-1">Set Status</span>
            <ChevronRight className="w-3.5 h-3.5 text-zinc-600" />
          </button>
          {hoveredItem === "status" && <StatusFlyout />}
        </div>

        {/* Set Alternative Title */}
        <button onClick={() => setShowAltTitle(true)}
          className="flex items-center gap-2.5 w-full px-4 py-2.5 text-left text-sm text-zinc-300 hover:bg-white/8 hover:text-zinc-100 transition-colors">
          <FileEdit className="w-3.5 h-3.5 text-zinc-500" />
          <span className="flex-1">Set Alternative Title</span>
          {(anime as any).alt_title && (
            <span className="text-[10px] text-emerald-500 bg-emerald-500/10 px-1.5 py-0.5 rounded">set</span>
          )}
        </button>

        {/* Edit Filters */}
        <button onClick={() => setShowFilters(true)}
          className="flex items-center gap-2.5 w-full px-4 py-2.5 text-left text-sm text-zinc-300 hover:bg-white/8 hover:text-zinc-100 transition-colors">
          <SlidersHorizontal className="w-3.5 h-3.5 text-zinc-500" />
          Edit Filters
        </button>
      </div>
    </>
  );
}
