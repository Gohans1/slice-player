use slice_engine::audio_source::{resolve_audio_source, validate_safe_local_audio_path};
use slice_engine::db::Db;
use slice_engine::events::EventBus;
use slice_engine::http::{build_router, AppState};
use slice_engine::models::NewTrack;
use slice_engine::EngineConfig;
use std::path::Path;
use tempfile::TempDir;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

const AUDIO_BYTES: &[u8] = b"0123456789";

async fn spawn_test_server() -> (u16, AppState, TempDir) {
    let dir = TempDir::new().unwrap();
    let data_dir = dir.path().join("data");
    std::fs::create_dir_all(data_dir.join("cache/audio")).unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let config = EngineConfig {
        db_path: dir.path().join("test.db"),
        data_dir,
        dist_dir: dir.path().join("dist"),
        port,
        is_production: false,
        is_test: true,
    };
    let db = Db::open(&config.db_path, true).unwrap();
    let state = AppState::new(config, db, EventBus::new());
    let router = build_router(state.clone());
    tokio::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });
    (port, state, dir)
}

fn ready_track(db: &Db, id: &str, file_path: &str) {
    db.create_track(&NewTrack {
        id: id.into(),
        source_type: "local".into(),
        source_uri: file_path.into(),
        title: id.into(),
        duration: 60.0,
        file_path: Some(file_path.into()),
        status: Some("ready".into()),
        ..Default::default()
    })
    .unwrap();
}

fn write_audio(dir: &Path, name: &str) -> String {
    let path = dir.join(name);
    std::fs::write(&path, AUDIO_BYTES).unwrap();
    path.to_string_lossy().to_string()
}

/// (status, lowercase headers, body)
async fn request(port: u16, method: &str, path: &str, range: Option<&str>) -> (u16, Vec<(String, String)>, String) {
    let range_header = range.map(|r| format!("Range: {r}\r\n")).unwrap_or_default();
    let raw = format!("{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n{range_header}Connection: close\r\n\r\n");
    let mut stream = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
    stream.write_all(raw.as_bytes()).await.unwrap();
    let mut buf = Vec::new();
    stream.read_to_end(&mut buf).await.unwrap();
    let text = String::from_utf8_lossy(&buf).to_string();
    let (head, body) = text.split_once("\r\n\r\n").unwrap_or((&text, ""));
    let mut lines = head.lines();
    let status = lines.next().unwrap().split_whitespace().nth(1).unwrap().parse().unwrap();
    let headers = lines
        .filter_map(|l| l.split_once(':'))
        .map(|(k, v)| (k.trim().to_ascii_lowercase(), v.trim().to_string()))
        .collect();
    (status, headers, body.to_string())
}

fn header<'a>(headers: &'a [(String, String)], name: &str) -> Option<&'a str> {
    headers.iter().find(|(k, _)| k == name).map(|(_, v)| v.as_str())
}

#[test]
fn serves_a_cached_fallback_without_writing_the_path_into_sqlite() {
    let dir = TempDir::new().unwrap();
    let db = Db::open(dir.path().join("test.db"), true).unwrap();
    let missing = dir.path().join("old-machine").join("song.wav").to_string_lossy().to_string();
    let cache = dir.path().join("cache");
    std::fs::create_dir(&cache).unwrap();
    std::fs::write(cache.join("song.wav"), "cached audio").unwrap();
    ready_track(&db, "track", &missing);

    let resolved = resolve_audio_source(&missing, &cache).unwrap();

    assert_eq!(std::fs::read_to_string(resolved).unwrap(), "cached audio");
    assert_eq!(db.get_track("track").unwrap().unwrap().file_path.as_deref(), Some(missing.as_str()));
}

#[test]
fn reports_404_when_the_file_is_neither_at_its_path_nor_in_the_cache() {
    let dir = TempDir::new().unwrap();
    let missing = dir.path().join("gone.opus").to_string_lossy().to_string();

    assert_eq!(resolve_audio_source(&missing, dir.path()).unwrap_err().0, 404);
}

#[test]
fn rejects_unc_paths_dos_device_names_and_alternate_data_streams() {
    for unsafe_path in [
        r"\\server\share\song.mp3",
        "//server/share/song.mp3",
        r"\\?\C:\song.mp3",
        r"C:\Music\CON\song.mp3",
        r"C:\Music\nul.mp3",
        r"C:\Music\song.mp3:hidden",
        "   ",
    ] {
        assert!(validate_safe_local_audio_path(unsafe_path).is_err(), "{unsafe_path} should be rejected");
    }
    for safe_path in [r"C:\Music\song.mp3", "/home/me/Music/song.flac", "\"/home/me/My Song.opus\"", "./data/cache/audio/yt_x.webm"] {
        assert!(validate_safe_local_audio_path(safe_path).is_ok(), "{safe_path} should be accepted");
    }
}

