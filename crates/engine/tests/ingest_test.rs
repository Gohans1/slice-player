use serde_json::{json, Value};
use slice_engine::db::Db;
use slice_engine::events::EventBus;
use slice_engine::http::ws_and_logs::ServerLogger;
use slice_engine::ingest::local::local_track_id;
use slice_engine::ingest::ytdlp::{is_youtube_auth_error, is_youtube_format_or_sabr_error, resolve_best_youtube_thumbnail};
use slice_engine::ingest::{Ingest, INGEST_PAUSED_MESSAGE, MAX_PLAYLIST_ITEMS};
use slice_engine::models::{NewSegment, NewTrack, TrackUpdates};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tempfile::TempDir;

fn ffmpeg(args: &[&str]) {
    let status = Command::new("ffmpeg").args(["-v", "error", "-y"]).args(args).status().unwrap();
    assert!(status.success(), "ffmpeg {args:?}");
}

fn tone(path: &Path, seconds: u32) -> PathBuf {
    ffmpeg(&["-f", "lavfi", "-i", &format!("sine=f=440:d={seconds}"), path.to_str().unwrap()]);
    path.to_path_buf()
}

struct Lib {
    dir: TempDir,
    db: Db,
    events: EventBus,
    ingest: Ingest,
}

fn library() -> Lib {
    library_with(|i| i)
}

fn library_with(configure: impl FnOnce(Ingest) -> Ingest) -> Lib {
    let dir = TempDir::new().unwrap();
    let data_dir = dir.path().join("data");
    std::fs::create_dir_all(data_dir.join("cache/audio")).unwrap();
    let db = Db::open(dir.path().join("test.db"), true).unwrap();
    let events = EventBus::new();
    let ingest = configure(Ingest::new(db.clone(), events.clone(), ServerLogger::new(events.clone()), data_dir));
    Lib { dir, db, events, ingest }
}

fn record(events: &EventBus, name: &str) -> Arc<Mutex<Vec<Value>>> {
    let seen = Arc::new(Mutex::new(Vec::new()));
    let sink = seen.clone();
    events.on(name, move |v| sink.lock().unwrap().push(v.clone()));
    seen
}

