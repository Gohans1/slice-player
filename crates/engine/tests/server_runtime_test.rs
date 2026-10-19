//! Integration tests for `slice_engine::start_server` and runtime lifecycle (Task 9b).

use slice_engine::app_window::is_server_running;
use slice_engine::db::Db;
use slice_engine::models::NewTrack;
use slice_engine::{reanalyze_library_waveforms, start_server, EngineConfig};
use std::path::Path;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

fn write_sine_wav(path: &Path) {
    let sample_rate = 48_000u32;
    let num_samples = sample_rate as usize; // 1.0s
    let mut pcm = Vec::with_capacity(num_samples * 2);
    for i in 0..num_samples {
        let t = i as f32 / sample_rate as f32;
        let sample = ((2.0 * std::f32::consts::PI * 440.0 * t).sin() * 16_000.0) as i16;
        pcm.extend_from_slice(&sample.to_le_bytes());
    }
    let data_len = pcm.len() as u32;
    let mut wav = Vec::with_capacity(44 + pcm.len());
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&(36 + data_len).to_le_bytes());
    wav.extend_from_slice(b"WAVEfmt ");
    wav.extend_from_slice(&16u32.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes());
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

#[tokio::test]
async fn start_server_recovers_ingests_measures_loudness_serves_http_and_ws_and_shuts_down() {
    let dir = tempfile::tempdir().expect("tempdir");
    let data_dir = dir.path().join("data");
    let audio_dir = data_dir.join("cache").join("audio");
    std::fs::create_dir_all(&audio_dir).unwrap();
    let db_path = data_dir.join("music.db");

    let ready_wav = audio_dir.join("ready_song.wav");
    write_sine_wav(&ready_wav);

    // Pre-seed database with:
    // 1. An incomplete `downloading` track without audio on disk -> must become `error` on startup
    // 2. A `ready` track with `loudness: None` -> must be measured by startup loudness worker
    {
        let db = Db::open(&db_path, true).expect("open seed db");
        db.create_track(&NewTrack {
            id: "yt_stalled".into(),
            source_type: "youtube".into(),
            source_uri: "https://youtube.com/watch?v=stalled".into(),
            title: "Stalled Track".into(),
            duration: 60.0,
            status: Some("downloading".into()),
            ..Default::default()
        })
        .unwrap();

        db.create_track(&NewTrack {
            id: "loc_ready".into(),
            source_type: "local".into(),
            source_uri: ready_wav.to_string_lossy().into_owned(),
            title: "Ready Track".into(),
            duration: 1.0,
            file_path: Some(ready_wav.to_string_lossy().into_owned()),
            peaks_json: Some("[0.1,0.2]".into()),
            status: Some("ready".into()),
            ..Default::default()
        })
        .unwrap();
        db.close();
    }

    let config = EngineConfig {
        db_path: db_path.clone(),
        data_dir: data_dir.clone(),
        dist_dir: dir.path().join("dist"),
        port: 0, // Ephemeral port
        is_production: false,
        is_test: true,
    };

    let running = start_server(config.clone()).await.expect("start_server");
    let app_url = running.app_url();
    let port = running.addr.port();
    assert!(port > 0);

    // 1. `/api/tracks` responds 200 OK over real TCP
    assert!(is_server_running(&app_url).await);

    // 2. Incomplete `downloading` track was recovered to `error` on boot
    let stalled = running.state.db.get_track("yt_stalled").unwrap().unwrap();
    assert_eq!(stalled.status, "error");

    // 3. Startup loudness worker measures `loc_ready` in the background
    let mut measured = false;
    for _ in 0..40 {
        if let Some(t) = running.state.db.get_track("loc_ready").unwrap()
            && t.loudness.is_some()
            && t.true_peak.is_some()
        {
            measured = true;
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    assert!(measured, "background loudness worker should measure ready track on boot");

    // 4. WebSocket upgrade on `/ws` sends initial `connected` event and increments lifecycle tracker
    let mut ws_stream = TcpStream::connect(("127.0.0.1", port)).await.expect("connect ws");
    let ws_key = "dGhlIHNhbXBsZSBub25jZQ==";
    let upgrade_req = format!(
        "GET /ws HTTP/1.1\r\n\
         Host: 127.0.0.1:{port}\r\n\
         Upgrade: websocket\r\n\
         Connection: Upgrade\r\n\
         Sec-WebSocket-Key: {ws_key}\r\n\
         Sec-WebSocket-Version: 13\r\n\r\n"
    );
    ws_stream.write_all(upgrade_req.as_bytes()).await.unwrap();

    let mut buf = vec![0u8; 2048];
    let mut total = 0usize;
    for _ in 0..10 {
        let n = ws_stream.read(&mut buf[total..]).await.unwrap();
        total += n;
        let text = String::from_utf8_lossy(&buf[..total]);
        if text.contains("\"connected\"") {
            break;
        }
    }
    let response_str = String::from_utf8_lossy(&buf[..total]);
    assert!(response_str.starts_with("HTTP/1.1 101"), "unexpected ws response: {response_str}");
    assert!(response_str.contains("\"connected\""), "missing connected event: {response_str}");

    let tracker = running.state.ws_lifecycle.as_ref().unwrap();
    assert_eq!(tracker.active_clients(), 1);
    drop(ws_stream);

    // 5. Graceful shutdown stops the HTTP listener and closes DB
    running.shutdown().await;
    assert!(!is_server_running(&app_url).await);

    // 6. Post-cutover `reanalyze_library_waveforms` recomputes 1000-point peaks while keeping loudness
    let count = reanalyze_library_waveforms(&config).await.expect("reanalyze waveforms");
    assert_eq!(count, 1);
    let db = Db::open(&db_path, true).unwrap();
    let track = db.get_track("loc_ready").unwrap().unwrap();
    let peaks: Vec<f64> = serde_json::from_str(track.peaks_json.as_deref().unwrap()).unwrap();
    assert_eq!(peaks.len(), 1000);
    assert!(track.loudness.is_some());
}
