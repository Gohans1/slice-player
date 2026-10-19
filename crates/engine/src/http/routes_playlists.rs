use crate::http::routes_tracks_segments::sanitize_control_chars;
use crate::http::security::{MAX_BATCH_LIMIT, MAX_BATCH_PAYLOAD_BYTES, MAX_JSON_PAYLOAD_BYTES};
use crate::http::{decode_uri_param, parse_json_bytes, AppState};
use crate::models::BatchPlaylistItemInput;
use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashSet;

#[derive(Deserialize)]
pub struct MembershipsQuery {
    pub track_id: Option<String>,
    pub segment_id: Option<String>,
    pub all: Option<String>,
}

pub async fn get_playlist_memberships_handler(
    State(state): State<AppState>,
    Query(query): Query<MembershipsQuery>,
) -> Response {
    let Some(ref track_id) = query.track_id else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "track_id là bắt buộc" })),
        )
            .into_response();
    };
    if track_id.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "track_id là bắt buộc" })),
        )
            .into_response();
    }
    let include_all = query.all.as_deref() == Some("true");
    match state
        .db
        .get_playlist_memberships(track_id, query.segment_id.as_deref(), include_all)
    {
        Ok(memberships) => Json(memberships).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e })),
        )
            .into_response(),
    }
}

pub async fn list_playlists_handler(State(state): State<AppState>) -> Response {
    match state.db.list_playlists() {
        Ok(playlists) => Json(playlists).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e })),
        )
            .into_response(),
    }
}

pub async fn create_playlist_handler(State(state): State<AppState>, body: Bytes) -> Response {
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

    let Some(name_str) = obj.get("name").and_then(|v| v.as_str()) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Tên danh sách phát phải là chuỗi" })),
        )
            .into_response();
    };
    let raw_name: String = sanitize_control_chars(name_str).chars().take(100).collect();
    if raw_name.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Tên danh sách phát không được để trống" })),
        )
            .into_response();
    }

    let mut parent_id: Option<String> = None;
    if let Some(p_val) = obj.get("parent_id")
        && !p_val.is_null()
    {
        let Some(p_str) = p_val.as_str() else {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "parent_id phải là chuỗi hoặc null" })),
            )
                .into_response();
        };
        let trimmed = p_str.trim();
        if !trimmed.is_empty() {
            parent_id = Some(trimmed.to_string());
        }
    }

    match state
        .db
        .create_playlist(&raw_name, None, parent_id.as_deref())
    {
        Ok(playlist) => {
            state
                .events
                .emit("playlist_created", json!({ "playlist": playlist }));
            (StatusCode::CREATED, Json(playlist)).into_response()
        }
        Err(e) => {
            let is_client_err = e.contains("nest beyond 1 level")
                || e.contains("mix playlist")
                || e.contains("Parent playlist")
                || e.contains("not found")
                || e.contains("empty");
            let status = if is_client_err {
                StatusCode::BAD_REQUEST
            } else {
                StatusCode::INTERNAL_SERVER_ERROR
            };
            (status, Json(json!({ "error": e }))).into_response()
        }
    }
}

