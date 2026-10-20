use crate::events::EventBus;
use crate::models::LogEntry;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use super::AppState;

pub const MAX_SERVER_LOGS: usize = 200;

pub fn sanitize_internal_paths(msg: &str) -> String {
    if msg.is_empty() {
        return String::new();
    }
    let mut out = msg.to_string();
    if let Ok(cwd) = std::env::current_dir() {
        let cwd_str = cwd.to_string_lossy().to_string();
        if !cwd_str.is_empty() {
            out = replace_case_insensitive(&out, &cwd_str, "[PROJECT_DIR]");
            let slash_cwd = cwd_str.replace('\\', "/");
            if slash_cwd != cwd_str {
                out = replace_case_insensitive(&out, &slash_cwd, "[PROJECT_DIR]");
            }
            let backslash_cwd = cwd_str.replace('/', "\\");
            if backslash_cwd != cwd_str {
                out = replace_case_insensitive(&out, &backslash_cwd, "[PROJECT_DIR]");
            }
        }
    }
    out = redact_unix_home(&out, "/Users/");
    out = redact_unix_home(&out, "/home/");
    out = redact_windows_home(&out);
    out
}

fn replace_case_insensitive(haystack: &str, needle: &str, replacement: &str) -> String {
    if needle.is_empty() {
        return haystack.to_string();
    }
    let lower_h = haystack.to_lowercase();
    let lower_n = needle.to_lowercase();
    if lower_h.len() != haystack.len() || lower_n.len() != needle.len() {
        return haystack.replace(needle, replacement);
    }
    let mut result = String::with_capacity(haystack.len());
    let mut last_end = 0usize;
    while let Some(pos) = lower_h[last_end..].find(&lower_n) {
        let abs_pos = last_end + pos;
        result.push_str(&haystack[last_end..abs_pos]);
        result.push_str(replacement);
        last_end = abs_pos + needle.len();
    }
    result.push_str(&haystack[last_end..]);
    result
}

fn is_username_boundary(ch: char) -> bool {
    ch == '/'
        || ch == '\\'
        || ch.is_whitespace()
        || matches!(ch, '"' | '\'' | ':' | ';' | ',' | ')' | ']' | '}')
}

fn redact_unix_home(input: &str, prefix: &str) -> String {
    let mut result = String::with_capacity(input.len());
    let mut idx = 0usize;
    while let Some(pos) = input[idx..].find(prefix) {
        let abs = idx + pos;
        result.push_str(&input[idx..abs]);
        let after_prefix = abs + prefix.len();
        let rest = &input[after_prefix..];
        let mut user_len = 0usize;
        for ch in rest.chars() {
            if is_username_boundary(ch) {
                break;
            }
            user_len += ch.len_utf8();
        }
        if user_len > 0 {
            if rest[user_len..].starts_with('/') {
                result.push_str("[USER_HOME]/");
                idx = after_prefix + user_len + 1;
            } else {
                result.push_str("[USER_HOME]");
                idx = after_prefix + user_len;
            }
        } else {
            result.push_str(prefix);
            idx = after_prefix;
        }
    }
    result.push_str(&input[idx..]);
    result
}

fn redact_windows_home(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut result = String::with_capacity(input.len());
    let mut i = 0usize;
    while i < bytes.len() {
        if i + 8 < bytes.len()
            && bytes[i].is_ascii_alphabetic()
            && bytes[i + 1] == b':'
            && bytes[i + 2] == b'\\'
            && input[i + 3..].len() >= 6
            && input[i + 3..i + 9].eq_ignore_ascii_case("Users\\")
        {
            let after_prefix = i + 9;
            let rest = &input[after_prefix..];
            let mut user_len = 0usize;
            for ch in rest.chars() {
                if is_username_boundary(ch) {
                    break;
                }
                user_len += ch.len_utf8();
            }
            if user_len > 0 {
                if rest[user_len..].starts_with('\\') {
                    result.push_str("[USER_HOME]\\");
                    i = after_prefix + user_len + 1;
                } else {
                    result.push_str("[USER_HOME]");
                    i = after_prefix + user_len;
                }
                continue;
            }
        }
        let ch = input[i..].chars().next().unwrap();
        result.push(ch);
        i += ch.len_utf8();
    }
    result
}

fn truncate_chars(s: String, max_chars: usize) -> String {
    if s.chars().count() > max_chars {
        let head: String = s.chars().take(max_chars).collect();
        format!("{head}... [truncated]")
    } else {
        s
    }
}

