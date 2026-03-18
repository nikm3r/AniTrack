import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { Search, RefreshCw, SlidersHorizontal } from "lucide-react";
import { api } from "../api";
import type { Anime, AnimeStatus, AppSettings } from "../types/anime";
import SeriesCard from "./SeriesCard";
import SeriesDetail from "./SeriesDetail";
import ContextMenu from "./ContextMenu";
import NowPlaying from "./NowPlaying";

type SortMode = "season" | "alpha" | "score" | "progress";

interface ContextMenuState {
  visible: boolean; x: number; y: number; anime: Anime | null;
}
interface NowPlayingState {
  animeId: number | null; episode: number | null;
  secondsRemaining: number; filePath: string | null;
}
interface AnimeListHandle {
  anime: Anime[]; loading: boolean; error: string | null;
  reload: () => void; updateAnime: (id: number, updates: Partial<Anime>) => void;
}
interface Props {
  onSearchRequest: (query: string) => void;
  animeList: AnimeListHandle;
  settings: AppSettings;
}

const CATEGORIES: { key: AnimeStatus; label: string }[] = [
  { key: "WATCHING",  label: "Currently Watching" },
  { key: "COMPLETED", label: "Completed" },
  { key: "PLANNING",  label: "Planning to Watch" },
  { key: "PAUSED",    label: "On Hold" },
  { key: "DROPPED",   label: "Dropped" },
];
const SORT_OPTIONS: { key: SortMode; label: string }[] = [
  { key: "season", label: "Season" },
  { key: "alpha",  label: "A–Z" },
  { key: "score",  label: "Score" },
  { key: "progress", label: "Progress" },
];
const SEASON_ORDER: Record<string, number> = { WINTER: 0, SPRING: 1, SUMMER: 2, FALL: 3 };

function seasonSortKey(season: string | null, year: number | null): number {
  return (year ?? 0) * 10 + (season ? (SEASON_ORDER[season.toUpperCase()] ?? 0) : 0);
}
function getSeasonLabel(season: string | null, year: number | null): string {
  if (!season || !year) return "Unknown Season";
  return `${season.charAt(0) + season.slice(1).toLowerCase()} ${year}`;
}

// ─── Row types for the virtual list ──────────────────────────────────────────
type Row =
  | { type: "header"; label: string; count: number }
  | { type: "grid"; items: Anime[] };

const CARD_MIN_WIDTH = 172;
const CARD_GAP = 16;

function buildRows(sorted: Anime[], groups: [string, Anime[]][] | null, cols: number): Row[] {
  const rows: Row[] = [];
  if (groups) {
    for (const [season, items] of groups) {
      rows.push({ type: "header", label: season, count: items.length });
      for (let i = 0; i < items.length; i += cols) {
        rows.push({ type: "grid", items: items.slice(i, i + cols) });
      }
    }
  } else {
    for (let i = 0; i < sorted.length; i += cols) {
      rows.push({ type: "grid", items: sorted.slice(i, i + cols) });
    }
  }
  return rows;
}

