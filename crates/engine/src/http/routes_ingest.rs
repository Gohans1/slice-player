//! `POST /api/tracks/ingest-youtube`, `/ingest-local`, `/retry-all` and `/:id/retry` (`index.ts`)

use super::security::MAX_JSON_PAYLOAD_BYTES;
use super::{decode_uri_param, parse_json_bytes, AppState};
use crate::audio_source::validate_safe_local_audio_path;
use crate::db::resolve_abs_path;
use crate::ingest::{IngestResult, clean_input_owned};
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{json, Value};

const MAX_LOCAL_PATHS: usize = 50;
const MAX_BATCH_TRACKS: usize = 50;

fn error(status: StatusCode, message: &str) -> Response {
    (status, Json(json!({ "error": message }))).into_response()
}

fn result_response(result: IngestResult) -> Response {
    let status = if result.success { StatusCode::OK } else { StatusCode::BAD_REQUEST };
    (status, Json(result)).into_response()
}

/// A JSON object body, as parseJsonBody required. The Err is the ready-to-send response, the same
/// shape as `parse_json_bytes`.
#[allow(clippy::result_large_err)]
fn parse_object(body: &Bytes) -> Result<serde_json::Map<String, Value>, Response> {
    match parse_json_bytes::<Value>(body, MAX_JSON_PAYLOAD_BYTES)? {
        Value::Object(map) => Ok(map),
        _ => Err(error(StatusCode::BAD_REQUEST, "Invalid JSON: expected an object")),
    }
}

pub async fn ingest_youtube_handler(State(state): State<AppState>, body: Bytes) -> Response {
    let body = match parse_object(&body) {
        Ok(body) => body,
        Err(resp) => return resp,
    };
    let Some(url) = body.get("url").and_then(Value::as_str).filter(|u| !u.is_empty()) else {
        return error(StatusCode::BAD_REQUEST, "Missing YouTube URL");
    };
    result_response(state.ingest.ingest_youtube_url(url).await)
}

pub async fn ingest_local_handler(State(state): State<AppState>, body: Bytes) -> Response {
    let body = match parse_object(&body) {
        Ok(body) => body,
        Err(resp) => return resp,
    };
    let raw: Vec<&str> = match (body.get("paths").and_then(Value::as_array), body.get("path").and_then(Value::as_str)) {
        (Some(paths), _) => paths.iter().filter_map(Value::as_str).collect(),
        (None, Some(path)) => vec![path],
        _ => vec![],
    };
    let mut items: Vec<String> = Vec::new();
    for item in raw
        .into_iter()
        .map(clean_input_owned)
        .filter(|p| !p.trim().is_empty())
    {
        if !items.contains(&item) {
            items.push(item);
        }
    }
    if items.is_empty() {
        return error(StatusCode::BAD_REQUEST, "Missing file path");
    }
    if items.len() > MAX_LOCAL_PATHS {
        return error(StatusCode::BAD_REQUEST, "Chỉ được nạp tối đa 50 đường dẫn mỗi lần");
    }
    // Every path is checked before touching the filesystem: a UNC path alone would leak the
    // Windows NetNTLM hash to whoever runs that share
    for item in &items {
        if let Err(message) = validate_safe_local_audio_path(item) {
            return (StatusCode::BAD_REQUEST, Json(json!({ "success": false, "message": message }))).into_response();
        }
    }

    let mut tracks = Vec::new();
    let mut errors: Vec<String> = Vec::new();
    for item in &items {
        if tracks.len() >= MAX_BATCH_TRACKS {
            errors.push(format!("Đã đạt giới hạn tối đa {MAX_BATCH_TRACKS} bài nạp trong một lượt."));
            break;
        }
        let resolved = resolve_abs_path(std::path::Path::new(item));
        let name = crate::ingest::file_name(std::path::Path::new(item));
        if !resolved.exists() {
            errors.push(format!("{name}: File hoặc thư mục không tồn tại"));
            continue;
        }
        let resolved_str = resolved.to_string_lossy().to_string();
        if resolved.is_dir() {
            let res = state.ingest.ingest_local_directory(&resolved_str).await;
            match (res.success, res.tracks, res.message) {
                (true, Some(found), _) => {
                    let remaining = MAX_BATCH_TRACKS - tracks.len();
                    if found.len() > remaining {
                        errors.push(format!("Thư mục \"{name}\" có nhiều file hơn số lượng cho phép trong lượt này."));
                    }
                    tracks.extend(found.into_iter().take(remaining));
                }
                (_, _, Some(message)) => errors.push(message),
                _ => {}
            }
        } else {
            let res = state.ingest.ingest_local_file(&resolved_str, None).await;
            match (res.success, res.tracks, res.message) {
                (true, Some(found), _) => tracks.extend(found),
                (_, _, Some(message)) => errors.push(message),
                _ => {}
            }
        }
    }

    if tracks.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "success": false, "message": format!("Không thể nạp bài hát nào: {}", errors.join("; ")) })),
        )
            .into_response();
    }
    let mut message = format!("Đã nạp thành công {} bài hát.", tracks.len());
    if !errors.is_empty() {
        message.push_str(&format!(" ({} bài lỗi)", errors.len()));
    }
    Json(json!({ "success": true, "tracks": tracks, "message": message })).into_response()
}

