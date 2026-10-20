use axum::body::Body;
use axum::extract::State;
use axum::http::{HeaderMap, HeaderValue, Method, Request, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use tokio::sync::Notify;

use super::AppState;

pub const MAX_JSON_PAYLOAD_BYTES: u64 = 64 * 1024;
pub const MAX_BATCH_PAYLOAD_BYTES: u64 = 2 * 1024 * 1024;
pub const MAX_UPLOAD_REQUEST_BYTES: u64 = 305 * 1024 * 1024;
pub const MAX_BACKUP_REQUEST_BYTES: u64 = 2 * 1024 * 1024 * 1024;
pub const MAX_BATCH_LIMIT: usize = 5000;

pub const LIBRARY_RESTORING_MESSAGE: &str =
    "Thư viện đang được khôi phục, vui lòng đợi trong giây lát.";

pub fn format_error(err: impl AsRef<str>, status: StatusCode, is_production: bool) -> String {
    if status == StatusCode::INTERNAL_SERVER_ERROR && is_production {
        return "Đã xảy ra lỗi máy chủ nội bộ.".to_string();
    }
    let sanitized = super::ws_and_logs::sanitize_internal_paths(err.as_ref());
    if sanitized.is_empty() {
        "Lỗi không xác định.".to_string()
    } else {
        sanitized
    }
}

pub fn json_error(status: StatusCode, err: impl AsRef<str>, is_production: bool) -> Response {
    (
        status,
        Json(json!({ "error": format_error(err, status, is_production) })),
    )
        .into_response()
}

#[derive(Clone)]
pub struct LibraryMutationGate {
    paused: Arc<AtomicBool>,
    restoring: Arc<AtomicBool>,
    active_mutations: Arc<AtomicUsize>,
    notify: Arc<Notify>,
}

impl Default for LibraryMutationGate {
    fn default() -> Self {
        Self::new()
    }
}

impl LibraryMutationGate {
    pub fn new() -> Self {
        Self {
            paused: Arc::new(AtomicBool::new(false)),
            restoring: Arc::new(AtomicBool::new(false)),
            active_mutations: Arc::new(AtomicUsize::new(0)),
            notify: Arc::new(Notify::new()),
        }
    }

    pub fn is_paused(&self) -> bool {
        self.paused.load(Ordering::SeqCst) || self.restoring.load(Ordering::SeqCst)
    }

    pub fn set_restoring(&self, val: bool) {
        self.restoring.store(val, Ordering::SeqCst);
    }

    pub fn try_begin_restore(&self) -> Option<RestoringGuard> {
        if self.restoring.swap(true, Ordering::SeqCst) {
            return None;
        }
        Some(RestoringGuard(self.restoring.clone()))
    }

    pub fn is_restoring(&self) -> bool {
        self.restoring.load(Ordering::SeqCst)
    }

    pub fn pause(&self) {
        self.paused.store(true, Ordering::SeqCst);
    }

    pub fn resume(&self) {
        self.paused.store(false, Ordering::SeqCst);
    }

    pub fn active_count(&self) -> usize {
        self.active_mutations.load(Ordering::SeqCst)
    }

    pub async fn drain(&self) {
        loop {
            let notified = self.notify.notified();
            if self.active_mutations.load(Ordering::SeqCst) == 0 {
                return;
            }
            notified.await;
        }
    }

    pub fn enter_mutation(&self) -> MutationGuard {
        self.active_mutations.fetch_add(1, Ordering::SeqCst);
        MutationGuard {
            active_mutations: self.active_mutations.clone(),
            notify: self.notify.clone(),
        }
    }
}

pub struct MutationGuard {
    active_mutations: Arc<AtomicUsize>,
    notify: Arc<Notify>,
}

impl Drop for MutationGuard {
    fn drop(&mut self) {
        if self.active_mutations.fetch_sub(1, Ordering::SeqCst) == 1 {
            self.notify.notify_waiters();
        }
    }
}

pub struct RestoringGuard(Arc<AtomicBool>);

impl Drop for RestoringGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

pub fn is_mutating_library_request(method: &Method, pathname: &str) -> bool {
    if !pathname.starts_with("/api/") {
        return false;
    }
    if pathname == "/api/library/import" {
        return false;
    }
    matches!(
        *method,
        Method::POST | Method::PUT | Method::PATCH | Method::DELETE
    )
}

pub fn parse_host_header(raw_host: &str) -> (String, String) {
    let h = raw_host.trim().to_ascii_lowercase();
    if h.starts_with('[')
        && let Some(bracket_end) = h.find(']')
    {
        let host = h[..=bracket_end].to_string();
        let rest = &h[bracket_end + 1..];
        let port = rest.strip_prefix(':').unwrap_or("").to_string();
        return (host, port);
    }
    if h == "::1" {
        return ("::1".to_string(), String::new());
    }
    let mut parts = h.split(':');
    let host = parts.next().unwrap_or("").to_string();
    let port = parts.next().unwrap_or("").to_string();
    (host, port)
}

pub fn is_allowed_host(raw_host: &str, server_port: u16, is_production: bool) -> bool {
    if raw_host.is_empty() {
        return false;
    }
    let (host, port) = parse_host_header(raw_host);
    let valid_host = matches!(host.as_str(), "localhost" | "127.0.0.1" | "[::1]" | "::1");
    if !valid_host {
        return false;
    }
    if port == server_port.to_string() {
        return true;
    }
    if port.is_empty() && (server_port == 80 || server_port == 443) {
        return true;
    }
    if !is_production && port == "5173" {
        return true;
    }
    false
}

pub fn is_allowed_origin(origin: &str, server_port: u16, is_production: bool) -> bool {
    let p = server_port;
    if origin == format!("http://localhost:{p}")
        || origin == format!("http://127.0.0.1:{p}")
        || origin == format!("http://[::1]:{p}")
        || origin == "tauri://localhost"
        || origin == "http://tauri.localhost"
        || origin == "https://tauri.localhost"
    {
        return true;
    }
    if !is_production
        && (origin == "http://localhost:5173"
            || origin == "http://127.0.0.1:5173"
            || origin == "http://[::1]:5173")
    {
        return true;
    }
    false
}

fn is_batch_route(pathname: &str) -> bool {
    if pathname == "/api/tracks/batch-delete" || pathname == "/api/segments/batch-delete" {
        return true;
    }
    if let Some(rest) = pathname.strip_prefix("/api/playlists/")
        && let Some((_, suffix)) = rest.split_once('/')
    {
        return matches!(suffix, "items/batch" | "items/batch-delete" | "reorder");
    }
    false
}

fn is_optional_body_route(pathname: &str) -> bool {
    if pathname == "/api/tracks/retry-all" {
        return true;
    }
    if let Some(rest) = pathname.strip_prefix("/api/tracks/")
        && let Some((id, suffix)) = rest.split_once('/')
    {
        return !id.is_empty() && !id.contains('/') && suffix == "retry";
    }
    false
}

pub fn apply_cors_and_security_headers(
    headers: &mut HeaderMap,
    allowed_origin: &str,
    server_port: u16,
    is_production: bool,
) {
    let dev_ws = if !is_production {
        " ws://localhost:5173 ws://127.0.0.1:5173 ws://[::1]:5173 http://localhost:5173 http://127.0.0.1:5173 http://[::1]:5173"
    } else {
        ""
    };
    let csp = format!(
        "default-src 'self'; script-src 'self' blob:; worker-src blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https:; media-src 'self' blob: data:; connect-src 'self' ws://127.0.0.1:{server_port} ws://localhost:{server_port} ws://[::1]:{server_port} ws://127.0.0.1:*{dev_ws}; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
    );

    if let Ok(v) = HeaderValue::from_str(allowed_origin) {
        headers.insert("Access-Control-Allow-Origin", v);
    }
    headers.insert(
        "Access-Control-Allow-Methods",
        HeaderValue::from_static("GET, POST, PUT, PATCH, DELETE, OPTIONS"),
    );
    headers.insert(
        "Access-Control-Allow-Headers",
        HeaderValue::from_static("Content-Type, Authorization, If-None-Match, Range"),
    );
    headers.insert(
        "Access-Control-Expose-Headers",
        HeaderValue::from_static("Content-Range, Content-Length, Accept-Ranges, ETag"),
    );
    headers.insert("Vary", HeaderValue::from_static("Origin"));
    headers.insert("X-Content-Type-Options", HeaderValue::from_static("nosniff"));
    headers.insert("X-Frame-Options", HeaderValue::from_static("DENY"));
    headers.insert(
        "Referrer-Policy",
        HeaderValue::from_static("strict-origin-when-cross-origin"),
    );
    headers.insert(
        "Permissions-Policy",
        HeaderValue::from_static("camera=(), microphone=(), geolocation=()"),
    );
    if let Ok(v) = HeaderValue::from_str(&csp) {
        headers.insert("Content-Security-Policy", v);
    }
}

pub async fn security_middleware(
    State(state): State<AppState>,
    req: Request<Body>,
    next: Next,
) -> Response {
    let method = req.method().clone();
    let pathname = req.uri().path().to_string();
    let port = state.config.port;
    let is_prod = state.config.is_production;

    let raw_host = req
        .headers()
        .get("host")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if !is_allowed_host(raw_host, port, is_prod) {
        return (StatusCode::FORBIDDEN, "Forbidden: Invalid Host header").into_response();
    }

    let sec_fetch_site = req
        .headers()
        .get("sec-fetch-site")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if sec_fetch_site == "cross-site" {
        let sec_fetch_mode = req
            .headers()
            .get("sec-fetch-mode")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        let sec_fetch_dest = req
            .headers()
            .get("sec-fetch-dest")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        let is_top_level_nav = !pathname.starts_with("/api/")
            && pathname != "/ws"
            && method == Method::GET
            && (sec_fetch_mode == "navigate" || sec_fetch_dest == "document");
        if !is_top_level_nav {
            return (StatusCode::FORBIDDEN, "Forbidden: Cross-site request blocked")
                .into_response();
        }
    }

    let origin_hdr = req
        .headers()
        .get("origin")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    if let Some(ref orig) = origin_hdr
        && !is_allowed_origin(orig, port, is_prod)
    {
        return (StatusCode::FORBIDDEN, "Forbidden: Invalid Origin").into_response();
    }

    let allowed_origin = origin_hdr.unwrap_or_else(|| format!("http://127.0.0.1:{port}"));

    if method == Method::OPTIONS {
        let mut resp = StatusCode::NO_CONTENT.into_response();
        apply_cors_and_security_headers(resp.headers_mut(), &allowed_origin, port, is_prod);
        return resp;
    }

    // Gate all non-/api/library requests (including GET/HEAD) while library restore is in progress
    if state.mutation_gate.is_restoring() && !pathname.starts_with("/api/library") {
        let mut resp = (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({ "error": LIBRARY_RESTORING_MESSAGE })),
        )
            .into_response();
        apply_cors_and_security_headers(resp.headers_mut(), &allowed_origin, port, is_prod);
        resp.headers_mut()
            .insert("Retry-After", HeaderValue::from_static("5"));
        return resp;
    }

    // Mutation gate check before running handler
    let mut _mutation_guard = None;
    if is_mutating_library_request(&method, &pathname) {
        if state.mutation_gate.is_paused() {
            let mut resp = (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({ "error": LIBRARY_RESTORING_MESSAGE })),
            )
                .into_response();
            apply_cors_and_security_headers(resp.headers_mut(), &allowed_origin, port, is_prod);
            resp.headers_mut()
                .insert("Retry-After", HeaderValue::from_static("5"));
            return resp;
        }
        _mutation_guard = Some(state.mutation_gate.enter_mutation());
    }

    if pathname.starts_with("/api/")
        && matches!(
            method,
            Method::POST | Method::PUT | Method::PATCH | Method::DELETE
        )
    {
        let te = req
            .headers()
            .get("transfer-encoding")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_ascii_lowercase();
        if !te.is_empty() && te != "identity" {
            let mut resp = (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "Chunked transfer encoding is not supported" })),
            )
                .into_response();
            apply_cors_and_security_headers(resp.headers_mut(), &allowed_origin, port, is_prod);
            return resp;
        }

        let max_limit = if pathname == "/api/library/import" {
            MAX_BACKUP_REQUEST_BYTES
        } else if pathname == "/api/tracks/upload" {
            MAX_UPLOAD_REQUEST_BYTES
        } else if is_batch_route(&pathname) {
            MAX_BATCH_PAYLOAD_BYTES
        } else {
            MAX_JSON_PAYLOAD_BYTES
        };

        let raw_len = req
            .headers()
            .get("content-length")
            .and_then(|v| v.to_str().ok());

        let is_optional_body = is_optional_body_route(&pathname);
        if matches!(method, Method::POST | Method::PUT | Method::PATCH)
            && raw_len.is_none()
            && !is_optional_body
        {
            let mut resp = (
                StatusCode::LENGTH_REQUIRED,
                Json(json!({ "error": "Length Required: Content-Length header is mandatory" })),
            )
                .into_response();
            apply_cors_and_security_headers(resp.headers_mut(), &allowed_origin, port, is_prod);
            return resp;
        }

        if let Some(len_str) = raw_len {
            let Ok(len) = len_str.trim().parse::<u64>() else {
                let mut resp = (
                    StatusCode::BAD_REQUEST,
                    Json(json!({ "error": "Invalid Content-Length header" })),
                )
                    .into_response();
                apply_cors_and_security_headers(resp.headers_mut(), &allowed_origin, port, is_prod);
                return resp;
            };
            if matches!(method, Method::POST | Method::PUT | Method::PATCH)
                && len == 0
                && !is_optional_body
            {
                let mut resp = (
                    StatusCode::BAD_REQUEST,
                    Json(json!({ "error": "Empty or invalid request body" })),
                )
                    .into_response();
                apply_cors_and_security_headers(resp.headers_mut(), &allowed_origin, port, is_prod);
                return resp;
            }
            if len > max_limit {
                let mut resp = (
                    StatusCode::PAYLOAD_TOO_LARGE,
                    Json(json!({ "error": "Payload Too Large" })),
                )
                    .into_response();
                apply_cors_and_security_headers(resp.headers_mut(), &allowed_origin, port, is_prod);
                return resp;
            }
        }
    }

    let mut resp = next.run(req).await;
    apply_cors_and_security_headers(resp.headers_mut(), &allowed_origin, port, is_prod);
    resp
}
