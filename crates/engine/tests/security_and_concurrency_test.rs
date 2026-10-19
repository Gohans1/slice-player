//! Cross-module security and database performance integration tests, porting
//! `src/server/security.test.ts` and `src/server/performance.test.ts`.

use bytes::Bytes;
use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;
use futures_util::StreamExt;
use serde_json::json;
use slice_engine::audio_source::validate_safe_local_audio_path;
use slice_engine::backup::{export_library_archive, import_library_archive};
use slice_engine::db::Db;
use slice_engine::events::EventBus;
use slice_engine::http::ws_and_logs::{sanitize_internal_paths, ServerLogger};
use slice_engine::http::AppState;
use slice_engine::models::{BatchPlaylistItemInput, NewSegment, NewTrack};
use slice_engine::EngineConfig;
use std::collections::BTreeSet;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::Instant;
use tempfile::TempDir;

struct Sandbox {
    _dir: TempDir,
    root: PathBuf,
    state: AppState,
}

impl Sandbox {
    fn new() -> Self {
        let base = std::env::current_dir().unwrap().join("target").join("test-tmp");
        std::fs::create_dir_all(&base).unwrap();
        let dir = tempfile::tempdir_in(&base).expect("tempdir");
        let root = dir.path().to_path_buf();
        let data_dir = root.join("data");
        std::fs::create_dir_all(data_dir.join("cache").join("audio")).unwrap();
        std::fs::create_dir_all(data_dir.join("cache").join("thumbs")).unwrap();
        std::fs::write(data_dir.join("cookies.txt"), "SAPISID=secret_token_12345;").unwrap();

        let db_path = data_dir.join("music.db");
        let db = Db::open(&db_path, true).expect("open db");
        let config = EngineConfig {
            port: 3000,
            data_dir,
            db_path,
            dist_dir: root.join("dist"),
            is_production: false,
            is_test: true,
        };
        let events = EventBus::new();
        let state = AppState::new(config, db, events);
        Self { _dir: dir, root, state }
    }
}

async fn collect_export_bytes(state: &AppState, include_cookies: bool) -> Result<Vec<u8>, String> {
    let mut stream = export_library_archive(state, include_cookies).await?;
    let mut out = Vec::new();
    while let Some(chunk) = stream.next().await {
        let bytes: Bytes = chunk.map_err(|e| e.to_string())?;
        out.extend_from_slice(&bytes);
    }
    Ok(out)
}

fn archive_entry_names(bytes: &[u8]) -> BTreeSet<String> {
    let decoder = GzDecoder::new(bytes);
    let mut archive = tar::Archive::new(decoder);
    let mut names = BTreeSet::new();
    for entry in archive.entries().expect("tar entries") {
        let mut entry = entry.expect("tar entry");
        if !entry.header().entry_type().is_file() {
            continue;
        }
        let name = String::from_utf8(entry.path_bytes().into_owned()).expect("utf8 path");
        let mut sink = Vec::new();
        entry.read_to_end(&mut sink).expect("read entry");
        names.insert(name);
    }
    names
}

fn write_tar_gz(path: &Path, entries: &[(&str, &[u8])]) {
    let file = std::fs::File::create(path).expect("create tar.gz");
    let gz = GzEncoder::new(file, Compression::fast());
    let mut builder = tar::Builder::new(gz);
    for (name, data) in entries {
        let mut header = tar::Header::new_gnu();
        header.set_size(data.len() as u64);
        header.set_mode(0o644);
        header.set_cksum();
        builder
            .append_data(&mut header, *name, *data)
            .expect("append tar entry");
    }
    let gz = builder.into_inner().expect("finish tar");
    gz.finish().expect("finish gzip");
}

// ============================================================================
// Security Controls & Boundary Enforcement (`src/server/security.test.ts`)
// ============================================================================

