//! Integration tests for library export/import (`crates/engine/src/backup`), porting
//! `src/server/backupLimits.test.ts`, `src/server/backup.test.ts`, and `src/server/restoreIngest.test.ts`.

use axum::body::Body;
use axum::http::{Request, StatusCode};
use bytes::Bytes;
use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;
use futures_util::StreamExt;
use http_body_util::BodyExt;
use rusqlite::{Connection, OpenFlags};
use serde_json::{json, Value};
use slice_engine::backup::{
    assert_export_fits_restore, export_library_archive, import_library_archive, is_safe_archive_filename,
    MAX_ARCHIVE_ENTRIES, MAX_AUDIO_FILE_BYTES, MAX_COOKIE_FILE_BYTES, MAX_DB_FILE_BYTES, MAX_EXPORTED_BACKUP_BYTES,
    MAX_THUMB_FILE_BYTES, MAX_TOTAL_EXTRACTED_BYTES,
};
use slice_engine::db::Db;
use slice_engine::events::EventBus;
use slice_engine::http::{build_router, AppState};
use slice_engine::models::{NewSegment, NewTrack};
use slice_engine::EngineConfig;
use std::collections::BTreeMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use tempfile::TempDir;
use tower::ServiceExt;

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
        std::fs::write(data_dir.join("cookies.txt"), "# YouTube cookies mock").unwrap();

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

    fn audio_dir(&self) -> PathBuf {
        self.state.config.data_dir.join("cache").join("audio")
    }

    fn thumbs_dir(&self) -> PathBuf {
        self.state.config.data_dir.join("cache").join("thumbs")
    }

    fn cookie_path(&self) -> PathBuf {
        self.state.config.data_dir.join("cookies.txt")
    }

    fn db_path(&self) -> PathBuf {
        self.state.config.db_path.clone()
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

fn unpack_tar_gz(bytes: &[u8]) -> BTreeMap<String, Vec<u8>> {
    let decoder = GzDecoder::new(bytes);
    let mut archive = tar::Archive::new(decoder);
    let mut map = BTreeMap::new();
    for entry in archive.entries().expect("tar entries") {
        let mut entry = entry.expect("tar entry");
        if !entry.header().entry_type().is_file() {
            continue;
        }
        let name = String::from_utf8(entry.path_bytes().into_owned()).expect("utf8 path");
        let mut content = Vec::new();
        entry.read_to_end(&mut content).expect("read entry");
        map.insert(name, content);
    }
    map
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
        builder.append_data(&mut header, *name, *data).expect("append tar entry");
    }
    let gz = builder.into_inner().expect("finish tar");
    gz.finish().expect("finish gzip");
}

fn make_sine_wav(path: &Path, freq_hz: f32) {
    let sample_rate = 8_000u32;
    let num_samples = sample_rate as usize; // 1 second
    let mut pcm = Vec::with_capacity(num_samples * 2);
    for i in 0..num_samples {
        let t = i as f32 / sample_rate as f32;
        let sample = ((2.0 * std::f32::consts::PI * freq_hz * t).sin() * 16_000.0) as i16;
        pcm.extend_from_slice(&sample.to_le_bytes());
    }
    let data_len = pcm.len() as u32;
    let mut wav = Vec::with_capacity(44 + pcm.len());
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&(36 + data_len).to_le_bytes());
    wav.extend_from_slice(b"WAVEfmt ");
    wav.extend_from_slice(&16u32.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes()); // PCM
    wav.extend_from_slice(&1u16.to_le_bytes()); // mono
    wav.extend_from_slice(&sample_rate.to_le_bytes());
    wav.extend_from_slice(&(sample_rate * 2).to_le_bytes());
    wav.extend_from_slice(&2u16.to_le_bytes());
    wav.extend_from_slice(&16u16.to_le_bytes());
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&data_len.to_le_bytes());
    wav.extend_from_slice(&pcm);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).unwrap();
    }
    std::fs::write(path, wav).unwrap();
}

