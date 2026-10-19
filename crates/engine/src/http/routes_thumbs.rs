//! `GET`/`HEAD /api/thumbs/:id(.ext)?size=small|large` (`index.ts`)

use super::AppState;
use crate::thumbnails::{resized_thumbnail, thumbnail_width, THUMBNAIL_EXTENSIONS};
use axum::body::Body;
use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderMap, HeaderValue, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use std::collections::HashMap;

/// `[A-Za-z0-9_-]+` with an optional `.ext` the client appends for caching; the extension is ignored
fn thumb_id(raw: &str) -> Option<&str> {
    let (id, ext) = raw.split_once('.').unwrap_or((raw, "a"));
    let id_ok = !id.is_empty() && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-');
    let ext_ok = !ext.is_empty() && ext.bytes().all(|b| b.is_ascii_alphanumeric());
    (id_ok && ext_ok).then_some(id)
}

fn not_found() -> Response {
    (StatusCode::NOT_FOUND, "Thumbnail not found").into_response()
}

pub async fn thumb_handler(
    State(state): State<AppState>,
    Path(raw): Path<String>,
    Query(query): Query<HashMap<String, String>>,
    method: Method,
    headers: HeaderMap,
) -> Response {
    let Some(id) = thumb_id(&raw) else {
        return not_found();
    };
    let thumbs_dir = state.config.data_dir.join("cache").join("thumbs");
    let Some((ext, original)) = THUMBNAIL_EXTENSIONS
        .iter()
        .map(|ext| (*ext, thumbs_dir.join(format!("{id}{ext}"))))
        .find(|(_, path)| path.is_file())
    else {
        return not_found();
    };

    // A slot size gets a scaled copy; without one, or when scaling fails, the original
    let variants_dir = state.config.data_dir.join("cache").join("thumbs-sized");
    let resized = match query.get("size").and_then(|s| thumbnail_width(s)) {
        Some(width) => resized_thumbnail(&original, width, &variants_dir).await,
        None => None,
    };
    let content_type = match (&resized, ext) {
        (Some(_), _) | (None, ".jpg") => "image/jpeg",
        (None, ".png") => "image/png",
        _ => "image/webp",
    };
    let served = resized.unwrap_or(original);

    let Ok(meta) = std::fs::metadata(&served) else {
        return not_found();
    };
    let mtime_ms = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let etag = format!("\"{:x}-{mtime_ms:x}\"", meta.len());

    let not_modified = headers.get(header::IF_NONE_MATCH).and_then(|v| v.to_str().ok()) == Some(etag.as_str());
    let body = if not_modified || method == Method::HEAD {
        Body::empty()
    } else {
        match tokio::fs::read(&served).await {
            Ok(bytes) => Body::from(bytes),
            Err(_) => return not_found(),
        }
    };

    let mut resp = Response::new(body);
    if not_modified {
        *resp.status_mut() = StatusCode::NOT_MODIFIED;
    }
    let h = resp.headers_mut();
    h.insert(header::CONTENT_TYPE, HeaderValue::from_static(content_type));
    h.insert(header::CONTENT_LENGTH, HeaderValue::from(meta.len()));
    h.insert(header::CACHE_CONTROL, HeaderValue::from_static("public, max-age=86400"));
    if let Ok(v) = HeaderValue::from_str(&etag) {
        h.insert(header::ETAG, v);
    }
    resp
}
