import React, { useState, useEffect, useRef } from "react";
import { Search, Download, Loader2, Wifi, WifiOff, Magnet } from "lucide-react";
import { api } from "../api";
import type { Anime } from "../types/anime";

interface TorrentResult {
  title: string;
  link: string;
  size: string;
  seeders: number;
  leechers: number;
}

interface Props {
  anime: Anime[];
  pendingSearch: string | null;
  onPendingSearchConsumed: () => void;
}

export default function TorrentSearch({ anime, pendingSearch, onPendingSearchConsumed }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TorrentResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadFeedback, setDownloadFeedback] = useState<{ link: string; ok: boolean } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Consume pending search from right-click → Search Torrents
  useEffect(() => {
    if (pendingSearch) {
      setQuery(pendingSearch);
      onPendingSearchConsumed();
      performSearch(pendingSearch);
    }
  }, [pendingSearch]);

  const performSearch = async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    setSearching(true);
    setError(null);
    setResults([]);
    try {
      const res = await api.get<{ data: TorrentResult[] }>(
        `/api/torrents/search?q=${encodeURIComponent(trimmed)}`
      );
      setResults(res.data);
      if (res.data.length === 0) setError("No results found.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
    } finally {
      setSearching(false);
    }
  };

  const handleDownload = async (result: TorrentResult) => {
    setDownloading(result.link);
    try {
      // Try to match query to a series in the library for correct save path
      const matchedAnime = findMatchingAnime(query, anime);

      await api.post("/api/torrents/download", {
        link: result.link,
        titleRomaji: matchedAnime?.title_romaji ?? query,
        animeId: matchedAnime?.id ?? null,
      });

      setDownloadFeedback({ link: result.link, ok: true });
      setTimeout(() => setDownloadFeedback(null), 3000);
    } catch (e) {
      setDownloadFeedback({ link: result.link, ok: false });
      setTimeout(() => setDownloadFeedback(null), 3000);
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0">

      {/* Header */}
      <div className="flex-shrink-0 mb-6">
        <h1 className="text-2xl font-bold text-zinc-100 tracking-tight mb-5">Torrent Search</h1>

        {/* Search bar */}
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === "Enter" && performSearch(query)}
              placeholder="Search AnimeTosho…"
              className="w-full bg-zinc-900/80 border border-white/8 rounded-2xl pl-11 pr-4 py-4 text-base text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500/50 transition-all"
            />
          </div>
          <button
            onClick={() => performSearch(query)}
            disabled={searching || !query.trim()}
            className="px-6 py-4 bg-emerald-500 text-black font-bold rounded-2xl hover:bg-emerald-400 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 flex-shrink-0"
          >
            {searching
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <Search className="w-4 h-4" />
            }
            Search
          </button>
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin space-y-2 pr-1">

        {searching && (
          <div className="flex items-center justify-center h-40 gap-3 text-zinc-500">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm">Searching AnimeTosho…</span>
          </div>
        )}

        {error && !searching && (
          <div className="flex items-center justify-center h-40 text-zinc-500 text-sm">
            {error}
          </div>
        )}

        {!searching && !error && results.length === 0 && query && (
          <div className="flex flex-col items-center justify-center h-40 gap-2 text-zinc-600">
            <span className="text-sm">No results — try a different query</span>
          </div>
        )}

        {!searching && results.length === 0 && !query && (
          <div className="flex flex-col items-center justify-center h-48 gap-3 text-zinc-700">
            <Magnet className="w-10 h-10" />
            <span className="text-sm">Search for anime torrents</span>
            <span className="text-xs text-zinc-800">Right-click any series → Search Torrents to auto-fill</span>
          </div>
        )}

        {results.map((r, i) => {
          const isFeedback = downloadFeedback?.link === r.link;
          const isDownloading = downloading === r.link;

          return (
            <div key={i}
              className="flex items-center gap-4 bg-zinc-900/60 border border-white/5 rounded-2xl px-5 py-4 hover:border-white/10 transition-all group">

              {/* Title + meta */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-zinc-200 leading-snug line-clamp-2 group-hover:text-zinc-100 transition-colors">
                  {r.title}
                </p>
                <div className="flex items-center gap-4 mt-1.5">
                  <span className="text-xs text-zinc-600">{r.size}</span>
                  <span className={`text-xs font-bold ${r.seeders > 10 ? "text-emerald-500" : r.seeders > 0 ? "text-amber-500" : "text-red-500/70"}`}>
                    ↑ {r.seeders} seeds
                  </span>
                  {r.leechers > 0 && (
                    <span className="text-xs text-zinc-700">↓ {r.leechers}</span>
                  )}
                </div>
              </div>

              {/* Download button */}
              <button
                onClick={() => handleDownload(r)}
                disabled={isDownloading || !!downloading}
                className={`
                  flex-shrink-0 flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium text-sm
                  transition-all disabled:opacity-50 disabled:cursor-not-allowed
                  ${isFeedback && downloadFeedback?.ok
                    ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                    : isFeedback && !downloadFeedback?.ok
                    ? "bg-red-500/15 text-red-400 border border-red-500/30"
                    : "bg-white/5 text-zinc-400 border border-white/8 hover:bg-emerald-500/10 hover:text-emerald-400 hover:border-emerald-500/30"
                  }
                `}
              >
                {isDownloading
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : isFeedback && downloadFeedback?.ok
                  ? <span className="text-xs">Sent ✓</span>
                  : isFeedback && !downloadFeedback?.ok
                  ? <span className="text-xs">Failed</span>
                  : <><Download className="w-4 h-4" /><span>Download</span></>
                }
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Match search query to library anime ──────────────────────────────────────
// Finds the best matching anime from the library based on the search query
// so we can use the correct save path

function findMatchingAnime(query: string, animeList: Anime[]): Anime | null {
  if (!query || !animeList.length) return null;
  const q = query.toLowerCase();

  // Score each anime — higher = better match
  let best: Anime | null = null;
  let bestScore = 0;

  for (const a of animeList) {
    const candidates = [
      a.title_romaji,
      a.title_english,
      (a as any).alt_title,
    ].filter(Boolean).map((s: string) => s.toLowerCase());

    for (const c of candidates) {
      // Exact match
      if (q.includes(c) || c.includes(q)) {
        const score = c.length; // longer match = more specific
        if (score > bestScore) { bestScore = score; best = a; }
      }
    }
  }

  return best;
}
