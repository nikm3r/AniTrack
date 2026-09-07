import React, { useEffect, useRef, useState } from "react";
import {
  Play, Users, Search, Tag, SlidersHorizontal, ChevronRight,
  MonitorPlay, CheckCircle, PauseCircle, XCircle, BookmarkPlus, Check, X, Trash2,
} from "lucide-react";
import { api } from "../api";
import type { Anime, AnimeStatus } from "../types/anime";

interface Props {
  onSearchRequest: (query: string) => void;
  x: number; y: number;
  anime: Anime;
  onClose: () => void;
  onUpdate: (updated: Partial<Anime> & { id: number }) => void;
  onRemove?: (id: number) => void;
  settings?: any;
}

interface ScannedFile { name: string; fullPath: string; size: number; }

interface Filters {
  altTitle: string;
  group: string; quality: string; keywords: string; overridePath: string;
}

const STATUS_ITEMS: { value: AnimeStatus; label: string; icon: React.ReactNode }[] = [
  { value: "WATCHING",  label: "Currently Watching", icon: <MonitorPlay className="w-3.5 h-3.5" /> },
  { value: "COMPLETED", label: "Completed",          icon: <CheckCircle className="w-3.5 h-3.5" /> },
  { value: "PLANNING",  label: "Planning to Watch",  icon: <BookmarkPlus className="w-3.5 h-3.5" /> },
  { value: "PAUSED",    label: "On Hold",             icon: <PauseCircle className="w-3.5 h-3.5" /> },
  { value: "DROPPED",   label: "Dropped",             icon: <XCircle className="w-3.5 h-3.5" /> },
];