#[tokio::test]
async fn excludes_cookies_txt_from_exported_archive_by_default_to_prevent_session_credential_leaks() {
    let sb = Sandbox::new();
    let bytes = collect_export_bytes(&sb.state, false).await.expect("export");
    let names = archive_entry_names(&bytes);

    assert!(names.contains("manifest.json"));
    assert!(names.contains("music.db"));
    assert!(!names.contains("cookies.txt"), "cookies.txt MUST NOT be included by default");
}

#[tokio::test]
async fn permits_cookies_txt_only_when_explicitly_requested_via_include_cookies_option() {
    let sb = Sandbox::new();
    let bytes = collect_export_bytes(&sb.state, true).await.expect("export with cookies");
    let names = archive_entry_names(&bytes);

    assert!(names.contains("manifest.json"));
    assert!(names.contains("music.db"));
    assert!(names.contains("cookies.txt"));
}

#[test]
fn validates_and_rejects_unc_network_paths_and_invalid_formats_in_validate_safe_local_audio_path() {
    assert!(validate_safe_local_audio_path(r"\\attacker-smb\share\song.mp3").is_err());
    assert!(validate_safe_local_audio_path("//evil-host/audio/test.wav").is_err());
    assert!(validate_safe_local_audio_path(r"C:\Windows\System32\drivers\etc\hosts:stream").is_err());
}

#[tokio::test]
async fn rejects_concurrent_export_attempts_with_a_busy_error() {
    let sb = Sandbox::new();
    let stream1 = export_library_archive(&sb.state, false)
        .await
        .expect("first export holds guard while stream is alive");
    let second = export_library_archive(&sb.state, false).await;
    let Err(err) = second else {
        panic!("expected concurrent export to fail with busy error");
    };
    assert!(err.contains("đang diễn ra"), "unexpected error: {err}");
    drop(stream1);
}

#[test]
fn sanitizes_internal_server_paths_and_masks_user_home_directories_in_logs() {
    let cwd = std::env::current_dir().unwrap();
    let cwd_file = cwd.join("src/server/db.ts").to_string_lossy().to_string();

    let sanitized_cwd = sanitize_internal_paths(&format!("Database connection failed at {cwd_file}:42"));
    assert!(!sanitized_cwd.contains(&cwd.to_string_lossy().to_string()));
    assert!(sanitized_cwd.contains("[PROJECT_DIR]"));

    let sanitized_win = sanitize_internal_paths(r"Failed at C:\Users\SomeoneElse\private\token.txt");
    assert!(!sanitized_win.contains(r"C:\Users\SomeoneElse"));
    assert!(sanitized_win.contains(r"[USER_HOME]\private\token.txt"));

    let logger = ServerLogger::default();
    logger.add_log(
        "error",
        "db",
        &format!("Failure at {cwd_file}"),
        Some(json!({
            "message": format!("Database connection failed at {cwd_file}:42"),
            "path": r"C:\Users\SomeoneElse\private\token.txt",
        })),
    );
    let logs = logger.get_recent_logs(10);
    assert_eq!(logs.len(), 1);
    assert!(!logs[0].message.contains(&cwd.to_string_lossy().to_string()));
    let details_str = serde_json::to_string(&logs[0].details).unwrap();
    assert!(!details_str.contains(&cwd.to_string_lossy().to_string()));
    assert!(!details_str.contains("SomeoneElse"));
}

#[tokio::test]
async fn enforces_decompression_validation_against_corrupted_or_fake_sqlite_archives() {
    let sb = Sandbox::new();
    let archive_path = sb.root.join("fake_db.tar.gz");
    write_tar_gz(&archive_path, &[("music.db", b"fake sqlite db")]);

    let res = import_library_archive(&sb.state, &archive_path).await;
    assert!(res.is_err(), "fake sqlite db archive must be rejected");
}

