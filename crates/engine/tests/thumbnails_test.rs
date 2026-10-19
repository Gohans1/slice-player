use slice_engine::db::Db;
use slice_engine::events::EventBus;
use slice_engine::http::{build_router, AppState};
use slice_engine::metadata::{read_local_metadata, save_cover_art};
use slice_engine::thumbnails::{remove_thumbnail_variants, resized_thumbnail, sweep_thumbnail_variants};
use slice_engine::EngineConfig;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, SystemTime};
use tempfile::TempDir;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

fn ffmpeg(args: &[&str]) {
    let status = Command::new("ffmpeg").args(["-v", "error", "-y"]).args(args).status().unwrap();
    assert!(status.success(), "ffmpeg {args:?}");
}

// Cover art as local files embed it: a single frame, often 3000px square
fn cover_art(path: &Path, size: u32) {
    ffmpeg(&["-f", "lavfi", "-i", &format!("color=c=red:s={size}x{size}"), "-frames:v", "1", path.to_str().unwrap()]);
}

fn width_of(path: &Path) -> u32 {
    image::image_dimensions(path).unwrap().0
}

fn set_mtime(path: &Path, when: SystemTime) {
    std::fs::File::options().write(true).open(path).unwrap().set_modified(when).unwrap();
}

fn names_in(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
        .collect();
    names.sort();
    names
}

fn file_name(path: &Path) -> String {
    path.file_name().unwrap().to_string_lossy().to_string()
}

struct Fixture {
    dir: TempDir,
    source: PathBuf,
    variants: PathBuf,
}

fn fixture() -> Fixture {
    let dir = TempDir::new().unwrap();
    let source = dir.path().join("loc_abc.jpg");
    let variants = dir.path().join("sized");
    Fixture { dir, source, variants }
}

#[tokio::test]
async fn scales_large_cover_art_down_to_the_requested_width() {
    let f = fixture();
    cover_art(&f.source, 3000);

    let resized = resized_thumbnail(&f.source, 192, &f.variants).await.unwrap();

    assert_eq!(width_of(&resized), 192);
    assert!(std::fs::metadata(&resized).unwrap().len() < std::fs::metadata(&f.source).unwrap().len());
}

#[tokio::test]
async fn never_scales_small_cover_art_up() {
    let f = fixture();
    cover_art(&f.source, 100);

    let resized = resized_thumbnail(&f.source, 192, &f.variants).await.unwrap();

    assert_eq!(width_of(&resized), 100);
}

#[tokio::test]
async fn reuses_a_resized_copy_until_the_cover_art_changes() {
    let f = fixture();
    cover_art(&f.source, 3000);
    let first = resized_thumbnail(&f.source, 192, &f.variants).await.unwrap();

    assert_eq!(resized_thumbnail(&f.source, 192, &f.variants).await.unwrap(), first);

    // A re-imported file brings new cover art
    cover_art(&f.source, 2000);
    set_mtime(&f.source, SystemTime::now() + Duration::from_secs(5));
    assert_ne!(resized_thumbnail(&f.source, 192, &f.variants).await.unwrap(), first);
}

#[tokio::test]
async fn makes_a_new_copy_when_a_restore_brings_back_other_art_with_an_older_date() {
    let f = fixture();
    cover_art(&f.source, 3000);
    assert_eq!(width_of(&resized_thumbnail(&f.source, 192, &f.variants).await.unwrap()), 192);

    // A restore writes the backup's cover art and keeps the backup's older modification time
    cover_art(&f.source, 100);
    set_mtime(&f.source, SystemTime::now() - Duration::from_secs(86_400));

    let current = resized_thumbnail(&f.source, 192, &f.variants).await.unwrap();
    assert_eq!(width_of(&current), 100);

    // The copy of the art it replaced goes at the next startup
    sweep_thumbnail_variants(f.dir.path(), &f.variants);
    assert_eq!(names_in(&f.variants), vec![file_name(&current)]);
}

#[tokio::test]
async fn keeps_a_copy_a_request_may_still_be_sending_when_newer_art_replaces_it() {
    let f = fixture();
    cover_art(&f.source, 3000);
    let sending = resized_thumbnail(&f.source, 192, &f.variants).await.unwrap();

    cover_art(&f.source, 100);
    resized_thumbnail(&f.source, 192, &f.variants).await.unwrap();

    assert!(sending.exists());
}