pub async fn create_mix_playlist_handler(State(state): State<AppState>, body: Bytes) -> Response {
    let val: Value = match parse_json_bytes(&body, MAX_JSON_PAYLOAD_BYTES) {
        Ok(v) => v,
        Err(resp) => return resp,
    };
    let Some(obj) = val.as_object() else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Cần name (chuỗi) và source_ids (mảng chuỗi)" })),
        )
            .into_response();
    };

    let Some(name_str) = obj.get("name").and_then(|v| v.as_str()) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Cần name (chuỗi) và source_ids (mảng chuỗi)" })),
        )
            .into_response();
    };
    let Some(source_arr) = obj.get("source_ids").and_then(|v| v.as_array()) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Cần name (chuỗi) và source_ids (mảng chuỗi)" })),
        )
            .into_response();
    };
    let mut source_ids = Vec::with_capacity(source_arr.len());
    for item in source_arr {
        let Some(s) = item.as_str() else {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "Cần name (chuỗi) và source_ids (mảng chuỗi)" })),
            )
                .into_response();
        };
        source_ids.push(s.to_string());
    }

    let raw_name: String = sanitize_control_chars(name_str).chars().take(100).collect();
    if raw_name.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Tên danh sách phát không được để trống" })),
        )
            .into_response();
    }

    match state.db.create_mix_playlist(&raw_name, &source_ids) {
        Ok(playlist) => {
            state
                .events
                .emit("playlist_created", json!({ "playlist": playlist }));
            (StatusCode::CREATED, Json(playlist)).into_response()
        }
        Err(e) => {
            let status = if e.contains("not found") {
                StatusCode::NOT_FOUND
            } else {
                StatusCode::BAD_REQUEST
            };
            (status, Json(json!({ "error": e }))).into_response()
        }
    }
}

pub async fn update_mix_sources_handler(
    State(state): State<AppState>,
    Path(raw_id): Path<String>,
    body: Bytes,
) -> Response {
    let Ok(pl_id) = decode_uri_param(&raw_id) else {
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
    let Some(source_arr) = val.get("source_ids").and_then(|v| v.as_array()) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "source_ids phải là mảng chuỗi" })),
        )
            .into_response();
    };
    let mut source_ids = Vec::with_capacity(source_arr.len());
    for item in source_arr {
        let Some(s) = item.as_str() else {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "source_ids phải là mảng chuỗi" })),
            )
                .into_response();
        };
        source_ids.push(s.to_string());
    }

    match state.db.set_mix_sources(&pl_id, &source_ids) {
        Ok(Some(playlist)) => {
            state
                .events
                .emit("playlist_items_changed", json!({ "playlistId": pl_id }));
            Json(playlist).into_response()
        }
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Playlist không tồn tại" })),
        )
            .into_response(),
        Err(e) => {
            let status = if e.contains("not found") {
                StatusCode::NOT_FOUND
            } else {
                StatusCode::BAD_REQUEST
            };
            (status, Json(json!({ "error": e }))).into_response()
        }
    }
}

pub async fn reorder_playlist_handler(
    State(state): State<AppState>,
    Path(raw_id): Path<String>,
    body: Bytes,
) -> Response {
    let Ok(pl_id) = decode_uri_param(&raw_id) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Malformed URI component" })),
        )
            .into_response();
    };
    let Ok(Some(_)) = state.db.get_playlist(&pl_id) else {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Playlist không tồn tại" })),
        )
            .into_response();
    };

    let val: Value = match parse_json_bytes(&body, MAX_BATCH_PAYLOAD_BYTES) {
        Ok(v) => v,
        Err(resp) => return resp,
    };
    let Some(arr) = val.get("itemIds").and_then(|v| v.as_array()) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "itemIds phải là mảng string" })),
        )
            .into_response();
    };
    let mut item_ids = Vec::with_capacity(arr.len());
    for item in arr {
        let Some(s) = item.as_str() else {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "itemIds phải là mảng string" })),
            )
                .into_response();
        };
        item_ids.push(s.to_string());
    }
    if item_ids.len() > MAX_BATCH_LIMIT {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": format!("Batch size limit exceeded (max {MAX_BATCH_LIMIT})") })),
        )
            .into_response();
    }
    let unique: HashSet<&String> = item_ids.iter().collect();
    if unique.len() != item_ids.len() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "itemIds không được chứa ID trùng lặp" })),
        )
            .into_response();
    }

    match state.db.reorder_playlist_items(&pl_id, &item_ids) {
        Ok(true) => {
            state
                .events
                .emit("playlist_items_changed", json!({ "playlistId": pl_id }));
            Json(json!({ "success": true })).into_response()
        }
        Ok(false) => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Không thể cập nhật thứ tự mục hoặc danh sách ID không hợp lệ" })),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e })),
        )
            .into_response(),
    }
}