#[tokio::test]
async fn head_reports_size_type_and_range_support_without_a_body() {
    let (port, state, dir) = spawn_test_server().await;
    ready_track(&state.db, "t_opus", &write_audio(dir.path(), "song.opus"));

    let (status, headers, body) = request(port, "HEAD", "/api/tracks/t_opus/stream", None).await;

    assert_eq!(status, 200);
    assert_eq!(header(&headers, "content-type"), Some("audio/ogg"));
    assert_eq!(header(&headers, "content-length"), Some("10"));
    assert_eq!(header(&headers, "accept-ranges"), Some("bytes"));
    assert_eq!(body, "");
}

#[tokio::test]
async fn get_without_range_streams_the_whole_file() {
    let (port, state, dir) = spawn_test_server().await;
    ready_track(&state.db, "t_m4a", &write_audio(dir.path(), "song.m4a"));

    let (status, headers, body) = request(port, "GET", "/api/tracks/t_m4a/stream", None).await;

    assert_eq!(status, 200);
    assert_eq!(header(&headers, "content-type"), Some("audio/mp4"));
    assert_eq!(body, "0123456789");
}

#[tokio::test]
async fn byte_ranges_answer_206_with_the_requested_slice() {
    let (port, state, dir) = spawn_test_server().await;
    ready_track(&state.db, "t_mp3", &write_audio(dir.path(), "song.mp3"));
    let url = "/api/tracks/t_mp3/stream";

    for (range, expected_body, expected_content_range) in [
        ("bytes=2-5", "2345", "bytes 2-5/10"),
        ("bytes=7-", "789", "bytes 7-9/10"),
        ("bytes=-3", "789", "bytes 7-9/10"),
        ("bytes=8-100", "89", "bytes 8-9/10"),
        ("bytes=0-1,4-5", "01", "bytes 0-1/10"),
    ] {
        let (status, headers, body) = request(port, "GET", url, Some(range)).await;
        assert_eq!(status, 206, "{range}");
        assert_eq!(body, expected_body, "{range}");
        assert_eq!(header(&headers, "content-range"), Some(expected_content_range), "{range}");
        assert_eq!(header(&headers, "content-length"), Some(expected_body.len().to_string().as_str()), "{range}");
        assert_eq!(header(&headers, "content-type"), Some("audio/mpeg"), "{range}");
    }
}

#[tokio::test]
async fn unsatisfiable_or_malformed_ranges_answer_416() {
    let (port, state, dir) = spawn_test_server().await;
    ready_track(&state.db, "t_flac", &write_audio(dir.path(), "song.flac"));

    for range in ["bytes=10-", "bytes=6-2", "bytes=-", "items=0-1", "bytes=-0"] {
        let (status, headers, _) = request(port, "GET", "/api/tracks/t_flac/stream", Some(range)).await;
        assert_eq!(status, 416, "{range}");
        assert_eq!(header(&headers, "content-range"), Some("bytes */10"), "{range}");
    }
}

#[tokio::test]
async fn refuses_unknown_tracks_missing_files_and_non_audio_extensions() {
    let (port, state, dir) = spawn_test_server().await;
    ready_track(&state.db, "t_gone", &dir.path().join("gone.opus").to_string_lossy());
    ready_track(&state.db, "t_text", &write_audio(dir.path(), "notes.txt"));
    ready_track(&state.db, "t_unc", r"\\server\share\song.mp3");

    assert_eq!(request(port, "GET", "/api/tracks/nope/stream", None).await.0, 404);
    assert_eq!(request(port, "GET", "/api/tracks/t_gone/stream", None).await.0, 404);
    assert_eq!(request(port, "GET", "/api/tracks/t_text/stream", None).await.0, 403);
    assert_eq!(request(port, "GET", "/api/tracks/t_unc/stream", None).await.0, 403);
}

#[tokio::test]
async fn falls_back_to_the_audio_cache_when_the_library_moved_machines() {
    let (port, state, dir) = spawn_test_server().await;
    let cached = dir.path().join("data/cache/audio/yt_moved.webm");
    std::fs::write(&cached, AUDIO_BYTES).unwrap();
    ready_track(&state.db, "yt_moved", r"C:\Users\old\slice\data\cache\audio\yt_moved.webm");

    let (status, headers, body) = request(port, "GET", "/api/tracks/yt_moved/stream", Some("bytes=0-3")).await;

    assert_eq!(status, 206);
    assert_eq!(header(&headers, "content-type"), Some("audio/webm"));
    assert_eq!(body, "0123");
}
