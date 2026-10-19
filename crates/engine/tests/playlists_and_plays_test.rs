use rusqlite::params;
use serde_json::{json, Value};
use slice_engine::db::{parse_play_record, Db};
use slice_engine::events::EventBus;
use slice_engine::http::{build_router, AppState};
use slice_engine::models::{BatchPlaylistItemInput, NewSegment, NewTrack, PlayRecord};
use slice_engine::EngineConfig;
use tempfile::TempDir;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

fn temp_db() -> (Db, TempDir) {
    let dir = TempDir::new().unwrap();
    let db_path = dir.path().join("test.db");
    let db = Db::open(&db_path, true).unwrap();
    (db, dir)
}

fn add_track(db: &Db, id: &str, title: &str) {
    db.create_track(&NewTrack {
        id: id.into(),
        source_type: "local".into(),
        source_uri: format!("C:/music/{id}.mp3"),
        title: title.into(),
        artist: Some(String::new()),
        duration: 120.0,
        thumbnail_url: Some(format!("https://img.test/{id}.jpg")),
        status: Some("ready".into()),
        ..Default::default()
    })
    .unwrap();
}

#[test]
fn test_mix_playlists_full_parity() {
    let (db, _dir) = temp_db();
    for n in 1..=7 {
        add_track(&db, &format!("t{n}"), &format!("Song {n}"));
    }

    let a = db.create_playlist("A", None, None).unwrap();
    let b = db.create_playlist("B", None, None).unwrap();
    let c = db.create_playlist("C", None, None).unwrap();

    // 1. Remembers sources in chosen order
    let mix = db
        .create_mix_playlist("A + B", &[b.id.clone(), a.id.clone()])
        .unwrap();
    let fetched = db.get_playlist(&mix.id).unwrap().unwrap();
    assert_eq!(fetched.is_mix, Some(true));
    assert_eq!(fetched.source_ids, Some(vec![b.id.clone(), a.id.clone()]));

    // 2. Lists items of first source then second, deduplicating by (track_id, segment_id)
    db.set_mix_sources(&mix.id, &[a.id.clone(), b.id.clone()])
        .unwrap();
    db.add_playlist_items_batch(
        &a.id,
        &[
            BatchPlaylistItemInput {
                track_id: "t1".into(),
                segment_id: None,
            },
            BatchPlaylistItemInput {
                track_id: "t2".into(),
                segment_id: None,
            },
        ],
    )
    .unwrap();
    db.add_playlist_items_batch(
        &b.id,
        &[
            BatchPlaylistItemInput {
                track_id: "t1".into(),
                segment_id: None,
            },
            BatchPlaylistItemInput {
                track_id: "t3".into(),
                segment_id: None,
            },
        ],
    )
    .unwrap();

    let items = db.get_playlist_items(&mix.id).unwrap();
    let titles: Vec<&str> = items.iter().map(|i| i.track.title.as_str()).collect();
    assert_eq!(titles, vec!["Song 1", "Song 2", "Song 3"]);
    assert_eq!(items[0].playlist_id, a.id);

    // 3. Slice and full track treated as distinct
    let seg = db
        .create_segment(&NewSegment {
            id: "s1".into(),
            track_id: "t1".into(),
            name: "Chorus".into(),
            start_time: 10.0,
            end_time: 20.0,
            color: None,
            sort_order: None,
        })
        .unwrap();
    db.add_playlist_item(&b.id, "t1", Some(&seg.id)).unwrap();
    assert_eq!(db.get_playlist_items(&mix.id).unwrap().len(), 4);

    // 4. Rejects < 2 distinct sources, unknown source, or mix source
    assert!(db
        .create_mix_playlist("Solo", std::slice::from_ref(&a.id))
        .is_err());
    assert!(db
        .create_mix_playlist("Dup", &[a.id.clone(), a.id.clone()])
        .is_err());
    assert!(db
        .create_mix_playlist("Ghost", &[a.id.clone(), "missing".into()])
        .unwrap_err()
        .contains("not found"));
    assert!(db
        .create_mix_playlist("Nested", &[mix.id.clone(), c.id.clone()])
        .unwrap_err()
        .contains("mix"));

    // 5. Refuses to store items directly in a mix
    assert!(db
        .add_playlist_item(&mix.id, "t4", None)
        .unwrap_err()
        .contains("mix"));

    // 6. Reports item_count, source_ids, mosaic_urls, and cover_url in list_playlists
    db.set_playlist_cover(&mix.id, Some("t3")).unwrap();
    let listed = db
        .list_playlists()
        .unwrap()
        .into_iter()
        .find(|p| p.id == mix.id)
        .unwrap();
    assert_eq!(listed.item_count, Some(4));
    assert_eq!(
        listed.cover_url.as_deref(),
        Some("https://img.test/t3.jpg")
    );
    assert_eq!(
        listed.mosaic_urls,
        Some(vec![
            "https://img.test/t1.jpg".into(),
            "https://img.test/t2.jpg".into(),
            "https://img.test/t3.jpg".into(),
        ])
    );

    // 7. Drops deleted source while keeping mix and remaining sources
    db.delete_playlist(&a.id, false).unwrap();
    assert_eq!(
        db.get_playlist(&mix.id).unwrap().unwrap().source_ids,
        Some(vec![b.id.clone()])
    );
}

