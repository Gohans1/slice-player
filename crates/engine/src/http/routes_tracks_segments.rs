use crate::db::{purge_track_cache_files, resolve_abs_path};
use crate::http::etag::{if_none_match_matches, weak_etag};
use crate::http::security::{MAX_BATCH_LIMIT, MAX_BATCH_PAYLOAD_BYTES, MAX_JSON_PAYLOAD_BYTES};
use crate::http::{decode_uri_param, parse_json_bytes, AppState};
use crate::models::{NewSegment, SegmentUpdates, TrackUpdates};
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{json, Value};
use std::fs;
use uuid::Uuid;

pub fn sanitize_control_chars(s: &str) -> String {
    s.chars()
        .map(|c| {
            if matches!(c, '\r' | '\n' | '\t' | '\x00'..='\x1F' | '\x7F') {
                ' '
            } else {
                c
            }
        })
        .collect::<String>()
        .trim()
        .to_string()
}

const UNINDEXED_QUEUE_FALLBACK: usize = 999_999;

fn is_valid_hex_color(s: &str) -> bool {
    if !s.starts_with('#') {
        return false;
    }
    let hex = &s[1..];
    (3..=8).contains(&hex.len()) && hex.chars().all(|c| c.is_ascii_hexdigit())
}

pub async fn get_tracks_handler(State(state): State<AppState>, headers: HeaderMap) -> Response {
    match state.db.list_tracks() {
        Ok(mut tracks) => {
            // Queued/downloading tracks carry their place in the download queue (index.ts)
            let queue = state.ingest.download_queue_order();
            for t in &mut tracks {
                if t.status == "downloading" || t.status == "queued" {
                    let idx = queue.iter().position(|id| *id == t.id);
                    t.download_index = Some(idx.unwrap_or(if t.status == "downloading" { 0 } else { UNINDEXED_QUEUE_FALLBACK }));
                }
            }
            let body = serde_json::to_string(&tracks).unwrap_or_else(|_| "[]".to_string());
            let etag = weak_etag(&body);
            let inm = headers.get("if-none-match").and_then(|v| v.to_str().ok());
            if if_none_match_matches(inm, &etag) {
                let mut resp = StatusCode::NOT_MODIFIED.into_response();
                if let Ok(v) = HeaderValue::from_str(&etag) {
                    resp.headers_mut().insert("ETag", v);
                }
                resp.headers_mut()
                    .insert("Cache-Control", HeaderValue::from_static("no-cache"));
                return resp;
            }
            let mut resp = (StatusCode::OK, body).into_response();
            resp.headers_mut().insert(
                "Content-Type",
                HeaderValue::from_static("application/json"),
            );
            if let Ok(v) = HeaderValue::from_str(&etag) {
                resp.headers_mut().insert("ETag", v);
            }
            resp.headers_mut()
                .insert("Cache-Control", HeaderValue::from_static("no-cache"));
            resp
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e })),
        )
            .into_response(),
    }
}

pub async fn get_track_by_id_handler(
    State(state): State<AppState>,
    Path(raw_id): Path<String>,
) -> Response {
    let Ok(track_id) = decode_uri_param(&raw_id) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Malformed URI component" })),
        )
            .into_response();
    };
    match state.db.get_track(&track_id) {
        Ok(Some(track)) => Json(track).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Track not found" })),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e })),
        )
            .into_response(),
    }
}

