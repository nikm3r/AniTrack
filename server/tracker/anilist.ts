import type {
  ITracker,
  TrackerSearchResult,
  TrackerAnimeDetail,
  TrackerEpisode,
  TrackerUserListEntry,
} from "./types.js";

const ANILIST_API = "https://graphql.anilist.co";

async function gql<T>(
  query: string,
  variables: Record<string, unknown> = {},
  token?: string
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(ANILIST_API, {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new Error(`AniList API error: ${res.status} ${res.statusText}`);
  }

  const json = (await res.json()) as { data?: T; errors?: { message: string }[] };

  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join("; "));
  }

  return json.data as T;
}

// Rate limit helper — AniList allows 90 requests/minute
async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeStatus(anilistStatus: string): string {
  const map: Record<string, string> = {
    CURRENT: "WATCHING",
    COMPLETED: "COMPLETED",
    PLANNING: "PLANNING",
    DROPPED: "DROPPED",
    PAUSED: "PAUSED",
    REPEATING: "WATCHING",
  };
  return map[anilistStatus] ?? "PLANNING";
}

export class AniListTracker implements ITracker {
  name = "anilist";

  async search(query: string): Promise<TrackerSearchResult[]> {
    const Q = `
      query ($search: String) {
        Page(page: 1, perPage: 20) {
          media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
            id
            title { romaji english native }
            coverImage { large }
            format
            status
            seasonYear
            episodes
          }
        }
      }
    `;

    type Media = {
      id: number;
      title: { romaji: string; english: string | null; native: string | null };
      coverImage: { large: string } | null;
      format: string | null;
      status: string | null;
      seasonYear: number | null;
      episodes: number | null;
    };

    const data = await gql<{ Page: { media: Media[] } }>(Q, { search: query });

    return data.Page.media.map((m) => ({
      id: String(m.id),
      titleRomaji: m.title.romaji,
      titleEnglish: m.title.english,
      titleNative: m.title.native,
      coverImage: m.coverImage?.large ?? null,
      format: m.format,
      status: m.status,
      seasonYear: m.seasonYear,
      totalEpisodes: m.episodes,
    }));
  }

  async getAnime(id: string): Promise<TrackerAnimeDetail> {
    const Q = `
      query ($id: Int) {
        Media(id: $id, type: ANIME) {
          id
          title { romaji english native }
          coverImage { extraLarge large }
          bannerImage
          format
          status
          season
          seasonYear
          episodes
          genres
          description(asHtml: false)
          averageScore
          streamingEpisodes {
            title
            thumbnail
            url
          }
          airingSchedule(notYetAired: false) {
            nodes { episode airingAt }
          }
        }
      }
    `;

    type AiringNode = { episode: number; airingAt: number };
    type StreamEpisode = { title: string; thumbnail: string; url: string };

    type MediaDetail = {
      id: number;
      title: { romaji: string; english: string | null; native: string | null };
      coverImage: { extraLarge: string | null; large: string | null };
      bannerImage: string | null;
      format: string | null;
      status: string | null;
      season: string | null;
      seasonYear: number | null;
      episodes: number | null;
      genres: string[];
      description: string | null;
      averageScore: number | null;
      streamingEpisodes: StreamEpisode[];
      airingSchedule: { nodes: AiringNode[] };
    };

    const data = await gql<{ Media: MediaDetail }>(Q, { id: parseInt(id, 10) });
    const m = data.Media;

    const episodeMap = new Map<number, TrackerEpisode>();

    for (const node of m.airingSchedule.nodes) {
      episodeMap.set(node.episode, {
        episodeNumber: node.episode,
        title: null,
        airDate: new Date(node.airingAt * 1000).toISOString().split("T")[0],
        thumbnail: null,
      });
    }

    m.streamingEpisodes.forEach((se, idx) => {
      const epNum = idx + 1;
      const existing = episodeMap.get(epNum);
      episodeMap.set(epNum, {
        episodeNumber: epNum,
        title: se.title ?? existing?.title ?? null,
        airDate: existing?.airDate ?? null,
        thumbnail: se.thumbnail ?? null,
      });
    });

    const episodes = Array.from(episodeMap.values()).sort(
      (a, b) => a.episodeNumber - b.episodeNumber
    );

    return {
      id: String(m.id),
      titleRomaji: m.title.romaji,
      titleEnglish: m.title.english,
      titleNative: m.title.native,
      coverImage: m.coverImage.extraLarge ?? m.coverImage.large ?? null,
      bannerImage: m.bannerImage,
      format: m.format,
      status: m.status,
      season: m.season,
      seasonYear: m.seasonYear,
      totalEpisodes: m.episodes,
      genres: m.genres ?? [],
      description: m.description,
      averageScore: m.averageScore,
      episodes,
    };
  }