#[tokio::test]
async fn makes_a_copy_once_when_the_same_size_is_asked_for_at_the_same_time() {
    let f = fixture();
    cover_art(&f.source, 3000);

    let (a, b) = tokio::join!(
        resized_thumbnail(&f.source, 640, &f.variants),
        resized_thumbnail(&f.source, 640, &f.variants)
    );

    assert_eq!(a, b);
    assert_eq!(width_of(&a.unwrap()), 640);
    assert_eq!(names_in(&f.variants).len(), 1);
}

#[tokio::test]
async fn removes_a_deleted_tracks_copies_and_leaves_other_tracks_alone() {
    let f = fixture();
    let other_source = f.dir.path().join("loc_other.jpg");
    cover_art(&f.source, 3000);
    cover_art(&other_source, 3000);
    resized_thumbnail(&f.source, 192, &f.variants).await.unwrap();
    resized_thumbnail(&f.source, 640, &f.variants).await.unwrap();
    let other = resized_thumbnail(&other_source, 192, &f.variants).await.unwrap();

    remove_thumbnail_variants("loc_abc", &f.variants);

    assert_eq!(names_in(&f.variants), vec![file_name(&other)]);
}

#[tokio::test]
async fn startup_sweep_clears_copies_of_gone_tracks_and_anything_that_isnt_a_copy() {
    let f = fixture();
    let gone_source = f.dir.path().join("loc_gone.jpg");
    cover_art(&f.source, 3000);
    cover_art(&gone_source, 3000);
    let kept = resized_thumbnail(&f.source, 192, &f.variants).await.unwrap();
    resized_thumbnail(&gone_source, 192, &f.variants).await.unwrap();
    std::fs::write(f.variants.join("loc_abc-192-x.jpg.partial.jpg"), b"half").unwrap();

    std::fs::remove_file(&gone_source).unwrap();
    sweep_thumbnail_variants(f.dir.path(), &f.variants);

    assert_eq!(names_in(&f.variants), vec![file_name(&kept)]);
}

#[tokio::test]
async fn gives_up_on_a_file_that_isnt_an_image() {
    let f = fixture();
    std::fs::write(&f.source, "not an image").unwrap();

    assert_eq!(resized_thumbnail(&f.source, 192, &f.variants).await, None);
    assert!(!f.variants.exists() || names_in(&f.variants).is_empty());
}

// --- /api/thumbs/:id ---

async fn spawn_test_server() -> (u16, TempDir) {
    let dir = TempDir::new().unwrap();
    let data_dir = dir.path().join("data");
    std::fs::create_dir_all(data_dir.join("cache/thumbs")).unwrap();
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
    let router = build_router(AppState::new(config, db, EventBus::new()));
    tokio::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });
    (port, dir)
}

/// (status, lowercase headers, body bytes)
async fn get(port: u16, path: &str, extra_headers: &str) -> (u16, Vec<(String, String)>, Vec<u8>) {
    let raw = format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n{extra_headers}Connection: close\r\n\r\n");
    let mut stream = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
    stream.write_all(raw.as_bytes()).await.unwrap();
    let mut buf = Vec::new();
    stream.read_to_end(&mut buf).await.unwrap();
    let split = buf.windows(4).position(|w| w == b"\r\n\r\n").unwrap();
    let head = String::from_utf8_lossy(&buf[..split]).to_string();
    let mut lines = head.lines();
    let status = lines.next().unwrap().split_whitespace().nth(1).unwrap().parse().unwrap();
    let headers = lines
        .filter_map(|l| l.split_once(':'))
        .map(|(k, v)| (k.trim().to_ascii_lowercase(), v.trim().to_string()))
        .collect();
    (status, headers, buf[split + 4..].to_vec())
}

fn header<'a>(headers: &'a [(String, String)], name: &str) -> Option<&'a str> {
    headers.iter().find(|(k, _)| k == name).map(|(_, v)| v.as_str())
}

