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
            if let Some(ref idx_fn) = state.download_index_fn {
                for t in &mut tracks {
                    if let Some(idx) = idx_fn(&t.id) {
                        t.download_index = Some(idx);
                    }
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
        Ok(Some(mut track)) => {
            if let Some(ref idx_fn) = state.download_index_fn {
                if let Some(idx) = idx_fn(&track.id) {
                    track.download_index = Some(idx);
                }
            }
            Json(track).into_response()
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
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "No valid fields provided for update" })),
        )
            .into_response();
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
    for ext in [".jpg", ".webp", ".png"] {
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

    if let Some(ref cancel_dl) = state.cancel_download_fn {
        cancel_dl(&track_id);
    }
    if let (Some(cancel_wf), Some(fp)) = (&state.cancel_waveform_fn, &track.file_path) {
        cancel_wf(fp);
    }

    let _ = state.db.delete_track(&track_id);
    cleanup_deleted_track_files(&state, &track_id, track.file_path.as_deref());

    for seg in segments {
        state
            .events
            .emit("segment_deleted", json!({ "segmentId": seg.id }));
    }
    state
        .events
        .emit("track_deleted", json!({ "trackId": track_id }));
    for pid in affected_playlists {
        state
            .events
            .emit("playlist_items_changed", json!({ "playlistId": pid }));
    }

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
        return Json(json!({ "success": true, "deletedCount": 0 })).into_response();
    }

    let affected_playlists = state
        .db
        .get_affected_playlist_ids_for_tracks(&valid_ids)
        .unwrap_or_default();
    let tracks_to_delete = state.db.get_tracks_batch(&valid_ids).unwrap_or_default();
    if tracks_to_delete.is_empty() {
        return Json(json!({ "success": true, "deletedCount": 0 })).into_response();
    }

    let existing_track_ids: Vec<String> = tracks_to_delete.iter().map(|(id, _)| id.clone()).collect();
    let segments_to_delete = state
        .db
        .list_segments_by_track_ids(&existing_track_ids)
        .unwrap_or_default();

    for (tid, fp) in &tracks_to_delete {
        if let Some(ref cancel_dl) = state.cancel_download_fn {
            cancel_dl(tid);
        }
        if let (Some(cancel_wf), Some(fp_str)) = (&state.cancel_waveform_fn, fp.as_deref()) {
            cancel_wf(fp_str);
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
        let seg_ids: Vec<String> = segments_to_delete.into_iter().map(|(sid, _)| sid).collect();
        state
            .events
            .emit("segments_deleted", json!({ "segmentIds": seg_ids }));
    }
    state
        .events
        .emit("tracks_deleted", json!({ "trackIds": existing_track_ids }));
    for pid in affected_playlists {
        state
            .events
            .emit("playlist_items_changed", json!({ "playlistId": pid }));
    }

    Json(json!({ "success": true, "deletedCount": deleted_count })).into_response()
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

    let Some(start_time) = obj.get("start_time").and_then(|v| v.as_f64()) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Missing or invalid start_time / end_time" })),
        )
            .into_response();
    };
    let Some(mut end_time) = obj.get("end_time").and_then(|v| v.as_f64()) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Missing or invalid start_time / end_time" })),
        )
            .into_response();
    };
    if !start_time.is_finite() || !end_time.is_finite() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Missing or invalid start_time / end_time" })),
        )
            .into_response();
    }

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

    let mut clean_name = "Slice".to_string();
    if let Some(name_val) = obj.get("name") {
        if !name_val.is_null() {
            let Some(name_str) = name_val.as_str() else {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(json!({ "error": "Segment name must be a string" })),
                )
                    .into_response();
            };
            let s: String = sanitize_control_chars(name_str).chars().take(100).collect();
            if !s.is_empty() {
                clean_name = s;
            }
        }
    }

    let mut clean_color = "#3b82f6".to_string();
    if let Some(color_val) = obj.get("color") {
        if !color_val.is_null() {
            let Some(color_str) = color_val.as_str() else {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(json!({ "error": "Invalid color format" })),
                )
                    .into_response();
            };
            if color_str.len() > 30 || !is_valid_hex_color(color_str) {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(json!({ "error": "Invalid color format" })),
                )
                    .into_response();
            }
            clean_color = color_str.to_string();
        }
    }

    let mut clean_sort_order = 0i64;
    if let Some(so_val) = obj.get("sort_order") {
        if !so_val.is_null() {
            let Some(so) = so_val.as_i64() else {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(json!({ "error": "Invalid sort_order" })),
                )
                    .into_response();
            };
            if !(0..=100_000).contains(&so) {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(json!({ "error": "Invalid sort_order" })),
                )
                    .into_response();
            }
            clean_sort_order = so;
        }
    }

    let seg_id = format!("seg_{}", &Uuid::new_v4().simple().to_string()[..12]);
    match state.db.create_segment(&NewSegment {
        id: seg_id,
        track_id,
        name: clean_name,
        start_time,
        end_time,
        color: Some(clean_color),
        sort_order: Some(clean_sort_order),
    }) {
        Ok(seg) => (StatusCode::CREATED, Json(seg)).into_response(),
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

    let new_start = if let Some(sv) = obj.get("start_time") {
        let Some(s) = sv.as_f64() else {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "Invalid start_time or end_time" })),
            )
                .into_response();
        };
        s
    } else {
        existing.start_time
    };

    let mut new_end = if let Some(ev) = obj.get("end_time") {
        let Some(e) = ev.as_f64() else {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "Invalid start_time or end_time" })),
            )
                .into_response();
        };
        e
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

    let mut updates = SegmentUpdates {
        start_time: Some(new_start),
        end_time: Some(new_end),
        ..Default::default()
    };

    if let Some(name_val) = obj.get("name") {
        let Some(name_str) = name_val.as_str() else {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "Segment name must be a string" })),
            )
                .into_response();
        };
        let clean: String = sanitize_control_chars(name_str).chars().take(100).collect();
        if clean.is_empty() {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "Segment name cannot be empty" })),
            )
                .into_response();
        }
        updates.name = Some(clean);
    }

    if let Some(color_val) = obj.get("color") {
        let Some(color_str) = color_val.as_str() else {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "Invalid color format" })),
            )
                .into_response();
        };
        if color_str.len() > 30 || !is_valid_hex_color(color_str) {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "Invalid color format" })),
            )
                .into_response();
        }
        updates.color = Some(color_str.to_string());
    }

    if let Some(so_val) = obj.get("sort_order") {
        let Some(so) = so_val.as_i64() else {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "Invalid sort_order" })),
            )
                .into_response();
        };
        if !(0..=100_000).contains(&so) {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "Invalid sort_order" })),
            )
                .into_response();
        }
        updates.sort_order = Some(so);
    }

    match state.db.update_segment(&seg_id, &updates) {
        Ok(Some(updated)) => Json(updated).into_response(),
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

    let affected_playlists = state
        .db
        .get_affected_playlist_ids_for_segments(std::slice::from_ref(&seg_id))
        .unwrap_or_default();

    match state.db.delete_segment(&seg_id) {
        Ok(true) => {
            state
                .events
                .emit("segment_deleted", json!({ "segmentId": seg_id }));
            for pid in affected_playlists {
                state
                    .events
                    .emit("playlist_items_changed", json!({ "playlistId": pid }));
            }
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

    let affected_playlists = state
        .db
        .get_affected_playlist_ids_for_segments(&valid_ids)
        .unwrap_or_default();

    match state.db.delete_segments_batch(&valid_ids) {
        Ok(deleted_count) => {
            if deleted_count > 0 {
                state
                    .events
                    .emit("segments_deleted", json!({ "segmentIds": valid_ids }));
                for pid in affected_playlists {
                    state
                        .events
                        .emit("playlist_items_changed", json!({ "playlistId": pid }));
                }
            }
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
