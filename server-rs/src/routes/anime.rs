use super::{err, ok, query_rows, Db};
use crate::queue::{enqueue, Payload};
use crate::util::{json_to_sql, with_genres};
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, patch},
    Json, Router,
};
use rusqlite::types::Value as SqlValue;
use rusqlite::Connection;
use serde_json::{json, Value};
use std::collections::HashMap;

pub fn router() -> Router<Db> {
    Router::new()
        .route("/", get(list).post(create))
        .route("/{id}", get(get_one).patch(update).delete(remove))
        .route("/{id}/score", patch(set_score))
        .route("/{id}/progress", patch(set_progress))
}

/// JS-like parseInt: leading optional sign + digits.
fn parse_int(s: &str) -> Option<i64> {
    let t = s.trim_start();
    let end = t
        .char_indices()
        .take_while(|(i, c)| c.is_ascii_digit() || (*i == 0 && (*c == '-' || *c == '+')))
        .map(|(i, c)| i + c.len_utf8())
        .last()?;
    t[..end].parse().ok()
}

fn fetch(conn: &Connection, id: i64) -> rusqlite::Result<Option<Value>> {
    Ok(query_rows(conn, "SELECT * FROM anime WHERE id = ?1", &[SqlValue::Integer(id)])?
        .into_iter()
        .next())
}

/// Queue a tracker update for every tracker this anime has an id for.
fn enqueue_for_anime(conn: &Connection, anime: &Value, ty: &str, p: &Payload) {
    for (col, tracker) in [("anilist_id", "anilist"), ("mal_id", "mal")] {
        if let Some(tid) = anime[col].as_i64() {
            if let Err(e) = enqueue(conn, tid, tracker, ty, p) {
                eprintln!("[queue] enqueue failed for {tracker}:{tid}: {e}");
            }
        }
    }
}

fn progress_payload(anime: &Value) -> Payload {
    Payload {
        progress: anime["progress"].as_i64(),
        status: anime["status"].as_str().map(String::from),
        score: None,
    }
}

fn internal(e: impl ToString) -> Response {
    err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string())
}

// GET /api/anime
async fn list(State(db): State<Db>, Query(q): Query<HashMap<String, String>>) -> Response {
    let mut sql = String::from("SELECT * FROM anime WHERE 1=1");
    let mut params: Vec<SqlValue> = vec![];
    if let Some(s) = q.get("status").filter(|s| !s.is_empty()) {
        sql.push_str(" AND status = ?");
        params.push(s.clone().into());
    }
    if let Some(f) = q.get("format").filter(|s| !s.is_empty()) {
        sql.push_str(" AND format = ?");
        params.push(f.clone().into());
    }
    if let Some(search) = q.get("search").filter(|s| !s.is_empty()) {
        sql.push_str(" AND (title_romaji LIKE ? OR title_english LIKE ? OR title_native LIKE ? OR alt_title LIKE ?)");
        let like = format!("%{search}%");
        for _ in 0..4 {
            params.push(like.clone().into());
        }
    }
    sql.push_str(" ORDER BY updated_at DESC LIMIT ? OFFSET ?");
    let page = q.get("page").and_then(|s| parse_int(s)).unwrap_or(1).max(1);
    let limit = q.get("limit").and_then(|s| parse_int(s)).unwrap_or(50).max(1);
    params.push(limit.into());
    params.push(((page - 1) * limit).into());

    let conn = db.lock().unwrap();
    match query_rows(&conn, &sql, &params) {
        Ok(rows) => ok(json!({
            "data": rows.into_iter().map(with_genres).collect::<Vec<_>>(),
            "page": page,
            "limit": limit,
        })),
        Err(e) => internal(e),
    }
}

// GET /api/anime/:id
async fn get_one(State(db): State<Db>, Path(id): Path<String>) -> Response {
    let Some(id) = parse_int(&id) else { return err(StatusCode::NOT_FOUND, "Not found") };
    let conn = db.lock().unwrap();
    match fetch(&conn, id) {
        Ok(Some(a)) => ok(with_genres(a)),
        Ok(None) => err(StatusCode::NOT_FOUND, "Not found"),
        Err(e) => internal(e),
    }
}

