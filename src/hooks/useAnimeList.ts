import { useState, useEffect, useCallback } from "react";
import { api } from "../api";
import type { Anime, AnimeStatus } from "../types/anime";

interface UseAnimeListOptions {
  status?: AnimeStatus;
  autoLoad?: boolean;
}

// Always connect to port 3000 — the Express/Socket.io server
function getSocketUrl(): string {
  return "ws://localhost:3000/socket.io/?EIO=4&transport=websocket";
}

export function useAnimeList(options: UseAnimeListOptions = {}) {
  const { status, autoLoad = true } = options;
  const [anime, setAnime] = useState<Anime[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: "9999" });
      if (status) params.set("status", status);
      const res = await api.get<{ data: Anime[] }>(`/api/anime?${params}`);
      setAnime(res.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load anime list");
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    if (autoLoad) load();
  }, [autoLoad, load]);

  // Listen for progress:updated socket events so UI updates without manual refresh
  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let dead = false;

    const connect = () => {
      if (dead) return;
      try {
        ws = new WebSocket(getSocketUrl());

        ws.onopen = () => ws?.send("40"); // socket.io connect packet

        ws.onmessage = (event) => {
          const data = event.data as string;
          if (data === "2") { ws?.send("3"); return; } // ping/pong
          if (data.startsWith("42")) {
            try {
              const [eventName, payload] = JSON.parse(data.slice(2));
              if (eventName === "progress:updated") {
                const { animeId, progress } = payload as { animeId: number; progress: number };
                // Fetch fresh data for this anime and patch local state
                api.get<Anime>(`/api/anime/${animeId}`)
                  .then(updated => {
                    setAnime(prev => prev.map(a =>
                      a.id === animeId
                        ? { ...updated, genres: Array.isArray((updated as any).genres) ? (updated as any).genres : [] }
                        : a
                    ));
                  })
                  .catch(() => {
                    // Fallback: patch just progress
                    setAnime(prev => prev.map(a => a.id === animeId ? { ...a, progress } : a));
                  });
              }
            } catch { }
          }
        };

        ws.onclose = () => {
          if (!dead) reconnectTimer = setTimeout(connect, 3000);
        };

        ws.onerror = () => ws?.close();
      } catch { }
    };

    connect();

    return () => {
      dead = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, []);

  const updateAnime = useCallback((id: number, updates: Partial<Anime>) => {
    setAnime((prev) => prev.map((a) => (a.id === id ? { ...a, ...updates } : a)));
  }, []);

  const removeAnime = useCallback((id: number) => {
    setAnime((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const addAnime = useCallback((newAnime: Anime) => {
    setAnime((prev) => [newAnime, ...prev]);
  }, []);

  return { anime, loading, error, reload: load, updateAnime, removeAnime, addAnime };
}
