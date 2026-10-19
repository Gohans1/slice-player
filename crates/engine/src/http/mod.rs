pub mod etag;
pub mod routes_backup;
pub mod routes_ingest;
pub mod routes_playlists;
pub mod routes_plays;
pub mod routes_stream;
pub mod routes_thumbs;
pub mod routes_tracks_segments;
pub mod security;
pub mod ws_and_logs;

use crate::app_window::WsLifecycleTracker;
use crate::db::{resolve_abs_path, Db};
use crate::events::EventBus;
use crate::audio_analysis::LoudnessWorker;
use crate::ingest::Ingest;
use std::sync::atomic::AtomicBool;
use crate::EngineConfig;
use axum::body::{Body, Bytes};
use axum::extract::{DefaultBodyLimit, State};
use axum::http::{HeaderValue, Request, StatusCode};
use axum::middleware;
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post, put};
use axum::{Json, Router};
use security::LibraryMutationGate;
use serde::de::DeserializeOwned;
use serde_json::json;
use std::path::Path;
use std::sync::Arc;
use ws_and_logs::ServerLogger;

#[derive(Clone)]
pub struct AppState {
    pub config: EngineConfig,
    pub db: Db,
    pub events: EventBus,
    pub logger: ServerLogger,
    pub mutation_gate: LibraryMutationGate,
    pub ws_lifecycle: Option<Arc<WsLifecycleTracker>>,
    pub ingest: Ingest,
    pub loudness: LoudnessWorker,
    /// Set while `/api/library/export` streams (only one at a time, never during a restore)
    pub exporting: Arc<AtomicBool>,
}

impl AppState {
    pub fn new(config: EngineConfig, db: Db, events: EventBus) -> Self {
        let logger = ServerLogger::new(events.clone());
        let ingest = Ingest::new(db.clone(), events.clone(), logger.clone(), config.data_dir.clone());
        let loudness = LoudnessWorker::new(db.clone(), events.clone());
        for event_name in ["track_created", "track_updated", "library_restored"] {
            let worker = loudness.clone();
            events.on(event_name, move |payload| {
                if event_name == "track_updated"
                    && matches!(
                        payload.get("reason").and_then(|v| v.as_str()),
                        Some("loudness" | "volume")
                    )
                {
                    return;
                }
                let w = worker.clone();
                if let Ok(handle) = tokio::runtime::Handle::try_current() {
                    handle.spawn(async move {
                        w.measure_missing_loudness().await;
                    });
                }
            });
        }
        Self {
            config,
            db,
            events,
            logger,
            mutation_gate: LibraryMutationGate::new(),
            ws_lifecycle: None,
            ingest,
            loudness,
            exporting: Arc::new(AtomicBool::new(false)),
        }
    }
}

#[allow(clippy::result_unit_err)]
pub fn decode_uri_param(raw: &str) -> Result<String, ()> {
    let bytes = raw.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0usize;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            if i + 2 >= bytes.len() {
                return Err(());
            }
            let h1 = (bytes[i + 1] as char).to_digit(16).ok_or(())?;
            let h2 = (bytes[i + 2] as char).to_digit(16).ok_or(())?;
            out.push(((h1 << 4) | h2) as u8);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).map_err(|_| ())
}

#[allow(clippy::result_large_err)]
pub fn parse_json_bytes<T: DeserializeOwned>(body: &Bytes, max_bytes: u64) -> Result<T, Response> {
    if body.len() as u64 > max_bytes {
        return Err((
            StatusCode::PAYLOAD_TOO_LARGE,
            Json(json!({ "error": "Payload Too Large" })),
        )
            .into_response());
    }
    serde_json::from_slice::<T>(body).map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": format!("Invalid JSON: {e}") })),
        )
            .into_response()
    })
}

fn static_mime_type(ext: &str) -> &'static str {
    match ext {
        ".html" => "text/html; charset=utf-8",
        ".js" => "application/javascript; charset=utf-8",
        ".css" => "text/css; charset=utf-8",
        ".json" => "application/json; charset=utf-8",
        ".svg" => "image/svg+xml",
        ".png" => "image/png",
        ".jpg" | ".jpeg" => "image/jpeg",
        ".webp" => "image/webp",
        ".ico" => "image/x-icon",
        ".woff" => "font/woff",
        ".woff2" => "font/woff2",
        _ => "application/octet-stream",
    }
}