const INSERT_FIELDS: &[&str] = &[
    "anilist_id", "mal_id", "title_romaji", "title_english", "title_native",
    "cover_image", "banner_image", "status", "score", "progress", "total_episodes",
    "format", "season", "season_year", "genres", "description", "average_score",
    "alt_title", "download_path", "notes", "started_at", "completed_at",
];

fn truthy(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().map(|f| f != 0.0).unwrap_or(true),
        Value::String(s) => !s.is_empty(),
        _ => true,
    }
}

// POST /api/anime
async fn create(State(db): State<Db>, Json(body): Json<Value>) -> Response {
    if !body.get("title_romaji").map(truthy).unwrap_or(false) {
        return err(StatusCode::BAD_REQUEST, "title_romaji is required");
    }
    let values: Vec<SqlValue> = INSERT_FIELDS
        .iter()
        .map(|&f| match (f, body.get(f)) {
            // Defaults only apply when the field is missing (like JS destructuring defaults)
            ("status", None) => SqlValue::Text("PLANNING".into()),
            ("progress", None) => SqlValue::Integer(0),
            ("genres", Some(g)) if truthy(g) => SqlValue::Text(g.to_string()),
            ("genres", _) => SqlValue::Null,
            (_, Some(v)) => json_to_sql(v),
            (_, None) => SqlValue::Null,
        })
        .collect();
    let placeholders = vec!["?"; INSERT_FIELDS.len()].join(", ");
    let sql = format!("INSERT INTO anime ({}) VALUES ({placeholders})", INSERT_FIELDS.join(", "));

    let conn = db.lock().unwrap();
    match conn.execute(&sql, rusqlite::params_from_iter(values)) {
        Ok(_) => match fetch(&conn, conn.last_insert_rowid()) {
            Ok(Some(a)) => (StatusCode::CREATED, Json(with_genres(a))).into_response(),
            Ok(None) => internal("Inserted row not found"),
            Err(e) => internal(e),
        },
        Err(e) => {
            let msg = e.to_string();
            if msg.contains("UNIQUE") {
                err(StatusCode::CONFLICT, "Anime already exists in library")
            } else {
                internal(msg)
            }
        }
    }
}

const PATCHABLE: &[&str] = &[
    "status", "score", "progress", "notes", "alt_title", "download_path",
    "started_at", "completed_at", "title_romaji", "title_english",
    "cover_image", "banner_image", "total_episodes", "genres", "description", "average_score",
];

// PATCH /api/anime/:id
async fn update(State(db): State<Db>, Path(id): Path<String>, Json(body): Json<Value>) -> Response {
    let Some(id) = parse_int(&id) else { return err(StatusCode::NOT_FOUND, "Not found") };
    let conn = db.lock().unwrap();
    match fetch(&conn, id) {
        Ok(Some(_)) => {}
        Ok(None) => return err(StatusCode::NOT_FOUND, "Not found"),
        Err(e) => return internal(e),
    }

    let mut sets: Vec<String> = vec![];
    let mut values: Vec<SqlValue> = vec![];
    for &key in PATCHABLE {
        if let Some(v) = body.get(key) {
            sets.push(format!("{key} = ?"));
            values.push(match (key, v) {
                ("genres", Value::Array(_)) => SqlValue::Text(v.to_string()),
                _ => json_to_sql(v),
            });
        }
    }
    if sets.is_empty() {
        return err(StatusCode::BAD_REQUEST, "No valid fields to update");
    }
    sets.push("updated_at = datetime('now')".into());
    values.push(id.into());

    if let Err(e) = conn.execute(
        &format!("UPDATE anime SET {} WHERE id = ?", sets.join(", ")),
        rusqlite::params_from_iter(values),
    ) {
        return internal(e);
    }
    let updated = match fetch(&conn, id) {
        Ok(Some(a)) => a,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Not found"),
        Err(e) => return internal(e),
    };
    if body.get("status").is_some() || body.get("progress").is_some() {
        enqueue_for_anime(&conn, &updated, "progress", &progress_payload(&updated));
    }
    ok(with_genres(updated))
}

