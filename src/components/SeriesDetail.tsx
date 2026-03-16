import React, { useState, useEffect } from "react";
import {
  X, Star, Play, FolderOpen, RefreshCw, ExternalLink,
  ChevronUp, ChevronDown, Edit2, Check
} from "lucide-react";
import { api } from "../api";
import { Button } from "./ui/Button";
import { Badge } from "./ui/Badge";
import type { Anime, AnimeStatus, AppSettings } from "../types/anime";

interface Props {
  anime: Anime;
  settings: AppSettings;
  onClose: () => void;
  onUpdate: (updated: Partial<Anime> & { id: number }) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

const STATUS_OPTIONS: { value: AnimeStatus; label: string }[] = [
  { value: "WATCHING",  label: "Currently Watching" },
  { value: "COMPLETED", label: "Completed" },
  { value: "PLANNING",  label: "Planning to Watch" },
  { value: "PAUSED",    label: "On Hold" },
  { value: "DROPPED",   label: "Dropped" },
];

function proxyUrl(url: string | null): string | null {
  if (!url) return null;
  return `http://localhost:3000/api/proxy-image?url=${encodeURIComponent(url)}`;
}

export default function SeriesDetail({ anime, settings, onClose, onUpdate, onContextMenu }: Props) {
  const [syncing, setSyncing] = useState(false);
  const [savingStatus, setSavingStatus] = useState(false);
  const [savingProgress, setSavingProgress] = useState(false);
  const [editingProgress, setEditingProgress] = useState(false);
  const [progressInput, setProgressInput] = useState(String(anime.progress));
  const [expanded, setExpanded] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [folderExists, setFolderExists] = useState<boolean | null>(null);

  // Reset state when anime changes
  useEffect(() => {
    setProgressInput(String(anime.progress));
    setEditingProgress(false);
    setImgError(false);
    setExpanded(false);
  }, [anime.id]);

  // Check folder existence
  useEffect(() => {
    const check = async () => {
      try {
        const res = await api.post<{ path: string; exists: boolean }>(
          "/api/files/resolve-path",
          { title_romaji: anime.title_romaji }
        );
        setFolderExists(res.exists);
      } catch {
        setFolderExists(null);
      }
    };
    check();
  }, [anime.id, anime.title_romaji]);

  const bannerUrl = imgError ? null : proxyUrl(anime.banner_image || anime.cover_image);
  const coverUrl = proxyUrl(anime.cover_image);

  const handleStatusChange = async (status: AnimeStatus) => {
    setSavingStatus(true);
    try {
      await api.patch(`/api/anime/${anime.id}`, { status });
      onUpdate({ id: anime.id, status });
    } catch (e) {
      console.error(e);
    } finally {
      setSavingStatus(false);
    }
  };

  const handleProgressSave = async () => {
    const val = parseInt(progressInput, 10);
    if (isNaN(val) || val < 0) return;
    setSavingProgress(true);
    try {
      const updated = await api.patch<Anime>(`/api/anime/${anime.id}/progress`, {
        progress: val,
      });
      onUpdate({ id: anime.id, progress: updated.progress, status: updated.status });
    } catch (e) {
      console.error(e);
    } finally {
      setSavingProgress(false);
      setEditingProgress(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await api.post<{ data: Anime }>(`/api/tracker/sync/${anime.id}`, {});
      onUpdate({ id: anime.id, ...res.data });
    } catch (e) {
      console.error(e);
    } finally {
      setSyncing(false);
    }
  };

  const openFolder = async () => {
    try {
      const res = await api.post<{ path: string }>("/api/files/resolve-path", {
        title_romaji: anime.title_romaji,
      });
      // Open folder via Electron shell if available
      if ((window as any).electronAPI?.openPath) {
        (window as any).electronAPI.openPath(res.path);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const genres: string[] = Array.isArray(anime.genres)
    ? anime.genres
    : anime.genres
    ? JSON.parse(anime.genres as unknown as string)
    : [];

  const description = (anime as any).description as string | null;
  const averageScore = (anime as any).average_score as number | null;
  const altTitle = (anime as any).alt_title as string | null;

  const truncated = description && description.length > 200 && !expanded;
  const displayDesc = truncated ? description.slice(0, 200) + "…" : description;

  return (
    <div
      className="bg-zinc-900/50 border border-white/8 rounded-2xl overflow-hidden flex flex-col"
      onContextMenu={onContextMenu}
    >
      {/* Banner / cover header */}
      <div className="relative h-36 bg-zinc-950 overflow-hidden flex-shrink-0">
        {bannerUrl && !imgError ? (
          <img
            src={bannerUrl}
            alt=""
            onError={() => setImgError(true)}
            className="w-full h-full object-cover opacity-60"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-zinc-900 to-zinc-950" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-zinc-900 via-zinc-900/40 to-transparent" />

        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 w-7 h-7 rounded-full bg-black/60 flex items-center justify-center text-zinc-400 hover:text-zinc-100 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>

        {/* Cover thumbnail */}
        {coverUrl && (
          <div className="absolute bottom-3 left-3 w-12 h-18 rounded-lg overflow-hidden ring-2 ring-white/10 shadow-lg flex-shrink-0">
            <img src={coverUrl} alt="" className="w-full h-full object-cover" />
          </div>
        )}

        {/* Title */}
        <div className="absolute bottom-3 left-3 right-3" style={{ left: coverUrl ? "4.5rem" : "0.75rem" }}>
          <h2 className="text-sm font-bold text-zinc-100 leading-tight line-clamp-2">
            {anime.title_english || anime.title_romaji}
          </h2>
          {anime.title_romaji !== (anime.title_english || anime.title_romaji) && (
            <p className="text-[10px] text-zinc-500 mt-0.5 line-clamp-1">{anime.title_romaji}</p>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="p-4 flex flex-col gap-4 overflow-y-auto flex-1 scrollbar-thin">

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-white/5 rounded-xl p-2.5 text-center">
            <p className="text-[10px] text-zinc-600 uppercase tracking-widest mb-0.5">Progress</p>
            <p className="text-sm font-bold text-zinc-200">
              {anime.progress}
              {anime.total_episodes ? `/${anime.total_episodes}` : ""}
            </p>
          </div>
          <div className="bg-white/5 rounded-xl p-2.5 text-center">
            <p className="text-[10px] text-zinc-600 uppercase tracking-widest mb-0.5">My Score</p>
            <p className="text-sm font-bold text-amber-400 flex items-center justify-center gap-1">
              {anime.score ? (
                <><Star className="w-3 h-3 fill-current" />{anime.score}</>
              ) : "—"}
            </p>
          </div>
          <div className="bg-white/5 rounded-xl p-2.5 text-center">
            <p className="text-[10px] text-zinc-600 uppercase tracking-widest mb-0.5">Avg</p>
            <p className="text-sm font-bold text-zinc-200">
              {averageScore ? `${averageScore}%` : "—"}
            </p>
          </div>
        </div>

        {/* Progress editor */}
        <div>
          <p className="text-[10px] text-zinc-600 uppercase tracking-widest mb-1.5">Episode Progress</p>
          <div className="flex items-center gap-2">
            {editingProgress ? (
              <>
                <input
                  type="number"
                  value={progressInput}
                  onChange={e => setProgressInput(e.target.value)}
                  min={0}
                  max={anime.total_episodes ?? 9999}
                  className="
                    flex-1 bg-black/40 border border-white/15 rounded-lg px-3 py-1.5
                    text-sm text-zinc-100 focus:outline-none focus:border-emerald-500/60
                  "
                  autoFocus
                  onKeyDown={e => { if (e.key === "Enter") handleProgressSave(); if (e.key === "Escape") setEditingProgress(false); }}
                />
                <Button size="sm" variant="primary" loading={savingProgress} onClick={handleProgressSave} icon={<Check className="w-3 h-3" />}>
                  Save
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditingProgress(false)}>
                  <X className="w-3 h-3" />
                </Button>
              </>
            ) : (
              <>
                <div className="flex-1 bg-white/5 rounded-lg px-3 py-1.5 text-sm text-zinc-400">
                  Episode {anime.progress}
                  {anime.total_episodes ? ` of ${anime.total_episodes}` : ""}
                </div>
                <button
                  onClick={() => setEditingProgress(true)}
                  className="w-7 h-7 rounded-lg bg-white/5 flex items-center justify-center text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  <Edit2 className="w-3 h-3" />
                </button>
                <button
                  onClick={async () => {
                    const next = anime.progress + 1;
                    setSavingProgress(true);
                    try {
                      const updated = await api.patch<Anime>(`/api/anime/${anime.id}/progress`, { progress: next });
                      onUpdate({ id: anime.id, progress: updated.progress, status: updated.status });
                    } finally { setSavingProgress(false); }
                  }}
                  disabled={savingProgress || (anime.total_episodes != null && anime.progress >= anime.total_episodes)}
                  className="w-7 h-7 rounded-lg bg-emerald-500/10 text-emerald-500 flex items-center justify-center hover:bg-emerald-500/20 transition-colors disabled:opacity-30"
                >
                  <ChevronUp className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={async () => {
                    const next = Math.max(0, anime.progress - 1);
                    setSavingProgress(true);
                    try {
                      const updated = await api.patch<Anime>(`/api/anime/${anime.id}/progress`, { progress: next });
                      onUpdate({ id: anime.id, progress: updated.progress, status: updated.status });
                    } finally { setSavingProgress(false); }
                  }}
                  disabled={savingProgress || anime.progress === 0}
                  className="w-7 h-7 rounded-lg bg-white/5 text-zinc-500 flex items-center justify-center hover:text-zinc-300 transition-colors disabled:opacity-30"
                >
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
              </>
            )}
          </div>
          {anime.total_episodes && anime.total_episodes > 0 && (
            <div className="h-1 bg-zinc-800 rounded-full mt-2 overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                style={{ width: `${Math.min(100, (anime.progress / anime.total_episodes) * 100)}%` }}
              />
            </div>
          )}
        </div>

        {/* Status selector */}
        <div>
          <p className="text-[10px] text-zinc-600 uppercase tracking-widest mb-1.5">Status</p>
          <div className="flex flex-wrap gap-1">
            {STATUS_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => handleStatusChange(opt.value)}
                disabled={savingStatus}
                className={`
                  px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all
                  ${anime.status === opt.value
                    ? "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30"
                    : "bg-white/5 text-zinc-500 hover:text-zinc-300 hover:bg-white/8"
                  }
                `}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Alt title */}
        {altTitle && (
          <div>
            <p className="text-[10px] text-zinc-600 uppercase tracking-widest mb-1">Alt. Title</p>
            <p className="text-xs text-zinc-400 bg-white/5 rounded-lg px-3 py-2">{altTitle}</p>
          </div>
        )}

        {/* Genres */}
        {genres.length > 0 && (
          <div>
            <p className="text-[10px] text-zinc-600 uppercase tracking-widest mb-1.5">Genres</p>
            <div className="flex flex-wrap gap-1.5">
              {genres.map(g => (
                <Badge key={g} color="zinc">{g}</Badge>
              ))}
            </div>
          </div>
        )}

        {/* Description */}
        {description && (
          <div>
            <p className="text-[10px] text-zinc-600 uppercase tracking-widest mb-1.5">Synopsis</p>
            <p className="text-xs text-zinc-400 leading-relaxed">
              {displayDesc}
            </p>
            {description.length > 200 && (
              <button
                onClick={() => setExpanded(e => !e)}
                className="text-[10px] text-emerald-500 hover:text-emerald-400 mt-1 transition-colors"
              >
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
          {anime.format && (
            <div>
              <span className="text-[10px] uppercase tracking-widest block mb-0.5">Format</span>
              <span className="text-zinc-400">{anime.format.replace("_", " ")}</span>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2 pt-1">
          <button
            onClick={handleSync}
            disabled={syncing || !anime.anilist_id}
            className="
              flex items-center justify-center gap-2 w-full py-2 rounded-xl
              bg-white/5 border border-white/8 text-zinc-400 text-xs font-medium
              hover:bg-white/8 hover:text-zinc-200 transition-all disabled:opacity-30
            "
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
            Sync Metadata
          </button>

          <button
            onClick={openFolder}
            disabled={!folderExists}
            className="
              flex items-center justify-center gap-2 w-full py-2 rounded-xl
              bg-white/5 border border-white/8 text-zinc-400 text-xs font-medium
              hover:bg-white/8 hover:text-zinc-200 transition-all disabled:opacity-30
            "
          >
            <FolderOpen className="w-3.5 h-3.5" />
            {folderExists ? "Open Folder" : "Folder Not Found"}
          </button>

          {anime.anilist_id && (
            <a
              href={`https://anilist.co/anime/${anime.anilist_id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="
                flex items-center justify-center gap-2 w-full py-2 rounded-xl
                bg-white/5 border border-white/8 text-zinc-400 text-xs font-medium
                hover:bg-white/8 hover:text-zinc-200 transition-all
              "
            >
              <ExternalLink className="w-3.5 h-3.5" />
              View on AniList
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