pub async fn update_track_handler(
    State(state): State<AppState>,
    Path(raw_id): Path<String>,
    body: Bytes,
) -> Response {
    let Ok(track_id) = decode_uri_param(&raw_id) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Malformed URI component" })),
        )
            .into_response();
    };
    let val: Value = match parse_json_bytes(&body, MAX_JSON_PAYLOAD_BYTES) {
        Ok(v) => v,
        Err(resp) => return resp,
    };
    let Some(obj) = val.as_object() else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "JSON body must be an object" })),
        )
            .into_response();
    };

    let mut updates = TrackUpdates::default();
    let mut has_updates = false;

    if let Some(title_val) = obj.get("title") {
        let Some(title_str) = title_val.as_str() else {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "Title must be a string" })),
            )
                .into_response();
        };
        let clean: String = sanitize_control_chars(title_str).chars().take(200).collect();
        if clean.is_empty() {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "Title cannot be empty" })),
            )
                .into_response();
        }
        updates.title = Some(clean);
        has_updates = true;
    }

    if let Some(artist_val) = obj.get("artist") {
        let Some(artist_str) = artist_val.as_str() else {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "Artist must be a string" })),
            )
                .into_response();
        };
        let clean: String = sanitize_control_chars(artist_str).chars().take(200).collect();
        updates.artist = Some(clean);
        has_updates = true;
    }

    if let Some(vol_val) = obj.get("volume") {
        let Some(vol) = vol_val.as_f64() else {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "Volume must be a number between 0.0 and 1.0" })),
            )
                .into_response();
        };
        if !vol.is_finite() || !(0.0..=1.0).contains(&vol) {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "Volume must be a number between 0.0 and 1.0" })),
            )
                .into_response();
        }
        updates.volume = Some(vol);
        has_updates = true;
    }

    if !has_updates {
        return match state.db.get_track(&track_id) {
            Ok(Some(existing)) => Json(existing).into_response(),
            Ok(None) => (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": "Track not found" })),
            )
                .into_response(),
            Err(e) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": e })),
            )
                .into_response(),
        };
    }

    let is_volume_only =
        updates.volume.is_some() && updates.title.is_none() && updates.artist.is_none();

    match state.db.update_track(&track_id, &updates) {
        Ok(Some(updated)) => {
            let reason = if is_volume_only { "volume" } else { "general" };
            state.events.emit(
                "track_updated",
                json!({
                    "trackId": track_id,
                    "track": updated,
                    "reason": reason
                }),
            );
            Json(updated).into_response()
        }
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Track not found" })),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e })),
        )
            .into_response(),
    }
}

fn cleanup_deleted_track_files(state: &AppState, track_id: &str, file_path: Option<&str>) {
    let audio_cache_dir = resolve_abs_path(&state.config.data_dir.join("cache/audio"));
    if let Some(fp) = file_path {
        let abs_fp = resolve_abs_path(std::path::Path::new(fp));
        if abs_fp.starts_with(&audio_cache_dir) && abs_fp != audio_cache_dir {
            let _ = fs::remove_file(&abs_fp);
        }
    }
    purge_track_cache_files(&audio_cache_dir, track_id);

    let thumbs_dir = state.config.data_dir.join("cache/thumbs");
    for ext in [".jpg", ".jpeg", ".webp", ".png"] {
        let _ = fs::remove_file(thumbs_dir.join(format!("{track_id}{ext}")));
    }
    crate::thumbnails::remove_thumbnail_variants(
        track_id,
        &state.config.data_dir.join("cache/thumbs-sized"),
    );
}

pub async fn delete_track_handler(
    State(state): State<AppState>,
    Path(raw_id): Path<String>,
) -> Response {
    let Ok(track_id) = decode_uri_param(&raw_id) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Malformed URI component" })),
        )
            .into_response();
    };

    // Settle any ingest of this track first, so it can't write the row back after the delete
    state.ingest.cancel_download_if_active(&track_id).await;
    let Ok(Some(track)) = state.db.get_track(&track_id) else {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Track not found" })),
        )
            .into_response();
    };

    let affected_playlists = state
        .db
        .get_affected_playlist_ids_for_tracks(std::slice::from_ref(&track_id))
        .unwrap_or_default();
    let segments = state
        .db
        .list_segments_by_track(&track_id)
        .unwrap_or_default();

    if let Some(fp) = &track.file_path {
        crate::audio_analysis::cancel_waveform_for_file(fp);
    }

    let _ = state.db.delete_track(&track_id);
    cleanup_deleted_track_files(&state, &track_id, track.file_path.as_deref());

    state
        .events
        .emit("track_deleted", json!({ "trackId": track_id }));
    for seg in segments {
        state
            .events
            .emit("segment_deleted", json!({ "segmentId": seg.id, "trackId": track_id }));
    }
    for pid in &affected_playlists {
        state
            .events
            .emit("playlist_items_changed", json!({ "playlistId": pid }));
    }
    state.events.emit("playlist_items_changed", json!({}));

    Json(json!({ "success": true })).into_response()
}