#[test]
fn test_sub_playlists_full_parity() {
    let (db, _dir) = temp_db();
    add_track(&db, "t1", "Song 1");
    add_track(&db, "t2", "Song 2");

    let parent = db.create_playlist("Parent", None, None).unwrap();
    let child1 = db
        .create_playlist("Child 1", None, Some(&parent.id))
        .unwrap();
    let child2 = db
        .create_playlist("Child 2", None, Some(&parent.id))
        .unwrap();
    assert_eq!(child1.parent_id.as_deref(), Some(parent.id.as_str()));

    // 1. Strict 1-level nesting
    assert!(db
        .create_playlist("Grandchild", None, Some(&child1.id))
        .unwrap_err()
        .contains("cannot nest beyond 1 level"));

    // 2. Auto-bubbles track from child to parent without duplicating
    db.add_playlist_item(&child1.id, "t1", None).unwrap();
    db.add_playlist_item(&child2.id, "t1", None).unwrap();
    assert_eq!(db.get_playlist_items(&child1.id).unwrap().len(), 1);
    assert_eq!(db.get_playlist_items(&parent.id).unwrap().len(), 1);

    // 3. Removing item from parent cascade-deletes from child1 and child2
    let parent_item_id = db.get_playlist_items(&parent.id).unwrap()[0].id.clone();
    db.remove_playlist_item(&parent.id, &parent_item_id)
        .unwrap();
    assert!(db.get_playlist_items(&parent.id).unwrap().is_empty());
    assert!(db.get_playlist_items(&child1.id).unwrap().is_empty());
    assert!(db.get_playlist_items(&child2.id).unwrap().is_empty());

    // 4. Batch auto-bubble and batch cascade-delete
    db.add_playlist_items_batch(
        &child1.id,
        &[
            BatchPlaylistItemInput {
                track_id: "t1".into(),
                segment_id: None,
            },
            BatchPlaylistItemInput {
                track_id: "t2".into(),
                segment_id: None,
            },
        ],
    )
    .unwrap();
    let parent_items = db.get_playlist_items(&parent.id).unwrap();
    assert_eq!(parent_items.len(), 2);

    let parent_item_ids: Vec<String> = parent_items.into_iter().map(|i| i.id).collect();
    let removed = db
        .remove_playlist_items_batch(&parent.id, &parent_item_ids)
        .unwrap();
    assert_eq!(removed, 2);
    assert!(db.get_playlist_items(&child1.id).unwrap().is_empty());

    // 5. deletePlaylist with keep_children = true promotes children
    db.delete_playlist(&parent.id, true).unwrap();
    assert!(db.get_playlist(&parent.id).unwrap().is_none());
    let promoted = db.get_playlist(&child1.id).unwrap().unwrap();
    assert!(promoted.parent_id.is_none());
}