async fn wait_for_status(db: &Db, id: &str, status: &str) -> slice_engine::models::Track {
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        let track = db.get_track(id).unwrap();
        if let Some(t) = &track
            && t.status == status
        {
            return track.unwrap();
        }
        assert!(Instant::now() < deadline, "{id} never reached {status}: {track:?}");
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

// --- resolveBestYouTubeThumbnail ---

fn thumbs(list: Value) -> Option<Value> {
    Some(list)
}

#[test]
fn thumbnail_picks_maxresdefault_when_listed() {
    let list = thumbs(json!([
        { "id": "default", "url": "https://i.ytimg.com/vi/abc/default.jpg", "width": 120, "height": 90 },
        { "id": "hqdefault", "url": "https://i.ytimg.com/vi/abc/hqdefault.jpg", "width": 480, "height": 360 },
        { "id": "maxresdefault", "url": "https://i.ytimg.com/vi/abc/maxresdefault.jpg", "width": 1280, "height": 720 }
    ]));
    assert_eq!(resolve_best_youtube_thumbnail("abc", list.as_ref(), None), "https://i.ytimg.com/vi/abc/maxresdefault.jpg");
}

#[test]
fn thumbnail_picks_the_best_listed_when_maxres_is_absent() {
    let list = thumbs(json!([
        { "id": "default", "url": "https://i.ytimg.com/vi/abc/default.jpg", "width": 120, "height": 90 },
        { "id": "mqdefault", "url": "https://i.ytimg.com/vi/abc/mqdefault.jpg", "width": 320, "height": 180 },
        { "id": "sddefault", "url": "https://i.ytimg.com/vi/abc/sddefault.jpg", "width": 640, "height": 480 }
    ]));
    assert_eq!(resolve_best_youtube_thumbnail("abc", list.as_ref(), None), "https://i.ytimg.com/vi/abc/sddefault.jpg");
}

#[test]
fn thumbnail_takes_a_webp_maxres() {
    let list = thumbs(json!([
        { "id": "0", "url": "https://i.ytimg.com/vi/3.jpg", "width": 120 },
        { "id": "maxresdefault", "url": "https://i.ytimg.com/vi_webp/abc/maxresdefault.webp", "width": 1280, "height": 720 }
    ]));
    assert_eq!(resolve_best_youtube_thumbnail("abc", list.as_ref(), None), "https://i.ytimg.com/vi_webp/abc/maxresdefault.webp");
}

#[test]
fn thumbnail_ranks_by_id_when_dimensions_are_missing() {
    let list = thumbs(json!([
        { "id": "default", "url": "https://i.ytimg.com/vi/abc/default.jpg" },
        { "id": "mqdefault", "url": "https://i.ytimg.com/vi/abc/mqdefault.jpg" },
        { "id": "hqdefault", "url": "https://i.ytimg.com/vi/abc/hqdefault.jpg" }
    ]));
    assert_eq!(resolve_best_youtube_thumbnail("abc", list.as_ref(), None), "https://i.ytimg.com/vi/abc/hqdefault.jpg");
}

#[test]
fn thumbnail_skips_downscaled_sqp_copies() {
    let list = thumbs(json!([
        { "id": "maxresdefault", "url": "https://i.ytimg.com/vi/abc/maxresdefault.jpg?sqp=xyz" },
        { "id": "hqdefault", "url": "https://i.ytimg.com/vi/abc/hqdefault.jpg?sqp=xyz" }
    ]));
    assert_eq!(resolve_best_youtube_thumbnail("abc", list.as_ref(), None), "https://i.ytimg.com/vi/abc/maxresdefault.jpg");
}

#[test]
fn thumbnail_falls_back_to_constructed_maxres_or_a_clean_default() {
    assert_eq!(resolve_best_youtube_thumbnail("xyz", Some(&json!([])), None), "https://i.ytimg.com/vi/xyz/maxresdefault.jpg");
    assert_eq!(resolve_best_youtube_thumbnail("xyz", None, None), "https://i.ytimg.com/vi/xyz/maxresdefault.jpg");
    assert_eq!(
        resolve_best_youtube_thumbnail("xyz", Some(&json!([])), Some("https://i.ytimg.com/vi/xyz/clean_custom.jpg")),
        "https://i.ytimg.com/vi/xyz/clean_custom.jpg"
    );
    assert_eq!(
        resolve_best_youtube_thumbnail("xyz", Some(&json!([])), Some("//i.ytimg.com/vi/xyz/clean_custom.jpg")),
        "https://i.ytimg.com/vi/xyz/clean_custom.jpg"
    );
}

#[test]
fn thumbnail_normalizes_protocol_relative_urls() {
    let list = thumbs(json!([{ "id": "maxresdefault", "url": "//i.ytimg.com/vi/xyz/maxresdefault.jpg", "width": 1280, "height": 720 }]));
    assert_eq!(resolve_best_youtube_thumbnail("xyz", list.as_ref(), None), "https://i.ytimg.com/vi/xyz/maxresdefault.jpg");
}

#[test]
fn thumbnail_rejects_sqp_or_non_http_defaults() {
    let maxres = "https://i.ytimg.com/vi/xyz/maxresdefault.jpg";
    assert_eq!(resolve_best_youtube_thumbnail("xyz", Some(&json!([])), Some("https://example.com/thumb.jpg?sqp=bad")), maxres);
    assert_eq!(resolve_best_youtube_thumbnail("xyz", Some(&json!([])), Some("javascript:alert(1)")), maxres);
}

#[test]
fn thumbnail_prefers_constructed_maxres_over_unranked_or_tiny_listings() {
    let maxres = "https://i.ytimg.com/vi/xyz/maxresdefault.jpg";
    assert_eq!(resolve_best_youtube_thumbnail("xyz", Some(&json!([{ "id": "0", "url": "https://i.ytimg.com/vi/xyz/0.jpg" }])), None), maxres);
    let tiny = json!([{ "id": "default", "url": "https://i.ytimg.com/vi/xyz/default.jpg", "width": 120, "height": 90 }]);
    assert_eq!(resolve_best_youtube_thumbnail("xyz", Some(&tiny), None), maxres);
}

#[test]
fn thumbnail_does_not_mistake_a_video_id_containing_hq720_for_the_hq720_tier() {
    let list = json!([{ "id": "0", "url": "https://i.ytimg.com/vi/vid_hq720_abc/default.jpg", "width": 120, "height": 90 }]);
    assert_eq!(resolve_best_youtube_thumbnail("vid_hq720_abc", Some(&list), None), "https://i.ytimg.com/vi/vid_hq720_abc/maxresdefault.jpg");
    let list = json!([{ "id": "0", "url": "https://i.ytimg.com/vi/hq720-abc1234/default.jpg", "width": 120, "height": 90 }]);
    assert_eq!(resolve_best_youtube_thumbnail("hq720-abc1234", Some(&list), None), "https://i.ytimg.com/vi/hq720-abc1234/maxresdefault.jpg");
}

#[test]
fn thumbnail_survives_malformed_dimensions() {
    let list = json!([
        { "id": "default", "url": "https://i.ytimg.com/vi/xyz/default.jpg", "width": -120, "height": "NaN" },
        { "id": "hqdefault", "url": "https://i.ytimg.com/vi/xyz/hqdefault.jpg", "width": 480, "height": 360 }
    ]);
    assert_eq!(resolve_best_youtube_thumbnail("xyz", Some(&list), None), "https://i.ytimg.com/vi/xyz/hqdefault.jpg");
}

#[test]
fn thumbnail_with_a_blank_video_id() {
    assert_eq!(resolve_best_youtube_thumbnail("   ", Some(&json!([])), Some("https://example.com/fallback.jpg")), "https://example.com/fallback.jpg");
    assert_eq!(resolve_best_youtube_thumbnail("", Some(&json!([])), None), "");
}

// --- error classification & auth args ---

#[test]
fn auth_errors_are_told_apart_from_per_video_restrictions() {
    for auth in [
        "ERROR: [youtube] KLZgIuTQDA4: Sign in to confirm you’re not a bot.",
        "ERROR: [youtube] KLZgIuTQDA4: Sign in to confirm you're not a bot.",
        "ERROR: unable to download video data: HTTP Error 403: Forbidden",
        "ERROR: [youtube] abc: HTTP Error 401: Unauthorized",
        "ERROR: [youtube] abc: HTTP Error 429: Too Many Requests",
        "429 Too Many Requests",
        "403 Forbidden",
        "A PO Token is required to download this video",
        "Proof of origin token missing",
        "po_token validation failed",
        "ERROR: cookies file expired",
        "ERROR: Invalid cookies provided",
        "ERROR: cookie error occurred",
        "The session needs to be reloaded",
    ] {
        assert!(is_youtube_auth_error(auth), "{auth}");
    }
    for not_auth in [
        "ERROR: [youtube] This is a private video",
        "ERROR: [youtube] Join this channel to view members-only video",
        "ERROR: Confirm your age to watch this video",
        "Stream reloaded successfully",
        "General network error",
    ] {
        assert!(!is_youtube_auth_error(not_auth), "{not_auth}");
    }
}

#[test]
fn format_and_sabr_errors_are_recognized() {
    assert!(is_youtube_format_or_sabr_error("ERROR: [youtube] doN4GrGoVpA: Requested format is not available. Use --list-formats"));
    assert!(is_youtube_format_or_sabr_error("YouTube is forcing SABR streaming for this client."));
    assert!(is_youtube_format_or_sabr_error("WARNING: Only images are available for download. use --list-formats to see them"));
    assert!(!is_youtube_format_or_sabr_error("General network error"));
    assert!(!is_youtube_format_or_sabr_error("403 Forbidden"));
}

#[test]
fn auth_args_switch_client_and_use_cookies_only_outside_their_cooldown() {
    let lib = library();
    let default_args = lib.ingest.youtube_auth_args(true, false);
    assert!(default_args.contains(&"youtube:player_client=default,-tv".to_string()));
    assert!(default_args.contains(&"--js-runtimes".to_string()) && default_args.contains(&"bun".to_string()));
    assert!(!default_args.contains(&"--cookies".to_string()), "no cookie file yet");
    assert!(lib.ingest.youtube_auth_args(false, true).contains(&"youtube:player_client=mweb,android,ios,web".to_string()));

    std::fs::write(lib.dir.path().join("data/cookies.txt"), "# Netscape HTTP Cookie File\n").unwrap();
    assert!(lib.ingest.youtube_auth_args(true, false).contains(&"--cookies".to_string()));
    assert!(!lib.ingest.youtube_auth_args(false, false).contains(&"--cookies".to_string()));

    lib.ingest.mark_cookies_failed();
    assert!(!lib.ingest.youtube_auth_args(true, false).contains(&"--cookies".to_string()), "5-minute cooldown");
    lib.ingest.reset_cookies_status();
    assert!(lib.ingest.youtube_auth_args(true, false).contains(&"--cookies".to_string()));
}

#[test]
fn playlist_cap_is_5000() {
    assert_eq!(MAX_PLAYLIST_ITEMS, 5000);
}

// --- local files & folders ---

#[tokio::test]
async fn local_ingest_rejects_bad_paths_with_the_reason() {
    let lib = library();
    let cases = [
        ("C:/non_existent_folder/missing_song.flac", "không tồn tại"),
        ("C:/Users/test.exe", "không được hỗ trợ"),
        (r"\\evil-server\share\song.flac", "UNC"),
    ];
    for (path, reason) in cases {
        let res = lib.ingest.ingest_local_file(path, None).await;
        assert!(!res.success);
        assert!(res.message.as_deref().unwrap().contains(reason), "{path}: {:?}", res.message);
    }
    let dir_cases = [
        (r"\\evil-server\share\music", "UNC"),
        ("CON", "thiết bị"),
        ("C:/music:stream", "Alternate Data Stream"),
        ("C:/non_existent_music_dir_12345", "không tồn tại"),
    ];
    for (path, reason) in dir_cases {
        let res = lib.ingest.ingest_local_directory(path).await;
        assert!(!res.success);
        assert!(res.message.as_deref().unwrap().contains(reason), "{path}: {:?}", res.message);
    }
}

#[tokio::test]
async fn ingests_a_local_file_with_waveform_loudness_and_its_tags() {
    let lib = library();
    let song = lib.dir.path().join("Song Name.mp3");
    ffmpeg(&["-f", "lavfi", "-i", "sine=f=440:d=3", "-metadata", "artist=Somebody", song.to_str().unwrap()]);
    let created = record(&lib.events, "track_created");

    let res = lib.ingest.ingest_local_file(&format!("\"{}\"", song.display()), None).await;

    assert!(res.success, "{res:?}");
    let track = &res.tracks.unwrap()[0];
    assert_eq!(track.id, local_track_id(&song));
    assert_eq!(track.title, "Song Name", "no title tag: the file name");
    assert_eq!(track.artist, "Somebody");
    assert_eq!(track.status, "ready");
    assert!((track.duration - 3.0).abs() < 0.2);
    let stored = lib.db.get_track(&track.id).unwrap().unwrap();
    let peaks: Vec<f64> = serde_json::from_str(stored.peaks_json.as_deref().unwrap()).unwrap();
    assert_eq!(peaks.len(), 1000);
    assert!(stored.loudness.is_some() && stored.true_peak.is_some(), "measured in the same decode");
    assert_eq!(*created.lock().unwrap(), vec![json!({ "trackId": track.id })]);
}

#[tokio::test]
async fn reingesting_a_shorter_file_updates_the_track_and_drops_slices_past_its_end() {
    let lib = library();
    let song = tone(&lib.dir.path().join("song.wav"), 4);
    let id = lib.ingest.ingest_local_file(song.to_str().unwrap(), None).await.tracks.unwrap()[0].id.clone();
    lib.db
        .create_segment(&NewSegment { id: "seg_late".into(), track_id: id.clone(), name: "Late".into(), start_time: 3.0, end_time: 3.9, color: None, sort_order: None })
        .unwrap();
    lib.db.update_track(&id, &TrackUpdates { status: Some("error".into()), error_message: Some(Some("old".into())), ..Default::default() }).unwrap();
    tone(&song, 2);
    let updated = record(&lib.events, "track_updated");

    let res = lib.ingest.ingest_local_file(song.to_str().unwrap(), None).await;

    assert!(res.success);
    let track = lib.db.get_track(&id).unwrap().unwrap();
    assert!((track.duration - 2.0).abs() < 0.1);
    assert_eq!(track.status, "ready");
    assert_eq!(track.error_message, None);
    assert!(lib.db.get_segment("seg_late").unwrap().is_none());
    assert!(updated.lock().unwrap().contains(&json!({ "trackId": id })));
}

#[tokio::test]
async fn ingesting_an_mp4_extracts_its_audio_into_the_cache() {
    let lib = library();
    let video = lib.dir.path().join("clip.mp4");
    ffmpeg(&[
        "-f", "lavfi", "-i", "color=c=blue:s=64x64:d=2", "-f", "lavfi", "-i", "sine=f=330:d=2",
        "-shortest", "-c:v", "libx264", "-c:a", "aac", video.to_str().unwrap(),
    ]);

    let res = lib.ingest.ingest_local_file(video.to_str().unwrap(), None).await;

    assert!(res.success, "{res:?}");
    let track = &res.tracks.unwrap()[0];
    let expected = lib.dir.path().join("data/cache/audio").join(format!("{}.m4a", track.id));
    assert_eq!(track.file_path.as_deref(), Some(expected.to_str().unwrap()));
    assert!(expected.exists());
    assert_eq!(track.source_uri, video.to_str().unwrap());
}

#[tokio::test]
async fn ingests_every_audio_file_of_a_folder() {
    let lib = library();
    let folder = lib.dir.path().join("album");
    std::fs::create_dir(&folder).unwrap();
    tone(&folder.join("01.wav"), 1);
    tone(&folder.join("02.flac"), 1);
    std::fs::write(folder.join("cover.txt"), "not audio").unwrap();

    let res = lib.ingest.ingest_local_directory(folder.to_str().unwrap()).await;

    assert!(res.success, "{res:?}");
    assert_eq!(res.tracks.unwrap().len(), 2);
    assert_eq!(res.message.as_deref(), Some("Đã nạp thành công 2/2 bài hát."));
}

#[tokio::test]
async fn a_delete_waits_for_a_local_reingest_so_it_cannot_resurrect_the_track() {
    let lib = library();
    let song = lib.dir.path().join("long.wav");
    ffmpeg(&["-f", "lavfi", "-i", "anoisesrc=d=900:a=0.2", "-ac", "1", "-ar", "8000", song.to_str().unwrap()]);
    let id = lib.ingest.ingest_local_file(song.to_str().unwrap(), None).await.tracks.unwrap()[0].id.clone();

    let reingest = tokio::spawn({
        let ingest = lib.ingest.clone();
        let path = song.to_string_lossy().to_string();
        async move { ingest.ingest_local_file(&path, None).await }
    });
    while !lib.ingest.is_ingesting_track(&id) {
        tokio::task::yield_now().await;
    }
    lib.ingest.cancel_download_if_active(&id).await;
    assert!(!lib.ingest.is_ingesting_track(&id), "cancel returns only once the reingest settled");
    lib.db.delete_track(&id).unwrap();
    let res = reingest.await.unwrap();
    assert!(!res.success);

    assert!(lib.db.get_track(&id).unwrap().is_none());
}

#[tokio::test]
async fn new_ingests_are_refused_while_paused() {
    let lib = library();
    let song = tone(&lib.dir.path().join("song.wav"), 1);
    let pause = lib.ingest.pause();

    let local = lib.ingest.ingest_local_file(song.to_str().unwrap(), None).await;
    let youtube = lib.ingest.ingest_youtube_url("https://www.youtube.com/watch?v=dQw4w9WgXcQ").await;

    assert_eq!(local.message.as_deref(), Some(INGEST_PAUSED_MESSAGE));
    assert_eq!(youtube.message.as_deref(), Some(INGEST_PAUSED_MESSAGE));
    drop(pause);
    assert!(lib.ingest.ingest_local_file(song.to_str().unwrap(), None).await.success);
}

// --- retries ---

fn errored_track(db: &Db, id: &str, source_type: &str, source_uri: &str) {
    db.create_track(&NewTrack {
        id: id.into(),
        source_type: source_type.into(),
        source_uri: source_uri.into(),
        title: id.into(),
        duration: 100.0,
        status: Some("error".into()),
        error_message: Some("Network failure".into()),
        ..Default::default()
    })
    .unwrap();
}

#[tokio::test]
async fn requeue_puts_errored_tracks_back_in_the_queue() {
    let lib = library_with(|i| i.with_ytdlp("/nonexistent/yt-dlp"));
    assert_eq!(lib.ingest.requeue_error_tracks(None), 0);
    errored_track(&lib.db, "yt_req_1", "youtube", "https://www.youtube.com/watch?v=req1");
    errored_track(&lib.db, "yt_req_2", "youtube", "https://www.youtube.com/watch?v=req2");

    assert_eq!(lib.ingest.requeue_error_tracks(None), 2);

    // Checked before the worker task first runs (single-threaded test runtime)
    for id in ["yt_req_1", "yt_req_2"] {
        let track = lib.db.get_track(id).unwrap().unwrap();
        assert_eq!(track.status, "queued");
        assert_eq!(track.error_message, None);
    }
    assert_eq!(lib.ingest.download_queue_order(), vec!["yt_req_1".to_string(), "yt_req_2".to_string()]);
    lib.ingest.abort().await;
}

#[tokio::test]
async fn requeue_only_touches_the_given_tracks() {
    let lib = library_with(|i| i.with_ytdlp("/nonexistent/yt-dlp"));
    errored_track(&lib.db, "yt_spec_1", "youtube", "https://www.youtube.com/watch?v=spec1");
    errored_track(&lib.db, "yt_spec_2", "youtube", "https://www.youtube.com/watch?v=spec2");

    assert_eq!(lib.ingest.requeue_error_tracks(Some(&[])), 0);
    assert_eq!(lib.ingest.requeue_error_tracks(Some(&["yt_spec_1".to_string()])), 1);

    assert_eq!(lib.db.get_track("yt_spec_1").unwrap().unwrap().status, "queued");
    assert_eq!(lib.db.get_track("yt_spec_2").unwrap().unwrap().status, "error");
    lib.ingest.abort().await;
}

#[tokio::test]
async fn requeueing_a_local_track_whose_file_is_gone_marks_it_errored_again() {
    let lib = library();
    errored_track(&lib.db, "local_missing_1", "local", "./data/non_existent_file.mp3");

    assert_eq!(lib.ingest.requeue_error_tracks(Some(&["local_missing_1".to_string()])), 1);

    let track = wait_for_status(&lib.db, "local_missing_1", "error").await;
    assert!(track.error_message.unwrap().contains("không tồn tại"));
}

// --- YouTube with a scripted yt-dlp ---

#[cfg(unix)]
mod youtube {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    /// A stand-in yt-dlp: `-J` prints `meta`, a download runs `download` with $OUT = the output
    /// path without its `.%(ext)s`, and every call's arguments are appended to calls.log
    fn fake_ytdlp(dir: &Path, meta: &Value, download: &str) -> PathBuf {
        let meta_path = dir.join("meta.json");
        std::fs::write(&meta_path, meta.to_string()).unwrap();
        let script = dir.join("yt-dlp");
        std::fs::write(
            &script,
            format!(
                "#!/bin/sh\necho \"$@\" >> '{log}'\nfor a in \"$@\"; do case \"$a\" in -J) mode=meta;; *player_client=mweb*) fallback=1;; esac; done\n\
                 if [ \"$mode\" = meta ]; then cat '{meta}'; exit 0; fi\n\
                 while [ $# -gt 0 ]; do if [ \"$1\" = \"-o\" ]; then out=\"$2\"; fi; shift; done\n\
                 OUT=$(printf '%s' \"$out\" | sed 's/\\.%(ext)s$//')\n{download}\n",
                log = dir.join("calls.log").display(),
                meta = meta_path.display(),
            ),
        )
        .unwrap();
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
        script
    }

    fn opus_fixture(dir: &Path) -> PathBuf {
        let path = dir.join("fixture.opus");
        ffmpeg(&["-f", "lavfi", "-i", "sine=f=440:d=3", "-c:a", "libopus", path.to_str().unwrap()]);
        path
    }

    fn video(id: &str, title: &str, duration: f64) -> Value {
        json!({ "id": id, "title": title, "uploader": "Channel", "duration": duration })
    }

    #[tokio::test]
    async fn a_video_is_queued_downloaded_and_becomes_ready_with_waveform_and_loudness() {
        let tools = TempDir::new().unwrap();
        let fixture = opus_fixture(tools.path());
        let script = fake_ytdlp(tools.path(), &video("vid00000001", "A Song", 3.0), &format!("cp '{}' \"$OUT.opus\"", fixture.display()));
        let lib = library_with(|i| i.with_ytdlp(&script));

        let res = lib.ingest.ingest_youtube_url("youtube.com/watch?v=vid00000001").await;

        assert!(res.success, "{res:?}");
        assert_eq!(res.message.as_deref(), Some("Đã nạp thành công bài hát vào hàng đợi tải."));
        let queued = &res.tracks.unwrap()[0];
        assert_eq!((queued.id.as_str(), queued.status.as_str()), ("yt_vid00000001", "queued"));
        assert_eq!(queued.thumbnail_url, "https://i.ytimg.com/vi/vid00000001/maxresdefault.jpg");
        let ready = wait_for_status(&lib.db, "yt_vid00000001", "ready").await;
        assert!(ready.file_path.unwrap().ends_with("yt_vid00000001.opus"));
        assert!((ready.duration - 3.0).abs() < 0.2);
        assert!(ready.peaks_json.is_some() && ready.loudness.is_some() && ready.true_peak.is_some());
    }

    #[tokio::test]
    async fn a_failed_download_records_yt_dlps_error_line() {
        let tools = TempDir::new().unwrap();
        let script = fake_ytdlp(
            tools.path(),
            &video("vid00000002", "Broken", 60.0),
            "echo 'WARNING: something' >&2; echo 'ERROR: [youtube] vid00000002: Video unavailable' >&2; exit 1",
        );
        let lib = library_with(|i| i.with_ytdlp(&script));

        assert!(lib.ingest.ingest_youtube_url("https://www.youtube.com/watch?v=vid00000002").await.success);

        let track = wait_for_status(&lib.db, "yt_vid00000002", "error").await;
        assert_eq!(track.error_message.as_deref(), Some("yt-dlp: ERROR: [youtube] vid00000002: Video unavailable"));
    }

    #[tokio::test]
    async fn a_bot_challenge_is_retried_with_the_fallback_client() {
        let tools = TempDir::new().unwrap();
        let fixture = opus_fixture(tools.path());
        let script = fake_ytdlp(
            tools.path(),
            &video("vid00000003", "Retry", 3.0),
            &format!(
                "if [ -z \"$fallback\" ]; then echo \"ERROR: Sign in to confirm you're not a bot\" >&2; exit 1; fi\ncp '{}' \"$OUT.opus\"",
                fixture.display()
            ),
        );
        let lib = library_with(|i| i.with_ytdlp(&script));

        assert!(lib.ingest.ingest_youtube_url("https://youtu.be/vid00000003").await.success);

        wait_for_status(&lib.db, "yt_vid00000003", "ready").await;
        let calls = std::fs::read_to_string(tools.path().join("calls.log")).unwrap();
        assert_eq!(calls.lines().filter(|l| !l.contains(" -J ")).count(), 2, "{calls}");
    }

    #[tokio::test]
    async fn a_playlist_skips_private_live_and_too_long_videos() {
        let tools = TempDir::new().unwrap();
        let meta = json!({ "entries": [
            video("vid0000000a", "Good One", 100.0),
            video("vid0000000a", "Duplicate", 100.0),
            video("vid0000000b", "[Private video]", 0.0),
            { "id": "vid0000000c", "title": "Live", "is_live": true },
            video("vid0000000d", "Too Long", 4000.0),
            { "id": "bad id!", "title": "Bad" },
            video("vid0000000e", "Good Two", 200.0)
        ]});
        let script = fake_ytdlp(tools.path(), &meta, "exit 1");
        let lib = library_with(|i| i.with_ytdlp(&script));

        let res = lib.ingest.ingest_youtube_url("https://www.youtube.com/playlist?list=PL123").await;

        assert!(res.success, "{res:?}");
        let ids: Vec<String> = res.tracks.unwrap().into_iter().map(|t| t.id).collect();
        assert_eq!(ids, vec!["yt_vid0000000a", "yt_vid0000000e"]);
        assert_eq!(res.message.as_deref(), Some("Đã xử lý 2 bài hát từ playlist (2 bài được đưa vào hàng đợi tải)."));
        lib.ingest.abort().await;
    }

    #[tokio::test]
    async fn non_youtube_or_empty_urls_are_rejected_without_running_yt_dlp() {
        let tools = TempDir::new().unwrap();
        let script = fake_ytdlp(tools.path(), &json!({}), "exit 1");
        let lib = library_with(|i| i.with_ytdlp(&script));

        for url in ["https://example.com/not-youtube", "   "] {
            let res = lib.ingest.ingest_youtube_url(url).await;
            assert!(res.message.unwrap().contains("URL không hợp lệ"), "{url}");
        }
        assert!(!tools.path().join("calls.log").exists());
    }

    #[tokio::test]
    async fn cancelling_a_download_kills_yt_dlp_and_leaves_no_file() {
        let tools = TempDir::new().unwrap();
        let script = fake_ytdlp(tools.path(), &video("vid00000004", "Slow", 60.0), "echo partial > \"$OUT.opus.part\"; sleep 30");
        let lib = library_with(|i| i.with_ytdlp(&script));
        assert!(lib.ingest.ingest_youtube_url("https://www.youtube.com/watch?v=vid00000004").await.success);
        wait_for_status(&lib.db, "yt_vid00000004", "downloading").await;
        tokio::time::sleep(Duration::from_millis(300)).await;

        let started = Instant::now();
        // Returns once the download settled, which takes the full 30s sleep unless yt-dlp is killed
        lib.ingest.cancel_download_if_active("yt_vid00000004").await;

        assert!(started.elapsed() < Duration::from_secs(5), "yt-dlp was not killed ({:?})", started.elapsed());
        assert!(!lib.ingest.download_queue_order().contains(&"yt_vid00000004".to_string()));

        let leftovers: Vec<_> = std::fs::read_dir(lib.dir.path().join("data/cache/audio")).unwrap().flatten().collect();
        assert!(leftovers.is_empty(), "{leftovers:?}");
    }

    #[tokio::test]
    async fn queued_downloads_resume_on_unpause_and_cancelled_metadata_waiter_cleans_up() {
        let tools = TempDir::new().unwrap();
        let fixture = tone(&tools.path().join("fixture.wav"), 1);
        let script = fake_ytdlp(
            tools.path(),
            &video("vid00000009", "PausedThenResumed", 1.0),
            &format!("sleep 0.15\ncp {:?} \"$OUT.wav\"", fixture),
        );
        let lib = library_with(|i| i.with_ytdlp(&script));

        // 1. Two tracks queued; pause while first is downloading so second stays in queue when worker exits, then resumes on drop
        errored_track(&lib.db, "yt_vid00000008", "youtube", "https://www.youtube.com/watch?v=vid00000008");
        errored_track(&lib.db, "yt_vid00000009", "youtube", "https://www.youtube.com/watch?v=vid00000009");
        {
            let pause = lib.ingest.pause();
            assert_eq!(lib.ingest.requeue_error_tracks(None), 0);
            drop(pause);
        }
        assert_eq!(lib.ingest.requeue_error_tracks(None), 2);
        wait_for_status(&lib.db, "yt_vid00000008", "downloading").await;
        let pause = lib.ingest.pause();
        wait_for_status(&lib.db, "yt_vid00000008", "ready").await;
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert_eq!(lib.db.get_track("yt_vid00000009").unwrap().unwrap().status, "queued");
        drop(pause);
        wait_for_status(&lib.db, "yt_vid00000009", "ready").await;

        // 2. Dropping a third concurrent metadata request while waiting on the 2-slot semaphore cleans up metadata_waiting
        let slow_tools = TempDir::new().unwrap();
        let slow_meta = slow_tools.path().join("slow-yt-dlp");
        std::fs::write(
            &slow_meta,
            "#!/bin/sh\nsleep 0.25\necho 'ERROR: simulated metadata failure' >&2\nexit 1\n",
        )
        .unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&slow_meta, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        let lib2 = library_with(|i| i.with_ytdlp(&slow_meta));
        let i1 = lib2.ingest.clone();
        let i2 = lib2.ingest.clone();
        let i3 = lib2.ingest.clone();
        let t1 = tokio::spawn(async move { i1.ingest_youtube_url("https://www.youtube.com/watch?v=vid00000011").await });
        let t2 = tokio::spawn(async move { i2.ingest_youtube_url("https://www.youtube.com/watch?v=vid00000012").await });
        tokio::time::sleep(Duration::from_millis(50)).await;
        let t3 = tokio::spawn(async move { i3.ingest_youtube_url("https://www.youtube.com/watch?v=vid00000013").await });
        tokio::time::sleep(Duration::from_millis(50)).await;
        t3.abort();
        let _ = t1.await;
        let _ = t2.await;
        let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
        while lib2.ingest.is_busy() && tokio::time::Instant::now() < deadline {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        assert!(!lib2.ingest.is_busy(), "aborted metadata waiter must not leave ingest.is_busy() stuck true");
    }
}
