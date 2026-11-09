mod db;
mod queue;
mod routes;
mod util;

use axum::{
    extract::{DefaultBodyLimit, Request},
    http::{HeaderValue, StatusCode},
    response::IntoResponse,
    routing::get,
    Json, Router, ServiceExt,
};
use serde_json::json;
use std::sync::{Arc, Mutex};
use tower::Layer;
use tower_http::{
    cors::{AllowOrigin, Any, CorsLayer},
    normalize_path::NormalizePathLayer,
};

async fn health() -> impl IntoResponse {
    Json(json!({
        "status": "ok",
        "version": "1.0.0",
        "server": "rust",
        "timestamp": chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
    }))
}

async fn not_found(req: Request) -> impl IntoResponse {
    if req.uri().path().starts_with("/api/") {
        (StatusCode::NOT_FOUND, Json(json!({ "error": "API route not found" }))).into_response()
    } else {
        StatusCode::NOT_FOUND.into_response()
    }
}

fn origin_allowed(origin: &HeaderValue) -> bool {
    let o = origin.to_str().unwrap_or("");
    o.starts_with("http://localhost")
        || o == "file://"
        // Tauri webview origins (for the later Tauri shell)
        || o == "tauri://localhost"
        || o.starts_with("http://tauri.localhost")
        || o.starts_with("https://tauri.localhost")
}

#[tokio::main]
async fn main() {
    let conn = match db::open() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[server] DB init failed: {e}");
            std::process::exit(1);
        }
    };
    let state: routes::Db = Arc::new(Mutex::new(conn));

    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::predicate(|o, _| origin_allowed(o)))
        .allow_methods(Any)
        .allow_headers(Any);

    let router = Router::new()
        .route("/api/health", get(health))
        .nest("/api/settings", routes::settings::router())
        .nest("/api/anime", routes::anime::router())
        .fallback(not_found)
        .layer(DefaultBodyLimit::max(10 * 1024 * 1024))
        .layer(cors)
        .with_state(state);

    // Express treats "/api/anime" and "/api/anime/" the same — so do we.
    let app = NormalizePathLayer::trim_trailing_slash().layer(router);

    let port: u16 = std::env::var("SERVER_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(3000);
    let listener = match tokio::net::TcpListener::bind(("127.0.0.1", port)).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("[server] Cannot bind 127.0.0.1:{port}: {e}");
            std::process::exit(1);
        }
    };
    println!("[server] AniTrack (Rust) running on http://127.0.0.1:{port}");
    axum::serve(listener, ServiceExt::<Request>::into_make_service(app))
        .await
        .unwrap();
}
