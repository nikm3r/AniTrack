import { Router, Request, Response } from "express";
import { getDb } from "../db.js";

const router = Router();

const ANILIST_API = "https://graphql.anilist.co";




const AIRING_QUERY = `
query ($start: Int, $end: Int, $page: Int) {
  Page(page: $page, perPage: 50) {
    pageInfo { hasNextPage }
    airingSchedules(airingAt_greater: $start, airingAt_lesser: $end) {
      airingAt
      episode
      media {
        id
        title { romaji english }
        coverImage { medium }
      }
    }
  }
}`;

async function fetchAiringSchedule(startUnix: number, endUnix: number): Promise<any[]> {
  const results: any[] = [];
  let page = 1;
  while (true) {
    const res = await fetch(ANILIST_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ query: AIRING_QUERY, variables: { start: startUnix, end: endUnix, page } }),
    });
    const json = await res.json() as any;
    const pageData = json?.data?.Page;
    if (!pageData) break;
    results.push(...(pageData.airingSchedules || []));
    if (!pageData.pageInfo?.hasNextPage) break;
    page++;
  }
  return results;
}

// GET /api/schedule?week=YYYY-MM-DD&timezone=...
router.get("/", async (req: Request, res: Response) => {
  const timezone = (req.query.timezone as string) || "UTC";
  const weekParam = req.query.week as string | undefined;

  // Use weekParam directly as mondayStr — frontend sends correct Monday in YYYY-MM-DD
  // Compute UTC Unix timestamps for the full week
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const mondayStr = weekParam || todayStr;




  const db = getDb();
  const animeRows = db.prepare(
    "SELECT id, anilist_id, mal_id, title_romaji, title_english, alt_title, download_path, cover_image, progress, total_episodes, status FROM anime WHERE status = 'WATCHING'"
  ).all() as {
    id: number; anilist_id: number | null; mal_id: number | null;
    title_romaji: string; title_english: string | null; alt_title: string | null; download_path: string | null; cover_image: string | null;
    progress: number; total_episodes: number | null; status: string;
  }[];

  const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  const emptyDays = Object.fromEntries(DAYS.map(d => [d, []]));

  if (animeRows.length === 0) {
    res.json({ week: mondayStr, days: emptyDays });
    return;
  }

  const byAnilistId = new Map<number, typeof animeRows[0]>();
  for (const a of animeRows) { if (a.anilist_id) byAnilistId.set(a.anilist_id, a); }

  try {
    // Parse as UTC midnight so timestamps align with AniList's UTC-based schedule
    const startUnix = Math.floor(new Date(mondayStr + "T00:00:00Z").getTime() / 1000);
    const endUnix = startUnix + (7 * 24 * 60 * 60) - 1; // 7 days later minus 1 second

    const schedules = await fetchAiringSchedule(startUnix, endUnix);

    const formatTime = (unixTs: number) => {
      try {
        return new Date(unixTs * 1000).toLocaleTimeString("en-US", {
          hour: "2-digit", minute: "2-digit", hour12: false, timeZone: timezone,
        });
      } catch { return null; }
    };

    const result: Record<string, any[]> = Object.fromEntries(DAYS.map(d => [d, []]));

    for (const schedule of schedules) {
      const anilistId = schedule.media?.id;
      if (!anilistId) continue;
      const libraryAnime = byAnilistId.get(anilistId);
      if (!libraryAnime) continue;

      const date = new Date(schedule.airingAt * 1000);
      const dayOfWeek = date.toLocaleDateString("en-US", { weekday: "long", timeZone: timezone }).toLowerCase();
      if (!result[dayOfWeek]) continue;

      const coverImage = schedule.media?.coverImage?.medium || libraryAnime.cover_image;

      result[dayOfWeek].push({
        slug: `${anilistId}-ep${schedule.episode}`,
        title: libraryAnime.title_english || libraryAnime.title_romaji,
        episodeNumber: schedule.episode,
        subTime: formatTime(schedule.airingAt),
        rawTime: null, // AniList only has one air time (Japanese broadcast)
        coverImage,
        libraryAnime: {
          id: libraryAnime.id, anilist_id: libraryAnime.anilist_id, mal_id: libraryAnime.mal_id,
          title_romaji: libraryAnime.title_romaji, title_english: libraryAnime.title_english,
          alt_title: libraryAnime.alt_title, download_path: libraryAnime.download_path,
          cover_image: libraryAnime.cover_image, progress: libraryAnime.progress,
          total_episodes: libraryAnime.total_episodes, status: libraryAnime.status,
        },
      });
    }

    // Sort each day by air time
    for (const d of DAYS) result[d].sort((a, b) => (a.subTime || "").localeCompare(b.subTime || ""));

    res.json({ week: mondayStr, days: result });
  } catch (err) {
    console.error("[schedule] Error:", err);
    res.status(500).json({ error: "Failed to fetch schedule" });
  }
});

export default router;
