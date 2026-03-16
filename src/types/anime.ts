// ─── Anime ────────────────────────────────────────────────────────────────────

export type AnimeStatus =
  | "WATCHING"
  | "COMPLETED"
  | "PLANNING"
  | "DROPPED"
  | "PAUSED";

export type AnimeFormat =
  | "TV"
  | "TV_SHORT"
  | "MOVIE"
  | "OVA"
  | "ONA"
  | "SPECIAL"
  | "MUSIC";

export interface Anime {
  id: number;
  anilist_id: number | null;
  mal_id: number | null;
  title_romaji: string;
  title_english: string | null;
  title_native: string | null;
  cover_image: string | null;
  banner_image: string | null;
  status: AnimeStatus;
  score: number | null;
  progress: number;
  total_episodes: number | null;
  format: AnimeFormat | null;
  season: string | null;
  season_year: number | null;
  genres: string[];
  download_path: string | null;
  notes: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Episodes ─────────────────────────────────────────────────────────────────

export interface Episode {
  id: number;
  anime_id: number;
  episode_number: number;
  title: string | null;
  air_date: string | null;
  watched: 0 | 1;
  watched_at: string | null;
  file_path: string | null;
  created_at: string;
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export interface AppSettings {
  base_folder: string;
  anilist_token: string;
  mal_token: string;
  active_tracker: "anilist" | "mal";
  theme: "dark" | "light";
  auto_update_tracker: string;
  language: "romaji" | "english" | "native";
}

// ─── Tracker ──────────────────────────────────────────────────────────────────

export interface TrackerSearchResult {
  id: string;
  titleRomaji: string;
  titleEnglish: string | null;
  titleNative: string | null;
  coverImage: string | null;
  format: string | null;
  status: string | null;
  seasonYear: number | null;
  totalEpisodes: number | null;
}

export interface TrackerAnimeDetail extends TrackerSearchResult {
  bannerImage: string | null;
  season: string | null;
  genres: string[];
  description: string | null;
  averageScore: number | null;
  episodes: {
    episodeNumber: number;
    title: string | null;
    airDate: string | null;
    thumbnail: string | null;
  }[];
}

// ─── API response envelopes ───────────────────────────────────────────────────

export interface PaginatedResponse<T> {
  data: T[];
  page: number;
  limit: number;
}

export interface ListResponse<T> {
  data: T[];
}

// ─── File scan ────────────────────────────────────────────────────────────────

export interface ScannedFile {
  name: string;
  fullPath: string;
  size: number;
}

export interface ScanResult {
  folder: string;
  files: ScannedFile[];
  exists: boolean;
}