pub async fn delete_playlist_item_handler(
    State(state): State<AppState>,
    Path((raw_pl_id, raw_item_id)): Path<(String, String)>,
) -> Response {
    let (Ok(pl_id), Ok(item_id)) = (decode_uri_param(&raw_pl_id), decode_uri_param(&raw_item_id))
    else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Malformed URI component" })),
        )
            .into_response();
    };

    let child_ids = state.db.get_child_playlist_ids(&pl_id).unwrap_or_default();
    match state.db.remove_playlist_item(&pl_id, &item_id) {
        Ok(true) => {
            state
                .events
                .emit("playlist_items_changed", json!({ "playlistId": pl_id }));
            for cid in child_ids {
                state
                    .events
                    .emit("playlist_items_changed", json!({ "playlistId": cid }));
            }
            Json(json!({ "success": true })).into_response()
        }
        Ok(false) => (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Mục không tồn tại trong playlist" })),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e })),
        )
            .into_response(),
    }
}

pub async fn batch_add_playlist_items_handler(
    State(state): State<AppState>,
    Path(raw_pl_id): Path<String>,
    body: Bytes,
) -> Response {
    let Ok(pl_id) = decode_uri_param(&raw_pl_id) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Malformed URI component" })),
        )
            .into_response();
    };
    let val: Value = match parse_json_bytes(&body, MAX_BATCH_PAYLOAD_BYTES) {
        Ok(v) => v,
        Err(resp) => return resp,
    };
    let Ok(Some(pl)) = state.db.get_playlist(&pl_id) else {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Playlist không tồn tại" })),
        )
            .into_response();
    };

    let mut items_to_add = Vec::new();
    if let Some(track_ids) = val.get("trackIds").and_then(|v| v.as_array()) {
        for tid in track_ids {
            if let Some(s) = tid.as_str() {
                let trimmed = s.trim();
                if !trimmed.is_empty() {
                    items_to_add.push(BatchPlaylistItemInput {
                        track_id: trimmed.to_string(),
                        segment_id: None,
                    });
                }
            }
        }
    } else if let Some(items) = val.get("items").and_then(|v| v.as_array()) {
        for item in items {
            if let Some(tid) = item.get("track_id").and_then(|v| v.as_str()) {
                let trimmed = tid.trim();
                if !trimmed.is_empty() {
                    let seg_id = item
                        .get("segment_id")
                        .and_then(|v| v.as_str())
                        .map(|s| s.trim())
                        .filter(|s| !s.is_empty())
                        .map(|s| s.to_string());
                    items_to_add.push(BatchPlaylistItemInput {
                        track_id: trimmed.to_string(),
                        segment_id: seg_id,
                    });
                }
            }
        }
    } else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "trackIds hoặc items là bắt buộc" })),
        )
            .into_response();
    }

    if items_to_add.len() > MAX_BATCH_LIMIT {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": format!("Batch size limit exceeded (max {MAX_BATCH_LIMIT})") })),
        )
            .into_response();
    }

    match state.db.add_playlist_items_batch(&pl_id, &items_to_add) {
        Ok(added) => {
            state
                .events
                .emit("playlist_items_changed", json!({ "playlistId": pl_id }));
            if let Some(ref pid) = pl.parent_id {
                state
                    .events
                    .emit("playlist_items_changed", json!({ "playlistId": pid }));
            }
            Json(json!({ "success": true, "count": added.len(), "items": added })).into_response()
        }
        Err(e) => {
            let status = if e.contains("mix playlist") {
                StatusCode::BAD_REQUEST
            } else {
                StatusCode::INTERNAL_SERVER_ERROR
            };
            (status, Json(json!({ "error": e }))).into_response()
        }
    }
}