async fn fallback_handler(State(state): State<AppState>, req: Request<Body>) -> Response {
    let pathname = req.uri().path();
    if pathname.starts_with("/api/") {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "API endpoint not found" })),
        )
            .into_response();
    }

    let raw_rel = if pathname == "/" {
        "index.html"
    } else {
        pathname.strip_prefix('/').unwrap_or(pathname)
    };

    let Ok(rel_path) = decode_uri_param(raw_rel) else {
        return (StatusCode::BAD_REQUEST, "Bad Request").into_response();
    };

    // Block path traversal before touching disk
    if rel_path.contains('\0')
        || rel_path
            .split(['/', '\\'])
            .any(|seg| seg == "..")
    {
        return (StatusCode::NOT_FOUND, "Not Found").into_response();
    }

    let dist_dir = resolve_abs_path(&state.config.dist_dir);
    let candidate = resolve_abs_path(&dist_dir.join(&rel_path));
    let mut is_inside = candidate == dist_dir || candidate.starts_with(&dist_dir);
    if is_inside
        && let (Ok(canon_dist), Ok(canon_cand)) = (dist_dir.canonicalize(), candidate.canonicalize())
    {
        is_inside = canon_cand == canon_dist || canon_cand.starts_with(&canon_dist);
    }

    if is_inside
        && candidate.is_file()
        && let Ok(bytes) = std::fs::read(&candidate)
    {
        let ext = candidate
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| format!(".{}", e.to_ascii_lowercase()))
            .unwrap_or_default();
        let ct = static_mime_type(&ext);
        let is_asset = candidate
            .components()
            .any(|c| c.as_os_str().eq_ignore_ascii_case("assets"));
        let cache_control = if is_asset {
            "public, max-age=31536000, immutable"
        } else {
            "no-cache"
        };
        let mut resp = (StatusCode::OK, bytes).into_response();
        resp.headers_mut()
            .insert("Content-Type", HeaderValue::from_static(ct));
        resp.headers_mut()
            .insert("Cache-Control", HeaderValue::from_static(cache_control));
        return resp;
    }

    let has_ext = Path::new(pathname).extension().is_some();
    let accepts_html = req
        .headers()
        .get("accept")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.contains("text/html"))
        .unwrap_or(false);
    let is_nav = !has_ext || accepts_html;

    let fallback_index = dist_dir.join("index.html");
    if is_nav
        && fallback_index.is_file()
        && let Ok(bytes) = std::fs::read(&fallback_index)
    {
        let mut resp = (StatusCode::OK, bytes).into_response();
        resp.headers_mut().insert(
            "Content-Type",
            HeaderValue::from_static("text/html; charset=utf-8"),
        );
        resp.headers_mut()
            .insert("Cache-Control", HeaderValue::from_static("no-cache"));
        return resp;
    }

    if !is_nav {
        return (StatusCode::NOT_FOUND, "Not Found").into_response();
    }

    (
        StatusCode::OK,
        "Slice Player Backend Running. Frontend is being built...",
    )
        .into_response()
}

pub fn build_router(state: AppState) -> Router {
    Router::new()
        .route("/ws", get(ws_and_logs::ws_handler))
        .route(
            "/api/logs",
            get(ws_and_logs::get_logs_handler).delete(ws_and_logs::delete_logs_handler),
        )
        .route("/api/tracks", get(routes_tracks_segments::get_tracks_handler))
        .route("/api/tracks/ingest-youtube", post(routes_ingest::ingest_youtube_handler))
        .route("/api/tracks/ingest-local", post(routes_ingest::ingest_local_handler))
        .route("/api/tracks/retry-all", post(routes_ingest::retry_all_handler))
        .route(
            "/api/tracks/upload",
            // The security middleware already caps the request at 305 MiB by Content-Length
            post(routes_ingest::upload_handler).layer(DefaultBodyLimit::max(security::MAX_UPLOAD_REQUEST_BYTES as usize)),
        )
        .route("/api/tracks/{id}/retry", post(routes_ingest::retry_track_handler))
        .route(
            "/api/tracks/batch-delete",
            post(routes_tracks_segments::batch_delete_tracks_handler),
        )
        .route(
            "/api/tracks/{id}",
            get(routes_tracks_segments::get_track_by_id_handler)
                .put(routes_tracks_segments::update_track_handler)
                .patch(routes_tracks_segments::update_track_handler)
                .delete(routes_tracks_segments::delete_track_handler),
        )
        .route(
            "/api/tracks/{id}/stream",
            get(routes_stream::stream_track_handler),
        )
        .route("/api/thumbs/{file}", get(routes_thumbs::thumb_handler))
        .route(
            "/api/tracks/{id}/segments",
            get(routes_tracks_segments::get_track_segments_handler)
                .post(routes_tracks_segments::create_track_segment_handler),
        )
        .route(
            "/api/segments",
            get(routes_tracks_segments::get_all_segments_handler),
        )
        .route(
            "/api/segments/batch-delete",
            post(routes_tracks_segments::batch_delete_segments_handler),
        )
        .route(
            "/api/segments/{id}",
            put(routes_tracks_segments::update_segment_handler)
                .delete(routes_tracks_segments::delete_segment_handler),
        )
        .route(
            "/api/playlist-memberships",
            get(routes_playlists::get_playlist_memberships_handler),
        )
        .route(
            "/api/playlists",
            get(routes_playlists::list_playlists_handler)
                .post(routes_playlists::create_playlist_handler),
        )
        .route(
            "/api/playlists/mix",
            post(routes_playlists::create_mix_playlist_handler),
        )
        .route(
            "/api/playlists/{id}/sources",
            put(routes_playlists::update_mix_sources_handler),
        )
        .route(
            "/api/playlists/{id}/reorder",
            put(routes_playlists::reorder_playlist_handler),
        )
        .route(
            "/api/playlists/{id}/items/batch",
            post(routes_playlists::batch_add_playlist_items_handler),
        )
        .route(
            "/api/playlists/{id}/items/batch-delete",
            post(routes_playlists::batch_delete_playlist_items_handler),
        )
        .route(
            "/api/playlists/{id}/items",
            post(routes_playlists::add_playlist_item_handler),
        )
        .route(
            "/api/playlists/{id}/items/{item_id}",
            delete(routes_playlists::delete_playlist_item_handler),
        )
        .route(
            "/api/playlists/{id}",
            get(routes_playlists::get_playlist_detail_handler)
                .patch(routes_playlists::patch_playlist_handler)
                .delete(routes_playlists::delete_playlist_handler),
        )
        .route("/api/library/export", get(routes_backup::export_handler))
        .route(
            "/api/library/import",
            // The security middleware caps this request at 2 GiB by Content-Length
            post(routes_backup::import_handler).layer(DefaultBodyLimit::max(security::MAX_BACKUP_REQUEST_BYTES as usize)),
        )
        .route("/api/plays", post(routes_plays::record_play_handler))
        .route("/api/home", get(routes_plays::get_home_handler))
        .fallback(fallback_handler)
        .layer(middleware::from_fn_with_state(
            state.clone(),
            security::security_middleware,
        ))
        .with_state(state)
}