  async getUserList(token: string): Promise<TrackerUserListEntry[]> {
    const viewerQ = `query { Viewer { id } }`;
    const viewerData = await gql<{ Viewer: { id: number } }>(viewerQ, {}, token);
    const userId = viewerData.Viewer.id;

    // ── Pass 1: fetch all list entries (lightweight — no heavy media fields) ──
    // This avoids AniList's query complexity cap which truncates large lists
    const listQ = `
      query ($userId: Int, $page: Int) {
        MediaListCollection(userId: $userId, type: ANIME) {
          lists {
            entries {
              status
              score
              progress
              media {
                id
                title { romaji english native }
                coverImage { large }
                bannerImage
                format
                episodes
                season
                seasonYear
              }
            }
          }
        }
      }
    `;

    type LightEntry = {
      status: string;
      score: number;
      progress: number;
      media: {
        id: number;
        title: { romaji: string; english: string | null; native: string | null };
        coverImage: { large: string } | null;
        bannerImage: string | null;
        format: string | null;
        episodes: number | null;
        season: string | null;
        seasonYear: number | null;
      };
    };

    const listData = await gql<{
      MediaListCollection: { lists: { entries: LightEntry[] }[] };
    }>(listQ, { userId }, token);

    // Flatten all lists into a single array
    const rawEntries: LightEntry[] = [];
    for (const list of listData.MediaListCollection.lists) {
      rawEntries.push(...list.entries);
    }

    console.log(`[anilist] Fetched ${rawEntries.length} list entries`);

    // ── Pass 2: batch fetch genres/description/averageScore in chunks of 50 ──
    // These are heavy fields that cause complexity issues if fetched with the list
    const mediaIds = rawEntries.map(e => e.media.id);
    const detailMap = new Map<number, { genres: string[]; description: string | null; averageScore: number | null }>();

    const CHUNK_SIZE = 50;
    for (let i = 0; i < mediaIds.length; i += CHUNK_SIZE) {
      const chunk = mediaIds.slice(i, i + CHUNK_SIZE);
      const detailQ = `
        query ($ids: [Int]) {
          Page(perPage: 50) {
            media(id_in: $ids, type: ANIME) {
              id
              genres
              description(asHtml: false)
              averageScore
            }
          }
        }
      `;
      type DetailMedia = { id: number; genres: string[]; description: string | null; averageScore: number | null };
      try {
        const detailData = await gql<{ Page: { media: DetailMedia[] } }>(detailQ, { ids: chunk }, token);
        for (const m of detailData.Page.media) {
          detailMap.set(m.id, { genres: m.genres ?? [], description: m.description, averageScore: m.averageScore });
        }
      } catch (e) {
        console.error(`[anilist] Detail batch ${i}-${i + CHUNK_SIZE} failed:`, e);
      }
      // Respect rate limit — 90 req/min = ~670ms between requests
      if (i + CHUNK_SIZE < mediaIds.length) await sleep(700);
    }

    console.log(`[anilist] Fetched details for ${detailMap.size}/${mediaIds.length} entries`);

    // ── Merge ────────────────────────────────────────────────────────────────
    const entries: TrackerUserListEntry[] = rawEntries.map(e => {
      const detail = detailMap.get(e.media.id);
      return {
        trackerId: String(e.media.id),
        titleRomaji: e.media.title.romaji,
        titleEnglish: e.media.title.english,
        titleNative: e.media.title.native,
        coverImage: e.media.coverImage?.large ?? null,
        bannerImage: e.media.bannerImage ?? null,
        status: normalizeStatus(e.status),
        score: e.score || null,
        progress: e.progress,
        totalEpisodes: e.media.episodes,
        format: e.media.format,
        season: e.media.season,
        seasonYear: e.media.seasonYear,
        genres: detail?.genres ?? [],
        description: detail?.description ?? null,
        averageScore: detail?.averageScore ?? null,
      } as TrackerUserListEntry & {
        titleNative: string | null;
        bannerImage: string | null;
        season: string | null;
        seasonYear: number | null;
        genres: string[];
        description: string | null;
        averageScore: number | null;
      };
    });

    return entries;
  }
}
