import { useState, useEffect, useCallback } from "react";
import { api } from "../api";
import type { AppSettings } from "../types/anime";

const DEFAULTS: AppSettings = {
  base_folder: "",
  anilist_token: "",
  mal_token: "",
  active_tracker: "anilist",
  theme: "dark",
  auto_update_tracker: "true",
  language: "romaji",
};

export function useSettings() {
  const [settings, setSettingsState] = useState<AppSettings>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.get<AppSettings>("/api/settings");
      setSettingsState({ ...DEFAULTS, ...data });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load settings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = useCallback(async (updates: Partial<AppSettings>) => {
    setSaving(true);
    try {
      const updated = await api.patch<AppSettings>("/api/settings", updates);
      setSettingsState({ ...DEFAULTS, ...updated });
      setError(null);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save settings");
      return false;
    } finally {
      setSaving(false);
    }
  }, []);

  return { settings, loading, saving, error, save, reload: load };
}
