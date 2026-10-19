use serde_json::{json, Value};
use slice_engine::db::Db;
use slice_engine::events::{forward_server_events_on, EventBus, FORWARDED_EVENT_TYPES};
use slice_engine::http::etag::{if_none_match_matches, weak_etag};
use slice_engine::http::ws_and_logs::{sanitize_internal_paths, ServerLogger};
use slice_engine::http::{build_router, AppState};
use slice_engine::models::NewTrack;
use slice_engine::EngineConfig;
use std::sync::{Arc, Mutex};
use tempfile::TempDir;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

async fn spawn_test_server() -> (u16, AppState, TempDir) {
    let dir = TempDir::new().unwrap();
    let db_path = dir.path().join("test.db");
    let data_dir = dir.path().join("data");
    let dist_dir = dir.path().join("dist");
    std::fs::create_dir_all(data_dir.join("cache/audio")).unwrap();
    std::fs::create_dir_all(data_dir.join("cache/thumbs")).unwrap();
    std::fs::create_dir_all(data_dir.join("cache/thumbs-sized")).unwrap();
    std::fs::create_dir_all(&dist_dir).unwrap();
    std::fs::write(dist_dir.join("index.html"), "<html><body>Slice</body></html>").unwrap();

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let config = EngineConfig {
        db_path: db_path.clone(),
        data_dir,
        dist_dir,
        port,
        is_production: false,
        is_test: true,
    };
    let db = Db::open(&db_path, true).unwrap();
    let events = EventBus::new();
    let state = AppState::new(config, db, events);
    let router = build_router(state.clone());

    tokio::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });

    (port, state, dir)
}

async fn send_raw_http(port: u16, raw_req: &str) -> (u16, Vec<(String, String)>, String) {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
    stream.write_all(raw_req.as_bytes()).await.unwrap();
    let mut buf = Vec::new();
    stream.read_to_end(&mut buf).await.unwrap();
    let text = String::from_utf8_lossy(&buf).to_string();
    let (head, body) = text.split_once("\r\n\r\n").unwrap_or((&text, ""));
    let mut lines = head.lines();
    let status_line = lines.next().unwrap_or("");
    let status = status_line
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse::<u16>().ok())
        .unwrap_or(0);
    let mut headers = Vec::new();
    for line in lines {
        if let Some((k, v)) = line.split_once(':') {
            headers.push((k.trim().to_ascii_lowercase(), v.trim().to_string()));
        }
    }
    (status, headers, body.to_string())
}