#[test]
fn backup_limits_match_restore_constraints_and_validate_filenames() {
    assert!(assert_export_fits_restore(&[
        ("manifest.json".into(), 120),
        ("music.db".into(), 4096),
        ("cookies.txt".into(), MAX_COOKIE_FILE_BYTES),
        ("cache/audio/track.opus".into(), 1024),
        ("cache/thumbs/track.jpg".into(), 1024),
    ])
    .is_ok());

    let too_many: Vec<(String, u64)> = (0..=MAX_ARCHIVE_ENTRIES)
        .map(|i| (format!("cache/thumbs/{i}.jpg"), 1))
        .collect();
    assert!(assert_export_fits_restore(&too_many).is_err());

    assert!(assert_export_fits_restore(&[("music.db".into(), MAX_DB_FILE_BYTES + 1)]).is_err());
    assert!(assert_export_fits_restore(&[("cache/audio/huge.opus".into(), MAX_AUDIO_FILE_BYTES + 1)]).is_err());

    // Exact parity with backupLimits.test.ts:
    let chunk: u64 = 256 * 1024 * 1024;
    let files = |count: usize| -> Vec<(String, u64)> {
        (0..count).map(|i| (format!("cache/audio/{i}.opus"), chunk)).collect()
    };
    // 1. Rejects 3 GiB library even though it fits extracted-size (5 GiB) and individual-file limits
    assert!(assert_export_fits_restore(&files(12)).is_err());

    // 2. Includes tar, gzip and multipart overhead instead of accepting payload bytes right up to upload cap
    let mut near_cap = files(7);
    near_cap.push(("cache/audio/last.opus".into(), MAX_EXPORTED_BACKUP_BYTES - 7 * chunk - 512));
    assert!(assert_export_fits_restore(&near_cap).is_err());

    // 3. Allows a normal library well within the shared upload budget
    assert!(assert_export_fits_restore(&files(2)).is_ok());

    assert_eq!(MAX_TOTAL_EXTRACTED_BYTES, 5 * 1024 * 1024 * 1024);

    assert!(is_safe_archive_filename("normal_track.opus"));
    assert!(is_safe_archive_filename("image_123.jpg"));
    assert!(!is_safe_archive_filename("../evil.mp3"));
    assert!(!is_safe_archive_filename("..\\evil.mp3"));
    assert!(!is_safe_archive_filename("folder/nested.mp3"));
    assert!(!is_safe_archive_filename("."));
    assert!(!is_safe_archive_filename(".."));
    assert!(!is_safe_archive_filename("CON"));
    assert!(!is_safe_archive_filename("PRN.txt"));
    assert!(!is_safe_archive_filename("AUX"));
    assert!(!is_safe_archive_filename("track.mp3:stream"));
}

