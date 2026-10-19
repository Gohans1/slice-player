//! `GET`/`HEAD /api/tracks/:id/stream` with byte ranges, as `index.ts` served it to `<audio>`

use super::{decode_uri_param, AppState};
use crate::audio_source::{audio_mime_type, dotted_extension, resolve_audio_source, SUPPORTED_AUDIO_EXTENSIONS};
use axum::body::Body;
use axum::extract::{Path, State};
use axum::http::{header, HeaderMap, HeaderValue, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tokio_util::io::ReaderStream;

fn text(status: StatusCode, message: &'static str) -> Response {
    (status, message).into_response()
}

fn range_not_satisfiable(size: u64) -> Response {
    let mut resp = text(StatusCode::RANGE_NOT_SATISFIABLE, "Range Not Satisfiable");
    let headers = resp.headers_mut();
    if let Ok(v) = HeaderValue::from_str(&format!("bytes */{size}")) {
        headers.insert(header::CONTENT_RANGE, v);
    }
    headers.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    resp
}

/// First `bytes=start-end` of a Range header (index.ts' unanchored `/bytes=(\d*)-(\d*)/`), as an
/// inclusive range clamped to the file, or `None` when it can't be satisfied
fn parse_range(raw: &str, size: u64) -> Option<(u64, u64)> {
    let spec = &raw[raw.find("bytes=")? + "bytes=".len()..];
    let digits = |s: &str| s.chars().take_while(char::is_ascii_digit).collect::<String>();
    let start_str = digits(spec);
    let after_start = &spec[start_str.len()..];
    let end_str = digits(after_start.strip_prefix('-')?);
    let parse = |s: &str| if s.is_empty() { None } else { s.parse::<u64>().ok() };
    let (start, end) = match (parse(&start_str), parse(&end_str)) {
        (None, None) => return None,
        // Suffix range: the last N bytes
        (None, Some(n)) => (size.saturating_sub(n), size.checked_sub(1)?),
        (Some(start), None) => (start, size.checked_sub(1)?),
        (Some(start), Some(end)) => (start, end),
    };
    if start >= size || start > end {
        return None;
    }
    Some((start, end.min(size - 1)))
}

pub async fn stream_track_handler(
    State(state): State<AppState>,
    Path(raw_id): Path<String>,
    method: Method,
    headers: HeaderMap,
) -> Response {
    let Ok(track_id) = decode_uri_param(&raw_id) else {
        return text(StatusCode::BAD_REQUEST, "Malformed URI component");
    };
    let file_path = match state.db.get_track(&track_id) {
        Ok(Some(track)) => track.file_path,
        Ok(None) => None,
        Err(_) => return text(StatusCode::INTERNAL_SERVER_ERROR, "Internal Server Error"),
    };
    let Some(file_path) = file_path else {
        return text(StatusCode::NOT_FOUND, "Audio file not available or not downloaded yet");
    };
    let cache_dir = state.config.data_dir.join("cache").join("audio");
    let path = match resolve_audio_source(&file_path, &cache_dir) {
        Ok(path) => path,
        Err((status, message)) => {
            return text(StatusCode::from_u16(status).unwrap_or(StatusCode::NOT_FOUND), message);
        }
    };
    let ext = dotted_extension(&path);
    if !SUPPORTED_AUDIO_EXTENSIONS.contains(&ext.as_str()) {
        return text(StatusCode::FORBIDDEN, "Unsupported or forbidden audio file format");
    }

    let Ok(mut file) = tokio::fs::File::open(&path).await else {
        return text(StatusCode::NOT_FOUND, "Audio file missing on disk");
    };
    let Ok(size) = file.metadata().await.map(|m| m.len()) else {
        return text(StatusCode::NOT_FOUND, "Audio file missing on disk");
    };

    let range = if method == Method::HEAD {
        None
    } else {
        match headers.get(header::RANGE).map(|v| v.to_str().unwrap_or_default()) {
            None => None,
            Some(raw) => match parse_range(raw, size) {
                Some(range) => Some(range),
                None => return range_not_satisfiable(size),
            },
        }
    };

    let (status, start, len) = match range {
        Some((start, end)) => (StatusCode::PARTIAL_CONTENT, start, end - start + 1),
        None => (StatusCode::OK, 0, size),
    };
    let body = if method == Method::HEAD {
        Body::empty()
    } else {
        if start > 0 && file.seek(std::io::SeekFrom::Start(start)).await.is_err() {
            return text(StatusCode::INTERNAL_SERVER_ERROR, "Internal Server Error");
        }
        Body::from_stream(ReaderStream::new(file.take(len)))
    };

    let mut resp = Response::new(body);
    *resp.status_mut() = status;
    let h = resp.headers_mut();
    h.insert(header::CONTENT_TYPE, HeaderValue::from_static(audio_mime_type(&ext)));
    h.insert(header::CONTENT_LENGTH, HeaderValue::from(len));
    h.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    if let Some((start, end)) = range
        && let Ok(v) = HeaderValue::from_str(&format!("bytes {start}-{end}/{size}"))
    {
        h.insert(header::CONTENT_RANGE, v);
    }
    resp
}
