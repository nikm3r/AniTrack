import React, { useState, useEffect } from "react";
import {
  ShieldCheck, FolderOpen,
  Database, Languages, ExternalLink, CheckCircle2, AlertCircle,
  RefreshCw, Save, Eye, EyeOff, Users, Download, Cloud, CloudUpload, CloudDownload,
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

interface TrackerUser {
  name: string;
  avatar: string | null;
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

function ConnectedBadge({ user, onClear }: { user: TrackerUser; onClear?: () => void }) {
  return (
    <div className="flex items-center gap-3 p-3 bg-emerald-500/5 border border-emerald-500/20 rounded-xl">
      {user.avatar && (
        <img
          src={`http://localhost:3000/api/tracker/proxy-image?url=${encodeURIComponent(user.avatar)}`}
          alt={user.name}
          className="w-10 h-10 rounded-full border border-emerald-500/30"
        />
      )}
      <div className="flex-1 min-w-0">
        <p className="font-bold text-sm text-zinc-100">{user.name}</p>
        <p className="text-[10px] text-emerald-400 font-bold uppercase tracking-wider">Connected</p>
      </div>
      <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0" />
    </div>
  );
}

export function Settings({ settings, onSave, saving, onSyncComplete }: SettingsProps) {
  const [local, setLocal] = useState<any>(settings);
  const [showAnilistToken, setShowAnilistToken] = useState(false);
  const [showMalToken, setShowMalToken] = useState(false);

  // AniList auth state
  const [anilistUser, setAnilistUser] = useState<TrackerUser | null>(null);
  const [anilistVerifying, setAnilistVerifying] = useState(false);
  const [anilistVerifyError, setAnilistVerifyError] = useState<string | null>(null);

  // MAL auth state
  const [malUser, setMalUser] = useState<TrackerUser | null>(null);
  const [malVerifying, setMalVerifying] = useState(false);
  const [malVerifyError, setMalVerifyError] = useState<string | null>(null);

  // Shared sync state
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Auto-updater state
  const [updateStatus, setUpdateStatus] = useState<
    "idle" | "checking" | "available" | "not-available" | "downloading" | "ready" | "error"
  >("idle");
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  const [updateProgress, setUpdateProgress] = useState<number>(0);
  const [updateError, setUpdateError] = useState<string | null>(null);

  // Cloud settings sync state
  const [cloudSyncing, setCloudSyncing] = useState(false);
  const [cloudResult, setCloudResult] = useState<string | null>(null);

  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api?.onUpdaterEvent) return;
    const cleanup = api.onUpdaterEvent((event: string, data: any) => {
      if (event === "updater:checking")      setUpdateStatus("checking");
      if (event === "updater:available")     { setUpdateStatus("available"); setUpdateVersion(data?.version ?? null); }
      if (event === "updater:not-available") setUpdateStatus("not-available");
      if (event === "updater:progress")      { setUpdateStatus("downloading"); setUpdateProgress(data?.percent ?? 0); }
      if (event === "updater:downloaded")    { setUpdateStatus("ready"); setUpdateVersion(data?.version ?? null); }
      if (event === "updater:error")         { setUpdateStatus("error"); setUpdateError(data?.message ?? "Unknown error"); }
    });
    return cleanup;
  }, []);

  useEffect(() => { setLocal(settings); }, [settings]);

  // Verify tokens on load if present
  useEffect(() => {
    if (settings.anilist_token) verifyAnilistToken(settings.anilist_token);
  }, [settings.anilist_token]);

  useEffect(() => {
    if (settings.mal_token) verifyMalToken(settings.mal_token);
  }, [settings.mal_token]);

  const set = (key: string, value: string) =>
    setLocal((prev: any) => ({ ...prev, [key]: value }));

  // ─── AniList auth ─────────────────────────────────────────────────────────

  async function verifyAnilistToken(token: string) {
    if (!token.trim()) { setAnilistUser(null); return; }
    setAnilistVerifying(true);
    setAnilistVerifyError(null);
    try {
      const res = await fetch("https://graphql.anilist.co", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ query: `query { Viewer { id name avatar { large } } }` }),
      });
      const data = await res.json();
      if (data.data?.Viewer) {
        setAnilistUser({ name: data.data.Viewer.name, avatar: data.data.Viewer.avatar?.large ?? null });
        setAnilistVerifyError(null);
      } else {
        setAnilistUser(null);
        setAnilistVerifyError("Invalid token — AniList did not recognise it.");
      }
    } catch {
      setAnilistVerifyError("Could not reach AniList. Check your internet connection.");
    } finally {
      setAnilistVerifying(false);
    }
  }

  function openAniListAuth() {
    const clientId = local.anilist_client_id?.trim();
    if (!clientId) { alert("Enter your AniList Client ID first."); return; }
    const url = `https://anilist.co/api/v2/oauth/authorize?client_id=${clientId}&response_type=token`;
    (window as any).electronAPI?.openExternal(url) ?? window.open(url, "_blank");
  }

  // ─── MAL auth ─────────────────────────────────────────────────────────────
  // MAL OAuth 2.0 PKCE flow:
  // MAL OAuth 2.0 PKCE — automatic flow via local HTTP server (port 54321).
  // main.js spins up a temporary server, opens the browser, catches the redirect,
  // and sends the code back via IPC. No manual copy-paste needed.
  //
  // Redirect URI to register in MAL app config: http://localhost:54321/callback

  const MAL_REDIRECT_URI = "http://localhost:54321/callback";

  async function openMALAuth() {
    const clientId = local.mal_client_id?.trim();
    if (!clientId) { alert("Enter your MAL Client ID first."); return; }

    // Generate code_verifier: 43 random URL-safe chars
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
    let verifier = "";
    const arr = new Uint8Array(43);
    crypto.getRandomValues(arr);
    for (const b of arr) verifier += chars[b % chars.length];

    setMalVerifying(true);
    setMalVerifyError(null);

    // Listen for the code coming back automatically from main process
    const cleanup = (window as any).electronAPI?.onMalAuthCode(async (data: { code: string }) => {
      cleanup?.();
      try {
        const res = await api.post<{ access_token: string; refresh_token: string; expires_in: number }>(
          "/api/tracker/mal-token",
          { code: data.code, code_verifier: verifier, client_id: clientId, redirect_uri: MAL_REDIRECT_URI }
        );
        setLocal((prev: any) => ({
          ...prev,
          mal_token: res.access_token,
          mal_refresh_token: res.refresh_token ?? "",
        }));
        await verifyMalToken(res.access_token);
      } catch (e) {
        setMalVerifyError(e instanceof Error ? e.message : "Token exchange failed");
      } finally {
        setMalVerifying(false);
      }
    });

    // Tell main to start the local server and open the browser
    try {
      const result = await (window as any).electronAPI?.startMalAuth(clientId, verifier);
      if (result && !result.ok) {
        cleanup?.();
        setMalVerifyError(result.error || "Auth failed");
        setMalVerifying(false);
      }
      // If result.ok, we wait — the onMalAuthCode listener will fire when the browser redirects
    } catch (e) {
      cleanup?.();
      setMalVerifyError(e instanceof Error ? e.message : "Failed to start auth");
      setMalVerifying(false);
    }
  }

  async function verifyMalToken(token: string) {
    if (!token?.trim()) { setMalUser(null); return; }
    setMalVerifying(true);
    setMalVerifyError(null);
    try {
      // Go through the server — MAL blocks direct browser requests (CORS)
      const res = await fetch("http://localhost:3000/api/mal/user");
      if (res.ok) {
        const data = await res.json();
        setMalUser({
          name: data.name,
          avatar: data.picture ?? null,
        });
        setMalVerifyError(null);
      } else {
        setMalUser(null);
        setMalVerifyError("Invalid token — MAL did not recognise it.");
      }
    } catch {
      setMalVerifyError("Could not reach server.");
    } finally {
      setMalVerifying(false);
    }
  }

  // ─── Sync ──────────────────────────────────────────────────────────────────

  async function syncFromTracker() {
    const trackerName = local.active_tracker ?? "anilist";
    if (trackerName === "anilist" && !anilistUser) return;
    if (trackerName === "mal" && !malUser) return;

    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await api.post<{ synced: number; updated: number; new: number }>(
        "/api/tracker/import-list", { tracker: trackerName }
      );
      setSyncResult(`Synced ${res.synced} anime (${res.new} new, ${res.updated} updated)`);
      onSyncComplete?.();
    } catch (e) {
      setSyncResult(`Sync failed: ${e instanceof Error ? e.message : "Unknown error"}`);
    } finally {
      setSyncing(false);
    }
  }

  // ─── Save ──────────────────────────────────────────────────────────────────

  async function pushToCloud() {
    if (!activeToken || !activeUser) return;
    setCloudSyncing(true);
    setCloudResult(null);
    try {
      const { pushSettings } = await import("../settingsSync");
      await pushSettings(local, activeToken, activeUser.name);
      setCloudResult("Settings pushed to cloud successfully.");
    } catch (e) {
      setCloudResult(`Push failed: ${e instanceof Error ? e.message : "Unknown error"}`);
    } finally {
      setCloudSyncing(false);
    }
  }

  async function pullFromCloud() {
    if (!activeToken || !activeUser) return;
    setCloudSyncing(true);
    setCloudResult(null);
    try {
      const { pullSettings } = await import("../settingsSync");
      const pulled = await pullSettings(activeToken, activeUser.name);
      const KEEP_LOCAL = ["base_folder", "torrent_client_path", "player_executable_path", "player_executable"];
      const merged = { ...local };
      for (const [k, v] of Object.entries(pulled)) {
        if (!KEEP_LOCAL.includes(k)) merged[k] = v;
      }
      setLocal(merged);
      await onSave(merged);
      setCloudResult("Settings pulled and applied. Reloading…");
      setTimeout(() => window.location.reload(), 1200);
    } catch (e) {
      setCloudResult(`Pull failed: ${e instanceof Error ? e.message : "Unknown error"}`);
    } finally {
      setCloudSyncing(false);
    }
  }

  async function handleSave() {
    // Don't persist internal temp fields
    const { _mal_code_verifier, ...toSave } = local;
    const ok = await onSave(toSave);
    if (ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      if (local.anilist_token !== settings.anilist_token) verifyAnilistToken(local.anilist_token);
      if (local.mal_token !== settings.mal_token) verifyMalToken(local.mal_token);
    }
  }

  function exportConfig() {
    const { _mal_code_verifier, ...toExport } = local;
    const blob = new Blob([JSON.stringify(toExport, null, 2)], { type: "application/json" });
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

  const activeTracker = local.active_tracker ?? "anilist";
  const activeToken = activeTracker === "mal" ? local.mal_token : local.anilist_token;
  const activeUser = activeTracker === "mal" ? malUser : anilistUser;
  const syncReady = activeTracker === "anilist" ? !!anilistUser : !!malUser;

  return (
    <div className="h-full overflow-y-auto scrollbar-thin pr-1">
      <div className="max-w-2xl space-y-8 pb-24">
        <h1 className="text-3xl font-bold tracking-tight mt-4">Settings</h1>

        {/* ── Tracker Selection ── */}
        <Section icon={<ShieldCheck className="w-5 h-5" />} title="Tracker">
          <div className="space-y-2">
            <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
              Active Tracker
            </label>
            <div className="flex bg-black/40 p-1 rounded-xl border border-white/10 no-drag">
              {(["anilist", "mal"] as const).map((t) => (
                <button key={t} onClick={() => set("active_tracker", t)}
                  className={`flex-1 py-2 rounded-lg font-bold text-sm transition-all ${
                    activeTracker === t ? "bg-emerald-500 text-black" : "text-zinc-500 hover:text-zinc-300"
                  }`}>
                  {t === "anilist" ? "AniList" : "MyAnimeList"}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-zinc-600 pl-0.5">
              Determines which tracker is used for search, sync, and progress updates.
            </p>
          </div>
        </Section>

        {/* ── AniList Authentication ── */}
        <Section icon={<ShieldCheck className="w-5 h-5" />} title="AniList Authentication">
          {anilistUser && <ConnectedBadge user={anilistUser} />}

          {anilistVerifyError && (
            <div className="flex items-center gap-2 p-3 bg-red-500/5 border border-red-500/20 rounded-xl text-sm text-red-400">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {anilistVerifyError}
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
                type={showAnilistToken ? "text" : "password"}
                value={local.anilist_token ?? ""}
                onChange={(e) => set("anilist_token", e.target.value)}
                placeholder="Paste your token here after authorising"
                hint="After clicking Authorise below, copy the token from the URL and paste it here"
              />
              <button type="button" onClick={() => setShowAnilistToken(v => !v)}
                className="absolute right-3 top-9 text-zinc-500 hover:text-zinc-300 transition-colors no-drag">
                {showAnilistToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <div className="flex gap-2">
              <Button variant="primary" size="sm" icon={<ExternalLink className="w-3.5 h-3.5" />} onClick={openAniListAuth}>
                Authorise with AniList
              </Button>
              <Button variant="secondary" size="sm" loading={anilistVerifying}
                onClick={() => verifyAnilistToken(local.anilist_token)} disabled={!local.anilist_token}>
                Verify Token
              </Button>
            </div>
          </div>

          {activeTracker === "anilist" && (
            <>
              <Divider />
              <SyncRow
                label="Sync Anime List"
                hint="Import your AniList library into the local database"
                syncing={syncing}
                syncResult={syncResult}
                disabled={!syncReady}
                onSync={syncFromTracker}
              />
            </>
          )}
        </Section>

        {/* ── MAL Authentication ── */}
        <Section icon={<ShieldCheck className="w-5 h-5" />} title="MyAnimeList Authentication">
          {malUser && <ConnectedBadge user={malUser} />}

          {malVerifyError && (
            <div className="flex items-center gap-2 p-3 bg-red-500/5 border border-red-500/20 rounded-xl text-sm text-red-400">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {malVerifyError}
            </div>
          )}

          <div className="space-y-2">
            <Input
              label="MAL Client ID"
              value={local.mal_client_id ?? ""}
              onChange={(e) => set("mal_client_id", e.target.value)}
              placeholder="Your MAL application Client ID"
              hint="Create one at myanimelist.net/apiconfig"
            />
            <Button variant="ghost" size="sm" icon={<ExternalLink className="w-3.5 h-3.5" />}
              onClick={() => {
                const url = "https://myanimelist.net/apiconfig";
                (window as any).electronAPI?.openExternal(url) ?? window.open(url, "_blank");
              }}>
              Open MAL API Config
            </Button>
          </div>

          <Divider />

          <div className="space-y-3">
            <div className="text-xs text-zinc-500 space-y-1.5">
              <p>
                <span className="text-amber-400 font-bold">Before you start:</span> in your MAL app config at{" "}
                <span className="font-mono text-zinc-300">myanimelist.net/apiconfig</span>, set the redirect URI to:
              </p>
              <p className="font-mono text-zinc-300 bg-black/40 px-3 py-2 rounded-lg select-all">
                http://localhost:54321/callback
              </p>
              <p>
                Then click <span className="text-zinc-300 font-medium">Authorise with MAL</span> below.
                Log in and approve — AniTrack will handle the rest automatically.
              </p>
            </div>

            <Button variant="primary" size="sm" icon={<ExternalLink className="w-3.5 h-3.5" />}
              onClick={openMALAuth}
              disabled={!local.mal_client_id?.trim() || malVerifying}
              loading={malVerifying}>
              {malVerifying ? "Waiting for authorisation…" : "Authorise with MAL"}
            </Button>

            {local.mal_token && (
              <Button variant="ghost" size="sm" loading={malVerifying}
                onClick={() => verifyMalToken(local.mal_token)}>
                Verify Token
              </Button>
            )}
          </div>

          <Divider />

          <div className="space-y-2">
            <div className="relative">
              <Input
                label="Access Token (manual)"
                type={showMalToken ? "text" : "password"}
                value={local.mal_token ?? ""}
                onChange={(e) => set("mal_token", e.target.value)}
                placeholder="Or paste a token directly if you have one"
                hint="Only needed if the code exchange flow above doesn't work"
              />
              <button type="button" onClick={() => setShowMalToken(v => !v)}
                className="absolute right-3 top-9 text-zinc-500 hover:text-zinc-300 transition-colors no-drag">
                {showMalToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {activeTracker === "mal" && (
            <>
              <Divider />
              <SyncRow
                label="Sync Anime List"
                hint="Import your MyAnimeList library into the local database"
                syncing={syncing}
                syncResult={syncResult}
                disabled={!syncReady}
                onSync={syncFromTracker}
              />
            </>
          )}
        </Section>

        {/* ── Local Library ── */}
        <Section icon={<FolderOpen className="w-5 h-5" />} title="Local Library">
          <Input label="Base Anime Folder" value={local.base_folder ?? ""} onChange={(e) => set("base_folder", e.target.value)}
            placeholder="/home/user/Anime  or  D:\Anime" mono
            hint="All series stored as: Base Folder / Romaji Title /" />
          <Divider />
          <Input label="Tracking Delay (seconds)" type="number" value={local.tracking_delay ?? "180"}
            onChange={(e) => set("tracking_delay", e.target.value)}
            hint="Time after launch before tracker progress is updated. Default: 180 (3 minutes)" />
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
          <Divider />
          <div className="flex flex-col gap-2">
            <label className="text-xs font-bold uppercase tracking-wider text-zinc-500">Torrent Search Source</label>
            <div className="flex rounded-xl overflow-hidden border border-white/8 bg-white/3">
              {([
                { label: "Nyaa", value: "https://nyaa.si/?page=rss&c=1_2&f=0&q=%title%" },
                { label: "Nyaa (trusted)", value: "https://nyaa.si/?page=rss&c=1_2&f=2&q=%title%" },
                { label: "Tokyo Toshokan", value: "https://www.tokyotosho.info/rss.php?terms=%title%&type=1" },
                { label: "Custom", value: "custom" },
              ] as { label: string; value: string }[]).map(({ label, value }) => {
                const presets = ["https://nyaa.si/?page=rss&c=1_2&f=0&q=%title%", "https://nyaa.si/?page=rss&c=1_2&f=2&q=%title%", "https://www.tokyotosho.info/rss.php?terms=%title%&type=1"];
                const currentUrl = local.torrent_rss_url ?? "https://nyaa.si/?page=rss&c=1_2&f=0&q=%title%";
                const isCustom = !presets.includes(currentUrl);
                const isActive = value === "custom" ? isCustom : currentUrl === value;
                return (
                  <button key={value} onClick={() => {
                    if (value !== "custom") set("torrent_rss_url", value);
                  }}
                    className={`flex-1 py-2 text-xs font-bold uppercase transition-all ${isActive ? "bg-emerald-500 text-black" : "text-zinc-500 hover:text-zinc-300"}`}>
                    {label}
                  </button>
                );
              })}
            </div>
            <Input label="" value={local.torrent_rss_url ?? "https://nyaa.si/?page=rss&c=1_2&f=0&q=%title%"}
              onChange={(e) => set("torrent_rss_url", e.target.value)}
              placeholder="https://nyaa.si/?page=rss&c=1_2&f=0&q=%title%" mono
              hint="Use %title% as the search query placeholder" />
          </div>
        </Section>

        {/* ── Sync Watch ── */}
        <Section icon={<Users className="w-5 h-5" />} title="Sync Watch">
          <Input label="Display Nickname" value={local.nickname ?? ""}
            onChange={(e) => set("nickname", e.target.value)}
            placeholder="Your display name in watch rooms" />
          <Divider />
          <Input label="Hub Server URL" value={local.hub_url ?? "https://anitrack-hub.onrender.com"}
            onChange={(e) => set("hub_url", e.target.value)}
            placeholder="https://anitrack-hub.onrender.com" mono
            hint="The sync server all users must connect to. Leave default unless self-hosting." />
        </Section>

        {/* ── Appearance ── */}
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

        {/* ── Updates ── */}
        <Section icon={<Download className="w-5 h-5" />} title="Updates">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-zinc-300">App Version</p>
              <p className="text-xs text-zinc-500 mt-0.5">
                {updateStatus === "idle" && "Click to check for updates"}
                {updateStatus === "checking" && "Checking for updates…"}
                {updateStatus === "not-available" && "You're on the latest version"}
                {updateStatus === "available" && `v${updateVersion} available — downloading…`}
                {updateStatus === "downloading" && `Downloading… ${updateProgress}%`}
                {updateStatus === "ready" && `v${updateVersion} ready — restart to install`}
                {updateStatus === "error" && `Update error: ${updateError}`}
              </p>
            </div>
            {updateStatus === "ready" ? (
              <Button variant="primary" size="sm" icon={<Download className="w-3.5 h-3.5" />}
                onClick={() => (window as any).electronAPI?.updaterInstall()}>
                Restart &amp; Install
              </Button>
            ) : (
              <Button variant="secondary" size="sm"
                loading={updateStatus === "checking" || updateStatus === "downloading"}
                icon={<RefreshCw className="w-3.5 h-3.5" />}
                onClick={async () => {
                  setUpdateStatus("checking");
                  setUpdateError(null);
                  const res = await (window as any).electronAPI?.updaterCheck();
                  if (res?.error) { setUpdateStatus("error"); setUpdateError(res.error); }
                }}
                disabled={updateStatus === "checking" || updateStatus === "downloading"}>
                Check for Updates
              </Button>
            )}
          </div>
          {updateStatus === "downloading" && (
            <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500 rounded-full transition-all duration-300"
                style={{ width: `${updateProgress}%` }} />
            </div>
          )}
        </Section>

        {/* ── Cloud Sync ── */}
        <Section icon={<Cloud className="w-5 h-5" />} title="Cloud Settings Sync">
          <p className="text-xs text-zinc-500">
            Settings are encrypted with your tracker token before upload — the server never sees plaintext.
            Machine-specific paths (base folder, player, torrent client) are never synced.
          </p>
          {!activeUser && (
            <p className="text-xs text-amber-400">Connect AniList or MAL first to enable cloud sync.</p>
          )}
          <div className="flex gap-3">
            <Button variant="secondary" size="sm" loading={cloudSyncing} disabled={!activeUser || cloudSyncing}
              icon={<CloudUpload className="w-3.5 h-3.5" />}
              onClick={pushToCloud}>
              Push to Cloud
            </Button>
            <Button variant="secondary" size="sm" loading={cloudSyncing} disabled={!activeUser || cloudSyncing}
              icon={<CloudDownload className="w-3.5 h-3.5" />}
              onClick={pullFromCloud}>
              Pull from Cloud
            </Button>
          </div>
          {cloudResult && (
            <p className={`text-xs pl-0.5 ${cloudResult.includes("failed") || cloudResult.includes("Failed") ? "text-red-400" : "text-emerald-400"}`}>
              {cloudResult}
            </p>
          )}
        </Section>

        {/* ── Data Management ── */}
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

// ─── SyncRow sub-component ────────────────────────────────────────────────────

function SyncRow({ label, hint, syncing, syncResult, disabled, onSync }: {
  label: string;
  hint: string;
  syncing: boolean;
  syncResult: string | null;
  disabled: boolean;
  onSync: () => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-zinc-300">{label}</p>
          <p className="text-xs text-zinc-500 mt-0.5">{hint}</p>
        </div>
        <Button variant="secondary" size="sm" loading={syncing}
          icon={<RefreshCw className="w-3.5 h-3.5" />}
          onClick={onSync} disabled={disabled}>
          Sync Now
        </Button>
      </div>
      {syncResult && (
        <p className={`text-xs pl-0.5 ${syncResult.includes("failed") ? "text-red-400" : "text-emerald-400"}`}>
          {syncResult}
        </p>
      )}
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
