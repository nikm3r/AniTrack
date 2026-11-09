pub mod anime;
pub mod settings;

use axum::{http::StatusCode, response::{IntoResponse, Response}, Json};
use rusqlite::Connection;
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};

pub type Db = Arc<Mutex<Connection>>;

pub fn err(status: StatusCode, msg: &str) -> Response {
    (status, Json(json!({ "error": msg }))).into_response()
}

pub fn ok(v: Value) -> Response {
    (StatusCode::OK, Json(v)).into_response()
}

/// Run a SELECT and return every row as a JSON object.
pub fn query_rows(
    conn: &Connection,
    sql: &str,
    params: &[rusqlite::types::Value],
) -> rusqlite::Result<Vec<Value>> {
    let mut stmt = conn.prepare(sql)?;
    let cols: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let rows = stmt.query_map(rusqlite::params_from_iter(params.iter()), |r| {
        crate::util::row_to_json(r, &cols)
    })?;
    rows.collect()
}