pub async fn batch_delete_tracks_handler(
    State(state): State<AppState>,
    body: Bytes,
) -> Response {
    let val: Value = match parse_json_bytes(&body, MAX_BATCH_PAYLOAD_BYTES) {
        Ok(v) => v,
        Err(resp) => return resp,
    };
    let Some(ids_arr) = val.get("ids").and_then(|v| v.as_array()) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "ids array is required" })),
        )
            .into_response();
    };

    let mut seen = std::collections::HashSet::new();
    let mut valid_ids = Vec::new();
    for item in ids_arr {
        if let Some(s) = item.as_str() {
            let trimmed = s.trim();
            if !trimmed.is_empty() && seen.insert(trimmed.to_string()) {
                valid_ids.push(trimmed.to_string());
            }
        }
    }

    if valid_ids.len() > MAX_BATCH_LIMIT {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": format!("Batch size limit exceeded (max {MAX_BATCH_LIMIT})") })),
        )
            .into_response();
    }

    if valid_ids.is_empty() {
        return Json(json!({ "success": true, "count": 0 })).into_response();
    }

    // Cancel any active downloads/ingests for all requested IDs BEFORE reading DB state
    for tid in &valid_ids {
        state.ingest.cancel_download_if_active(tid).await;
    }

    let affected_playlists = state
        .db
        .get_affected_playlist_ids_for_tracks(&valid_ids)
        .unwrap_or_default();
    let tracks_to_delete = state.db.get_tracks_batch(&valid_ids).unwrap_or_default();
    if tracks_to_delete.is_empty() {
        return Json(json!({ "success": true, "count": 0 })).into_response();
    }

    let existing_track_ids: Vec<String> = tracks_to_delete.iter().map(|(id, _)| id.clone()).collect();
    let segments_to_delete = state
        .db
        .list_segments_by_track_ids(&existing_track_ids)
        .unwrap_or_default();

    for (_, fp) in &tracks_to_delete {
        if let Some(fp_str) = fp.as_deref() {
            crate::audio_analysis::cancel_waveform_for_file(fp_str);
        }
    }

    let deleted_count = match state.db.delete_tracks_batch(&existing_track_ids) {
        Ok(c) => c,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": e })),
            )
                .into_response()
        }
    };

    for (tid, fp) in &tracks_to_delete {
        cleanup_deleted_track_files(&state, tid, fp.as_deref());
    }

    if !segments_to_delete.is_empty() {
        let items: Vec<Value> = segments_to_delete
            .iter()
            .map(|(sid, tid)| json!({ "segmentId": sid, "trackId": tid }))
            .collect();
        let seg_ids: Vec<String> = segments_to_delete.into_iter().map(|(sid, _)| sid).collect();
        state
            .events
            .emit("segments_deleted", json!({ "segmentIds": seg_ids, "items": items }));
    }
    state
        .events
        .emit("tracks_deleted", json!({ "trackIds": existing_track_ids }));
    for pid in &affected_playlists {
        state
            .events
            .emit("playlist_items_changed", json!({ "playlistId": pid }));
    }
    state.events.emit("playlist_items_changed", json!({}));

    Json(json!({ "success": true, "count": deleted_count })).into_response()
}

pub async fn get_track_segments_handler(
    State(state): State<AppState>,
    Path(raw_id): Path<String>,
) -> Response {
    let Ok(track_id) = decode_uri_param(&raw_id) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Malformed URI component" })),
        )
            .into_response();
    };
    match state.db.list_segments_by_track(&track_id) {
        Ok(segs) => Json(segs).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e })),
        )
            .into_response(),
    }
}

fn round2(val: f64) -> f64 {
    (val * 100.0).round() / 100.0
}

