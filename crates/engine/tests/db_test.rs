use slice_engine::db::{get_cross_platform_basename, validate_volume, Db, LIBRARY_DB_PATH};
use slice_engine::events::EventBus;
use slice_engine::models::{
    BatchPlaylistItemInput, NewSegment, NewTrack, SegmentUpdates, TrackUpdates,
};
use std::fs;
use tempfile::TempDir;

fn open_test_db() -> (TempDir, Db) {
    let tmp = TempDir::new().unwrap();
    let db_path = tmp.path().join("test_music.db");
    let db = Db::open(&db_path, true).expect("should open test db");
    (tmp, db)
}

#[test]
fn should_create_and_retrieve_a_track() {
    let (_tmp, db) = open_test_db();
    let track = db
        .create_track(&NewTrack {
            id: "track-1".into(),
            source_type: "youtube".into(),
            source_uri: "https://youtube.com/watch?v=123".into(),
            title: "Test Track".into(),
            artist: Some("Test Artist".into()),
            duration: 180.0,
            thumbnail_url: Some("https://img.youtube.com/vi/123/0.jpg".into()),
            file_path: Some("./data/cache/audio/123.m4a".into()),
            peaks_json: Some("[0.1,0.5,0.9]".into()),
            status: Some("ready".into()),
            ..Default::default()
        })
        .unwrap();

    assert_eq!(track.id, "track-1");
    assert_eq!(track.title, "Test Track");

    let fetched = db.get_track("track-1").unwrap().expect("track should exist");
    assert_eq!(fetched.duration, 180.0);
}

#[test]
fn should_create_list_and_cascade_delete_segments() {
    let (_tmp, db) = open_test_db();
    db.create_track(&NewTrack {
        id: "track-2".into(),
        source_type: "local".into(),
        source_uri: "C:/music/test.flac".into(),
        title: "Local FLAC".into(),
        artist: Some("FLAC Artist".into()),
        duration: 240.0,
        status: Some("ready".into()),
        ..Default::default()
    })
    .unwrap();

    db.create_segment(&NewSegment {
        id: "seg-1".into(),
        track_id: "track-2".into(),
        name: "Intro Hook".into(),
        start_time: 15.5,
        end_time: 30.0,
        color: Some("#4385BE".into()),
        sort_order: None,
    })
    .unwrap();

    db.create_segment(&NewSegment {
        id: "seg-2".into(),
        track_id: "track-2".into(),
        name: "Guitar Solo".into(),
        start_time: 120.0,
        end_time: 150.0,
        color: Some("#879A39".into()),
        sort_order: None,
    })
    .unwrap();

    let segments = db.list_segments_by_track("track-2").unwrap();
    assert_eq!(segments.len(), 2);
    assert_eq!(segments[0].name, "Intro Hook");
    assert_eq!(segments[1].name, "Guitar Solo");

    db.update_segment(
        "seg-1",
        &SegmentUpdates {
            name: Some("Intro Hook Updated".into()),
            end_time: Some(32.5),
            ..Default::default()
        },
    )
    .unwrap();

    let updated = db.list_segments_by_track("track-2").unwrap();
    let seg1 = updated.iter().find(|s| s.id == "seg-1").unwrap();
    assert_eq!(seg1.name, "Intro Hook Updated");
    assert_eq!(seg1.end_time, 32.5);

    db.delete_track("track-2").unwrap();
    assert!(db.list_segments_by_track("track-2").unwrap().is_empty());
}

