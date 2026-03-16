import type {
  ITracker,
  TrackerSearchResult,
  TrackerAnimeDetail,
  TrackerUserListEntry,
} from "./types.js";

/**
 * MyAnimeList tracker — slot ready for implementation.
 *
 * MAL uses OAuth 2.0 with PKCE for auth and a REST API v2.
 * API docs: https://myanimelist.net/apiconfig/references/api/v2
 *
 * To implement:
 * 1. Register an app at https://myanimelist.net/apiconfig
 * 2. Add MAL_CLIENT_ID to settings
 * 3. Implement PKCE OAuth flow in the renderer
 * 4. Store the token via PUT /api/settings/mal_token
 * 5. Fill in the three methods below
 */
export class MALTracker implements ITracker {
  name = "mal";

  private readonly BASE = "https://api.myanimelist.net/v2";

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async search(_query: string): Promise<TrackerSearchResult[]> {
    throw new Error("MAL tracker not yet implemented");
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getAnime(_id: string): Promise<TrackerAnimeDetail> {
    throw new Error("MAL tracker not yet implemented");
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getUserList(_token: string): Promise<TrackerUserListEntry[]> {
    throw new Error("MAL tracker not yet implemented");
  }
}
