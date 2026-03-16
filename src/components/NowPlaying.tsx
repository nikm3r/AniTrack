import React, { useEffect, useState } from "react";
import { X, Clock } from "lucide-react";
import type { Anime } from "../types/anime";

interface Props {
  anime: Anime;
  episode: number | null;
  secondsRemaining: number;
  onDismiss: () => void;
}

function formatTime(seconds: number): string {
  if (seconds <= 0) return "0s";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

function proxyUrl(url: string | null): string | null {
  if (!url) return null;
  return `http://localhost:3000/api/proxy-image?url=${encodeURIComponent(url)}`;
}

export default function NowPlaying({ anime, episode, secondsRemaining, onDismiss }: Props) {
  const [ticking, setTicking] = useState(secondsRemaining);

  // Countdown from server-provided seconds
  useEffect(() => {
    setTicking(secondsRemaining);
  }, [secondsRemaining]);

  useEffect(() => {
    if (ticking <= 0) return;
    const id = setInterval(() => setTicking(t => Math.max(0, t - 1)), 1000);
    return () => clearInterval(id);
  }, [ticking > 0]);

  const coverUrl = proxyUrl(anime.cover_image);
  const isTracking = ticking <= 0;
  const pct = secondsRemaining > 0 ? Math.max(0, (ticking / secondsRemaining) * 100) : 0;
  const title = anime.title_english || anime.title_romaji;

  return (
    <div className="
      mb-4 flex items-center gap-3 bg-emerald-500/8 border border-emerald-500/20
      rounded-2xl px-4 py-3 relative overflow-hidden
    ">
      {/* Animated scan-line */}
      {!isTracking && (
        <div
          className="absolute inset-y-0 left-0 bg-emerald-500/5 transition-all duration-1000 ease-linear"
          style={{ width: `${100 - pct}%` }}
        />
      )}

      {/* Cover */}
      {coverUrl && (
        <div className="w-10 h-14 rounded-lg overflow-hidden flex-shrink-0 ring-1 ring-white/10">
          <img src={coverUrl} alt="" className="w-full h-full object-cover" />
        </div>
      )}

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          {/* Pulsing dot */}
          <span className="relative flex h-2 w-2 flex-shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
          <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest">
            Now Playing
          </span>
          {episode != null && (
            <span className="text-[10px] text-zinc-500">
              — Episode {String(episode).padStart(2, "0")}
            </span>
          )}
        </div>

        <p className="text-sm font-semibold text-zinc-200 truncate">{title}</p>

        {/* Tracking state */}
        <div className="flex items-center gap-1.5 mt-1">
          <Clock className="w-3 h-3 text-zinc-600 flex-shrink-0" />
          {isTracking ? (
            <span className="text-[11px] text-emerald-400 font-medium">
              ✓ Progress tracked
            </span>
          ) : (
            <span className="text-[11px] text-zinc-500">
              Tracking in {formatTime(ticking)}
            </span>
          )}
        </div>
      </div>

      {/* Progress ring (tracking countdown) */}
      {!isTracking && (
        <div className="relative w-10 h-10 flex-shrink-0">
          <svg className="w-10 h-10 -rotate-90" viewBox="0 0 36 36">
            <circle
              cx="18" cy="18" r="15"
              fill="none"
              stroke="rgba(255,255,255,0.06)"
              strokeWidth="3"
            />
            <circle
              cx="18" cy="18" r="15"
              fill="none"
              stroke="#10b981"
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={`${2 * Math.PI * 15}`}
              strokeDashoffset={`${2 * Math.PI * 15 * (pct / 100)}`}
              className="transition-all duration-1000 ease-linear"
            />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-zinc-400">
            {Math.ceil(ticking / 60) > 0 ? `${Math.ceil(ticking / 60)}m` : `${ticking}s`}
          </span>
        </div>
      )}

      {isTracking && (
        <div className="w-8 h-8 rounded-full bg-emerald-500/15 flex items-center justify-center flex-shrink-0">
          <span className="text-emerald-400 text-sm">✓</span>
        </div>
      )}

      {/* Dismiss */}
      <button
        onClick={onDismiss}
        className="absolute top-2 right-2 w-5 h-5 rounded-full bg-white/5 flex items-center justify-center text-zinc-600 hover:text-zinc-400 transition-colors"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}
