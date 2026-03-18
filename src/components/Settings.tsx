import React, { useState, useEffect } from "react";
import {
  ShieldCheck, FolderOpen,
  Database, Languages, ExternalLink, CheckCircle2, AlertCircle,
  RefreshCw, Save, Eye, EyeOff, Users,
} from "lucide-react";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import { api } from "../api";
import type { AppSettings } from "../types/anime";

interface SettingsProps {
  settings: AppSettings;
  onSave: (updates: Partial<AppSettings>) => Promise<boolean>;
  saving: boolean;
  onSyncComplete?: () => void;
}

interface AniListUser {
  id: number;
  name: string;
  avatar: { large: string } | null;
}

function Section({ icon, title, children }: {
  icon: React.ReactNode; title: string; children: React.ReactNode;
}) {
  return (
    <section className="space-y-4">
      <h3 className="text-base font-bold flex items-center gap-2.5 text-emerald-400">
        <span className="w-5 h-5 flex items-center justify-center">{icon}</span>
        {title}
      </h3>
      <div className="bg-zinc-900/60 border border-white/5 rounded-2xl p-6 space-y-5">
        {children}
      </div>
    </section>
  );
}

function Divider() {
  return <div className="border-t border-white/5" />;
}

export function Settings({ settings, onSave, saving, onSyncComplete }: SettingsProps) {
  const [local, setLocal] = useState<any>(settings);
  const [showToken, setShowToken] = useState(false);
  const [anilistUser, setAnilistUser] = useState<AniListUser | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => { setLocal(settings); }, [settings]);

  useEffect(() => {
    if (settings.anilist_token) verifyToken(settings.anilist_token);
  }, [settings.anilist_token]);

  const set = (key: string, value: string) =>
    setLocal((prev: any) => ({ ...prev, [key]: value }));

  async function verifyToken(token: string) {
    if (!token.trim()) { setAnilistUser(null); return; }
    setVerifying(true);
    setVerifyError(null);
    try {
      const res = await fetch("https://graphql.anilist.co", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ query: `query { Viewer { id name avatar { large } } }` }),
      });
      const data = await res.json();
      if (data.data?.Viewer) {
        setAnilistUser(data.data.Viewer);
        setVerifyError(null);
      } else {
        setAnilistUser(null);
        setVerifyError("Invalid token — AniList did not recognise it.");
      }
    } catch {
      setVerifyError("Could not reach AniList. Check your internet connection.");
    } finally {
      setVerifying(false);
    }
  }

  async function syncFromAniList() {
    if (!local.anilist_token) return;
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await api.post<{ synced: number; updated: number; new: number }>(
        "/api/tracker/import-list", { tracker: "anilist" }
      );
      setSyncResult(`Synced ${res.synced} anime (${res.new} new, ${res.updated} updated)`);
      onSyncComplete?.();
    } catch (e) {
      setSyncResult(`Sync failed: ${e instanceof Error ? e.message : "Unknown error"}`);
    } finally {
      setSyncing(false);
    }
  }

  async function handleSave() {
    const ok = await onSave(local);
    if (ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      if (local.anilist_token !== settings.anilist_token) verifyToken(local.anilist_token);
    }
  }

  function exportConfig() {
    const blob = new Blob([JSON.stringify(local, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `anitrack-config-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function importConfig(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string);
        setLocal((prev: any) => ({ ...prev, ...data }));
      } catch { alert("Invalid config file."); }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  function openAniListAuth() {
    const clientId = local.anilist_client_id?.trim();
    if (!clientId) { alert("Enter your AniList Client ID first."); return; }
    const url = `https://anilist.co/api/v2/oauth/authorize?client_id=${clientId}&response_type=token`;
    (window as any).electronAPI?.openExternal(url) ?? window.open(url, "_blank");
  }

  return (
    <div className="h-full overflow-y-auto scrollbar-thin pr-1">
      <div className="max-w-2xl space-y-8 pb-24">
        <h1 className="text-3xl font-bold tracking-tight mt-4">Settings</h1>

        {/* AniList Authentication */}
        <Section icon={<ShieldCheck className="w-5 h-5" />} title="AniList Authentication">
          {anilistUser && (
            <div className="flex items-center gap-3 p-3 bg-emerald-500/5 border border-emerald-500/20 rounded-xl">
              {anilistUser.avatar?.large && (
                <img
                  src={`http://localhost:3000/api/proxy-image?url=${encodeURIComponent(anilistUser.avatar.large)}`}
                  alt={anilistUser.name}
                  className="w-10 h-10 rounded-full border border-emerald-500/30"
                />
              )}
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm text-zinc-100">{anilistUser.name}</p>
                <p className="text-[10px] text-emerald-400 font-bold uppercase tracking-wider">Connected</p>
              </div>
              <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0" />
            </div>
          )}

          {verifyError && (
            <div className="flex items-center gap-2 p-3 bg-red-500/5 border border-red-500/20 rounded-xl text-sm text-red-400">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {verifyError}
            </div>
          )}

          <div className="space-y-2">
            <Input
              label="AniList Client ID"
              value={local.anilist_client_id ?? ""}
              onChange={(e) => set("anilist_client_id", e.target.value)}
              placeholder="Your AniList application Client ID"
              hint="Create one at anilist.co/settings/developer"
            />
            <Button variant="ghost" size="sm" icon={<ExternalLink className="w-3.5 h-3.5" />}
              onClick={() => {
                const url = "https://anilist.co/settings/developer";
                (window as any).electronAPI?.openExternal(url) ?? window.open(url, "_blank");
              }}>
              Open AniList Developer Settings
            </Button>
          </div>

          <Divider />

          <div className="space-y-2">
            <div className="relative">
              <Input
                label="Access Token"
                type={showToken ? "text" : "password"}
                value={local.anilist_token ?? ""}
                onChange={(e) => set("anilist_token", e.target.value)}
                placeholder="Paste your token here after authorising"
                hint="After clicking Authorise below, copy the token from the URL and paste it here"
              />
              <button type="button" onClick={() => setShowToken(v => !v)}
                className="absolute right-3 top-9 text-zinc-500 hover:text-zinc-300 transition-colors no-drag">
                {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <div className="flex gap-2">
              <Button variant="primary" size="sm" icon={<ExternalLink className="w-3.5 h-3.5" />} onClick={openAniListAuth}>
                Authorise with AniList
              </Button>
              <Button variant="secondary" size="sm" loading={verifying}
                onClick={() => verifyToken(local.anilist_token)} disabled={!local.anilist_token}>
                Verify Token
              </Button>
            </div>
          </div>

          <Divider />

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-zinc-300">Sync Anime List</p>
                <p className="text-xs text-zinc-500 mt-0.5">Import your AniList library into the local database</p>
              </div>
              <Button variant="secondary" size="sm" loading={syncing}
                icon={<RefreshCw className="w-3.5 h-3.5" />}
                onClick={syncFromAniList} disabled={!anilistUser}>
                Sync Now
              </Button>
            </div>
            {syncResult && (
              <p className={`text-xs pl-0.5 ${syncResult.includes("failed") ? "text-red-400" : "text-emerald-400"}`}>
                {syncResult}
              </p>
            )}
          </div>
        </Section>

        {/* Local Library */}
        <Section icon={<FolderOpen className="w-5 h-5" />} title="Local Library">
          <Input label="Base Anime Folder" value={local.base_folder ?? ""} onChange={(e) => set("base_folder", e.target.value)}
            placeholder="/home/user/Anime  or  D:\Anime" mono
            hint="All series stored as: Base Folder / Romaji Title /" />
          <Divider />
          <Input label="Tracking Delay (seconds)" type="number" value={local.tracking_delay ?? "180"}
            onChange={(e) => set("tracking_delay", e.target.value)}
            hint="Time after launch before AniList progress is updated. Default: 180 (3 minutes)" />
          <Divider />
          <div className="space-y-2">
            <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Preferred Player</label>
            <div className="flex bg-black/40 p-1 rounded-xl border border-white/10 no-drag">
              {(["mpv", "vlc"] as const).map((mode) => (
                <button key={mode} onClick={() => set("player_mode", mode)}
                  className={`flex-1 py-2 rounded-lg font-bold text-sm uppercase transition-all ${
                    local.player_mode === mode ? "bg-emerald-500 text-black" : "text-zinc-500 hover:text-zinc-300"
                  }`}>
                  {mode}
                </button>
              ))}
            </div>
          </div>
          <Input label="Player Executable Path (optional)" value={local.player_path ?? ""}
            onChange={(e) => set("player_path", e.target.value)}
            placeholder="/usr/bin/mpv  or  C:\Program Files\mpv\mpv.exe" mono
            hint="Leave empty to use system default" />
          <Divider />
          <Input label="Torrent Client Path (optional)" value={local.torrent_client_path ?? ""}
            onChange={(e) => set("torrent_client_path", e.target.value)}
            placeholder="/usr/bin/qbittorrent" mono
            hint="Leave empty to use system default magnet handler" />
        </Section>

        {/* Sync Watch */}
        <Section icon={<Users className="w-5 h-5" />} title="Sync Watch">
          <Input
            label="Display Nickname"
            value={local.nickname ?? ""}
            onChange={(e) => set("nickname", e.target.value)}
            placeholder="Your display name in watch rooms"
          />
          <Divider />
          <Input
            label="Hub Server URL"
            value={local.hub_url ?? "https://anitrack-hub.onrender.com"}
            onChange={(e) => set("hub_url", e.target.value)}
            placeholder="https://anitrack-hub.onrender.com"
            mono
            hint="The sync server all users must connect to. Leave default unless self-hosting."
          />
        </Section>

        {/* Appearance */}
        <Section icon={<Languages className="w-5 h-5" />} title="Appearance">
          <div className="space-y-2">
            <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Title Language</label>
            <div className="flex bg-black/40 p-1 rounded-xl border border-white/10 no-drag">
              {(["romaji", "english", "native"] as const).map((lang) => (
                <button key={lang} onClick={() => set("language", lang)}
                  className={`flex-1 py-2 rounded-lg font-bold text-sm capitalize transition-all ${
                    local.language === lang ? "bg-emerald-500 text-black" : "text-zinc-500 hover:text-zinc-300"
                  }`}>
                  {lang}
                </button>
              ))}
            </div>
          </div>
        </Section>

        {/* Data Management */}
        <Section icon={<Database className="w-5 h-5" />} title="Data Management">
          <div className="grid grid-cols-2 gap-3">
            <Button variant="secondary" onClick={exportConfig} icon={<Database className="w-4 h-4" />}>
              Export Config
            </Button>
            <label className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm rounded-xl bg-zinc-800 text-zinc-200 font-medium hover:bg-zinc-700 border border-white/5 cursor-pointer transition-all no-drag">
              <RefreshCw className="w-4 h-4" /> Import Config
              <input type="file" accept=".json" onChange={importConfig} className="hidden" />
            </label>
          </div>
        </Section>

        <Button variant="primary" size="lg" className="w-full" onClick={handleSave} loading={saving}
          icon={saved ? <CheckCircle2 className="w-4 h-4" /> : <Save className="w-4 h-4" />}>
          {saved ? "Saved!" : "Save Settings"}
        </Button>
      </div>
    </div>
  );
}

declare global {
  interface Window {
    electronAPI?: {
      openExternal: (url: string) => void;
      getConfig: () => Promise<{ serverPort: number; isDev: boolean }>;
      showItemInFolder: (path: string) => void;
    };
  }
}
