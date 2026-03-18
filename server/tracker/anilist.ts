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
    // Get username first (Taiga uses userName not userId — avoids extra round trip)
    const viewerQ = `query { Viewer { id name } }`;
    const viewerData = await gql<{ Viewer: { id: number; name: string } }>(viewerQ, {}, token);
    const userName = viewerData.Viewer.name;

    // Single query matching Taiga's approach:
    // No genres/description/averageScore — those are heavy fields that cause
    // AniList's complexity cap to truncate large libraries silently.
    // They are fetched lazily when the user opens a series detail panel.
    const listQ = `
      query ($userName: String!) {
        MediaListCollection(userName: $userName, type: ANIME) {
          lists {
            entries {
              status
              score(format: POINT_100)
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
                averageScore
              }
            }
          }
        }
      }
    `;

    type ListEntry = {
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
        averageScore: number | null;
      };
    };

    const listData = await gql<{
      MediaListCollection: { lists: { entries: ListEntry[] }[] };
    }>(listQ, { userName }, token);

    const entries: TrackerUserListEntry[] = [];
    for (const list of listData.MediaListCollection.lists) {
      for (const e of list.entries) {
        entries.push({
          trackerId: String(e.media.id),
          titleRomaji: e.media.title.romaji,
          titleEnglish: e.media.title.english,
          titleNative: e.media.title.native,
          coverImage: e.media.coverImage?.large ?? null,
          bannerImage: e.media.bannerImage ?? null,
          status: normalizeStatus(e.status),
          // AniList returns score as POINT_100 (0-100), convert to 0-10
          score: e.score ? e.score / 10 : null,
          progress: e.progress,
          totalEpisodes: e.media.episodes,
          format: e.media.format,
          season: e.media.season,
          seasonYear: e.media.seasonYear,
          genres: [],
          description: null,
          averageScore: e.media.averageScore,
        } as TrackerUserListEntry & {
          titleNative: string | null;
          bannerImage: string | null;
          season: string | null;
          seasonYear: number | null;
          genres: string[];
          description: string | null;
          averageScore: number | null;
        });
      }
    }

    console.log(`[anilist] Fetched ${entries.length} list entries for ${userName}`);
    return entries;
  }
  async updateProgress(token: string, mediaId: string, progress: number, status: string): Promise<void> {
    const statusMap: Record<string, string> = {
      WATCHING:  "CURRENT",
      COMPLETED: "COMPLETED",
      PLANNING:  "PLANNING",
      DROPPED:   "DROPPED",
      PAUSED:    "PAUSED",
    };
    const anilistStatus = statusMap[status] ?? "CURRENT";

    const mutation = `
      mutation ($mediaId: Int, $progress: Int, $status: MediaListStatus) {
        SaveMediaListEntry(mediaId: $mediaId, progress: $progress, status: $status) {
          id
          progress
          status
        }
      }
    `;

    await gql(mutation, {
      mediaId: parseInt(mediaId, 10),
      progress,
      status: anilistStatus,
    }, token);

    console.log(`[anilist] Updated progress for media ${mediaId}: ep ${progress} (${anilistStatus})`);
  }

}