pub async fn create_track_segment_handler(
    State(state): State<AppState>,
    Path(raw_id): Path<String>,
    body: Bytes,
) -> Response {
    let Ok(track_id) = decode_uri_param(&raw_id) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Malformed URI component" })),
        )
            .into_response();
    };

    let val: Value = match parse_json_bytes(&body, MAX_JSON_PAYLOAD_BYTES) {
        Ok(v) => v,
        Err(resp) => return resp,
    };
    let Some(obj) = val.as_object() else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "JSON body must be an object" })),
        )
            .into_response();
    };

    let Some(name_val) = obj.get("name").filter(|v| !v.is_null()) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Missing segment fields" })),
        )
            .into_response();
    };
    let Some(name_str) = name_val.as_str() else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Segment name must be a string" })),
        )
            .into_response();
    };

    let Some(raw_start) = obj.get("start_time").and_then(|v| v.as_f64()) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Missing segment fields" })),
        )
            .into_response();
    };
    let Some(raw_end) = obj.get("end_time").and_then(|v| v.as_f64()) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Missing segment fields" })),
        )
            .into_response();
    };
    if !raw_start.is_finite() || !raw_end.is_finite() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Missing or invalid start_time / end_time" })),
        )
            .into_response();
    }

    let start_time = round2(raw_start);
    let mut end_time = round2(raw_end);

    let Ok(Some(track)) = state.db.get_track(&track_id) else {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Track not found" })),
        )
            .into_response();
    };
    if track.status != "ready" {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Track is not ready for slicing" })),
        )
            .into_response();
    }
    if !track.duration.is_finite() || track.duration <= 0.0 {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Track duration is invalid or unknown" })),
        )
            .into_response();
    }

    if end_time > track.duration && end_time <= track.duration + 0.5 {
        end_time = track.duration;
    }

    if start_time < 0.0
        || end_time <= start_time
        || (end_time - start_time) < 0.5
        || end_time > 1800.0
        || end_time > track.duration + 0.1
        || start_time >= track.duration
    {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Invalid segment time boundaries (min 0.5s, must be within track duration)" })),
        )
            .into_response();
    }

    let clean_name: String = sanitize_control_chars(name_str).chars().take(100).collect();
    if clean_name.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Tên đoạn không được để trống" })),
        )
            .into_response();
    }

    let clean_color = obj
        .get("color")
        .and_then(|v| v.as_str())
        .filter(|s| is_valid_hex_color(s))
        .unwrap_or("#4385BE")
        .to_string();

    let clean_sort_order = obj
        .get("sort_order")
        .and_then(|v| v.as_i64())
        .filter(|so| (0..=100_000).contains(so))
        .unwrap_or(0);

    let seg_id = format!("seg_{}", &Uuid::new_v4().simple().to_string()[..12]);
    match state.db.create_segment(&NewSegment {
        id: seg_id,
        track_id: track_id.clone(),
        name: clean_name,
        start_time,
        end_time,
        color: Some(clean_color),
        sort_order: Some(clean_sort_order),
    }) {
        Ok(seg) => {
            state
                .events
                .emit("track_updated", json!({ "trackId": track_id }));
            (StatusCode::CREATED, Json(seg)).into_response()
        }
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": e })),
        )
            .into_response(),
    }
}