#[tokio::test]
async fn thumbs_route_serves_a_scaled_copy_for_a_slot_size_and_the_original_otherwise() {
    let (port, dir) = spawn_test_server().await;
    cover_art(&dir.path().join("data/cache/thumbs/loc_123.png"), 1000);

    let (status, headers, body) = get(port, "/api/thumbs/loc_123.jpg?v=ab12&size=small", "").await;
    assert_eq!(status, 200);
    assert_eq!(header(&headers, "content-type"), Some("image/jpeg"));
    assert_eq!(image::load_from_memory(&body).unwrap().width(), 192);

    for url in ["/api/thumbs/loc_123", "/api/thumbs/loc_123.png?size=huge"] {
        let (status, headers, body) = get(port, url, "").await;
        assert_eq!(status, 200, "{url}");
        assert_eq!(header(&headers, "content-type"), Some("image/png"), "{url}");
        assert_eq!(header(&headers, "cache-control"), Some("public, max-age=86400"), "{url}");
        assert_eq!(image::load_from_memory(&body).unwrap().width(), 1000, "{url}");
    }
}

#[tokio::test]
async fn thumbs_route_answers_304_for_a_matching_etag() {
    let (port, dir) = spawn_test_server().await;
    cover_art(&dir.path().join("data/cache/thumbs/loc_9.jpg"), 300);
    let (_, headers, _) = get(port, "/api/thumbs/loc_9.jpg", "").await;
    let etag = header(&headers, "etag").unwrap().to_string();

    let (status, _, body) = get(port, "/api/thumbs/loc_9.jpg", &format!("If-None-Match: {etag}\r\n")).await;

    assert_eq!(status, 304);
    assert!(body.is_empty());
}

#[tokio::test]
async fn thumbs_route_404s_for_missing_art_and_unsafe_ids() {
    let (port, _dir) = spawn_test_server().await;

    assert_eq!(get(port, "/api/thumbs/loc_none.jpg", "").await.0, 404);
    assert_eq!(get(port, "/api/thumbs/..%2Fmusic.db", "").await.0, 404);
    assert_eq!(get(port, "/api/thumbs/a.b.c", "").await.0, 404);
}

// --- local metadata & cover art ---

#[tokio::test]
async fn reads_title_artist_duration_and_embedded_cover_art() {
    let dir = TempDir::new().unwrap();
    let cover = dir.path().join("cover.jpg");
    cover_art(&cover, 64);
    let song = dir.path().join("song.mp3");
    ffmpeg(&[
        "-f", "lavfi", "-i", "sine=f=440:d=3", "-i", cover.to_str().unwrap(),
        "-map", "0:a", "-map", "1:v", "-c:a", "libmp3lame", "-c:v", "copy", "-id3v2_version", "3",
        "-disposition:v", "attached_pic", "-metadata", "title=Hook Song", "-metadata", "artist=The Band",
        song.to_str().unwrap(),
    ]);

    let meta = read_local_metadata(&song).await;

    assert_eq!(meta.title.as_deref(), Some("Hook Song"));
    assert_eq!(meta.artist.as_deref(), Some("The Band"));
    assert!((meta.duration - 3.0).abs() < 0.2, "duration {}", meta.duration);
    assert_eq!(meta.picture.unwrap()[..3], [0xFF, 0xD8, 0xFF]);
}

#[tokio::test]
async fn untagged_audio_still_gets_its_duration() {
    let dir = TempDir::new().unwrap();
    let song = dir.path().join("bare.wav");
    ffmpeg(&["-f", "lavfi", "-i", "sine=f=440:d=2", song.to_str().unwrap()]);

    let meta = read_local_metadata(&song).await;

    assert_eq!(meta.title, None);
    assert!((meta.duration - 2.0).abs() < 0.1);
}

#[test]
fn saves_verified_cover_art_and_replaces_the_tracks_older_art() {
    let dir = TempDir::new().unwrap();
    std::fs::write(dir.path().join("loc_1.jpg"), b"old jpeg art").unwrap();
    let png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3];

    let url = save_cover_art("loc_1", &png, dir.path()).unwrap();

    assert!(url.starts_with("/api/thumbs/loc_1.png?v="), "{url}");
    assert_eq!(url.len(), "/api/thumbs/loc_1.png?v=".len() + 8);
    assert_eq!(names_in(dir.path()), vec!["loc_1.png".to_string()]);
}

#[test]
fn refuses_cover_art_that_isnt_a_jpeg_png_or_webp() {
    let dir = TempDir::new().unwrap();

    assert_eq!(save_cover_art("loc_2", b"GIF89a....", dir.path()), None);
    assert_eq!(save_cover_art("loc_2", &[0xFF, 0xD8], dir.path()), None);
    assert!(names_in(dir.path()).is_empty());
}
