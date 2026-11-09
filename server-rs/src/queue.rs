use rusqlite::{params, Connection, OptionalExtension};

const MAX_ATTEMPTS: i64 = 5;

pub fn migrate(db: &Connection) -> rusqlite::Result<()> {
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS sync_queue (
           id          INTEGER PRIMARY KEY AUTOINCREMENT,
           tracker_id  INTEGER NOT NULL,
           tracker     TEXT NOT NULL DEFAULT 'anilist',
           type        TEXT NOT NULL DEFAULT 'progress',
           progress    INTEGER,
           status      TEXT,
           score       REAL,
           attempts    INTEGER NOT NULL DEFAULT 0,
           last_error  TEXT,
           created_at  TEXT NOT NULL DEFAULT (datetime('now')),
           updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
         );
         CREATE INDEX IF NOT EXISTS idx_sync_queue_tracker ON sync_queue(tracker_id, tracker);",
    )?;
    let mut stmt = db.prepare("PRAGMA table_info(sync_queue)")?;
    let cols: Vec<String> = stmt
        .query_map([], |r| r.get::<_, String>(1))?
        .collect::<Result<_, _>>()?;
    if cols.iter().any(|c| c == "anilist_id") && !cols.iter().any(|c| c == "tracker_id") {
        db.execute_batch("ALTER TABLE sync_queue RENAME COLUMN anilist_id TO tracker_id;")?;
        println!("[queue] Migrated sync_queue: renamed anilist_id → tracker_id");
    }
    if !cols.iter().any(|c| c == "tracker") {
        db.execute_batch("ALTER TABLE sync_queue ADD COLUMN tracker TEXT NOT NULL DEFAULT 'anilist';")?;
        println!("[queue] Migrated sync_queue: added tracker column");
    }
    Ok(())
}

#[derive(Default)]
pub struct Payload {
    pub progress: Option<i64>,
    pub status: Option<String>,
    pub score: Option<f64>,
}

/// Queue a tracker update. Merges into an existing pending item for the same
/// tracker_id + tracker + type (same behaviour as the Node queue).
pub fn enqueue(
    db: &Connection,
    tracker_id: i64,
    tracker: &str,
    ty: &str,
    p: &Payload,
) -> rusqlite::Result<()> {
    let existing: Option<i64> = db
        .query_row(
            "SELECT id FROM sync_queue
             WHERE tracker_id = ?1 AND tracker = ?2 AND type = ?3 AND attempts < ?4
             ORDER BY id DESC LIMIT 1",
            params![tracker_id, tracker, ty, MAX_ATTEMPTS],
            |r| r.get(0),
        )
        .optional()?;

    if let Some(id) = existing {
        let mut sets = vec!["updated_at = datetime('now')", "attempts = 0", "last_error = NULL"];
        let mut vals: Vec<rusqlite::types::Value> = vec![];
        if let Some(v) = p.progress { sets.push("progress = ?"); vals.push(v.into()); }
        if let Some(v) = &p.status { sets.push("status = ?"); vals.push(v.clone().into()); }
        if let Some(v) = p.score { sets.push("score = ?"); vals.push(v.into()); }
        vals.push(id.into());
        db.execute(
            &format!("UPDATE sync_queue SET {} WHERE id = ?", sets.join(", ")),
            rusqlite::params_from_iter(vals),
        )?;
        println!("[queue] Merged {ty} update for {tracker}:{tracker_id}");
    } else {
        db.execute(
            "INSERT INTO sync_queue (tracker_id, tracker, type, progress, status, score)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![tracker_id, tracker, ty, p.progress, p.status, p.score],
        )?;
        println!("[queue] Enqueued {ty} update for {tracker}:{tracker_id}");
    }
    Ok(())
}