pub async fn update_segment_handler(
    State(state): State<AppState>,
    Path(raw_id): Path<String>,
    body: Bytes,
) -> Response {
    let Ok(seg_id) = decode_uri_param(&raw_id) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Malformed URI component" })),
        )
            .into_response();
    };
    let val: Value = match parse_json_bytes(&body, MAX_JSON_PAYLOAD_BYTES) {
        Ok(v) => v,
        Err(resp) => return resp,
    };
    let Some(obj) = val.as_object() else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "JSON body must be an object" })),
        )
            .into_response();
    };

    let Ok(Some(existing)) = state.db.get_segment(&seg_id) else {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Segment not found" })),
        )
            .into_response();
    };
    let Ok(Some(track)) = state.db.get_track(&existing.track_id) else {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Parent track not found" })),
        )
            .into_response();
    };
    if track.status != "ready" || !track.duration.is_finite() || track.duration <= 0.0 {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Bài hát chưa sẵn sàng để chỉnh sửa đoạn" })),
        )
            .into_response();
    }

    let new_start = if let Some(sv) = obj.get("start_time").filter(|v| !v.is_null()) {
        let Some(s) = sv.as_f64() else {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "Invalid start_time or end_time" })),
            )
                .into_response();
        };
        round2(s)
    } else {
        existing.start_time
    };

    let mut new_end = if let Some(ev) = obj.get("end_time").filter(|v| !v.is_null()) {
        let Some(e) = ev.as_f64() else {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "Invalid start_time or end_time" })),
            )
                .into_response();
        };
        round2(e)
    } else {
        existing.end_time
    };

    if !new_start.is_finite() || !new_end.is_finite() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Invalid start_time or end_time" })),
        )
            .into_response();
    }

    if track.duration > 0.0 && new_end > track.duration && new_end <= track.duration + 0.5 {
        new_end = track.duration;
    }

    if new_start < 0.0
        || new_end <= new_start
        || (new_end - new_start) < 0.5
        || new_end > 1800.0
        || (track.duration > 0.0 && (new_end > track.duration + 0.1 || new_start >= track.duration))
    {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Invalid segment time boundaries (min 0.5s, must be within track duration)" })),
        )
            .into_response();
    }

    let clean_name = if let Some(name_val) = obj.get("name").filter(|v| !v.is_null()) {
        let Some(name_str) = name_val.as_str() else {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "Segment name must be a string" })),
            )
                .into_response();
        };
        let clean: String = sanitize_control_chars(name_str).chars().take(100).collect();
        if clean.is_empty() {
            existing.name.clone()
        } else {
            clean
        }
    } else {
        existing.name.clone()
    };

    let clean_color = obj
        .get("color")
        .and_then(|v| v.as_str())
        .filter(|s| is_valid_hex_color(s))
        .unwrap_or(&existing.color)
        .to_string();

    let clean_sort_order = obj
        .get("sort_order")
        .and_then(|v| v.as_i64())
        .filter(|so| (0..100_000).contains(so))
        .unwrap_or(existing.sort_order);

    let updates = SegmentUpdates {
        name: Some(clean_name),
        color: Some(clean_color),
        start_time: Some(new_start),
        end_time: Some(new_end),
        sort_order: Some(clean_sort_order),
    };

    match state.db.update_segment(&seg_id, &updates) {
        Ok(Some(updated)) => {
            state.events.emit(
                "segment_updated",
                json!({ "segmentId": seg_id, "trackId": existing.track_id }),
            );
            state
                .events
                .emit("track_updated", json!({ "trackId": existing.track_id }));
            Json(updated).into_response()
        }
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Segment not found" })),
        )
            .into_response(),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": e })),
        )
            .into_response(),
    }
}

pub async fn delete_segment_handler(
    State(state): State<AppState>,
    Path(raw_id): Path<String>,
) -> Response {
    let Ok(seg_id) = decode_uri_param(&raw_id) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Malformed URI component" })),
        )
            .into_response();
    };

    let Ok(Some(existing)) = state.db.get_segment(&seg_id) else {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Segment not found" })),
        )
            .into_response();
    };

    let affected_playlists = state
        .db
        .get_affected_playlist_ids_for_segments(std::slice::from_ref(&seg_id))
        .unwrap_or_default();

    match state.db.delete_segment(&seg_id) {
        Ok(true) => {
            state.events.emit(
                "segment_deleted",
                json!({ "segmentId": seg_id, "trackId": existing.track_id }),
            );
            state
                .events
                .emit("track_updated", json!({ "trackId": existing.track_id }));
            for pid in &affected_playlists {
                state
                    .events
                    .emit("playlist_items_changed", json!({ "playlistId": pid }));
            }
            state.events.emit("playlist_items_changed", json!({}));
            Json(json!({ "success": true })).into_response()
        }
        Ok(false) => (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Segment not found" })),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e })),
        )
            .into_response(),
    }
}

