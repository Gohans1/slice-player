//! `GET /api/library/export` and `POST /api/library/import` (`index.ts`)

use super::ws_and_logs::sanitize_internal_paths;
use super::AppState;
use crate::backup::export::{export_library_archive, iso_now};
use crate::backup::import::import_library_archive;
use crate::backup::LIBRARY_BUSY_MESSAGE;
use axum::body::Body;
use axum::extract::{FromRequest, Multipart, Request, State};
use axum::http::{header, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use futures_util::{Stream, StreamExt};
use serde_json::json;
use tokio::io::AsyncWriteExt;

fn error(status: StatusCode, message: impl Into<String>) -> Response {
    (status, Json(json!({ "error": message.into() }))).into_response()
}

pub async fn export_handler(State(state): State<AppState>) -> Response {
    if state.exporting.load(std::sync::atomic::Ordering::SeqCst) {
        return error(StatusCode::TOO_MANY_REQUESTS, "Thao tác xuất thư viện đang được xử lý, vui lòng thử lại sau giây lát.");
    }
    match export_library_archive(&state, false).await {
        Ok(stream) => {
            // `2026-10-19T17-30-04`, as index.ts named it
            let timestamp: String = iso_now().replace([':', '.'], "-").chars().take(19).collect();
            let mut resp = Response::new(Body::from_stream(stream));
            let h = resp.headers_mut();
            h.insert(header::CONTENT_TYPE, HeaderValue::from_static("application/gzip"));
            if let Ok(v) = HeaderValue::from_str(&format!("attachment; filename=\"slice-player-backup-{timestamp}.tar.gz\"")) {
                h.insert(header::CONTENT_DISPOSITION, v);
            }
            resp
        }
        Err(message) => {
            let status = if message == LIBRARY_BUSY_MESSAGE { StatusCode::TOO_MANY_REQUESTS } else { StatusCode::INTERNAL_SERVER_ERROR };
            error(status, format!("Lỗi xuất dữ liệu thư viện: {message}"))
        }
    }
}

/// Writes a byte stream to a temp file, enforcing `MAX_BACKUP_REQUEST_BYTES` as chunks arrive so a
/// 2 GB archive never sits in memory and an unannounced >2 GB stream is aborted immediately.
async fn spool<S, E>(dir: &std::path::Path, mut stream: S) -> Result<tempfile::TempPath, (StatusCode, String)>
where
    S: Stream<Item = Result<axum::body::Bytes, E>> + Unpin,
    E: std::fmt::Display,
{
    std::fs::create_dir_all(dir).map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
    let temp = tempfile::Builder::new()
        .prefix(".slice-import-")
        .tempfile_in(dir)
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?
        .into_temp_path();
    let mut file = tokio::fs::File::create(&temp)
        .await
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
    let mut written: u64 = 0;
    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
        written = written.saturating_add(bytes.len() as u64);
        if written > crate::backup::MAX_BACKUP_REQUEST_BYTES {
            return Err((
                StatusCode::PAYLOAD_TOO_LARGE,
                "Backup exceeds the 2GB restore upload limit.".into(),
            ));
        }
        file.write_all(&bytes)
            .await
            .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
    }
    file.flush()
        .await
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
    Ok(temp)
}

pub async fn import_handler(State(state): State<AppState>, req: Request) -> Response {
    let is_multipart = req
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|ct| ct.contains("multipart/form-data"));
    let spool_dir = state.config.data_dir.clone();
    let spooled = if is_multipart {
        let mut multipart = match Multipart::from_request(req, &()).await {
            Ok(m) => m,
            Err(e) => return error(StatusCode::BAD_REQUEST, e.body_text()),
        };
        let mut found = None;
        loop {
            match multipart.next_field().await {
                Ok(Some(field)) if matches!(field.name(), Some("file" | "backup")) && field.file_name().is_some() => {
                    found = Some(spool(&spool_dir, field).await);
                    break;
                }
                Ok(Some(_)) => continue,
                Ok(None) => break,
                Err(e) => return error(StatusCode::BAD_REQUEST, e.body_text()),
            }
        }
        found
    } else {
        Some(spool(&spool_dir, req.into_body().into_data_stream()).await)
    };
    let archive = match spooled {
        Some(Ok(path)) => path,
        Some(Err((status, e))) => return error(status, sanitize_internal_paths(&e)),
        None => return error(StatusCode::BAD_REQUEST, "File backup không hợp lệ hoặc bị rỗng"),
    };
    if std::fs::metadata(&archive).map(|m| m.len()).unwrap_or(0) < 50 {
        return error(StatusCode::BAD_REQUEST, "File backup không hợp lệ hoặc bị rỗng");
    }
    match import_library_archive(&state, &archive).await {
        Ok(result) => Json(result).into_response(),
        Err(message) => error(StatusCode::BAD_REQUEST, sanitize_internal_paths(&message)),
    }
}
