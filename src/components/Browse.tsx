import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { Search, SlidersHorizontal, Plus, Check, ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import { api } from "../api";
import type { Anime, AnimeStatus, AppSettings } from "../types/anime";
import SeriesCard from "./SeriesCard";
import SeriesDetail from "./SeriesDetail";

// ─── Types ────────────────────────────────────────────────────────────────────

interface BrowseAnime {
  id: number;           // AniList ID
  title_romaji: string;
  title_english: string | null;
  cover_image: string | null;
  banner_image: string | null;
  format: string | null;
  status: string | null;
  season: string | null;
  season_year: number | null;
  total_episodes: number | null;
  average_score: number | null;
  genres: string[];
  description: string | null;
  // If already in library, this is set
  libraryAnime?: Anime;
}

type SortMode = "popularity" | "alpha" | "score";

interface Props {
  animeList: Anime[];
  settings: AppSettings;
  onAnimeAdded: (anime: Anime) => void;
  onAnimeRemoved: (id: number) => void;
}

const SEASONS = ["WINTER", "SPRING", "SUMMER", "FALL"] as const;
type Season = typeof SEASONS[number];

const SEASON_LABELS: Record<Season, string> = {
  WINTER: "Winter", SPRING: "Spring", SUMMER: "Summer", FALL: "Fall",
};

const SEASON_ORDER: Record<Season, number> = {
  WINTER: 0, SPRING: 1, SUMMER: 2, FALL: 3,
};

function getCurrentSeason(): { season: Season; year: number } {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  let season: Season;
  if (month <= 3) season = "WINTER";
  else if (month <= 6) season = "SPRING";
  else if (month <= 9) season = "SUMMER";
  else season = "FALL";
  return { season, year };
}

function prevSeason(season: Season, year: number): { season: Season; year: number } {
  const idx = SEASONS.indexOf(season);
  if (idx === 0) return { season: "FALL", year: year - 1 };
  return { season: SEASONS[idx - 1], year };
}

function nextSeason(season: Season, year: number): { season: Season; year: number } {
  const idx = SEASONS.indexOf(season);
  if (idx === 3) return { season: "WINTER", year: year + 1 };
  return { season: SEASONS[idx + 1], year };
}

function proxyUrl(url: string | null): string | null {
  if (!url) return null;
  return `http://localhost:3000/api/proxy-image?url=${encodeURIComponent(url)}`;
}

const CARD_MIN_WIDTH = 172;
const CARD_GAP = 16;

// ─── Browse Card ──────────────────────────────────────────────────────────────

function BrowseCard({
  anime, isSelected, inLibrary, onClick, onAdd, onRemove, settings,
}: {
  anime: BrowseAnime;
  isSelected: boolean;
  inLibrary: boolean;
  onClick: () => void;
  onAdd: (status: AnimeStatus) => void;
  onRemove?: () => void;
  settings?: AppSettings;
}) {
  const [imgError, setImgError] = useState(false);
  const [adding, setAdding] = useState(false);
  const cover = imgError ? null : proxyUrl(anime.cover_image);
  const title =
    settings?.language === "english" ? (anime.title_english || anime.title_romaji) :
    anime.title_romaji;

  return (
    <div
      onClick={onClick}
      className={`
        relative group flex flex-col rounded-2xl overflow-hidden cursor-pointer
        transition-all duration-200 select-none
        ${isSelected
          ? "ring-2 ring-emerald-500 shadow-xl shadow-emerald-500/20"
          : "ring-1 ring-white/8 hover:ring-white/20 hover:shadow-xl hover:shadow-black/40"
        }
      `}
    >
      {/* Cover */}
      <div className="relative bg-zinc-900 overflow-hidden" style={{ aspectRatio: "2/3" }}>
        {cover ? (
          <img src={cover} alt={title} onError={() => setImgError(true)}
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-zinc-900 p-3">
            <span className="text-zinc-600 text-xs font-medium text-center leading-tight">{title}</span>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />

        {/* Score badge */}
        {anime.average_score != null && anime.average_score > 0 && (
          <div className="absolute top-2.5 right-2.5 flex items-center gap-1 bg-black/75 backdrop-blur-sm text-amber-400 text-xs font-bold px-2 py-1 rounded-lg">
            {anime.average_score}%
          </div>
        )}

        {/* Format badge */}
        {anime.format && anime.format !== "TV" && (
          <div className="absolute bottom-14 right-2.5 text-[10px] font-bold text-zinc-400 bg-black/75 backdrop-blur-sm px-1.5 py-0.5 rounded-md">
            {anime.format.replace("_", " ")}
          </div>
        )}

        {/* Episode count */}
        <div className="absolute bottom-2 left-3">
          {anime.total_episodes && (
            <span className="text-[11px] text-zinc-400">{anime.total_episodes} ep</span>
          )}
        </div>
      </div>

      {/* Info strip */}
      <div className="bg-zinc-900/95 px-3 py-2.5 flex flex-col gap-2" onClick={e => e.stopPropagation()}>
        <p className="text-xs font-semibold text-zinc-200 leading-snug line-clamp-2 min-h-[2.5rem]">
          {title}
        </p>
        {inLibrary ? (
          <button
            onClick={e => { e.stopPropagation(); onRemove?.(); }}
            className="w-full h-7 rounded-lg bg-emerald-500/10 text-emerald-500 text-xs font-medium flex items-center justify-center gap-1.5 hover:bg-red-500/10 hover:text-red-400 transition-all group"
          >
            <Check className="w-3 h-3 group-hover:hidden" />
            <span className="group-hover:hidden">In Library</span>
            <span className="hidden group-hover:flex items-center gap-1.5"><Trash2 className="w-3 h-3" /> Remove</span>
          </button>
        ) : (
          <select
            onClick={e => e.stopPropagation()}
            onChange={e => { if (e.target.value) { onAdd(e.target.value as AnimeStatus); e.target.value = ""; } }}
            defaultValue=""
            className="w-full h-7 rounded-lg bg-zinc-900 text-emerald-400 text-xs font-medium px-2 cursor-pointer hover:bg-zinc-800 transition-all border border-white/8 outline-none"
            style={{ colorScheme: "dark" }}
          >
            <option value="" disabled style={{ background: "#18181b", color: "#6b7280" }}>Add to Library ▾</option>
            <option value="PLANNING" style={{ background: "#18181b", color: "#34d399" }}>Planning</option>
            <option value="WATCHING" style={{ background: "#18181b", color: "#34d399" }}>Watching</option>
            <option value="COMPLETED" style={{ background: "#18181b", color: "#34d399" }}>Completed</option>
            <option value="PAUSED" style={{ background: "#18181b", color: "#34d399" }}>On Hold</option>
            <option value="DROPPED" style={{ background: "#18181b", color: "#34d399" }}>Dropped</option>
          </select>
        )}
      </div>

      {isSelected && (
        <div className="absolute inset-0 rounded-2xl ring-2 ring-emerald-500 pointer-events-none" />
      )}
    </div>
  );
}

// ─── Browse Detail Panel ──────────────────────────────────────────────────────
// Shows info for a BrowseAnime — simpler than SeriesDetail since it's not in library

function BrowseDetail({
  anime, inLibrary, onAdd, onRemove, onClose, settings,
}: {
  anime: BrowseAnime;
  inLibrary: boolean;
  onAdd: (status: AnimeStatus) => Promise<void>;
  onRemove: () => void;
  onClose: () => void;
  settings?: AppSettings;
}) {
  const [adding, setAdding] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const bannerUrl = imgError ? null : proxyUrl(anime.banner_image || anime.cover_image);
  const coverUrl = proxyUrl(anime.cover_image);
  const title =
    settings?.language === "english" ? (anime.title_english || anime.title_romaji) :
    anime.title_romaji;
  const desc = anime.description?.replace(/<[^>]+>/g, "") ?? null;
  const truncated = desc && desc.length > 200 && !expanded;
  const displayDesc = truncated ? desc.slice(0, 200) + "…" : desc;

  const handleAdd = async (status: AnimeStatus) => {
    if (inLibrary || adding) return;
    setAdding(true);
    try { await onAdd(status); } finally { setAdding(false); }
  };

  return (
    <div className="bg-zinc-900/50 border border-white/8 rounded-2xl overflow-hidden flex flex-col">
      {/* Banner */}
      <div className="relative h-36 bg-zinc-950 overflow-hidden flex-shrink-0">
        {bannerUrl && !imgError ? (
          <img src={bannerUrl} alt="" onError={() => setImgError(true)}
            className="w-full h-full object-cover opacity-60" />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-zinc-900 to-zinc-950" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-zinc-900 via-zinc-900/40 to-transparent" />
        <button onClick={onClose}
          className="absolute top-3 right-3 w-7 h-7 rounded-full bg-black/60 flex items-center justify-center text-zinc-400 hover:text-zinc-100 transition-colors">
          <span className="text-xs font-bold">✕</span>
        </button>
        {coverUrl && (
          <div className="absolute bottom-3 left-3 w-12 rounded-lg overflow-hidden ring-2 ring-white/10 shadow-lg">
            <img src={coverUrl} alt="" className="w-full h-full object-cover" style={{ aspectRatio: "2/3" }} />
          </div>
        )}
        <div className="absolute bottom-3 right-3" style={{ left: coverUrl ? "4.5rem" : "0.75rem" }}>
          <h2 className="text-sm font-bold text-zinc-100 leading-tight line-clamp-2">{title}</h2>
          {anime.title_romaji !== title && (
            <p className="text-[10px] text-zinc-500 mt-0.5 line-clamp-1">{anime.title_romaji}</p>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="p-4 flex flex-col gap-4 overflow-y-auto flex-1">
        {/* Stats */}
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-white/5 rounded-xl p-2.5 text-center">
            <p className="text-[10px] text-zinc-600 uppercase tracking-widest mb-0.5">Episodes</p>
            <p className="text-sm font-bold text-zinc-200">{anime.total_episodes ?? "?"}</p>
          </div>
          <div className="bg-white/5 rounded-xl p-2.5 text-center">
            <p className="text-[10px] text-zinc-600 uppercase tracking-widest mb-0.5">Score</p>
            <p className="text-sm font-bold text-amber-400">{anime.average_score ? `${anime.average_score}%` : "—"}</p>
          </div>
          <div className="bg-white/5 rounded-xl p-2.5 text-center">
            <p className="text-[10px] text-zinc-600 uppercase tracking-widest mb-0.5">Format</p>
            <p className="text-sm font-bold text-zinc-200">{anime.format?.replace("_", " ") ?? "—"}</p>
          </div>
        </div>

        {/* Add button */}
        {inLibrary ? (
          <button onClick={onRemove}
            className="w-full py-2.5 rounded-xl text-sm font-medium flex items-center justify-center gap-2 bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/20 transition-all group">
            <Check className="w-4 h-4 group-hover:hidden" /><span className="group-hover:hidden">In Library</span>
            <Trash2 className="w-4 h-4 hidden group-hover:block" /><span className="hidden group-hover:inline">Remove from Library</span>
          </button>
        ) : adding ? (
          <div className="w-full py-2.5 rounded-xl flex items-center justify-center">
            <div className="w-4 h-4 border border-emerald-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-[10px] text-zinc-600 uppercase tracking-widest">Add to Library as…</p>
            <div className="grid grid-cols-2 gap-1.5">
              {(["PLANNING","WATCHING","COMPLETED","PAUSED","DROPPED"] as const).map(s => {
                const labels: Record<string, string> = { PLANNING: "Planning", WATCHING: "Watching", COMPLETED: "Completed", PAUSED: "On Hold", DROPPED: "Dropped" };
                return (
                  <button key={s} onClick={() => handleAdd(s)}
                    className="px-2 py-2 rounded-xl bg-white/5 hover:bg-emerald-500/15 text-zinc-400 hover:text-emerald-400 text-xs font-medium transition-all border border-white/5 hover:border-emerald-500/20">
                    {labels[s]}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Genres */}
        {anime.genres.length > 0 && (
          <div>
            <p className="text-[10px] text-zinc-600 uppercase tracking-widest mb-1.5">Genres</p>
            <div className="flex flex-wrap gap-1.5">
              {anime.genres.map(g => (
                <span key={g} className="text-[11px] px-2 py-0.5 bg-white/5 rounded-full text-zinc-400">{g}</span>
              ))}
            </div>
          </div>
        )}

        {/* Description */}
        {desc && (
          <div>
            <p className="text-[10px] text-zinc-600 uppercase tracking-widest mb-1.5">Synopsis</p>
            <p className="text-xs text-zinc-400 leading-relaxed">{displayDesc}</p>
            {desc.length > 200 && (
              <button onClick={() => setExpanded(e => !e)}
                className="text-[10px] text-emerald-500 hover:text-emerald-400 mt-1 transition-colors">
                {expanded ? "Show less" : "Show more"}
              </button>
            )}
          </div>
        )}

        {/* Meta */}
        <div className="grid grid-cols-2 gap-2 text-xs text-zinc-600">
          {anime.season && anime.season_year && (
            <div>
              <span className="text-[10px] uppercase tracking-widest block mb-0.5">Season</span>
              <span className="text-zinc-400">
                {anime.season.charAt(0) + anime.season.slice(1).toLowerCase()} {anime.season_year}
              </span>
            </div>
          )}
          {anime.status && (
            <div>
              <span className="text-[10px] uppercase tracking-widest block mb-0.5">Status</span>
              <span className="text-zinc-400">{anime.status.replace("_", " ")}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Browse Component ────────────────────────────────────────────────────

export default function Browse({ animeList, settings, onAnimeAdded, onAnimeRemoved }: Props) {
  const { season: initSeason, year: initYear } = getCurrentSeason();
  const [season, setSeason] = useState<Season>(initSeason);
  const [year, setYear] = useState(initYear);
  const [sortMode, setSortMode] = useState<SortMode>("popularity");
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<BrowseAnime[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedAnime, setSelectedAnime] = useState<BrowseAnime | null>(null);
  const [addingIds, setAddingIds] = useState<Set<number>>(new Set());

  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(900);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => setContainerWidth(entries[0].contentRect.width));
    ro.observe(el);
    setContainerWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const cols = Math.max(1, Math.floor((containerWidth + CARD_GAP) / (CARD_MIN_WIDTH + CARD_GAP)));
  const cardWidth = (containerWidth - (cols - 1) * CARD_GAP) / cols;
  const cardHeight = Math.round((cardWidth * 3) / 2) + 88;

  // Fetch season data
  useEffect(() => {
    let cancelled = false;
    const fetch_ = async () => {
      setLoading(true);
      setError(null);
      setResults([]);
      try {
        const data = await api.get<BrowseAnime[]>(
          `/api/browse/season?season=${season}&year=${year}`
        );
        if (!cancelled) setResults(data);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetch_();
    return () => { cancelled = true; };
  }, [season, year]);

  // Build a set of anilist IDs already in library
  const libraryIds = useMemo(() => new Set(animeList.map(a => a.anilist_id).filter(Boolean)), [animeList]);

  const filtered = useMemo(() => {
    let res = results;
    if (search) {
      const q = search.toLowerCase();
      res = res.filter(a =>
        a.title_romaji.toLowerCase().includes(q) ||
        (a.title_english || "").toLowerCase().includes(q)
      );
    }
    return [...res].sort((a, b) => {
      if (sortMode === "alpha") return a.title_romaji.localeCompare(b.title_romaji);
      if (sortMode === "score") return (b.average_score ?? 0) - (a.average_score ?? 0);
      return 0; // popularity — keep API order
    });
  }, [results, search, sortMode]);

  const handlePrev = () => {
    const { season: s, year: y } = prevSeason(season, year);
    setSeason(s); setYear(y); setSelectedAnime(null);
  };
  const handleNext = () => {
    const { season: s, year: y } = nextSeason(season, year);
    setSeason(s); setYear(y); setSelectedAnime(null);
  };

  const handleAdd = useCallback(async (anime: BrowseAnime, status: AnimeStatus) => {
    if (libraryIds.has(anime.id)) return;
    setAddingIds(prev => new Set(prev).add(anime.id));
    try {
      const added = await api.post<Anime>("/api/browse/add", { anilistId: anime.id, status });
      onAnimeAdded(added);
    } catch (e) {
      console.error("Failed to add anime:", e);
    } finally {
      setAddingIds(prev => { const s = new Set(prev); s.delete(anime.id); return s; });
    }
  }, [libraryIds, onAnimeAdded]);

  const handleRemove = useCallback(async (anilistId: number) => {
    // Find the local DB id
    const local = animeList.find(a => a.anilist_id === anilistId);
    if (!local) return;
    if (!confirm(`Remove "${local.title_romaji}" from library?`)) return;
    try {
      await api.delete(`/api/anime/${local.id}`);
      onAnimeRemoved(local.id);
    } catch (e) {
      console.error("Failed to remove anime:", e);
    }
  }, [animeList, onAnimeRemoved]);

  const handleAnimeUpdate = useCallback((updated: Partial<Anime> & { id: number }) => {
    // No-op for browse — we don't own these in local state
  }, []);

  const SORT_OPTIONS: { key: SortMode; label: string }[] = [
    { key: "popularity", label: "Popular" },
    { key: "alpha", label: "A–Z" },
    { key: "score", label: "Score" },
  ];

  // Grid rows
  const rows = useMemo(() => {
    const r: BrowseAnime[][] = [];
    for (let i = 0; i < filtered.length; i += cols) r.push(filtered.slice(i, i + cols));
    return r;
  }, [filtered, cols]);

  const totalHeight = rows.length * (cardHeight + CARD_GAP);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);

  const visibleRows = useMemo(() => {
    const viewHeight = 800;
    return rows.map((row, i) => ({ row, top: i * (cardHeight + CARD_GAP), index: i }))
      .filter(({ top }) => top + cardHeight + CARD_GAP > scrollTop - 200 && top < scrollTop + viewHeight + 200);
  }, [rows, scrollTop, cardHeight]);

  return (
    <div className="flex flex-col h-full min-h-0">

      {/* Header */}
      <div className="flex items-center gap-3 mb-6 flex-shrink-0">
        <h1 className="text-2xl font-bold text-zinc-100 tracking-tight">Browse</h1>
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
      </div>

      {/* Season selector */}
      <div className="flex items-center gap-4 mb-6 flex-shrink-0">
        <button onClick={handlePrev}
          className="w-9 h-9 rounded-xl bg-white/5 border border-white/8 flex items-center justify-center text-zinc-400 hover:text-zinc-200 transition-all">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="flex gap-1 bg-white/5 border border-white/8 rounded-xl p-1">
          {SEASONS.map(s => (
            <button key={s} onClick={() => { setSeason(s); setSelectedAnime(null); }}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${season === s ? "bg-emerald-500/15 text-emerald-400" : "text-zinc-500 hover:text-zinc-300"}`}>
              {SEASON_LABELS[s]}
            </button>
          ))}
        </div>
        <span className="text-zinc-300 font-bold text-lg">{year}</span>
        <button onClick={() => setYear(y => y - 1)}
          className="w-8 h-8 rounded-lg bg-white/5 text-zinc-500 hover:text-zinc-300 flex items-center justify-center transition-all text-sm">−</button>
        <button onClick={() => setYear(y => y + 1)}
          className="w-8 h-8 rounded-lg bg-white/5 text-zinc-500 hover:text-zinc-300 flex items-center justify-center transition-all text-sm">+</button>
        <button onClick={handleNext}
          className="w-9 h-9 rounded-xl bg-white/5 border border-white/8 flex items-center justify-center text-zinc-400 hover:text-zinc-200 transition-all">
          <ChevronRight className="w-4 h-4" />
        </button>
        {!loading && (
          <span className="text-xs text-zinc-600 ml-auto">{filtered.length} titles</span>
        )}
      </div>

      {/* Content */}
      <div className="flex flex-1 gap-6 min-h-0">

        {/* Grid */}
        <div ref={containerRef} className="flex-1 min-w-0">
          <div ref={scrollRef} className="h-full overflow-y-auto"
            onScroll={e => setScrollTop((e.target as HTMLDivElement).scrollTop)}>

            {loading && (
              <div className="flex items-center justify-center h-40">
                <div className="w-7 h-7 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
              </div>
            )}
            {error && <div className="flex items-center justify-center h-40 text-red-400 text-sm">{error}</div>}
            {!loading && !error && filtered.length === 0 && (
              <div className="flex flex-col items-center justify-center h-48 gap-3 text-zinc-600">
                <span className="text-4xl">¯\_(ツ)_/¯</span>
                <span className="text-sm">Nothing found</span>
              </div>
            )}

            {!loading && !error && filtered.length > 0 && (
              <div style={{ height: totalHeight, position: "relative" }}>
                {visibleRows.map(({ row, top, index }) => (
                  <div key={index} style={{ position: "absolute", top, left: 0, right: 0 }}>
                    <div className="grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: CARD_GAP, marginBottom: CARD_GAP }}>
                      {row.map(a => (
                        <BrowseCard
                          key={a.id}
                          anime={a}
                          isSelected={selectedAnime?.id === a.id}
                          inLibrary={libraryIds.has(a.id) || addingIds.has(a.id)}
                          onClick={() => setSelectedAnime(prev => prev?.id === a.id ? null : a)}
                          onAdd={(status) => handleAdd(a, status)}
                          onRemove={() => handleRemove(a.id)}
                          settings={settings}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Detail panel */}
        {selectedAnime && (
          <div className="w-80 flex-shrink-0 overflow-y-auto">
            <BrowseDetail
              anime={selectedAnime}
              inLibrary={libraryIds.has(selectedAnime.id)}
              onAdd={(status) => handleAdd(selectedAnime, status)}
              onRemove={() => { handleRemove(selectedAnime.id); setSelectedAnime(null); }}
              onClose={() => setSelectedAnime(null)}
              settings={settings}
            />
          </div>
        )}
      </div>
    </div>
  );
}
