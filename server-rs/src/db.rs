use rusqlite::{Connection, OptionalExtension};
use std::path::PathBuf;

pub fn data_dir() -> PathBuf {
    if let Ok(p) = std::env::var("USER_DATA_PATH") {
        if !p.is_empty() {
            return PathBuf::from(p);
        }
    }
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".into());
    PathBuf::from(home).join(".anitrack")
}

pub fn open() -> rusqlite::Result<Connection> {
    let dir = data_dir();
    std::fs::create_dir_all(&dir).ok();
    let path = dir.join("anitrack.db");
    println!("[db] Opening database at: {}", path.display());
    let conn = Connection::open(path)?;
    conn.query_row("PRAGMA journal_mode = WAL", [], |r| r.get::<_, String>(0))?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    migrate(&conn)?;
    Ok(conn)
}

const ANIME_TABLE: &str = "
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  anilist_id      INTEGER UNIQUE,
  mal_id          INTEGER UNIQUE,
  title_romaji    TEXT NOT NULL,
  title_english   TEXT,
  title_native    TEXT,
  cover_image     TEXT,
  banner_image    TEXT,
  status          TEXT NOT NULL DEFAULT 'PLANNING',
  score           INTEGER,
  progress        INTEGER NOT NULL DEFAULT 0,
  total_episodes  INTEGER,
  format          TEXT,
  season          TEXT,
  season_year     INTEGER,
  genres          TEXT,
  description     TEXT,
  average_score   INTEGER,
  alt_title       TEXT,
  download_path   TEXT,
  notes           TEXT,
  started_at      TEXT,
  completed_at    TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
";

fn migrate(db: &Connection) -> rusqlite::Result<()> {
    db.execute_batch("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY);")?;
    let current: i64 = db
        .query_row(
            "SELECT version FROM schema_version ORDER BY version DESC LIMIT 1",
            [],
            |r| r.get(0),
        )
        .optional()?
        .unwrap_or(0);

    if current < 1 {
        db.execute_batch(&format!(
            "CREATE TABLE IF NOT EXISTS anime ({ANIME_TABLE});
             CREATE TABLE IF NOT EXISTS episodes (
               id              INTEGER PRIMARY KEY AUTOINCREMENT,
               anime_id        INTEGER NOT NULL REFERENCES anime(id) ON DELETE CASCADE,
               episode_number  INTEGER NOT NULL,
               title           TEXT,
               air_date        TEXT,
               watched         INTEGER NOT NULL DEFAULT 0,
               watched_at      TEXT,
               file_path       TEXT,
               created_at      TEXT NOT NULL DEFAULT (datetime('now')),
               UNIQUE(anime_id, episode_number)
             );
             CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
             CREATE INDEX IF NOT EXISTS idx_anime_status     ON anime(status);
             CREATE INDEX IF NOT EXISTS idx_anime_anilist_id ON anime(anilist_id);
             CREATE INDEX IF NOT EXISTS idx_anime_mal_id     ON anime(mal_id);
             CREATE INDEX IF NOT EXISTS idx_episodes_anime   ON episodes(anime_id);
             INSERT INTO schema_version (version) VALUES (1);"
        ))?;
        println!("[db] Migrated to schema v1");
    }

    if current < 2 {
        for (col, ty) in [("alt_title", "TEXT"), ("description", "TEXT"), ("average_score", "INTEGER")] {
            if let Err(e) = db.execute_batch(&format!("ALTER TABLE anime ADD COLUMN {col} {ty};")) {
                if !e.to_string().to_lowercase().contains("duplicate column name") {
                    return Err(e);
                }
            }
        }
        db.execute_batch("INSERT OR REPLACE INTO schema_version (version) VALUES (2);")?;
        println!("[db] Migrated to schema v2");
    }

    if current < 3 {
        // Recreate `anime` with UNIQUE(mal_id). Foreign keys must be OFF during the rename.
        db.execute_batch("PRAGMA foreign_keys = OFF;")?;
        let res = db.execute_batch(&format!(
            "BEGIN;
             ALTER TABLE anime RENAME TO anime_old;
             CREATE TABLE anime ({ANIME_TABLE});
             INSERT INTO anime SELECT * FROM anime_old;
             DROP TABLE anime_old;
             CREATE INDEX IF NOT EXISTS idx_anime_status     ON anime(status);
             CREATE INDEX IF NOT EXISTS idx_anime_anilist_id ON anime(anilist_id);
             CREATE INDEX IF NOT EXISTS idx_anime_mal_id     ON anime(mal_id);
             INSERT OR REPLACE INTO schema_version (version) VALUES (3);
             INSERT OR IGNORE INTO settings (key, value) VALUES ('mal_client_id', '');
             INSERT OR IGNORE INTO settings (key, value) VALUES ('mal_refresh_token', '');
             COMMIT;"
        ));
        if res.is_err() {
            let _ = db.execute_batch("ROLLBACK;");
        }
        db.execute_batch("PRAGMA foreign_keys = ON;")?;
        res?;
        println!("[db] Migrated to schema v3 (mal_id UNIQUE, MAL OAuth fields)");
    }

    if current < 4 {
        let _ = db.execute_batch("DROP TABLE IF EXISTS sync_queue; DROP INDEX IF EXISTS idx_sync_queue_tracker;");
        db.execute_batch("INSERT OR REPLACE INTO schema_version (version) VALUES (4);")?;
        println!("[db] Migrated to schema v4 - rebuilt sync_queue");
    }

    crate::queue::migrate(db)?;
    Ok(())
}
