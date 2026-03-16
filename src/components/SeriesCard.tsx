import React, { useState } from "react";
import { Star, Plus, Minus } from "lucide-react";
import type { Anime } from "../types/anime";
import { api } from "../api";

interface Props {
  anime: Anime;
  isSelected: boolean;
  isNowPlaying: boolean;
  nowPlayingEpisode: number | null;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onUpdate: (updated: Partial<Anime> & { id: number }) => void;
}

function proxyUrl(url: string | null): string | null {
  if (!url) return null;
  return `http://localhost:3000/api/proxy-image?url=${encodeURIComponent(url)}`;
}

export default function SeriesCard({
  anime, isSelected, isNowPlaying, nowPlayingEpisode,
  onClick, onContextMenu, onUpdate,
}: Props) {
  const [imgError, setImgError] = useState(false);
  const [updating, setUpdating] = useState(false);
  const cover = imgError ? null : proxyUrl(anime.cover_image);
  const pct = anime.total_episodes
    ? Math.min(100, Math.round((anime.progress / anime.total_episodes) * 100))
    : 0;
  const title = anime.title_english || anime.title_romaji;

  const changeProgress = async (e: React.MouseEvent, delta: number) => {
    e.stopPropagation();
    e.preventDefault();
    if (updating) return;
    const next = Math.max(0, anime.progress + delta);
    if (anime.total_episodes && next > anime.total_episodes) return;
    setUpdating(true);
    try {
      const updated = await api.patch<Anime>(`/api/anime/${anime.id}/progress`, { progress: next });
      onUpdate({ id: anime.id, progress: updated.progress, status: updated.status });
    } catch (e) {
      console.error(e);
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={`
        relative group flex flex-col rounded-2xl overflow-hidden cursor-pointer
        transition-all duration-200 select-none
        ${isSelected
          ? "ring-2 ring-emerald-500 shadow-xl shadow-emerald-500/20"
          : "ring-1 ring-white/8 hover:ring-white/20 hover:shadow-xl hover:shadow-black/40"
        }
      `}
    >
      {/* Cover image */}
      <div className="relative bg-zinc-900 overflow-hidden" style={{ aspectRatio: "2/3" }}>
        {cover ? (
          <img
            src={cover}
            alt={title}
            onError={() => setImgError(true)}
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-zinc-900 p-3">
            <span className="text-zinc-600 text-xs font-medium text-center leading-tight">{title}</span>
          </div>
        )}

        {/* Gradient */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />

        {/* Now Playing badge */}
        {isNowPlaying && (
          <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5 bg-emerald-500 text-black text-[9px] font-black px-2 py-1 rounded-full shadow-lg">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-black opacity-60" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-black" />
            </span>
            {nowPlayingEpisode != null ? `EP ${nowPlayingEpisode}` : "PLAYING"}
          </div>
        )}

        {/* Score badge */}
        {anime.score != null && anime.score > 0 && (
          <div className="absolute top-2.5 right-2.5 flex items-center gap-1 bg-black/75 backdrop-blur-sm text-amber-400 text-xs font-bold px-2 py-1 rounded-lg">
            <Star className="w-3 h-3 fill-current" />
            {anime.score}
          </div>
        )}

        {/* Format badge */}
        {anime.format && anime.format !== "TV" && (
          <div className="absolute bottom-14 right-2.5 text-[10px] font-bold text-zinc-400 bg-black/75 backdrop-blur-sm px-1.5 py-0.5 rounded-md">
            {anime.format.replace("_", " ")}
          </div>
        )}

        {/* Progress + controls overlay at bottom of image */}
        <div className="absolute bottom-0 left-0 right-0 px-3 pb-2.5 pt-6">
          {/* Episode progress text */}
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] text-zinc-400 font-medium">
              {anime.progress}{anime.total_episodes ? `/${anime.total_episodes}` : ""} ep
            </span>
            {pct > 0 && (
              <span className="text-[11px] text-zinc-500">{pct}%</span>
            )}
          </div>

          {/* Progress bar */}
          {anime.total_episodes != null && anime.total_episodes > 0 && (
            <div className="h-1 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
          )}
        </div>
      </div>

      {/* Info strip */}
      <div className="bg-zinc-900/95 px-3 py-2.5 flex flex-col gap-2">
        <p className="text-xs font-semibold text-zinc-200 leading-snug line-clamp-2 min-h-[2.5rem]">
          {title}
        </p>

        {/* +/- episode controls */}
        <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
          <button
            onClick={e => changeProgress(e, -1)}
            disabled={updating || anime.progress === 0}
            className="flex-1 h-7 rounded-lg bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-zinc-200 transition-all disabled:opacity-30 flex items-center justify-center"
          >
            <Minus className="w-3 h-3" />
          </button>
          <span className="text-xs font-bold text-zinc-300 min-w-[2rem] text-center">
            {anime.progress}
          </span>
          <button
            onClick={e => changeProgress(e, 1)}
            disabled={updating || (anime.total_episodes != null && anime.progress >= anime.total_episodes)}
            className="flex-1 h-7 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-500 hover:text-emerald-400 transition-all disabled:opacity-30 flex items-center justify-center"
          >
            <Plus className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Selected ring */}
      {isSelected && (
        <div className="absolute inset-0 rounded-2xl ring-2 ring-emerald-500 pointer-events-none" />
      )}
    </div>
  );
}