#[tokio::test]
async fn rejects_archive_containing_dangerous_or_non_allowlisted_file_extensions() {
    let sb = Sandbox::new();
    let archive_path = sb.root.join("dangerous.tar.gz");
    let manifest = br#"{"version":1,"app":"slice-player","exportedAt":"2026-10-19T00:00:00Z"}"#;
    write_tar_gz(
        &archive_path,
        &[
            ("manifest.json", manifest),
            ("music.db", b"fake db content"),
            ("cache/audio/malicious.exe", b"MZ dangerous binary"),
            ("cache/thumbs/payload.bat", b"@echo off\nevil.exe"),
        ],
    );

    let err = import_library_archive(&sb.state, &archive_path)
        .await
        .expect_err("dangerous extensions must be rejected");
    let lower = err.to_lowercase();
    assert!(
        lower.contains("định dạng không được hỗ trợ") || lower.contains("không hợp lệ"),
        "unexpected error: {err}"
    );
}

// ============================================================================
// Batch Operations & Database Performance (`src/server/performance.test.ts`)
// ============================================================================

#[test]
fn batch_inserts_500_playlist_items_efficiently_without_individual_n_plus_1_lookups() {
    let sb = Sandbox::new();
    let pl = sb
        .state
        .db
        .create_playlist("Perf Playlist", None, None)
        .expect("create playlist");

    for i in 0..100 {
        sb.state
            .db
            .create_track(&NewTrack {
                id: format!("trk_perf_{i}"),
                source_type: "local".into(),
                source_uri: format!("file:///music/track_{i}.mp3"),
                title: format!("Track {i}"),
                artist: Some("Perf Artist".into()),
                duration: 120.0,
                status: Some("ready".into()),
                ..Default::default()
            })
            .expect("create track");
    }

    let items_to_add: Vec<BatchPlaylistItemInput> = (0..500)
        .map(|i| BatchPlaylistItemInput {
            track_id: format!("trk_perf_{}", i % 100),
            segment_id: None,
        })
        .collect();

    let start = Instant::now();
    let result = sb
        .state
        .db
        .add_playlist_items_batch(&pl.id, &items_to_add)
        .expect("batch add");
    let elapsed = start.elapsed();

    assert_eq!(result.len(), 500);
    assert!(
        elapsed.as_millis() < 1000,
        "batch add of 500 items took {}ms",
        elapsed.as_millis()
    );

    let pl_items = sb.state.db.get_playlist_items(&pl.id).expect("get items");
    assert_eq!(pl_items.len(), 100);
}

#[test]
fn batch_deletes_200_tracks_in_chunked_queries_efficiently() {
    let sb = Sandbox::new();
    let mut track_ids = Vec::with_capacity(200);
    for i in 0..200 {
        let id = format!("trk_del_{i}");
        sb.state
            .db
            .create_track(&NewTrack {
                id: id.clone(),
                source_type: "local".into(),
                source_uri: format!("file:///music/track_del_{i}.mp3"),
                title: format!("Track Del {i}"),
                duration: 120.0,
                status: Some("ready".into()),
                ..Default::default()
            })
            .expect("create track");
        track_ids.push(id);
    }

    let start = Instant::now();
    let deleted_count = sb
        .state
        .db
        .delete_tracks_batch(&track_ids)
        .expect("batch delete");
    let elapsed = start.elapsed();

    assert_eq!(deleted_count, 200);
    assert!(
        elapsed.as_millis() < 500,
        "batch delete of 200 tracks took {}ms",
        elapsed.as_millis()
    );
}