pub async fn batch_delete_playlist_items_handler(
    State(state): State<AppState>,
    Path(raw_pl_id): Path<String>,
    body: Bytes,
) -> Response {
    let Ok(pl_id) = decode_uri_param(&raw_pl_id) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Malformed URI component" })),
        )
            .into_response();
    };
    let Ok(Some(_)) = state.db.get_playlist(&pl_id) else {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Playlist không tồn tại" })),
        )
            .into_response();
    };

    let val: Value = match parse_json_bytes(&body, MAX_BATCH_PAYLOAD_BYTES) {
        Ok(v) => v,
        Err(resp) => return resp,
    };
    let Some(ids_arr) = val.get("itemIds").and_then(|v| v.as_array()) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "itemIds array is required" })),
        )
            .into_response();
    };

    let mut seen = HashSet::new();
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

    let child_ids = state.db.get_child_playlist_ids(&pl_id).unwrap_or_default();
    match state.db.remove_playlist_items_batch(&pl_id, &valid_ids) {
        Ok(deleted_count) => {
            state
                .events
                .emit("playlist_items_changed", json!({ "playlistId": pl_id }));
            for cid in child_ids {
                state
                    .events
                    .emit("playlist_items_changed", json!({ "playlistId": cid }));
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

pub async fn add_playlist_item_handler(
    State(state): State<AppState>,
    Path(raw_pl_id): Path<String>,
    body: Bytes,
) -> Response {
    let Ok(pl_id) = decode_uri_param(&raw_pl_id) else {
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

    let Some(track_id_str) = val.get("track_id").and_then(|v| v.as_str()) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "track_id là bắt buộc" })),
        )
            .into_response();
    };
    let clean_track_id = track_id_str.trim();
    if clean_track_id.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "track_id là bắt buộc" })),
        )
            .into_response();
    }

    let Ok(Some(pl)) = state.db.get_playlist(&pl_id) else {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Playlist không tồn tại" })),
        )
            .into_response();
    };
    let Ok(Some(_)) = state.db.get_track(clean_track_id) else {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Bài hát không tồn tại" })),
        )
            .into_response();
    };

    let mut clean_seg_id: Option<String> = None;
    if let Some(seg_val) = val.get("segment_id")
        && !seg_val.is_null()
    {
        let Some(seg_str) = seg_val.as_str() else {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "segment_id phải là chuỗi hoặc null" })),
            )
                .into_response();
        };
        let trimmed = seg_str.trim();
        if !trimmed.is_empty() {
            let Ok(Some(seg)) = state.db.get_segment(trimmed) else {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(json!({ "error": "Lát cắt không tồn tại hoặc không thuộc bài hát này" })),
                )
                    .into_response();
            };
            if seg.track_id != clean_track_id {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(json!({ "error": "Lát cắt không tồn tại hoặc không thuộc bài hát này" })),
                )
                    .into_response();
            }
            clean_seg_id = Some(trimmed.to_string());
        }
    }

    match state
        .db
        .add_playlist_item(&pl_id, clean_track_id, clean_seg_id.as_deref())
    {
        Ok(item) => {
            state
                .events
                .emit("playlist_items_changed", json!({ "playlistId": pl_id }));
            if let Some(ref pid) = pl.parent_id {
                state
                    .events
                    .emit("playlist_items_changed", json!({ "playlistId": pid }));
            }
            (StatusCode::CREATED, Json(item)).into_response()
        }
        Err(e) => {
            let status = if e.contains("not found") {
                StatusCode::NOT_FOUND
            } else {
                StatusCode::BAD_REQUEST
            };
            (status, Json(json!({ "error": e }))).into_response()
        }
    }
}

pub async fn get_playlist_detail_handler(
    State(state): State<AppState>,
    Path(raw_pl_id): Path<String>,
) -> Response {
    let Ok(pl_id) = decode_uri_param(&raw_pl_id) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Malformed URI component" })),
        )
            .into_response();
    };
    let Ok(Some(pl)) = state.db.get_playlist(&pl_id) else {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Playlist không tồn tại" })),
        )
            .into_response();
    };
    let items = match state.db.get_playlist_items(&pl_id) {
        Ok(i) => i,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": e })),
            )
                .into_response()
        }
    };
    let mut val = serde_json::to_value(&pl).unwrap_or_else(|_| json!({}));
    if let Value::Object(ref mut map) = val {
        map.insert(
            "items".to_string(),
            serde_json::to_value(items).unwrap_or_else(|_| json!([])),
        );
    }
    Json(val).into_response()
}