fn sanitize_details(value: &Value, depth: usize) -> Value {
    if depth > 4 {
        return Value::String("[Truncated]".to_string());
    }
    match value {
        Value::String(s) => Value::String(truncate_chars(sanitize_internal_paths(s), 5000)),
        Value::Array(arr) => Value::Array(
            arr.iter()
                .take(20)
                .map(|v| sanitize_details(v, depth + 1))
                .collect(),
        ),
        Value::Object(map) => {
            let mut out = serde_json::Map::new();
            for (k, v) in map.iter().take(30) {
                out.insert(k.clone(), sanitize_details(v, depth + 1));
            }
            Value::Object(out)
        }
        other => other.clone(),
    }
}

#[derive(Clone)]
pub struct ServerLogger {
    logs: Arc<Mutex<VecDeque<LogEntry>>>,
    counter: Arc<std::sync::atomic::AtomicU64>,
    events: EventBus,
}

impl Default for ServerLogger {
    fn default() -> Self {
        Self::new(EventBus::new())
    }
}

impl ServerLogger {
    pub fn new(events: EventBus) -> Self {
        Self {
            logs: Arc::new(Mutex::new(VecDeque::with_capacity(MAX_SERVER_LOGS))),
            counter: Arc::new(std::sync::atomic::AtomicU64::new(0)),
            events,
        }
    }

    pub fn add_log(
        &self,
        level: &str,
        category: &str,
        message: &str,
        details: Option<Value>,
    ) {
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;
        let seq = self.counter.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
        let safe_message = truncate_chars(sanitize_internal_paths(message), 2000);
        let entry = LogEntry {
            id: format!("srv_{now_ms}_{seq:08}"),
            timestamp: now_ms,
            level: level.to_string(),
            category: category.to_string(),
            message: safe_message,
            details: details.as_ref().map(|d| sanitize_details(d, 0)),
        };

        {
            let mut guard = self.logs.lock().unwrap();
            guard.push_back(entry.clone());
            while guard.len() > MAX_SERVER_LOGS {
                guard.pop_front();
            }
        }

        if let Ok(val) = serde_json::to_value(&entry) {
            self.events.emit("app_log", val);
        }
    }

    pub fn get_recent_logs(&self, limit: usize) -> Vec<LogEntry> {
        let safe_limit = limit.clamp(1, MAX_SERVER_LOGS);
        let guard = self.logs.lock().unwrap();
        let skip = guard.len().saturating_sub(safe_limit);
        guard.iter().skip(skip).cloned().collect()
    }

    pub fn clear_logs(&self) {
        let mut guard = self.logs.lock().unwrap();
        guard.clear();
    }
}

#[derive(Deserialize)]
pub struct LogsQuery {
    pub limit: Option<String>,
}

pub async fn get_logs_handler(
    State(state): State<AppState>,
    Query(query): Query<LogsQuery>,
) -> Response {
    let limit = match query.limit.as_deref() {
        None | Some("") => 100,
        Some(raw) => match raw.parse::<f64>() {
            Ok(n) if n.is_finite() => {
                if n <= 1.0 {
                    1
                } else if n >= MAX_SERVER_LOGS as f64 {
                    MAX_SERVER_LOGS
                } else {
                    n as usize
                }
            }
            _ => 100,
        },
    };
    Json(state.logger.get_recent_logs(limit)).into_response()
}

pub async fn delete_logs_handler(State(state): State<AppState>) -> Response {
    state.logger.clear_logs();
    state.events.emit("logs_cleared", json!({}));
    Json(json!({ "success": true })).into_response()
}

pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
) -> Result<Response, StatusCode> {
    Ok(ws
        .max_message_size(64 * 1024)
        .max_frame_size(64 * 1024)
        .on_upgrade(move |socket| handle_ws_socket(socket, state)))
}

async fn handle_ws_socket(mut socket: WebSocket, state: AppState) {
    if let Some(ref tracker) = state.ws_lifecycle {
        tracker.on_ws_open();
    }
    let _ = socket
        .send(Message::Text(r#"{"type":"connected"}"#.into()))
        .await;

    let (tx, mut rx) = tokio::sync::mpsc::channel::<String>(256);
    let unsub = crate::events::forward_server_events_on(&state.events, move |msg| {
        if let Ok(s) = serde_json::to_string(&msg) {
            let _ = tx.try_send(s);
        }
    });

    loop {
        tokio::select! {
            Some(outbound) = rx.recv() => {
                if socket.send(Message::Text(outbound.into())).await.is_err() {
                    break;
                }
            }
            inbound = socket.recv() => {
                match inbound {
                    Some(Ok(Message::Text(text))) => {
                        if text.as_str() == "ping" {
                            let _ = socket.send(Message::Text("pong".into())).await;
                        }
                    }
                    Some(Ok(Message::Ping(payload))) => {
                        let _ = socket.send(Message::Pong(payload)).await;
                    }
                    Some(Ok(Message::Close(_))) | None | Some(Err(_)) => {
                        break;
                    }
                    _ => {}
                }
            }
        }
    }

    unsub();
    if let Some(ref tracker) = state.ws_lifecycle {
        tracker.on_ws_close();
    }
}