#[test]
fn has_indexes_on_tracks_created_at_desc_and_tracks_status_to_accelerate_polling_and_sorting() {
    let sb = Sandbox::new();
    let (index_names, plan_details) = sb.state.db.with_conn(|conn| {
        let mut stmt = conn.prepare("PRAGMA index_list(tracks);").unwrap();
        let names: Vec<String> = stmt
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .filter_map(Result::ok)
            .collect();

        let mut plan_stmt = conn
            .prepare("EXPLAIN QUERY PLAN SELECT id FROM tracks ORDER BY created_at DESC;")
            .unwrap();
        let details: Vec<String> = plan_stmt
            .query_map([], |row| row.get::<_, String>(3))
            .unwrap()
            .filter_map(Result::ok)
            .collect();
        (names, details)
    });

    assert!(index_names.contains(&"idx_tracks_created_at".to_string()));
    assert!(index_names.contains(&"idx_tracks_status".to_string()));
    assert!(
        plan_details
            .iter()
            .any(|d| d.contains("idx_tracks_created_at") || d.contains("USING INDEX")),
        "expected index usage in query plan: {plan_details:?}"
    );
}

#[test]
fn bulk_prefetches_tracks_and_segments_via_get_tracks_batch_and_list_segments_by_track_ids_in_chunks() {
    let sb = Sandbox::new();
    let mut track_ids = Vec::with_capacity(50);
    for i in 0..50 {
        let id = format!("trk_batch_fetch_{i}");
        sb.state
            .db
            .create_track(&NewTrack {
                id: id.clone(),
                source_type: "local".into(),
                source_uri: format!("file:///music/batch_{i}.mp3"),
                title: format!("Batch Track {i}"),
                duration: 180.0,
                file_path: Some(format!("/music/batch_{i}.mp3")),
                status: Some("ready".into()),
                ..Default::default()
            })
            .expect("create track");
        sb.state
            .db
            .create_segment(&NewSegment {
                id: format!("seg_a_{i}"),
                track_id: id.clone(),
                name: format!("Seg A {i}"),
                start_time: 10.0,
                end_time: 20.0,
                color: None,
                sort_order: None,
            })
            .expect("create seg a");
        sb.state
            .db
            .create_segment(&NewSegment {
                id: format!("seg_b_{i}"),
                track_id: id.clone(),
                name: format!("Seg B {i}"),
                start_time: 30.0,
                end_time: 40.0,
                color: None,
                sort_order: None,
            })
            .expect("create seg b");
        track_ids.push(id);
    }

    let fetched_tracks = sb
        .state
        .db
        .get_tracks_batch(&track_ids)
        .expect("get tracks batch");
    assert_eq!(fetched_tracks.len(), 50);
    assert!(fetched_tracks[0].1.is_some());

    let fetched_segments = sb
        .state
        .db
        .list_segments_by_track_ids(&track_ids)
        .expect("list segments by track ids");
    assert_eq!(fetched_segments.len(), 100);
    assert!(!fetched_segments[0].1.is_empty());
}

#[test]
fn executes_list_tracks_without_temporary_b_tree_sorting_using_idx_tracks_created_at() {
    let sb = Sandbox::new();
    let plan_details = sb.state.db.with_conn(|conn| {
        let mut stmt = conn
            .prepare(
                "
                EXPLAIN QUERY PLAN
                SELECT tracks.id, tracks.source_type, tracks.source_uri, tracks.title,
                       tracks.artist, tracks.duration, tracks.thumbnail_url, tracks.file_path,
                       tracks.status, tracks.error_message, tracks.volume, tracks.loudness,
                       tracks.true_peak, tracks.created_at,
                       (SELECT COUNT(*) FROM segments WHERE segments.track_id = tracks.id) AS segment_count
                FROM tracks
                ORDER BY tracks.created_at DESC
                ",
            )
            .unwrap();
        stmt.query_map([], |row| row.get::<_, String>(3))
            .unwrap()
            .filter_map(Result::ok)
            .collect::<Vec<_>>()
    });

    assert!(
        !plan_details.iter().any(|d| d.contains("USE TEMP B-TREE")),
        "unexpected temp B-tree in query plan: {plan_details:?}"
    );
    assert!(
        plan_details.iter().any(|d| d.contains("idx_tracks_created_at")),
        "expected idx_tracks_created_at in query plan: {plan_details:?}"
    );
}
