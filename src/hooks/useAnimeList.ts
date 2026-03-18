import { useState, useEffect, useCallback } from "react";
import { api } from "../api";
import type { Anime, AnimeStatus } from "../types/anime";

interface UseAnimeListOptions {
  status?: AnimeStatus;
  autoLoad?: boolean;
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

  const updateAnime = useCallback((id: number, updates: Partial<Anime>) => {
    setAnime((prev) =>
      prev.map((a) => (a.id === id ? { ...a, ...updates } : a))
    );
  }, []);

  const removeAnime = useCallback((id: number) => {
    setAnime((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const addAnime = useCallback((newAnime: Anime) => {
    setAnime((prev) => [newAnime, ...prev]);
  }, []);

  return { anime, loading, error, reload: load, updateAnime, removeAnime, addAnime };
}
