import React, { useState, useCallback } from "react";
import { Monitor, Search, Users, Settings as SettingsIcon, Tv } from "lucide-react";
import { Settings } from "./Settings";
import { useSettings } from "../hooks/useSettings";
import { useAnimeList } from "../hooks/useAnimeList";
import Watchlist from "./Watchlist";
import TorrentSearch from "./TorrentSearch";
import SyncWatch from "./SyncWatch";

type Tab = "watchlist" | "search" | "sync" | "settings";

function NavItem({ active, icon, label, onClick }: {
  active: boolean; icon: React.ReactNode; label: string; onClick: () => void;
}) {
  return (
    <button onClick={onClick} title={label}
      className={`
        relative w-12 h-12 rounded-2xl flex items-center justify-center
        transition-all duration-200 no-drag group
        ${active ? "bg-emerald-500/15 text-emerald-400" : "text-zinc-600 hover:text-zinc-300 hover:bg-white/5"}
      `}>
      <span className="w-5 h-5">{icon}</span>
      {active && (
        <span className="absolute -left-3 top-1/2 -translate-y-1/2 w-1 h-6 bg-emerald-500 rounded-r-full" />
      )}
      <span className="absolute left-full ml-3 px-2 py-1 bg-zinc-800 text-zinc-200 text-xs font-medium rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all whitespace-nowrap pointer-events-none z-50">
        {label}
      </span>
    </button>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>("watchlist");
  const { settings, loading: settingsLoading, saving, save } = useSettings();
  const animeList = useAnimeList();
  const [pendingSearch, setPendingSearch] = useState<string | null>(null);

  const handleSearchRequest = useCallback((query: string) => {
    setPendingSearch(query);
    setActiveTab("search");
  }, []);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#0a0a0f]">

      {/* Sidebar */}
      <nav className="w-20 h-full flex-shrink-0 bg-[#0d0d14] border-r border-white/5 flex flex-col items-center py-6 gap-3 drag z-40">
        <div className="w-10 h-10 bg-emerald-500 rounded-2xl flex items-center justify-center shadow-lg shadow-emerald-500/20 mb-4 flex-shrink-0 no-drag">
          <Tv className="w-5 h-5 text-black" />
        </div>

        <div className="flex flex-col items-center gap-2 flex-1 no-drag">
          <NavItem active={activeTab === "watchlist"} icon={<Monitor className="w-5 h-5" />} label="Watchlist"       onClick={() => setActiveTab("watchlist")} />
          <NavItem active={activeTab === "search"}    icon={<Search className="w-5 h-5" />}  label="Search Torrents" onClick={() => setActiveTab("search")} />
          <NavItem active={activeTab === "sync"}      icon={<Users className="w-5 h-5" />}   label="Sync Watch"      onClick={() => setActiveTab("sync")} />
        </div>

        <div className="no-drag">
          <NavItem active={activeTab === "settings"} icon={<SettingsIcon className="w-5 h-5" />} label="Settings" onClick={() => setActiveTab("settings")} />
        </div>
      </nav>

      {/* Main content */}
      <main className="flex-1 min-w-0 h-full overflow-hidden flex flex-col">
        <div className="flex-1 min-h-0 px-8 py-8 overflow-hidden flex flex-col">

          {/* Watchlist — always mounted */}
          <div className={`flex-1 min-h-0 flex flex-col ${activeTab === "watchlist" ? "" : "hidden"}`}>
            <Watchlist
              animeList={animeList}
              settings={settings}
              onSearchRequest={handleSearchRequest}
            />
          </div>

          {/* Torrent Search — always mounted */}
          <div className={`flex-1 min-h-0 flex flex-col ${activeTab === "search" ? "" : "hidden"}`}>
            <TorrentSearch
              anime={animeList.anime}
              pendingSearch={pendingSearch}
              onPendingSearchConsumed={() => setPendingSearch(null)}
            />
          </div>

          {/* Sync Watch — always mounted to preserve room state */}
          <div className={`flex-1 min-h-0 flex flex-col ${activeTab === "sync" ? "" : "hidden"}`}>
            <SyncWatch
              anime={animeList.anime}
              settings={settings}
            />
          </div>

          {/* Settings */}
          {activeTab === "settings" && (
            <div className="flex-1 min-h-0 flex flex-col">
              {settingsLoading ? (
                <div className="flex items-center justify-center h-64">
                  <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : (
                <Settings settings={settings} onSave={save} saving={saving} />
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