#[test]
fn test_plays_and_home_summary_parity() {
    let (db, _dir) = temp_db();
    let day = 24 * 60 * 60;
    let now = 1_800_000_000i64;

    for id in ["t1", "t2", "t3"] {
        add_track(&db, id, id);
    }
    db.create_segment(&NewSegment {
        id: "s1".into(),
        track_id: "t1".into(),
        name: "Chorus".into(),
        start_time: 10.0,
        end_time: 40.0,
        color: None,
        sort_order: None,
    })
    .unwrap();

    let road = db.create_playlist("Road", None, None).unwrap();
    let gym = db.create_playlist("Gym", None, None).unwrap();

    let record_at = |play: PlayRecord, days_ago: i64| -> bool {
        let ok = db.record_play(&play).unwrap();
        if ok {
            db.with_conn(|conn| {
                conn.execute(
                    "UPDATE plays SET played_at = ?1 WHERE id = (SELECT MAX(id) FROM plays)",
                    params![now - days_ago * day],
                )
                .unwrap();
            });
        }
        ok
    };

    record_at(
        PlayRecord {
            track_id: "t1".into(),
            segment_id: None,
            source_type: "playlist".into(),
            playlist_id: Some(road.id.clone()),
            via_home: false,
        },
        3,
    );
    record_at(
        PlayRecord {
            track_id: "t2".into(),
            segment_id: None,
            source_type: "original_only".into(),
            playlist_id: None,
            via_home: false,
        },
        2,
    );
    record_at(
        PlayRecord {
            track_id: "t1".into(),
            segment_id: Some("s1".into()),
            source_type: "playlist".into(),
            playlist_id: Some(gym.id.clone()),
            via_home: false,
        },
        1,
    );
    record_at(
        PlayRecord {
            track_id: "t2".into(),
            segment_id: None,
            source_type: "playlist".into(),
            playlist_id: Some(gym.id.clone()),
            via_home: false,
        },
        1,
    );
    // Old play > 30d ago should not count in heavy_rotation or top_playlists
    record_at(
        PlayRecord {
            track_id: "t3".into(),
            segment_id: None,
            source_type: "playlist".into(),
            playlist_id: Some(road.id.clone()),
            via_home: false,
        },
        35,
    );
    // Home play should be excluded from recently_played
    record_at(
        PlayRecord {
            track_id: "t1".into(),
            segment_id: None,
            source_type: "home".into(),
            playlist_id: None,
            via_home: true,
        },
        0,
    );

    let summary = db.get_home_summary(Some(now)).unwrap();
    assert_eq!(summary.heavy_rotation.len(), 2);
    assert_eq!(summary.heavy_rotation[0].track_id, "t1");
    assert_eq!(summary.heavy_rotation[0].plays, 3);
    assert_eq!(summary.heavy_rotation[1].track_id, "t2");
    assert_eq!(summary.heavy_rotation[1].plays, 2);

    assert_eq!(summary.top_playlists.len(), 2);
    assert_eq!(summary.top_playlists[0].playlist_id, gym.id);
    assert_eq!(summary.top_playlists[0].plays, 2);
    assert_eq!(summary.top_playlists[1].playlist_id, road.id);
    assert_eq!(summary.top_playlists[1].plays, 1);

    assert_eq!(summary.recently_played.len(), 3);
    assert_eq!(summary.recently_played[0].playlist_id, Some(gym.id.clone()));

    // parse_play_record validation
    assert!(parse_play_record(&json!({
        "track_id": "t1",
        "segment_id": "s1",
        "source_type": "playlist",
        "playlist_id": "p1",
        "via_home": true
    }))
    .is_some());
    assert!(parse_play_record(&json!({
        "track_id": "t1",
        "segment_id": null,
        "source_type": "playlist",
        "playlist_id": null,
        "via_home": false
    }))
    .is_none());
}

#[tokio::test]
async fn test_http_playlists_and_plays_endpoints() {
    let dir = TempDir::new().unwrap();
    let db_path = dir.path().join("test.db");
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let config = EngineConfig {
        db_path: db_path.clone(),
        data_dir: dir.path().join("data"),
        dist_dir: dir.path().join("dist"),
        port,
        is_production: false,
        is_test: true,
    };
    let db = Db::open(&db_path, true).unwrap();
    add_track(&db, "t1", "Song 1");
    let state = AppState::new(config, db, EventBus::new());
    let router = build_router(state);
    tokio::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });

    let send = |req: String| async move {
        let mut s = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        s.write_all(req.as_bytes()).await.unwrap();
        let mut buf = Vec::new();
        s.read_to_end(&mut buf).await.unwrap();
        let text = String::from_utf8_lossy(&buf).to_string();
        let (head, body) = text.split_once("\r\n\r\n").unwrap_or((&text, ""));
        let status = head
            .lines()
            .next()
            .unwrap_or("")
            .split_whitespace()
            .nth(1)
            .and_then(|c| c.parse::<u16>().ok())
            .unwrap_or(0);
        (status, body.to_string())
    };

    // POST /api/playlists
    let create_body = r#"{"name":"Chill"}"#;
    let (status, body) = send(format!(
        "POST /api/playlists HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{create_body}",
        create_body.len()
    ))
    .await;
    assert_eq!(status, 201);
    let pl: Value = serde_json::from_str(&body).unwrap();
    let pl_id = pl["id"].as_str().unwrap().to_string();

    // PATCH /api/playlists/:id rejecting parent_id reparenting
    let reparent_body = r#"{"parent_id":"other"}"#;
    let (status, _) = send(format!(
        "PATCH /api/playlists/{pl_id} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{reparent_body}",
        reparent_body.len()
    ))
    .await;
    assert_eq!(status, 400);

    // POST /api/plays -> 204
    let play_body = format!(
        r#"{{"track_id":"t1","segment_id":null,"source_type":"playlist","playlist_id":"{pl_id}","via_home":false}}"#
    );
    let (status, _) = send(format!(
        "POST /api/plays HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{play_body}",
        play_body.len()
    ))
    .await;
    assert_eq!(status, 204);

    // GET /api/home -> 200
    let (status, body) = send(format!(
        "GET /api/home HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n"
    ))
    .await;
    assert_eq!(status, 200);
    let home: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(home["heavy_rotation"][0]["track_id"], "t1");
}