export default function Watchlist({ animeList, settings, onSearchRequest }: Props) {
  const { anime, loading, error, reload, updateAnime } = animeList;

  const [activeCategory, setActiveCategory] = useState<AnimeStatus>("WATCHING");
  const [sortMode, setSortMode] = useState<SortMode>("season");
  const [search, setSearch] = useState("");
  const [selectedAnime, setSelectedAnime] = useState<Anime | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({ visible: false, x: 0, y: 0, anime: null });
  const [nowPlaying, setNowPlaying] = useState<NowPlayingState>({ animeId: null, episode: null, secondsRemaining: 0, filePath: null });

  // Measure container width to compute column count
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(900);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      setContainerWidth(entries[0].contentRect.width);
    });
    ro.observe(el);
    setContainerWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const cols = Math.max(1, Math.floor((containerWidth + CARD_GAP) / (CARD_MIN_WIDTH + CARD_GAP)));
  // Card height: cover (aspect 2/3 of width) + info strip (~88px)
  const cardWidth = (containerWidth - (cols - 1) * CARD_GAP) / cols;
  const cardHeight = Math.round((cardWidth * 3) / 2) + 88;
  const HEADER_HEIGHT = 44;

  useEffect(() => {
    const close = () => setContextMenu(c => ({ ...c, visible: false }));
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  useEffect(() => {
    const poll = async () => {
      try {
        const port = (window as any).__SERVER_PORT || 3000;
        const res = await fetch(`http://localhost:${port}/api/playback/status`);
        if (res.ok) {
          const data = await res.json();
          setNowPlaying({ animeId: data.animeId ?? null, episode: data.episode ?? null, secondsRemaining: data.secondsRemaining ?? 0, filePath: data.filePath ?? null });
        }
      } catch { }
    };
    poll();
    const id = setInterval(poll, 2000);
    return () => clearInterval(id);
  }, []);

  const filtered = useMemo(() => anime.filter(a => {
    if (a.status !== activeCategory) return false;
    if (search) {
      const q = search.toLowerCase();
      if (
        !(a.title_romaji || "").toLowerCase().includes(q) &&
        !(a.title_english || "").toLowerCase().includes(q) &&
        !((a as any).alt_title || "").toLowerCase().includes(q)
      ) return false;
    }
    return true;
  }), [anime, activeCategory, search]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    switch (sortMode) {
      case "alpha":    return copy.sort((a, b) => a.title_romaji.localeCompare(b.title_romaji));
      case "score":    return copy.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
      case "progress": return copy.sort((a, b) => {
        const ap = a.total_episodes ? a.progress / a.total_episodes : 0;
        const bp = b.total_episodes ? b.progress / b.total_episodes : 0;
        return bp - ap;
      });
      default: return copy.sort((a, b) => seasonSortKey(b.season, b.season_year) - seasonSortKey(a.season, a.season_year));
    }
  }, [filtered, sortMode]);

  const groups = useMemo<[string, Anime[]][] | null>(() => {
    if (sortMode !== "season") return null;
    const map = new Map<string, Anime[]>();
    for (const a of sorted) {
      const label = getSeasonLabel(a.season, a.season_year);
      if (!map.has(label)) map.set(label, []);
      map.get(label)!.push(a);
    }
    for (const [, items] of map) {
      items.sort((a, b) => a.title_romaji.localeCompare(b.title_romaji));
    }
    return Array.from(map.entries());
  }, [sorted, sortMode]);

  const rows = useMemo(() => buildRows(sorted, groups, cols), [sorted, groups, cols]);

  // Simple manual virtualization
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);

  const rowHeights = useMemo(() =>
    rows.map(r => r.type === "header" ? HEADER_HEIGHT : cardHeight + CARD_GAP),
    [rows, cardHeight]
  );

  const totalHeight = useMemo(() => rowHeights.reduce((a, b) => a + b, 0), [rowHeights]);

  const visibleRows = useMemo(() => {
    const viewHeight = 800; // generous estimate
    let top = 0;
    const visible: { row: Row; top: number; index: number }[] = [];
    for (let i = 0; i < rows.length; i++) {
      const h = rowHeights[i];
      if (top + h > scrollTop - 200 && top < scrollTop + viewHeight + 200) {
        visible.push({ row: rows[i], top, index: i });
      }
      top += h;
    }
    return visible;
  }, [rows, rowHeights, scrollTop]);

  const handleContextMenu = useCallback((e: React.MouseEvent, a: Anime) => {
    e.preventDefault(); e.stopPropagation();
    setContextMenu({ visible: true, x: e.clientX, y: e.clientY, anime: a });
  }, []);

  const handleAnimeUpdate = useCallback((updated: Partial<Anime> & { id: number }) => {
    updateAnime(updated.id, updated);
    if (selectedAnime?.id === updated.id) {
      setSelectedAnime(prev => prev ? { ...prev, ...updated } : null);
    }
  }, [updateAnime, selectedAnime]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await api.post("/api/tracker/import-list", {});
      await reload();
    } catch (e) { console.error("Sync failed", e); }
    finally { setSyncing(false); }
  };

  const counts = useMemo(() => {
    const map: Partial<Record<AnimeStatus, number>> = {};
    for (const a of anime) map[a.status] = (map[a.status] ?? 0) + 1;
    return map;
  }, [anime]);

  const nowPlayingAnime = useMemo(() => anime.find(a => a.id === nowPlaying.animeId) ?? null, [anime, nowPlaying.animeId]);

  return (
    <div className="flex flex-col h-full min-h-0">

      {nowPlaying.animeId && nowPlayingAnime && (
        <NowPlaying anime={nowPlayingAnime} episode={nowPlaying.episode}
          secondsRemaining={nowPlaying.secondsRemaining}
          onDismiss={() => setNowPlaying({ animeId: null, episode: null, secondsRemaining: 0, filePath: null })} />
      )}

      {/* Header */}
      <div className="flex items-center gap-3 mb-6 flex-shrink-0">
        <h1 className="text-2xl font-bold text-zinc-100 tracking-tight">Library</h1>
        <div className="flex-1" />
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-600 pointer-events-none" />
          <input type="text" placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)}
            className="bg-white/5 border border-white/8 rounded-xl pl-10 pr-4 py-2.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500/40 transition-all w-52" />
        </div>
        <div className="flex items-center gap-1 bg-white/5 border border-white/8 rounded-xl p-1">
          <SlidersHorizontal className="w-4 h-4 text-zinc-600 ml-2 mr-1" />
          {SORT_OPTIONS.map(opt => (
            <button key={opt.key} onClick={() => setSortMode(opt.key)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${sortMode === opt.key ? "bg-emerald-500/15 text-emerald-400" : "text-zinc-500 hover:text-zinc-300"}`}>
              {opt.label}
            </button>
          ))}
        </div>
        <button onClick={handleSync} disabled={syncing} title="Sync from AniList"
          className="w-10 h-10 rounded-xl bg-white/5 border border-white/8 flex items-center justify-center text-zinc-500 hover:text-zinc-300 transition-all disabled:opacity-40">
          <RefreshCw className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Category tabs */}
      <div className="flex items-center mb-6 border-b border-white/5 flex-shrink-0">
        {CATEGORIES.map(cat => (
          <button key={cat.key} onClick={() => { setActiveCategory(cat.key); setSelectedAnime(null); }}
            className={`relative px-5 py-3 text-sm font-medium transition-all whitespace-nowrap ${activeCategory === cat.key ? "text-emerald-400" : "text-zinc-500 hover:text-zinc-300"}`}>
            {cat.label}
            {counts[cat.key] != null && (
              <span className={`ml-2 text-[11px] font-bold px-1.5 py-0.5 rounded-md ${activeCategory === cat.key ? "bg-emerald-500/15 text-emerald-500" : "bg-white/5 text-zinc-600"}`}>
                {counts[cat.key]}
              </span>
            )}
            {activeCategory === cat.key && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-500 rounded-full" />}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex flex-1 gap-6 min-h-0">

        {/* Virtualized grid */}
        <div ref={containerRef} className="flex-1 min-w-0">
          <div
            ref={scrollRef}
            className="h-full overflow-y-auto scrollbar-thin"
            onScroll={e => setScrollTop((e.target as HTMLDivElement).scrollTop)}
          >
            {loading && (
              <div className="flex items-center justify-center h-40">
                <div className="w-7 h-7 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
              </div>
            )}
            {error && <div className="flex items-center justify-center h-40 text-red-400 text-sm">{error}</div>}
            {!loading && !error && sorted.length === 0 && (
              <div className="flex flex-col items-center justify-center h-48 gap-3 text-zinc-600">
                <span className="text-4xl">¯\_(ツ)_/¯</span>
                <span className="text-sm">Nothing here yet</span>
              </div>
            )}

            {!loading && !error && sorted.length > 0 && (
              <div style={{ height: totalHeight, position: "relative" }}>
                {visibleRows.map(({ row, top, index }) => (
                  <div key={index} style={{ position: "absolute", top, left: 0, right: 0 }}>
                    {row.type === "header" ? (
                      <div className="flex items-center gap-3 mb-2 px-0.5" style={{ height: HEADER_HEIGHT, alignItems: "center" }}>
                        <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest">{row.label}</span>
                        <div className="flex-1 h-px bg-white/5" />
                        <span className="text-xs text-zinc-700">{row.count}</span>
                      </div>
                    ) : (
                      <div
                        className="grid"
                        style={{
                          gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                          gap: CARD_GAP,
                          marginBottom: CARD_GAP,
                        }}
                      >
                        {row.items.map(a => (
                          <SeriesCard
                            key={a.id}
                            anime={a}
                            isSelected={selectedAnime?.id === a.id}
                            isNowPlaying={nowPlaying.animeId === a.id}
                            nowPlayingEpisode={nowPlaying.animeId === a.id ? nowPlaying.episode : null}
                            onClick={() => setSelectedAnime(prev => prev?.id === a.id ? null : a)}
                            onContextMenu={e => handleContextMenu(e, a)}
                            onUpdate={handleAnimeUpdate}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Detail panel */}
        {selectedAnime && (
          <div className="w-80 flex-shrink-0 overflow-y-auto scrollbar-thin">
            <SeriesDetail
              anime={selectedAnime}
              settings={settings}
              onClose={() => setSelectedAnime(null)}
              onUpdate={handleAnimeUpdate}
              onContextMenu={e => handleContextMenu(e, selectedAnime)}
            />
          </div>
        )}
      </div>

      {contextMenu.visible && contextMenu.anime && (
        <ContextMenu
          onSearchRequest={onSearchRequest}
          x={contextMenu.x} y={contextMenu.y}
          anime={contextMenu.anime}
          onClose={() => setContextMenu(c => ({ ...c, visible: false }))}
          onUpdate={handleAnimeUpdate}
          settings={settings}
        />
      )}
    </div>
  );
}