// DELETE /api/anime/:id
// NOTE: the Node server also removes the entry from AniList/MAL before deleting
// locally. That needs the tracker clients, which are ported in a later step.
async fn remove(State(db): State<Db>, Path(id): Path<String>) -> Response {
    let Some(id) = parse_int(&id) else { return err(StatusCode::NOT_FOUND, "Not found") };
    let conn = db.lock().unwrap();
    match fetch(&conn, id) {
        Ok(Some(_)) => {}
        Ok(None) => return err(StatusCode::NOT_FOUND, "Not found"),
        Err(e) => return internal(e),
    }
    eprintln!("[anime] WARNING: tracker-side delete not ported yet — deleting {id} locally only");
    if let Err(e) = conn.execute("DELETE FROM anime WHERE id = ?1", [id]) {
        return internal(e);
    }
    StatusCode::NO_CONTENT.into_response()
}

// PATCH /api/anime/:id/score
async fn set_score(State(db): State<Db>, Path(id): Path<String>, Json(body): Json<Value>) -> Response {
    let score = match body.get("score") {
        Some(Value::Number(n)) if (0.0..=10.0).contains(&n.as_f64().unwrap_or(-1.0)) => n.clone(),
        _ => return err(StatusCode::BAD_REQUEST, "score must be a number between 0 and 10"),
    };
    let Some(id) = parse_int(&id) else { return err(StatusCode::NOT_FOUND, "Not found") };
    let conn = db.lock().unwrap();
    let anime = match fetch(&conn, id) {
        Ok(Some(a)) => a,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Not found"),
        Err(e) => return internal(e),
    };
    let score_val = json_to_sql(&Value::Number(score.clone()));
    if let Err(e) = conn.execute(
        "UPDATE anime SET score = ?1, updated_at = datetime('now') WHERE id = ?2",
        rusqlite::params![score_val, id],
    ) {
        return internal(e);
    }
    let p = Payload { score: score.as_f64(), ..Default::default() };
    enqueue_for_anime(&conn, &anime, "score", &p);
    ok(json!({ "ok": true, "score": score }))
}

// PATCH /api/anime/:id/progress
async fn set_progress(State(db): State<Db>, Path(id): Path<String>, Json(body): Json<Value>) -> Response {
    let progress = match body.get("progress") {
        Some(Value::Number(n)) if n.as_f64().map(|f| f >= 0.0).unwrap_or(false) => n.clone(),
        _ => return err(StatusCode::BAD_REQUEST, "progress must be a non-negative number"),
    };
    let progress_f = progress.as_f64().unwrap_or(0.0);
    let Some(id) = parse_int(&id) else { return err(StatusCode::NOT_FOUND, "Not found") };
    let conn = db.lock().unwrap();
    let existing = match fetch(&conn, id) {
        Ok(Some(a)) => a,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Not found"),
        Err(e) => return internal(e),
    };

    let mut status = match body.get("status") {
        Some(Value::String(s)) => s.clone(),
        _ => existing["status"].as_str().unwrap_or("PLANNING").to_string(),
    };
    let total = existing["total_episodes"].as_f64().filter(|t| *t > 0.0);
    if progress_f == 0.0 && status == "WATCHING" {
        status = "PLANNING".into();
    } else if total.map(|t| progress_f >= t).unwrap_or(false) && status == "WATCHING" {
        status = "COMPLETED".into();
    } else if progress_f > 0.0 && status == "PLANNING" {
        status = "WATCHING".into();
    }

    if let Err(e) = conn.execute(
        "UPDATE anime SET progress = ?1, status = ?2, updated_at = datetime('now') WHERE id = ?3",
        rusqlite::params![json_to_sql(&Value::Number(progress)), status, id],
    ) {
        return internal(e);
    }
    let updated = match fetch(&conn, id) {
        Ok(Some(a)) => a,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Not found"),
        Err(e) => return internal(e),
    };
    enqueue_for_anime(&conn, &updated, "progress", &progress_payload(&updated));
    ok(with_genres(updated))
}