pub async fn batch_delete_segments_handler(
    State(state): State<AppState>,
    body: Bytes,
) -> Response {
    let val: Value = match parse_json_bytes(&body, MAX_BATCH_PAYLOAD_BYTES) {
        Ok(v) => v,
        Err(resp) => return resp,
    };
    let Some(ids_arr) = val.get("ids").and_then(|v| v.as_array()) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "ids array is required" })),
        )
            .into_response();
    };

    let mut seen = std::collections::HashSet::new();
    let mut valid_ids = Vec::new();
    for item in ids_arr {
        if let Some(s) = item.as_str() {
            let trimmed = s.trim();
            if !trimmed.is_empty() && seen.insert(trimmed.to_string()) {
                valid_ids.push(trimmed.to_string());
            }
        }
    }

    if valid_ids.len() > MAX_BATCH_LIMIT {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": format!("Batch size limit exceeded (max {MAX_BATCH_LIMIT})") })),
        )
            .into_response();
    }

    if valid_ids.is_empty() {
        return Json(json!({ "success": true, "deletedCount": 0 })).into_response();
    }

    let (affected_track_ids, segment_track_map) = state.db.with_conn(|conn| {
        let mut track_ids = Vec::new();
        let mut track_seen = std::collections::HashSet::new();
        let mut map = serde_json::Map::new();
        for chunk in valid_ids.chunks(500) {
            let placeholders = vec!["?"; chunk.len()].join(",");
            let sql = format!("SELECT id, track_id FROM segments WHERE id IN ({placeholders})");
            if let Ok(mut stmt) = conn.prepare(&sql)
                && let Ok(rows) = stmt.query_map(rusqlite::params_from_iter(chunk.iter()), |r| {
                    Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
                })
            {
                for row in rows.flatten() {
                    if track_seen.insert(row.1.clone()) {
                        track_ids.push(row.1.clone());
                    }
                    map.insert(row.0, Value::String(row.1));
                }
            }
        }
        (track_ids, map)
    });

    let affected_playlists = state
        .db
        .get_affected_playlist_ids_for_segments(&valid_ids)
        .unwrap_or_default();

    match state.db.delete_segments_batch(&valid_ids) {
        Ok(deleted_count) => {
            state.events.emit(
                "segments_deleted",
                json!({
                    "segmentIds": valid_ids,
                    "segmentTrackMap": segment_track_map,
                }),
            );
            if affected_track_ids.len() <= 10 {
                for tid in affected_track_ids {
                    state
                        .events
                        .emit("track_updated", json!({ "trackId": tid }));
                }
            }
            for pid in &affected_playlists {
                state
                    .events
                    .emit("playlist_items_changed", json!({ "playlistId": pid }));
            }
            state.events.emit("playlist_items_changed", json!({}));
            Json(json!({ "success": true, "deletedCount": deleted_count })).into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e })),
        )
            .into_response(),
    }
}

pub async fn get_all_segments_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Response {
    match state.db.list_all_segments() {
        Ok(segments) => {
            let body = serde_json::to_string(&segments).unwrap_or_else(|_| "[]".to_string());
            let etag = weak_etag(&body);
            let inm = headers.get("if-none-match").and_then(|v| v.to_str().ok());
            if if_none_match_matches(inm, &etag) {
                let mut resp = StatusCode::NOT_MODIFIED.into_response();
                if let Ok(v) = HeaderValue::from_str(&etag) {
                    resp.headers_mut().insert("ETag", v);
                }
                resp.headers_mut()
                    .insert("Cache-Control", HeaderValue::from_static("no-cache"));
                return resp;
            }
            let mut resp = (StatusCode::OK, body).into_response();
            resp.headers_mut().insert(
                "Content-Type",
                HeaderValue::from_static("application/json"),
            );
            if let Ok(v) = HeaderValue::from_str(&etag) {
                resp.headers_mut().insert("ETag", v);
            }
            resp.headers_mut()
                .insert("Cache-Control", HeaderValue::from_static("no-cache"));
            resp
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e })),
        )
            .into_response(),
    }
}