function guessEpisode(filename: string, totalEpisodes?: number | null): number | null {
  const base = filename.split("/").pop()?.split("\\").pop() || filename;
  const clean = base.replace(/\.[^.]+$/, "").replace(/\[[0-9A-Fa-f]{6,8}\]/g, "").trim();
  const tryN = (n: number): number | null => {
    if (n <= 0) return null;
    if (n >= 1900 && n <= 2100) return null;
    if (totalEpisodes && n > totalEpisodes) return null;
    return n;
  };
  const patterns: RegExp[] = [
    /[Ss]\d{1,2}[Ee](\d{1,3})/,
    /[Ss]eason\s*\d+\s*[Ee]pisode\s*(\d{1,3})/i,
    /[Ee]pisode\s*(\d{1,3})/i,
    /[Ee]p?\.?\s*(\d{1,3})(?!\d)/,
    / - (\d{2,3})[\s\[.(]/,
    /[_ ](\d{2,3})[_\[. ]/,
    /(?:^|[\s_\-])0*(\d{1,3})\s*$/,
  ];
  for (const re of patterns) {
    const m = clean.match(re);
    if (m) { const result = tryN(parseInt(m[1], 10)); if (result !== null) return result; }
  }
  return null;
}

function filterKey(titleRomaji: string): string {
  return `filters_t_${titleRomaji.toLowerCase().replace(/[^a-z0-9]/g, "_")}`;
}
function loadFilters(animeId: number, titleRomaji: string): Filters {
  try {
    const saved = localStorage.getItem(filterKey(titleRomaji));
    if (saved) return JSON.parse(saved);
  } catch { }
  return { altTitle: "", group: "", quality: "1080p", keywords: "", overridePath: "" };
}
function saveFilters(animeId: number, filters: Filters, titleRomaji: string) {
  localStorage.setItem(filterKey(titleRomaji), JSON.stringify(filters));
}

// ─── EpisodeFlyout — top-level component so it never unmounts on parent re-render ───

interface EpisodeFlyoutProps {
  visible: boolean;
  forSync: boolean;
  pos: { x: number; y: number };
  files: ScannedFile[] | null;
  loadingFiles: boolean;
  totalEpisodes: number | null | undefined;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onLaunch: (filePath: string, forSync: boolean) => void;
}

const EpisodeFlyout = React.memo(function EpisodeFlyout({
  visible, forSync, pos, files, loadingFiles, totalEpisodes, onMouseEnter, onMouseLeave, onLaunch,
}: EpisodeFlyoutProps) {
  const sortedFiles = files
    ? [...files].sort((a, b) => (guessEpisode(a.name, totalEpisodes) ?? 999) - (guessEpisode(b.name, totalEpisodes) ?? 999))
    : [];

  const flipLeft = pos.x + 240 + 384 + 8 > window.innerWidth;
  const flipUp = pos.y + 480 > window.innerHeight;

  return (
    <div
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className="absolute w-96 bg-zinc-900 border border-white/10 rounded-xl shadow-2xl shadow-black/60 py-1.5 z-[902]"
      style={{
        ...(flipLeft ? { right: "100%", left: "auto", marginRight: "6px" } : { left: "100%", marginLeft: "6px" }),
        ...(flipUp ? { bottom: 0, top: "auto" } : { top: 0, bottom: "auto" }),
        maxHeight: "min(70vh, 480px)",
        overflowY: "auto",
        visibility: visible ? "visible" : "hidden",
        pointerEvents: visible ? "auto" : "none",
      }}
    >
      {loadingFiles && <p className="text-xs text-zinc-600 px-4 py-2">Scanning folder…</p>}
      {!loadingFiles && sortedFiles.length === 0 && (
        <div className="px-4 py-3">
          <p className="text-xs text-zinc-500">No video files found</p>
          <p className="text-[10px] text-zinc-700 mt-1">Set your base folder in Settings first</p>
        </div>
      )}
      {sortedFiles.map((f, i) => (
        <button key={i} onClick={() => onLaunch(f.fullPath, forSync)}
          className="w-full px-4 py-2 text-left text-xs text-zinc-300 hover:bg-emerald-500/10 hover:text-emerald-400 transition-colors flex items-center gap-2">
          <Play className="w-3 h-3 flex-shrink-0 shrink-0" />
          <span className="text-left break-words min-w-0">{f.name.replace(/\.[^.]+$/, '')}</span>
        </button>
      ))}
    </div>
  );
});

// ─── Main ContextMenu ──────────────────────────────────────────────────────────

export default function ContextMenu({ x, y, anime, onClose, onUpdate, onRemove, onSearchRequest, settings }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<Filters>(() => ({ ...loadFilters(anime.id, anime.title_romaji), altTitle: (anime as any).alt_title ?? "" }));
  const [files, setFiles] = useState<ScannedFile[] | null>(null);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [pos, setPos] = useState({ x: -9999, y: -9999 });

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
    const MARGIN = 8;
    const finalX = x + rect.width + MARGIN > window.innerWidth ? x - rect.width : x;
    const finalY = y + rect.height + MARGIN > window.innerHeight ? y - rect.height : y;
    setPos({ x: Math.max(MARGIN, finalX), y: Math.max(MARGIN, finalY) });
  }, [x, y]);

  useEffect(() => {
    setLoadingFiles(true);
    api.get<{ files: ScannedFile[] }>(`/api/files/scan/${anime.id}`)
      .then(res => setFiles(res.files))
      .catch(() => setFiles([]))
      .finally(() => setLoadingFiles(false));
  }, [anime.id]);

  const launchFile = async (filePath: string, forSync = false) => {
    if (forSync) {
      const ep = guessEpisode(filePath.split("/").pop() || filePath, (anime as any).total_episodes);
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
          animeId: anime.id, filePath, trackingDelaySecs: parseInt(settings?.tracking_delay || "180", 10),
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

  const handleSaveFilters = async () => {
    saveFilters(anime.id, filters, anime.title_romaji);
    const updates: any = {};
    if (filters.overridePath !== (anime as any).download_path) updates.download_path = filters.overridePath || null;
    if (filters.altTitle !== ((anime as any).alt_title ?? "")) updates.alt_title = filters.altTitle || null;
    if (Object.keys(updates).length > 0) {
      try {
        await api.patch(`/api/anime/${anime.id}`, updates);
        onUpdate({ id: anime.id, ...updates });
      } catch (e) { console.error(e); }
    }
    onClose();
  };

  const handleRemove = async () => {
    if (!confirm(`Remove "${anime.title_romaji}" from library? This cannot be undone.`)) return;
    try {
      await api.delete(`/api/anime/${anime.id}`);
      onRemove?.(anime.id);
    } catch (e) { console.error(e); }
    onClose();
  };

  const handleTorrentSearch = () => {
    const f = loadFilters(anime.id, anime.title_romaji);
    const title = filters.altTitle || (anime as any).alt_title || anime.title_romaji;
    const q = [title, f.group, f.quality, f.keywords].filter(Boolean).join(" ");
    onSearchRequest(q);
    onClose();
  };

  const Divider = () => <div className="h-px bg-white/5 my-1" />;

  const StatusFlyout = () => {
    const flipLeft = pos.x + 240 + 208 + 8 > window.innerWidth;
    const flipUp = pos.y + 200 > window.innerHeight;
    return (
      <div
        onMouseEnter={() => showItem("status")}
        onMouseLeave={hideItem}
        className={`absolute w-52 bg-zinc-900 border border-white/10 rounded-xl shadow-2xl shadow-black/60 py-1.5 z-[902] ${flipLeft ? "right-full mr-1.5" : "left-full ml-1.5"}`}
        style={flipUp ? { bottom: 0, top: "auto" } : { top: 0, bottom: "auto" }}
      >
        {STATUS_ITEMS.map(s => (
          <button key={s.value} onClick={() => handleSetStatus(s.value)}
            className={`flex items-center gap-2.5 w-full px-4 py-2.5 text-xs text-left transition-colors ${
              anime.status === s.value ? "text-emerald-400 bg-emerald-500/10" : "text-zinc-300 hover:bg-white/8 hover:text-zinc-100"
            }`}>
            <span className={anime.status === s.value ? "text-emerald-400" : "text-zinc-500"}>{s.icon}</span>
            {s.label}
            {anime.status === s.value && <Check className="w-3 h-3 ml-auto text-emerald-500" />}
          </button>
        ))}
      </div>
    );
  };

  if (showFilters) {
    return (
      <>
        <div className="fixed inset-0 z-[900]" onClick={onClose} />
        <div ref={ref}
          style={{ left: "50%", top: "50%", transform: "translate(-50%, -50%)" }}
          onClick={e => e.stopPropagation()}
          className="fixed z-[901] w-96 bg-zinc-900 border border-white/10 rounded-2xl shadow-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="w-4 h-4 text-emerald-500" />
              <p className="text-sm font-bold text-zinc-200">Edit Settings</p>
            </div>
            <button onClick={onClose} className="text-zinc-600 hover:text-zinc-400"><X className="w-4 h-4" /></button>
          </div>
          <p className="text-xs text-zinc-600 mb-4 truncate">{anime.title_english || anime.title_romaji}</p>
          <div className="space-y-3">
            <div>
              <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1.5 block">Alternative Title (for torrent search)</label>
              <input type="text" value={filters.altTitle}
                onChange={e => setFilters(f => ({ ...f, altTitle: e.target.value }))}
                placeholder={anime.title_romaji}
                className="w-full bg-black/50 border border-white/10 rounded-xl px-3 py-2.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500/50" />
            </div>
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
          <EpisodeFlyout
            visible={hoveredItem === "play"}
            forSync={false}
            pos={pos}
            files={files}
            loadingFiles={loadingFiles}
            totalEpisodes={(anime as any).total_episodes}
            onMouseEnter={() => showItem("play")}
            onMouseLeave={hideItem}
            onLaunch={launchFile}
          />
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
          <EpisodeFlyout
            visible={hoveredItem === "sync"}
            forSync={true}
            pos={pos}
            files={files}
            loadingFiles={loadingFiles}
            totalEpisodes={(anime as any).total_episodes}
            onMouseEnter={() => showItem("sync")}
            onMouseLeave={hideItem}
            onLaunch={launchFile}
          />
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

        {/* Remove from Library */}
        <div className="h-px bg-white/5 mx-3 my-1" />
        <button onClick={handleRemove}
          className="flex items-center gap-2.5 w-full px-4 py-2.5 text-left text-sm text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-colors">
          <Trash2 className="w-3.5 h-3.5" />
          <span className="flex-1">Remove from Library</span>
        </button>

        {/* Edit Settings */}
        <button onClick={() => setShowFilters(true)}
          className="flex items-center gap-2.5 w-full px-4 py-2.5 text-left text-sm text-zinc-300 hover:bg-white/8 hover:text-zinc-100 transition-colors">
          <SlidersHorizontal className="w-3.5 h-3.5 text-zinc-500" />
          <span className="flex-1">Edit Settings</span>
          {((anime as any).alt_title || filters.group || filters.overridePath) && (
            <span className="text-[10px] text-emerald-500 bg-emerald-500/10 px-1.5 py-0.5 rounded">set</span>
          )}
        </button>
      </div>
    </>
  );
}
