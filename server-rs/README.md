# AniTrack server (Rust)

Rust port of `server/` (Express + better-sqlite3), using axum + rusqlite.
Same routes, same port, same database file — the React UI does not change.

Run next to the Node server for testing:

    SERVER_PORT=3001 USER_DATA_PATH=/path/to/copy cargo run

## Port status

| Area | Status |
|---|---|
| DB open + migrations v1–v4, sync_queue | done |
| /api/health | done |
| /api/settings | done |
| /api/anime (list/get/create/patch/score/progress) | done |
| DELETE /api/anime/:id | local delete only — tracker-side delete pending |
| Sync queue worker | pending |
| Trackers (AniList, MAL, OAuth, import) | pending |
| files, torrents, browse, schedule, episodes | pending |
| playback, player controllers, SyncWatch engine | pending |
