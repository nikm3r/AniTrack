// ─── Shared tracker types ─────────────────────────────────────────────────────

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
  episodes: TrackerEpisode[];
}

export interface TrackerEpisode {
  episodeNumber: number;
  title: string | null;
  airDate: string | null;
  thumbnail: string | null;
}

export interface TrackerUserListEntry {
  trackerId: string;
  titleRomaji: string;
  titleEnglish: string | null;
  coverImage: string | null;
  status: string; // CURRENT | COMPLETED | PLANNING | DROPPED | PAUSED (AniList) → normalized
  score: number | null;
  progress: number;
  totalEpisodes: number | null;
  format: string | null;
}

// ─── Tracker interface ────────────────────────────────────────────────────────

export interface ITracker {
  name: string;
  search(query: string): Promise<TrackerSearchResult[]>;
  getAnime(id: string): Promise<TrackerAnimeDetail>;
  getUserList(token: string): Promise<TrackerUserListEntry[]>;
  updateProgress(token: string, mediaId: string, progress: number, status: string): Promise<void>;
}
