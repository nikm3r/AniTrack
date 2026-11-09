use super::{err, ok, query_rows, Db};
use crate::util::js_string;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::Response,
    routing::get,
    Json, Router,
};
use serde_json::{json, Map, Value};

const DEFAULTS: &[(&str, &str)] = &[
    ("base_folder", ""),
    ("anilist_token", ""),
    ("anilist_client_id", ""),
    ("mal_token", ""),
    ("mal_client_id", ""),
    ("mal_refresh_token", ""),
    ("active_tracker", "anilist"),
    ("language", "romaji"),
    ("auto_update_tracker", "true"),
    ("tracking_delay", "180"),
    ("player_mode", "mpv"),
    ("player_path", ""),
    ("torrent_client_path", ""),
    ("nickname", ""),
    ("hub_url", "https://anitrack-hub.onrender.com"),
];

pub fn router() -> Router<Db> {
    Router::new()
        .route("/", get(get_all).patch(patch_all))
        .route("/{key}", get(get_one).put(put_one))
}

fn merged(conn: &rusqlite::Connection) -> rusqlite::Result<Value> {
    let mut m = Map::new();
    for (k, v) in DEFAULTS {
        m.insert((*k).into(), Value::String((*v).into()));
    }
    for row in query_rows(conn, "SELECT key, value FROM settings", &[])? {
        if let (Some(k), Some(v)) = (row["key"].as_str(), row["value"].as_str()) {
            m.insert(k.into(), Value::String(v.into()));
        }
    }
    Ok(Value::Object(m))
}

async fn get_all(State(db): State<Db>) -> Response {
    let conn = db.lock().unwrap();
    match merged(&conn) {
        Ok(v) => ok(v),
        Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    }
}

async fn get_one(State(db): State<Db>, Path(key): Path<String>) -> Response {
    let conn = db.lock().unwrap();
    let stored: Option<String> = conn
        .query_row("SELECT value FROM settings WHERE key = ?1", [&key], |r| r.get(0))
        .ok();
    if let Some(v) = stored {
        return ok(json!({ "key": key, "value": v }));
    }
    match DEFAULTS.iter().find(|(k, _)| *k == key) {
        Some((_, d)) => ok(json!({ "key": key, "value": d })),
        None => err(StatusCode::NOT_FOUND, "Setting not found"),
    }
}

const UPSERT: &str =
    "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value";

async fn put_one(State(db): State<Db>, Path(key): Path<String>, Json(body): Json<Value>) -> Response {
    let value = match body.get("value") {
        None | Some(Value::Null) => return err(StatusCode::BAD_REQUEST, "value is required"),
        Some(v) => js_string(v),
    };
    let conn = db.lock().unwrap();
    match conn.execute(UPSERT, rusqlite::params![key, value]) {
        Ok(_) => ok(json!({ "key": key, "value": value })),
        Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    }
}

async fn patch_all(State(db): State<Db>, Json(body): Json<Value>) -> Response {
    let Value::Object(updates) = body else {
        return err(StatusCode::BAD_REQUEST, "Body must be a key-value object");
    };
    let mut conn = db.lock().unwrap();
    let result: rusqlite::Result<()> = (|| {
        let tx = conn.transaction()?;
        for (k, v) in &updates {
            tx.execute(UPSERT, rusqlite::params![k, js_string(v)])?;
        }
        tx.commit()
    })();
    if let Err(e) = result {
        return err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string());
    }
    match merged(&conn) {
        Ok(v) => ok(v),
        Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    }
}