#[tokio::test]
async fn exports_valid_archive_and_omits_cookies_by_default_on_http_route() {
    let sb = Sandbox::new();
    let audio_file = sb.audio_dir().join("yt_test123.opus");
    std::fs::write(&audio_file, b"test audio data 12345").unwrap();
    let thumb_file = sb.thumbs_dir().join("yt_test123.jpg");
    std::fs::write(&thumb_file, b"fake jpeg header bytes").unwrap();

    sb.state
        .db
        .create_track(&NewTrack {
            id: "yt_test123".into(),
            source_type: "youtube".into(),
            source_uri: "https://youtube.com/watch?v=test123".into(),
            title: "Export Song".into(),
            artist: Some("Export Artist".into()),
            duration: 180.0,
            file_path: Some(audio_file.to_string_lossy().into_owned()),
            thumbnail_url: Some("/api/thumbs/yt_test123.jpg".into()),
            status: Some("ready".into()),
            ..Default::default()
        })
        .unwrap();

    sb.state
        .db
        .create_segment(&NewSegment {
            id: "seg_123".into(),
            track_id: "yt_test123".into(),
            name: "Cool Hook".into(),
            start_time: 10.0,
            end_time: 30.0,
            color: None,
            sort_order: None,
        })
        .unwrap();
    sb.state.db.create_playlist("My Favorite Playlist", None, None).unwrap();

    // 1. Direct export with include_cookies = true includes cookies.txt
    let bytes_with_cookies = collect_export_bytes(&sb.state, true).await.expect("export with cookies");
    let files = unpack_tar_gz(&bytes_with_cookies);
    assert!(files.contains_key("manifest.json"));
    assert!(files.contains_key("music.db"));
    assert!(files.contains_key("cookies.txt"));
    assert_eq!(files.get("cache/audio/yt_test123.opus").unwrap(), b"test audio data 12345");
    assert_eq!(files.get("cache/thumbs/yt_test123.jpg").unwrap(), b"fake jpeg header bytes");
    assert_eq!(files.get("cookies.txt").unwrap(), b"# YouTube cookies mock");

    let manifest: Value = serde_json::from_slice(files.get("manifest.json").unwrap()).unwrap();
    assert_eq!(manifest["version"], 1);
    assert_eq!(manifest["trackCount"], 1);
    assert_eq!(manifest["segmentCount"], 1);
    assert_eq!(manifest["playlistCount"], 1);

    // 2. HTTP GET /api/library/export omits cookies.txt by default
    let app = build_router(sb.state.clone());
    let resp = app
        .oneshot(
            Request::builder()
                .uri("/api/library/export")
                .header("host", "127.0.0.1:3000")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body_bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let http_files = unpack_tar_gz(&body_bytes);
    assert!(!http_files.contains_key("cookies.txt"));
    assert!(http_files.contains_key("music.db"));
}

#[tokio::test]
async fn exports_committed_wal_rows_even_when_older_reader_blocks_checkpointing() {
    let sb = Sandbox::new();
    let before_audio = sb.audio_dir().join("before.opus");
    let after_audio = sb.audio_dir().join("after.opus");
    std::fs::write(&before_audio, b"before").unwrap();
    std::fs::write(&after_audio, b"after").unwrap();

    sb.state
        .db
        .create_track(&NewTrack {
            id: "before".into(),
            source_type: "local".into(),
            source_uri: "before.opus".into(),
            title: "Before".into(),
            duration: 10.0,
            file_path: Some(before_audio.to_string_lossy().into_owned()),
            status: Some("ready".into()),
            ..Default::default()
        })
        .unwrap();

    let reader = Connection::open_with_flags(sb.db_path(), OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    reader.execute_batch("BEGIN;").unwrap();
    let _: Vec<String> = reader
        .prepare("SELECT id FROM tracks")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();

    sb.state
        .db
        .create_track(&NewTrack {
            id: "after".into(),
            source_type: "local".into(),
            source_uri: "after.opus".into(),
            title: "After".into(),
            duration: 10.0,
            file_path: Some(after_audio.to_string_lossy().into_owned()),
            status: Some("ready".into()),
            ..Default::default()
        })
        .unwrap();

    let archive_bytes = collect_export_bytes(&sb.state, false).await.expect("export");
    let files = unpack_tar_gz(&archive_bytes);
    let exported_db = sb.root.join("exported.db");
    std::fs::write(&exported_db, files.get("music.db").unwrap()).unwrap();

    let snap = Connection::open_with_flags(&exported_db, OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    let ids: Vec<String> = snap
        .prepare("SELECT id FROM tracks ORDER BY id")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    assert_eq!(ids, vec!["after".to_string(), "before".to_string()]);
    let integrity: String = snap.query_row("PRAGMA integrity_check", [], |r| r.get(0)).unwrap();
    assert_eq!(integrity, "ok");
    drop(reader);
}

#[tokio::test]
async fn rejects_late_oversized_entry_and_rolls_back_on_commit_failure() {
    let sb = Sandbox::new();
    let audio = sb.audio_dir().join("existing.opus");
    let thumb = sb.thumbs_dir().join("existing.jpg");
    std::fs::write(&audio, b"original audio").unwrap();
    std::fs::write(&thumb, b"original thumbnail").unwrap();

    let base_archive = collect_export_bytes(&sb.state, false).await.unwrap();
    let base_files = unpack_tar_gz(&base_archive);
    let db_bytes = base_files.get("music.db").unwrap();

    sb.state
        .db
        .create_track(&NewTrack {
            id: "survivor".into(),
            source_type: "local".into(),
            source_uri: "existing.opus".into(),
            title: "Survivor".into(),
            duration: 10.0,
            file_path: Some(audio.to_string_lossy().into_owned()),
            status: Some("ready".into()),
            ..Default::default()
        })
        .unwrap();

    // 1. Late oversized thumbnail entry rejected during staging without touching live files
    let oversized_tar = sb.root.join("oversized.tar.gz");
    let huge_thumb = vec![b'x'; (MAX_THUMB_FILE_BYTES as usize) + 1];
    write_tar_gz(
        &oversized_tar,
        &[
            ("music.db", db_bytes),
            ("cookies.txt", b"replacement cookies"),
            ("cache/audio/existing.opus", b"replacement audio"),
            ("cache/thumbs/existing.jpg", b"replacement thumbnail"),
            ("cache/thumbs/new.jpg", b"new thumbnail"),
            ("cache/thumbs/oversized.jpg", &huge_thumb),
        ],
    );

    let err = import_library_archive(&sb.state, &oversized_tar).await.unwrap_err();
    assert!(err.contains("vượt quá giới hạn"), "unexpected error: {err}");
    assert_eq!(sb.state.db.get_track("survivor").unwrap().unwrap().title, "Survivor");
    assert_eq!(std::fs::read_to_string(&audio).unwrap(), "original audio");
    assert_eq!(std::fs::read_to_string(&thumb).unwrap(), "original thumbnail");
    assert_eq!(std::fs::read_to_string(sb.cookie_path()).unwrap(), "# YouTube cookies mock");
    assert!(!sb.thumbs_dir().join("new.jpg").exists());

    // 2. Commit failure (directory blocking destination file) rolls back DB, overwritten assets, and newly installed files
    let blocked = sb.thumbs_dir().join("blocked.jpg");
    std::fs::create_dir_all(&blocked).unwrap();
    std::fs::write(blocked.join("sentinel"), b"keep this directory").unwrap();

    let commit_fail_tar = sb.root.join("commit_fail.tar.gz");
    write_tar_gz(
        &commit_fail_tar,
        &[
            ("music.db", db_bytes),
            ("cookies.txt", b"replacement cookies"),
            ("cache/audio/existing.opus", b"replacement audio"),
            ("cache/thumbs/existing.jpg", b"replacement thumbnail"),
            ("cache/thumbs/new.jpg", b"new thumbnail"),
            ("cache/thumbs/blocked.jpg", b"cannot replace a directory"),
        ],
    );

    assert!(import_library_archive(&sb.state, &commit_fail_tar).await.is_err());
    assert_eq!(sb.state.db.get_track("survivor").unwrap().unwrap().title, "Survivor");
    assert_eq!(std::fs::read_to_string(&audio).unwrap(), "original audio");
    assert_eq!(std::fs::read_to_string(&thumb).unwrap(), "original thumbnail");
    assert_eq!(std::fs::read_to_string(sb.cookie_path()).unwrap(), "# YouTube cookies mock");
    assert!(!sb.thumbs_dir().join("new.jpg").exists());
    assert_eq!(std::fs::read_to_string(blocked.join("sentinel")).unwrap(), "keep this directory");
}

#[tokio::test]
async fn blocks_concurrent_export_and_import_and_rejects_corrupted_archives() {
    let sb = Sandbox::new();
    let archive_bytes = collect_export_bytes(&sb.state, false).await.unwrap();
    let archive_path = sb.root.join("valid.tar.gz");
    std::fs::write(&archive_path, &archive_bytes).unwrap();

    // Hold export stream open even after producer thread completes — concurrent export and import must both fail
    let export_stream = export_library_archive(&sb.state, false).await.expect("start export");
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    assert!(export_library_archive(&sb.state, false).await.is_err(), "second export must fail while first stream is open");
    let err = import_library_archive(&sb.state, &archive_path).await.unwrap_err();
    assert!(err.contains("đang diễn ra"));
    drop(export_stream);

    // Hold restore lock — concurrent export and second import must both fail with LIBRARY_BUSY_MESSAGE
    let restore_guard = sb.state.mutation_gate.try_begin_restore().expect("acquire restore lock");
    assert!(sb.state.mutation_gate.try_begin_restore().is_none(), "second restore lock must fail");
    let err_export = export_library_archive(&sb.state, false).await.err().unwrap();
    assert!(err_export.contains("đang diễn ra"));
    let err_import = import_library_archive(&sb.state, &archive_path).await.unwrap_err();
    assert!(err_import.contains("đang diễn ra"));
    drop(restore_guard);

    // Corrupted / non-SQLite music.db inside valid tar.gz preserves existing DB
    sb.state
        .db
        .create_track(&NewTrack {
            id: "safe_existing_track".into(),
            source_type: "youtube".into(),
            source_uri: "https://youtube.com/watch?v=safe123".into(),
            title: "I Must Survive".into(),
            duration: 120.0,
            status: Some("ready".into()),
            ..Default::default()
        })
        .unwrap();

    let corrupt_tar = sb.root.join("corrupt.tar.gz");
    write_tar_gz(
        &corrupt_tar,
        &[
            ("manifest.json", br#"{"version":1}"#),
            ("music.db", b"THIS IS NOT A VALID SQLITE DATABASE FILE........................"),
        ],
    );
    assert!(import_library_archive(&sb.state, &corrupt_tar).await.is_err());
    assert_eq!(
        sb.state.db.get_track("safe_existing_track").unwrap().unwrap().title,
        "I Must Survive"
    );
}

#[tokio::test]
async fn transfers_external_local_audio_with_colliding_basenames_and_prefers_cached_copy() {
    let sb = Sandbox::new();
    let external = sb.root.join("external");
    let one_wav = external.join("one").join("song.wav");
    let two_wav = external.join("two").join("song.wav");
    make_sine_wav(&one_wav, 440.0);
    make_sine_wav(&two_wav, 880.0);

    let r1 = sb.state.ingest.ingest_local_file(&one_wav.to_string_lossy(), None).await;
    let r2 = sb.state.ingest.ingest_local_file(&two_wav.to_string_lossy(), None).await;
    assert!(r1.success && r2.success);
    let id1 = r1.tracks.unwrap()[0].id.clone();
    let id2 = r2.tracks.unwrap()[0].id.clone();
    let bytes1 = std::fs::read(&one_wav).unwrap();
    let bytes2 = std::fs::read(&two_wav).unwrap();

    let archive_bytes = collect_export_bytes(&sb.state, false).await.unwrap();
    let archive_path = sb.root.join("colliding.tar.gz");
    std::fs::write(&archive_path, &archive_bytes).unwrap();

    // Remove external originals and import into a second sandbox
    std::fs::remove_dir_all(&external).unwrap();
    let dest = Sandbox::new();
    let res = import_library_archive(&dest.state, &archive_path).await.expect("import");
    assert!(res.success);

    let p1 = PathBuf::from(dest.state.db.get_track(&id1).unwrap().unwrap().file_path.unwrap());
    let p2 = PathBuf::from(dest.state.db.get_track(&id2).unwrap().unwrap().file_path.unwrap());
    assert_ne!(p1, p2);
    assert_eq!(p1.parent().unwrap(), dest.audio_dir());
    assert_eq!(p2.parent().unwrap(), dest.audio_dir());
    assert_eq!(std::fs::read(&p1).unwrap(), bytes1);
    assert_eq!(std::fs::read(&p2).unwrap(), bytes2);

    // Also verify missing ready audio rejects export
    let missing_sb = Sandbox::new();
    missing_sb
        .state
        .db
        .create_track(&NewTrack {
            id: "missing".into(),
            source_type: "local".into(),
            source_uri: "gone.wav".into(),
            title: "Missing".into(),
            duration: 1.0,
            file_path: Some(missing_sb.root.join("gone.wav").to_string_lossy().into_owned()),
            status: Some("ready".into()),
            ..Default::default()
        })
        .unwrap();
    assert!(collect_export_bytes(&missing_sb.state, false).await.is_err());
}

#[tokio::test]
async fn restore_waits_for_active_ingest_and_admitted_mutations_before_replacing_db() {
    let sb = Sandbox::new();
    let audio = sb.audio_dir().join("restored.opus");
    std::fs::write(&audio, b"restored audio").unwrap();
    sb.state
        .db
        .create_track(&NewTrack {
            id: "restored".into(),
            source_type: "local".into(),
            source_uri: "restored.opus".into(),
            title: "Restored Track".into(),
            duration: 10.0,
            file_path: Some(audio.to_string_lossy().into_owned()),
            status: Some("ready".into()),
            ..Default::default()
        })
        .unwrap();

    let archive_bytes = collect_export_bytes(&sb.state, false).await.unwrap();
    let archive_path = sb.root.join("restore_race.tar.gz");
    std::fs::write(&archive_path, &archive_bytes).unwrap();

    // Add a track that exists only before restore
    sb.state
        .db
        .create_track(&NewTrack {
            id: "stale_track".into(),
            source_type: "local".into(),
            source_uri: "stale.opus".into(),
            title: "Stale".into(),
            duration: 5.0,
            status: Some("ready".into()),
            ..Default::default()
        })
        .unwrap();

    // Hold an active ingest operation guard + an admitted HTTP mutation guard
    let active_guard = sb.state.ingest.begin_operation(Some("stale_track")).expect("begin op");
    let mutation_guard = sb.state.mutation_gate.enter_mutation();

    let state_clone = sb.state.clone();
    let archive_clone = archive_path.clone();
    let restore_task = tokio::spawn(async move { import_library_archive(&state_clone, &archive_clone).await });

    // Wait deterministically until restore enters Phase 2 (which cancels active_guard and waits on active_guard & mutation_guard)
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(5);
    while (!sb.state.mutation_gate.is_restoring() || !active_guard.cancel.is_cancelled())
        && tokio::time::Instant::now() < deadline
    {
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    assert!(sb.state.mutation_gate.is_restoring());

    // While restore is running, new ingest and non-library HTTP requests are rejected (503 Retry-After: 5)
    let blocked_ingest = sb.state.ingest.ingest_local_file(&audio.to_string_lossy(), None).await;
    assert!(!blocked_ingest.success);

    let app = build_router(sb.state.clone());
    let delete_resp = app
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri("/api/tracks/restored")
                .header("host", "127.0.0.1:3000")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(delete_resp.status(), StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(delete_resp.headers().get("retry-after").unwrap(), "5");

    // Restore must still be waiting because active_guard and mutation_guard haven't been dropped yet
    assert!(!restore_task.is_finished());

    drop(active_guard);
    drop(mutation_guard);

    let res = restore_task.await.unwrap().expect("restore completes once drained");
    assert!(res.success);
    assert!(sb.state.db.get_track("restored").unwrap().is_some());
    assert!(sb.state.db.get_track("stale_track").unwrap().is_none());

    // Also test HTTP POST /api/library/import raw body endpoint
    let app2 = build_router(sb.state.clone());
    let len = archive_bytes.len().to_string();
    let import_resp = app2
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/library/import")
                .header("host", "127.0.0.1:3000")
                .header("content-length", len)
                .body(Body::from(archive_bytes))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(import_resp.status(), StatusCode::OK);
    let body: Value = serde_json::from_slice(&import_resp.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert_eq!(body, json!({ "success": true, "manifest": body["manifest"], "message": body["message"] }));
}