pub async fn patch_playlist_handler(
    State(state): State<AppState>,
    Path(raw_pl_id): Path<String>,
    body: Bytes,
) -> Response {
    let Ok(pl_id) = decode_uri_param(&raw_pl_id) else {
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

    if obj.contains_key("parent_id") {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Không được phép thay đổi playlist cha (reparenting is not permitted)" })),
        )
            .into_response();
    }

    if let Some(cover_val) = obj.get("cover_track_id") {
        let cover_id = if cover_val.is_null() {
            None
        } else if let Some(s) = cover_val.as_str() {
            Some(s)
        } else {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "cover_track_id phải là chuỗi hoặc null" })),
            )
                .into_response();
        };

        return match state.db.set_playlist_cover(&pl_id, cover_id) {
            Ok(Some(updated)) => {
                state.events.emit(
                    "playlist_updated",
                    json!({ "playlistId": updated.id, "playlist": updated }),
                );
                Json(updated).into_response()
            }
            Ok(None) => (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": "Playlist không tồn tại" })),
            )
                .into_response(),
            Err(e) => (StatusCode::BAD_REQUEST, Json(json!({ "error": e }))).into_response(),
        };
    }

    let Some(name_str) = obj.get("name").and_then(|v| v.as_str()) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Tên danh sách phát phải là chuỗi" })),
        )
            .into_response();
    };
    let raw_name: String = sanitize_control_chars(name_str).chars().take(100).collect();
    if raw_name.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Tên danh sách phát không được để trống" })),
        )
            .into_response();
    }

    match state.db.update_playlist(&pl_id, &raw_name) {
        Ok(Some(updated)) => {
            state.events.emit(
                "playlist_updated",
                json!({ "playlistId": updated.id, "playlist": updated }),
            );
            Json(updated).into_response()
        }
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Playlist không tồn tại" })),
        )
            .into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, Json(json!({ "error": e }))).into_response(),
    }
}

#[derive(Deserialize)]
pub struct DeletePlaylistQuery {
    pub keep_children: Option<String>,
}

pub async fn delete_playlist_handler(
    State(state): State<AppState>,
    Path(raw_pl_id): Path<String>,
    Query(query): Query<DeletePlaylistQuery>,
    body: Bytes,
) -> Response {
    let Ok(pl_id) = decode_uri_param(&raw_pl_id) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Malformed URI component" })),
        )
            .into_response();
    };

    let mut keep_children = query.keep_children.as_deref() == Some("true");
    if !body.is_empty()
        && let Ok(val) = serde_json::from_slice::<Value>(&body)
        && let Some(kc) = val.get("keep_children").and_then(|v| v.as_bool())
    {
        keep_children = kc;
    }

    let child_ids = state.db.get_child_playlist_ids(&pl_id).unwrap_or_default();
    match state.db.delete_playlist(&pl_id, keep_children) {
        Ok(true) => {
            state
                .events
                .emit("playlist_deleted", json!({ "playlistId": pl_id }));
            if keep_children {
                for cid in child_ids {
                    if let Ok(Some(promoted)) = state.db.get_playlist(&cid) {
                        state.events.emit(
                            "playlist_updated",
                            json!({ "playlistId": cid, "playlist": promoted }),
                        );
                    }
                }
            } else {
                for cid in child_ids {
                    state
                        .events
                        .emit("playlist_deleted", json!({ "playlistId": cid }));
                }
            }
            Json(json!({ "success": true })).into_response()
        }
        Ok(false) => (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Playlist không tồn tại" })),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e })),
        )
            .into_response(),
    }
}