#[test]
fn should_persist_and_update_per_track_volume_and_loudness_reset() {
    let (_tmp, db) = open_test_db();
    let track = db
        .create_track(&NewTrack {
            id: "track-vol".into(),
            source_type: "youtube".into(),
            source_uri: "https://youtube.com/watch?v=vol".into(),
            title: "Volume Test".into(),
            duration: 120.0,
            status: Some("ready".into()),
            volume: Some(0.45),
            ..Default::default()
        })
        .unwrap();

    assert_eq!(track.volume, 0.45);
    db.update_track(
        "track-vol",
        &TrackUpdates {
            volume: Some(0.25),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(db.get_track("track-vol").unwrap().unwrap().volume, 0.25);

    let default_track = db
        .create_track(&NewTrack {
            id: "track-default-vol".into(),
            source_type: "youtube".into(),
            source_uri: "https://youtube.com/watch?v=def".into(),
            title: "Default Volume Test".into(),
            duration: 60.0,
            status: Some("ready".into()),
            ..Default::default()
        })
        .unwrap();
    assert_eq!(default_track.volume, 0.5);

    // Clamping on update
    db.update_track(
        "track-vol",
        &TrackUpdates {
            volume: Some(1.5),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(db.get_track("track-vol").unwrap().unwrap().volume, 1.0);

    db.update_track(
        "track-vol",
        &TrackUpdates {
            volume: Some(-0.5),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(db.get_track("track-vol").unwrap().unwrap().volume, 0.0);

    // Set loudness and verify file_path update resets loudness unless explicitly provided
    db.set_track_loudness("track-vol", -14.2, -1.1).unwrap();
    let with_loudness = db.get_track("track-vol").unwrap().unwrap();
    assert_eq!(with_loudness.loudness, Some(-14.2));
    assert_eq!(with_loudness.true_peak, Some(-1.1));

    // Changing file_path alone resets loudness and true_peak to None
    db.update_track(
        "track-vol",
        &TrackUpdates {
            file_path: Some(Some("/tmp/new.opus".into())),
            ..Default::default()
        },
    )
    .unwrap();
    let after_path_change = db.get_track("track-vol").unwrap().unwrap();
    assert_eq!(after_path_change.loudness, None);
    assert_eq!(after_path_change.true_peak, None);

    // Changing file_path WITH explicit loudness/true_peak preserves the new values (single-pass ingest)
    db.update_track(
        "track-vol",
        &TrackUpdates {
            file_path: Some(Some("/tmp/newer.opus".into())),
            loudness: Some(Some(-12.5)),
            true_peak: Some(Some(-0.4)),
            ..Default::default()
        },
    )
    .unwrap();
    let after_single_pass = db.get_track("track-vol").unwrap().unwrap();
    assert_eq!(after_single_pass.loudness, Some(-12.5));
    assert_eq!(after_single_pass.true_peak, Some(-0.4));
}

#[test]
fn should_validate_volume_boundaries() {
    assert!(validate_volume(0.5));
    assert!(validate_volume(0.0));
    assert!(validate_volume(1.0));
    assert!(!validate_volume(-0.1));
    assert!(!validate_volume(1.01));
    assert!(!validate_volume(f64::NAN));
    assert!(!validate_volume(f64::INFINITY));
    assert!(!validate_volume(f64::NEG_INFINITY));
}

#[test]
fn should_run_migrations_v1_through_v11_and_upgrade_legacy_volume_and_sqp_thumbs() {
    let tmp = TempDir::new().unwrap();
    let db_path = tmp.path().join("legacy.db");
    {
        let db = Db::open(&db_path, true).unwrap();
        db.with_conn(|conn| {
            conn.execute(
                "INSERT OR REPLACE INTO tracks (id, source_type, source_uri, title, duration, volume, thumbnail_url)
                 VALUES ('yt_dQw4w9WgXcQ', 'youtube', 'https://youtube.com', 'Legacy', 100, 0.8, 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg?sqp=-oaymwEcCNACELwBSFXyq4qpAw4IARUAAIhCGAFwAcABBg==')",
                [],
            )
            .unwrap();
            conn.execute(
                "INSERT OR REPLACE INTO tracks (id, source_type, source_uri, title, duration, volume)
                 VALUES ('custom-v1-track', 'youtube', 'https://youtube.com', 'Custom', 100, 0.9)",
                [],
            )
            .unwrap();
            conn.execute_batch("PRAGMA user_version = 0;").unwrap();
        });
    }

    let db = Db::open(&db_path, true).unwrap();
    let legacy = db.get_track("yt_dQw4w9WgXcQ").unwrap().unwrap();
    assert_eq!(legacy.volume, 0.5);
    assert_eq!(
        legacy.thumbnail_url,
        "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg"
    );

    let custom = db.get_track("custom-v1-track").unwrap().unwrap();
    assert_eq!(custom.volume, 0.9);
    assert_eq!(db.user_version().unwrap(), 11);
}

#[test]
fn playlist_crud_items_batch_ordering_and_cover_mosaic() {
    let (_tmp, db) = open_test_db();
    assert!(db.create_playlist("   ", None, None).is_err());

    let pl = db.create_playlist("Mosaic", None, None).unwrap();
    assert!(pl.id.starts_with("pl_"));
    assert_eq!(pl.item_count, Some(0));
    assert!(!pl.is_custom_ordered);

    for id in ["m1", "m2", "m3", "m4", "m5"] {
        db.create_track(&NewTrack {
            id: id.into(),
            source_type: "local".into(),
            source_uri: format!("local://{id}"),
            title: id.into(),
            duration: 100.0,
            thumbnail_url: Some(format!("https://img/{id}.jpg")),
            status: Some("ready".into()),
            ..Default::default()
        })
        .unwrap();
    }
    db.create_track(&NewTrack {
        id: "m-nothumb".into(),
        source_type: "local".into(),
        source_uri: "local://m-nothumb".into(),
        title: "m-nothumb".into(),
        duration: 100.0,
        thumbnail_url: Some(String::new()),
        status: Some("ready".into()),
        ..Default::default()
    })
    .unwrap();

    let mut item_ids = Vec::new();
    for id in ["m1", "m2", "m3", "m4", "m5"] {
        item_ids.push(db.add_playlist_item(&pl.id, id, None).unwrap().id);
    }
    let no_thumb_item = db.add_playlist_item(&pl.id, "m-nothumb", None).unwrap();
    db.create_segment(&NewSegment {
        id: "m1-slice".into(),
        track_id: "m1".into(),
        name: "Chorus".into(),
        start_time: 0.0,
        end_time: 10.0,
        color: None,
        sort_order: None,
    })
    .unwrap();
    let slice_item = db.add_playlist_item(&pl.id, "m1", Some("m1-slice")).unwrap();

    // Idempotent duplicate add
    let dup = db.add_playlist_item(&pl.id, "m1", Some("m1-slice")).unwrap();
    assert_eq!(dup.id, slice_item.id);

    let reordered_ids = vec![
        no_thumb_item.id,
        item_ids[0].clone(),
        slice_item.id,
        item_ids[1].clone(),
        item_ids[2].clone(),
        item_ids[3].clone(),
        item_ids[4].clone(),
    ];
    assert!(db.reorder_playlist_items(&pl.id, &reordered_ids).unwrap());

    let listed = db
        .list_playlists()
        .unwrap()
        .into_iter()
        .find(|p| p.id == pl.id)
        .unwrap();
    assert_eq!(
        listed.mosaic_urls,
        Some(vec![
            "https://img/m1.jpg".into(),
            "https://img/m2.jpg".into(),
            "https://img/m3.jpg".into(),
            "https://img/m4.jpg".into(),
        ])
    );

    // Cover art tests
    let updated_cover = db.set_playlist_cover(&pl.id, Some("m2")).unwrap().unwrap();
    assert_eq!(updated_cover.cover_track_id, Some("m2".into()));
    let listed_with_cover = db
        .list_playlists()
        .unwrap()
        .into_iter()
        .find(|p| p.id == pl.id)
        .unwrap();
    assert_eq!(
        listed_with_cover.cover_url,
        Some("https://img/m2.jpg".into())
    );

    // Outsider track rejected
    db.create_track(&NewTrack {
        id: "outsider".into(),
        source_type: "local".into(),
        source_uri: "local://outsider".into(),
        title: "outsider".into(),
        duration: 100.0,
        thumbnail_url: Some("https://img/outsider.jpg".into()),
        status: Some("ready".into()),
        ..Default::default()
    })
    .unwrap();
    assert!(db.set_playlist_cover(&pl.id, Some("outsider")).is_err());

    // Batch operations and memberships
    let pl_batch = db.create_playlist("Batch PL", None, None).unwrap();
    let batch_added = db
        .add_playlist_items_batch(
            &pl_batch.id,
            &[
                BatchPlaylistItemInput {
                    track_id: "m1".into(),
                    segment_id: None,
                },
                BatchPlaylistItemInput {
                    track_id: "m2".into(),
                    segment_id: None,
                },
                BatchPlaylistItemInput {
                    track_id: "m1".into(),
                    segment_id: None,
                },
            ],
        )
        .unwrap();
    assert_eq!(batch_added.len(), 3);
    assert_eq!(db.get_playlist_items(&pl_batch.id).unwrap().len(), 2);

    let memberships_all = db.get_playlist_memberships("m1", None, true).unwrap();
    assert_eq!(memberships_all.len(), 2);
}

#[test]
fn library_database_guard_refuses_to_open_library_database_in_test_mode() {
    let err = Db::open(LIBRARY_DB_PATH, true).err().expect("must refuse library db");
    assert!(err.contains("library database"));
}

#[test]
fn self_healing_and_portable_track_paths() {
    let tmp = TempDir::new().unwrap();
    let db_path = tmp.path().join("portable.db");
    let audio_dir = tmp.path().join("audio");
    fs::create_dir_all(&audio_dir).unwrap();

    let db = Db::open(&db_path, true).unwrap();
    let fake_old_path = "C:\\OtherUser\\OldFolder\\data\\cache\\audio\\yt_abc123.opus";
    let actual_local = audio_dir.join("yt_abc123.opus");
    fs::write(&actual_local, b"dummy audio bytes").unwrap();

    db.create_track(&NewTrack {
        id: "track_test_heal".into(),
        source_type: "youtube".into(),
        source_uri: "https://youtube.com/watch?v=abc123".into(),
        title: "Cross Machine Song".into(),
        artist: Some("Test".into()),
        duration: 120.0,
        file_path: Some(fake_old_path.into()),
        status: Some("ready".into()),
        ..Default::default()
    })
    .unwrap();

    let healed = db.heal_track_file_paths(&audio_dir).unwrap();
    assert_eq!(healed, 1);

    let after = db.get_track("track_test_heal").unwrap().unwrap();
    assert_eq!(
        after.file_path.as_deref(),
        Some(actual_local.canonicalize().unwrap().to_str().unwrap())
    );

    assert_eq!(
        get_cross_platform_basename("C:\\Users\\admin\\song.mp3"),
        "song.mp3"
    );
    assert_eq!(
        get_cross_platform_basename("/home/user/music/song.opus"),
        "song.opus"
    );
    assert_eq!(
        get_cross_platform_basename("C:/Users/admin\\mixed/path\\song.wav"),
        "song.wav"
    );
    assert_eq!(
        get_cross_platform_basename("direct_song.flac"),
        "direct_song.flac"
    );
    assert_eq!(get_cross_platform_basename(""), "");
}

#[test]
fn recover_incomplete_ingests_marks_queued_and_downloading_as_error_without_deleting() {
    let tmp = TempDir::new().unwrap();
    let db_path = tmp.path().join("recover.db");
    let audio_dir = tmp.path().join("audio");
    fs::create_dir_all(&audio_dir).unwrap();

    let db = Db::open(&db_path, true).unwrap();
    db.create_track(&NewTrack {
        id: "yt_queued1".into(),
        source_type: "youtube".into(),
        source_uri: "https://youtube.com/watch?v=q1".into(),
        title: "Queued Song".into(),
        duration: 100.0,
        status: Some("queued".into()),
        ..Default::default()
    })
    .unwrap();
    db.create_track(&NewTrack {
        id: "yt_dl1".into(),
        source_type: "youtube".into(),
        source_uri: "https://youtube.com/watch?v=d1".into(),
        title: "Downloading Song".into(),
        duration: 100.0,
        status: Some("downloading".into()),
        ..Default::default()
    })
    .unwrap();

    let partial_file = audio_dir.join("yt_dl1.opus.part");
    fs::write(&partial_file, b"part").unwrap();

    let bus = EventBus::new();
    let updated_ids = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
    let ids_clone = updated_ids.clone();
    bus.on("track_updated", move |payload| {
        if let Some(id) = payload.get("trackId").and_then(|v| v.as_str()) {
            ids_clone.lock().unwrap().push(id.to_string());
        }
    });

    db.recover_incomplete_ingests(&audio_dir, &bus).unwrap();

    assert!(!partial_file.exists());
    let q1 = db.get_track("yt_queued1").unwrap().expect("must not delete queued row");
    assert_eq!(q1.status, "error");
    assert_eq!(
        q1.error_message.as_deref(),
        Some("Tải bài hát bị gián đoạn do máy chủ khởi động lại. Vui lòng bấm Thử lại (Retry).")
    );
    let d1 = db.get_track("yt_dl1").unwrap().expect("must not delete downloading row");
    assert_eq!(d1.status, "error");

    let emitted = updated_ids.lock().unwrap().clone();
    assert!(emitted.contains(&"yt_queued1".to_string()));
    assert!(emitted.contains(&"yt_dl1".to_string()));
}