#[test]
fn test_weak_etag_and_if_none_match() {
    let a = weak_etag(r#"[{"id":"t1"}]"#);
    let b = weak_etag(r#"[{"id":"t1"}]"#);
    assert_eq!(a, b);
    assert!(a.starts_with("W/\""));
    assert!(a.ends_with('"'));

    let c = weak_etag(r#"[{"id":"t2"}]"#);
    assert_ne!(a, c);

    let tag = weak_etag("payload");
    assert!(!if_none_match_matches(None, &tag));
    assert!(!if_none_match_matches(Some(""), &tag));
    assert!(if_none_match_matches(Some("*"), &tag));
    assert!(if_none_match_matches(Some(&tag), &tag));
    assert!(!if_none_match_matches(Some("W/\"other\""), &tag));

    let strong = tag.strip_prefix("W/").unwrap();
    assert!(if_none_match_matches(Some(strong), &tag));

    let list = format!("W/\"stale-1\", {tag} , W/\"stale-2\"");
    assert!(if_none_match_matches(Some(&list), &tag));

    let comma_header = r#"W/"a,b", W/"c""#;
    assert!(if_none_match_matches(Some(comma_header), r#"W/"c""#));
    assert!(if_none_match_matches(Some(comma_header), r#"W/"a,b""#));
    assert!(!if_none_match_matches(Some(comma_header), r#"W/"a""#));
}

#[test]
fn test_logger_sanitization_and_ring_buffer() {
    let cwd = std::env::current_dir().unwrap().to_string_lossy().to_string();
    let msg = format!(
        "Failed at {cwd}/src/server/ingest.ts and /home/alice/secret/song.mp3 and C:\\Users\\Bob\\Music\\a.mp3"
    );
    let clean = sanitize_internal_paths(&msg);
    assert!(!clean.contains(&cwd));
    assert!(!clean.contains("alice"));
    assert!(!clean.contains("Bob"));
    assert!(clean.contains("[PROJECT_DIR]"));
    assert!(clean.contains("[USER_HOME]"));

    let events = EventBus::new();
    let received = Arc::new(Mutex::new(Vec::new()));
    let r_clone = received.clone();
    events.on("app_log", move |v| {
        r_clone.lock().unwrap().push(v.clone());
    });

    let logger = ServerLogger::new(events);
    for i in 0..205 {
        logger.add_log("info", "test", &format!("log-{i}"), Some(json!({ "idx": i })));
    }
    let recent = logger.get_recent_logs(300);
    assert_eq!(recent.len(), 200);
    assert_eq!(recent[0].message, "log-204");
    assert_eq!(received.lock().unwrap().len(), 205);

    logger.clear_logs();
    assert!(logger.get_recent_logs(10).is_empty());
}

#[test]
fn test_websocket_events_forwarding() {
    let bus = EventBus::new();
    let forwarded = Arc::new(Mutex::new(Vec::<Value>::new()));
    let f_clone = forwarded.clone();
    let unsub = forward_server_events_on(&bus, move |msg| {
        f_clone.lock().unwrap().push(msg);
    });

    for &ev in &FORWARDED_EVENT_TYPES {
        bus.emit(ev, json!({ "sample": ev, "type": "spoofed_type" }));
    }

    {
        let list = forwarded.lock().unwrap();
        assert_eq!(list.len(), FORWARDED_EVENT_TYPES.len());
        for (idx, &ev) in FORWARDED_EVENT_TYPES.iter().enumerate() {
            assert_eq!(list[idx]["type"], ev);
            assert_eq!(list[idx]["sample"], ev);
        }
    }

    unsub();
    bus.emit("track_created", json!({ "after": true }));
    assert_eq!(forwarded.lock().unwrap().len(), FORWARDED_EVENT_TYPES.len());
}

#[tokio::test]
async fn test_security_headers_and_mutation_gate() {
    let (port, state, _dir) = spawn_test_server().await;

    // 1. Invalid Host header -> 403
    let (status, _, _) = send_raw_http(
        port,
        "GET /api/tracks HTTP/1.1\r\nHost: evil.com\r\nConnection: close\r\n\r\n",
    )
    .await;
    assert_eq!(status, 403);

    // 2. Invalid Origin header -> 403
    let (status, _, _) = send_raw_http(
        port,
        &format!(
            "GET /api/tracks HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nOrigin: https://evil.com\r\nConnection: close\r\n\r\n"
        ),
    )
    .await;
    assert_eq!(status, 403);

    // 3. Sec-Fetch-Site: cross-site on /api/* -> 403
    let (status, _, _) = send_raw_http(
        port,
        &format!(
            "GET /api/tracks HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nSec-Fetch-Site: cross-site\r\nConnection: close\r\n\r\n"
        ),
    )
    .await;
    assert_eq!(status, 403);

    // 4. Missing Content-Length on POST -> 411
    let (status, _, _) = send_raw_http(
        port,
        &format!(
            "POST /api/playlists HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n"
        ),
    )
    .await;
    assert_eq!(status, 411);

    // 5. Payload Too Large (> 64 KiB on JSON route) -> 413
    let (status, _, _) = send_raw_http(
        port,
        &format!(
            "POST /api/playlists HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Type: application/json\r\nContent-Length: 100000\r\nConnection: close\r\n\r\n"
        ),
    )
    .await;
    assert_eq!(status, 413);

    // 6. Mutation gate paused -> 503 with Retry-After: 5
    state.mutation_gate.pause();
    let body = r#"{"ids":["t1"]}"#;
    let (status, headers, _) = send_raw_http(
        port,
        &format!(
            "POST /api/tracks/batch-delete HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        ),
    )
    .await;
    assert_eq!(status, 503);
    assert!(headers.iter().any(|(k, v)| k == "retry-after" && v == "5"));
    state.mutation_gate.resume();
}

#[tokio::test]
async fn test_tracks_and_segments_crud_and_etags() {
    let (port, state, _dir) = spawn_test_server().await;

    state
        .db
        .create_track(&NewTrack {
            id: "t1".into(),
            source_type: "local".into(),
            source_uri: "/tmp/t1.mp3".into(),
            title: "Song 1".into(),
            artist: Some("Artist 1".into()),
            duration: 100.0,
            peaks_json: Some("[0.1,0.5]".into()),
            status: Some("ready".into()),
            volume: Some(0.8),
            ..Default::default()
        })
        .unwrap();

    // GET /api/tracks returns weak ETag and omits peaks_json
    let (status, headers, body) = send_raw_http(
        port,
        &format!("GET /api/tracks HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n"),
    )
    .await;
    assert_eq!(status, 200);
    let etag = headers
        .iter()
        .find(|(k, _)| k == "etag")
        .map(|(_, v)| v.clone())
        .expect("Missing ETag");
    let tracks_json: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(tracks_json[0]["id"], "t1");
    assert!(tracks_json[0].get("peaks_json").is_none());

    // Conditional GET /api/tracks with If-None-Match -> 304
    let (status_304, _, _) = send_raw_http(
        port,
        &format!(
            "GET /api/tracks HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nIf-None-Match: {etag}\r\nConnection: close\r\n\r\n"
        ),
    )
    .await;
    assert_eq!(status_304, 304);

    // GET /api/tracks/t1 includes peaks_json
    let (status, _, body) = send_raw_http(
        port,
        &format!(
            "GET /api/tracks/t1 HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n"
        ),
    )
    .await;
    assert_eq!(status, 200);
    let single: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(single["peaks_json"], "[0.1,0.5]");

    // PATCH /api/tracks/t1 volume update emits reason: "volume"
    let patch_body = r#"{"volume":0.55}"#;
    let (status, _, body) = send_raw_http(
        port,
        &format!(
            "PATCH /api/tracks/t1 HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{patch_body}",
            patch_body.len()
        ),
    )
    .await;
    assert_eq!(status, 200);
    let patched: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(patched["volume"], 0.55);

    // POST /api/tracks/t1/segments with end_time slightly exceeding duration by 0.3s -> clamped to 100.0
    let seg_body = r##"{"name":"Intro","start_time":10,"end_time":100.3,"color":"#ef4444"}"##;
    let (status, _, body) = send_raw_http(
        port,
        &format!(
            "POST /api/tracks/t1/segments HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{seg_body}",
            seg_body.len()
        ),
    )
    .await;
    assert_eq!(status, 201);
    let seg: Value = serde_json::from_str(&body).unwrap();
    let seg_id = seg["id"].as_str().unwrap().to_string();
    assert_eq!(seg["end_time"], 100.0);

    // PUT /api/segments/:id
    let upd_seg_body = r#"{"name":"Chorus","start_time":20,"end_time":50}"#;
    let (status, _, body) = send_raw_http(
        port,
        &format!(
            "PUT /api/segments/{seg_id} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{upd_seg_body}",
            upd_seg_body.len()
        ),
    )
    .await;
    assert_eq!(status, 200);
    let upd_seg: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(upd_seg["name"], "Chorus");
    assert_eq!(upd_seg["start_time"], 20.0);

    // DELETE /api/segments/:id
    let (status, _, _) = send_raw_http(
        port,
        &format!(
            "DELETE /api/segments/{seg_id} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n"
        ),
    )
    .await;
    assert_eq!(status, 200);

    // DELETE /api/tracks/t1
    let (status, _, _) = send_raw_http(
        port,
        &format!(
            "DELETE /api/tracks/t1 HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n"
        ),
    )
    .await;
    assert_eq!(status, 200);
    assert!(state.db.get_track("t1").unwrap().is_none());
}