pub async fn retry_all_handler(State(state): State<AppState>, body: Bytes) -> Response {
    let mut track_ids: Option<Vec<String>> = None;
    if !body.is_empty() {
        let body = match parse_object(&body) {
            Ok(body) => body,
            Err(resp) => return resp,
        };
        if let Some(ids) = body.get("track_ids") {
            let Some(ids) = ids.as_array() else {
                return error(StatusCode::BAD_REQUEST, "track_ids must be an array");
            };
            track_ids = Some(
                ids.iter()
                    .filter_map(Value::as_str)
                    .filter(|id| !id.trim().is_empty())
                    .map(str::to_string)
                    .collect(),
            );
        }
    }
    let requeued = state.ingest.requeue_error_tracks(track_ids.as_deref());
    Json(json!({ "success": true, "requeued": requeued })).into_response()
}

pub async fn retry_track_handler(State(state): State<AppState>, Path(raw_id): Path<String>) -> Response {
    let Ok(track_id) = decode_uri_param(&raw_id) else {
        return error(StatusCode::BAD_REQUEST, "Malformed URI component");
    };
    let Ok(Some(track)) = state.db.get_track(&track_id) else {
        return error(StatusCode::NOT_FOUND, "Track not found");
    };
    let res = match track.source_type.as_str() {
        "youtube" => {
            state.ingest.reset_cookies_status();
            state.ingest.ingest_youtube_url(&track.source_uri).await
        }
        "local" => state.ingest.ingest_local_file(&track.source_uri, None).await,
        _ => return error(StatusCode::BAD_REQUEST, "Unsupported source type"),
    };
    if !res.success {
        let message = res.message.clone().unwrap_or_else(|| "Tải lại thất bại".into());
        state.ingest.mark_error(&track_id, &message);
    }
    result_response(res)
}

const MAX_UPLOAD_FILES: usize = 20;

/// `POST /api/tracks/upload`: up to 20 files in `files` / `file` fields. Every file is spooled to
/// disk first, so the count is known (and an oversized batch refused) before any is ingested.
pub async fn upload_handler(State(state): State<AppState>, mut multipart: axum::extract::Multipart) -> Response {
    let mut spooled: Vec<(String, Result<crate::ingest::upload::SpooledUpload, String>)> = Vec::new();
    loop {
        let field = match multipart.next_field().await {
            Ok(Some(field)) => field,
            Ok(None) => break,
            Err(e) => return error(StatusCode::BAD_REQUEST, &format!("Invalid multipart body: {e}")),
        };
        if !matches!(field.name(), Some("files" | "file")) {
            continue;
        }
        let Some(name) = field.file_name().map(str::to_string) else { continue };
        let name = if name.trim().is_empty() { "audio.flac".to_string() } else { name };
        if spooled.len() >= MAX_UPLOAD_FILES {
            return error(StatusCode::BAD_REQUEST, "Chỉ được tải lên tối đa 20 file mỗi lần");
        }
        let result = state.ingest.spool_upload(&name, field, crate::ingest::upload::MAX_UPLOAD_BYTES).await;
        spooled.push((name, result));
    }
    if spooled.is_empty() {
        return error(StatusCode::BAD_REQUEST, "Không tìm thấy file tải lên");
    }

    let total = spooled.len();
    let mut tracks = Vec::new();
    let mut errors = Vec::new();
    for (name, upload) in spooled {
        let res = match upload {
            Ok(upload) => state.ingest.ingest_spooled_upload(upload).await,
            Err(message) => IngestResult::fail(message),
        };
        match (res.success, res.tracks) {
            (true, Some(found)) => tracks.extend(found),
            _ => errors.push(format!("{name}: {}", res.message.unwrap_or_else(|| "Lỗi nạp file".into()))),
        }
    }
    if tracks.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "success": false, "message": format!("Không thể nạp file: {}", errors.join("; ")) })),
        )
            .into_response();
    }
    let mut message = format!("Đã nạp thành công {}/{total} bài hát.", tracks.len());
    if !errors.is_empty() {
        message.push_str(&format!(" ({} bài lỗi)", errors.len()));
    }
    Json(json!({ "success": true, "tracks": tracks, "message": message })).into_response()
}
