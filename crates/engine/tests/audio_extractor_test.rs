use futures_util::stream;
use slice_engine::audio_source::SUPPORTED_AUDIO_EXTENSIONS;
use slice_engine::db::Db;
use slice_engine::events::EventBus;
use slice_engine::http::ws_and_logs::ServerLogger;
use slice_engine::http::{build_router, AppState};
use slice_engine::ingest::video_extractor::extract_audio_from_video;
use slice_engine::ingest::Ingest;
use slice_engine::EngineConfig;
use bytes::Bytes;
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::process::Command;
use tempfile::TempDir;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

fn ffmpeg(args: &[&str]) {
    let status = Command::new("ffmpeg").args(["-v", "error", "-y"]).args(args).status().unwrap();
    assert!(status.success(), "ffmpeg {args:?}");
}

fn mp4_with_audio(path: &Path) -> PathBuf {
    ffmpeg(&[
        "-f", "lavfi", "-i", "color=c=blue:s=64x64:d=2", "-f", "lavfi", "-i", "sine=f=330:d=2",
        "-shortest", "-c:v", "libx264", "-c:a", "aac", path.to_str().unwrap(),
    ]);
    path.to_path_buf()
}

fn stream_types(path: &Path, selector: &str) -> String {
    let out = Command::new("ffprobe")
        .args(["-v", "error", "-select_streams", selector, "-show_entries", "stream=codec_type", "-of", "default=noprint_wrappers=1:nokey=1"])
        .arg(path)
        .output()
        .unwrap();
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

#[test]
fn mp4_is_a_supported_extension() {
    assert!(SUPPORTED_AUDIO_EXTENSIONS.contains(&".mp4"));
}

#[tokio::test]
async fn extracts_the_audio_of_an_mp4_without_its_video() {
    let dir = TempDir::new().unwrap();
    let video = mp4_with_audio(&dir.path().join("clip.mp4"));
    let out = dir.path().join("extracted.m4a");

    extract_audio_from_video(&video, &out).await.unwrap();

    assert_eq!(stream_types(&out, "a:0"), "audio");
    assert_eq!(stream_types(&out, "v:0"), "");
}

#[tokio::test]
async fn refuses_an_mp4_without_audio_and_a_missing_file() {
    let dir = TempDir::new().unwrap();
    let silent = dir.path().join("silent.mp4");
    ffmpeg(&["-f", "lavfi", "-i", "color=c=red:s=64x64:d=1", "-c:v", "libx264", silent.to_str().unwrap()]);

    let err = extract_audio_from_video(&silent, &dir.path().join("a.m4a")).await.unwrap_err();
    assert!(err.contains("không chứa luồng âm thanh"), "{err}");
    assert!(extract_audio_from_video(&dir.path().join("none.mp4"), &dir.path().join("b.m4a")).await.is_err());
    assert!(!dir.path().join("a.m4a").exists());
}

fn ingest_in(dir: &Path) -> (Db, Ingest) {
    let db = Db::open(dir.join("test.db"), true).unwrap();
    let events = EventBus::new();
    let ingest = Ingest::new(db.clone(), events.clone(), ServerLogger::new(events), dir.join("data"));
    (db, ingest)
}

fn bytes_stream(chunks: Vec<&'static [u8]>) -> impl futures_util::Stream<Item = Result<Bytes, std::io::Error>> + Unpin {
    stream::iter(chunks.into_iter().map(|c| Ok(Bytes::from_static(c))))
}

fn audio_cache_entries(dir: &Path) -> Vec<String> {
    std::fs::read_dir(dir.join("data/cache/audio"))
        .map(|rd| rd.flatten().map(|e| e.file_name().to_string_lossy().to_string()).collect())
        .unwrap_or_default()
}

#[tokio::test]
async fn upload_spooling_refuses_bad_names_empty_and_oversized_files_and_leaves_nothing() {
    let dir = TempDir::new().unwrap();
    let (_db, ingest) = ingest_in(dir.path());

    let cases: Vec<(&str, Vec<&'static [u8]>, &str)> = vec![
        ("script.sh", vec![b"test"], "không được hỗ trợ"),
        ("song_without_extension", vec![b"audio data"], "không được hỗ trợ"),
        ("empty.flac", vec![], "rỗng"),
        ("huge.flac", vec![&[0u8; 600], &[0u8; 600]], "vượt quá dung lượng tối đa"),
    ];
    for (name, chunks, reason) in cases {
        let err = ingest.spool_upload(name, bytes_stream(chunks), 1000).await.err().unwrap();
        assert!(err.contains(reason), "{name}: {err}");
    }
    assert!(audio_cache_entries(dir.path()).is_empty());
}

// --- POST /api/tracks/upload ---

async fn spawn_server() -> (u16, AppState, TempDir) {
    let dir = TempDir::new().unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let config = EngineConfig {
        db_path: dir.path().join("test.db"),
        data_dir: dir.path().join("data"),
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

async fn upload(port: u16, files: &[(&str, &str, Vec<u8>)]) -> (u16, Value) {
    let boundary = "----slice-test-boundary";
    let mut body = Vec::new();
    for (field, name, content) in files {
        body.extend_from_slice(
            format!("--{boundary}\r\nContent-Disposition: form-data; name=\"{field}\"; filename=\"{name}\"\r\nContent-Type: application/octet-stream\r\n\r\n").as_bytes(),
        );
        body.extend_from_slice(content);
        body.extend_from_slice(b"\r\n");
    }
    body.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());
    let head = format!(
        "POST /api/tracks/upload HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Type: multipart/form-data; boundary={boundary}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let mut stream = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
    stream.write_all(head.as_bytes()).await.unwrap();
    stream.write_all(&body).await.unwrap();
    let mut buf = Vec::new();
    stream.read_to_end(&mut buf).await.unwrap();
    let text = String::from_utf8_lossy(&buf).to_string();
    let status = text.split_whitespace().nth(1).unwrap().parse().unwrap();
    let json = text.split_once("\r\n\r\n").map(|(_, b)| serde_json::from_str(b).unwrap_or(Value::Null)).unwrap_or(Value::Null);
    (status, json)
}

#[tokio::test]
async fn an_uploaded_mp4_becomes_an_m4a_track_and_no_video_stays_in_the_cache() {
    let (port, _state, dir) = spawn_server().await;
    let video = std::fs::read(mp4_with_audio(&dir.path().join("clip.mp4"))).unwrap();

    let (status, body) = upload(port, &[("files", "uploaded_clip.mp4", video)]).await;

    assert_eq!(status, 200, "{body}");
    let track = &body["tracks"][0];
    assert_eq!(track["title"], "uploaded_clip");
    let path = track["file_path"].as_str().unwrap();
    assert!(path.ends_with(".m4a") && Path::new(path).exists(), "{path}");
    let entries = audio_cache_entries(dir.path());
    assert!(entries.iter().all(|e| !e.ends_with(".mp4") && !e.starts_with("temp_upload_")), "{entries:?}");
}

#[tokio::test]
async fn the_same_audio_uploaded_twice_is_one_cached_file_and_one_track() {
    let (port, state, dir) = spawn_server().await;
    let wav = dir.path().join("tone.wav");
    ffmpeg(&["-f", "lavfi", "-i", "sine=f=440:d=1", wav.to_str().unwrap()]);
    let bytes = std::fs::read(&wav).unwrap();

    let (first, a) = upload(port, &[("file", "tone.wav", bytes.clone())]).await;
    let (second, b) = upload(port, &[("file", "renamed.wav", bytes)]).await;

    assert_eq!((first, second), (200, 200));
    assert_eq!(a["tracks"][0]["id"], b["tracks"][0]["id"]);
    assert_eq!(state.db.list_tracks().unwrap().len(), 1);
    assert_eq!(audio_cache_entries(dir.path()).len(), 1);
}

#[tokio::test]
async fn a_batch_reports_each_failed_file_and_still_ingests_the_rest() {
    let (port, _state, dir) = spawn_server().await;
    let wav = dir.path().join("ok.wav");
    ffmpeg(&["-f", "lavfi", "-i", "sine=f=440:d=1", wav.to_str().unwrap()]);

    let (status, body) = upload(port, &[("files", "ok.wav", std::fs::read(&wav).unwrap()), ("files", "notes.txt", b"hi".to_vec())]).await;

    assert_eq!(status, 200, "{body}");
    assert_eq!(body["message"], "Đã nạp thành công 1/2 bài hát. (1 bài lỗi)");
}

#[tokio::test]
async fn refuses_more_than_20_files_and_a_request_without_files() {
    let (port, _state, dir) = spawn_server().await;
    let files: Vec<(&str, &str, Vec<u8>)> = (0..21).map(|_| ("files", "a.flac", b"x".to_vec())).collect();

    let (status, body) = upload(port, &files).await;
    assert_eq!(status, 400);
    assert_eq!(body["error"], "Chỉ được tải lên tối đa 20 file mỗi lần");
    assert!(audio_cache_entries(dir.path()).is_empty(), "spooled files are removed");

    let (status, body) = upload(port, &[]).await;
    assert_eq!(status, 400);
    assert_eq!(body["error"], "Không tìm thấy file tải lên");
}
