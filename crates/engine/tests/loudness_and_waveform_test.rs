use serde_json::Value;
use slice_engine::audio_analysis::{
    analyze_audio_file, cancel_waveform_for_file, generate_peaks, measure_loudness, LoudnessWorker,
    ANALYSIS_CANCELLED,
};
use slice_engine::db::Db;
use slice_engine::events::EventBus;
use slice_engine::models::{NewTrack, TrackUpdates};
use std::path::{Path, PathBuf};
use std::pin::pin;
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tempfile::TempDir;

fn ffmpeg(args: &[&str]) {
    let status = Command::new("ffmpeg")
        .args(["-v", "error", "-y"])
        .args(args)
        .status()
        .expect("ffmpeg must be installed");
    assert!(status.success(), "ffmpeg {args:?} failed");
}

// A 1kHz tone at the given amplitude, as a lossy file like the library's downloads (loudness.test.ts)
fn make_opus_tone(dir: &Path, name: &str, amplitude: f64) -> PathBuf {
    let out = dir.join(format!("{name}.opus"));
    ffmpeg(&[
        "-f", "lavfi", "-i", &format!("aevalsrc={amplitude}*sin(2*PI*1000*t):d=4"),
        "-c:a", "libopus", out.to_str().unwrap(),
    ]);
    out
}

/// What loudness.ts stored: the summary of `ffmpeg -af ebur128=peak=true:framelog=quiet`
fn legacy_ffmpeg_loudness(path: &Path) -> (f64, f64) {
    let out = Command::new("ffmpeg")
        .args(["-nostats", "-hide_banner", "-i", path.to_str().unwrap(), "-map", "0:a:0"])
        .args(["-af", "ebur128=peak=true:framelog=quiet", "-f", "null", "-"])
        .output()
        .unwrap();
    let stderr = String::from_utf8_lossy(&out.stderr);
    let summary = &stderr[stderr.rfind("Summary:").expect("ebur128 summary")..];
    let number_after = |label: &str| -> f64 {
        let rest = &summary[summary.find(label).unwrap() + label.len()..];
        rest.split_whitespace().next().unwrap().parse().unwrap()
    };
    (number_after("I:"), number_after("Peak:"))
}

#[tokio::test]
async fn half_the_amplitude_is_6_db_quieter_in_loudness_and_true_peak() {
    let dir = TempDir::new().unwrap();
    let loud_path = make_opus_tone(dir.path(), "loud", 0.5);
    let quiet_path = make_opus_tone(dir.path(), "quiet", 0.25);

    let (loud, quiet) = tokio::join!(measure_loudness(&loud_path), measure_loudness(&quiet_path));
    let (loud, quiet) = (loud.unwrap(), quiet.unwrap());

    assert!((loud.loudness - quiet.loudness - 6.0).abs() < 0.6, "loud={loud:?} quiet={quiet:?}");
    assert!((loud.true_peak - (-6.0)).abs() < 0.7, "loud true peak {}", loud.true_peak);
    assert!((quiet.true_peak - (-12.0)).abs() < 0.7, "quiet true peak {}", quiet.true_peak);
}

#[tokio::test]
async fn native_measurement_matches_the_legacy_ffmpeg_values_for_mono_and_stereo() {
    let dir = TempDir::new().unwrap();
    // Mono MP3 at 44.1kHz (ffmpeg resamples it to 48kHz for ebur128) and stereo Opus with unequal channels
    let mono = dir.path().join("mono.mp3");
    ffmpeg(&[
        "-f", "lavfi", "-i", "anoisesrc=d=8:c=pink:a=0.3:seed=7",
        "-ac", "1", "-ar", "44100", "-c:a", "libmp3lame", "-b:a", "192k", mono.to_str().unwrap(),
    ]);
    let stereo = dir.path().join("stereo.opus");
    ffmpeg(&[
        "-f", "lavfi", "-i", "aevalsrc=0.6*sin(2*PI*220*t)|0.2*sin(2*PI*3000*t):d=8",
        "-c:a", "libopus", stereo.to_str().unwrap(),
    ]);

    for path in [&mono, &stereo] {
        let native = measure_loudness(path).await.expect("measurable");
        let (legacy_i, legacy_peak) = legacy_ffmpeg_loudness(path);

        assert!(
            (native.loudness - legacy_i).abs() <= 0.1,
            "{}: native I {} vs ffmpeg {legacy_i}",
            path.display(),
            native.loudness
        );
        assert!(
            (native.true_peak - legacy_peak).abs() <= 0.2,
            "{}: native peak {} vs ffmpeg {legacy_peak}",
            path.display(),
            native.true_peak
        );
    }
}

#[tokio::test]
async fn falls_back_to_ffmpeg_for_a_codec_symphonia_cannot_decode() {
    let dir = TempDir::new().unwrap();
    let ac3 = dir.path().join("tone.ac3");
    ffmpeg(&[
        "-f", "lavfi", "-i", "aevalsrc=0.5*sin(2*PI*440*t):d=4",
        "-c:a", "ac3", ac3.to_str().unwrap(),
    ]);

    let result = analyze_audio_file(&ac3, 1000).await.unwrap();

    let loudness = result.loudness.expect("measured through the ffmpeg fallback");
    let (legacy_i, _) = legacy_ffmpeg_loudness(&ac3);
    assert!((loudness.loudness - legacy_i).abs() <= 0.1, "fallback I {} vs ffmpeg {legacy_i}", loudness.loudness);
    assert!(result.peaks.iter().any(|&p| p > 0.3), "fallback peaks should follow the tone");
}

#[tokio::test]
async fn waveform_has_1000_points_on_the_absolute_amplitude_scale() {
    let dir = TempDir::new().unwrap();
    let loud_path = make_opus_tone(dir.path(), "loud", 0.5);
    let quiet_path = make_opus_tone(dir.path(), "quiet", 0.25);

    let loud = generate_peaks(&loud_path, 1000).await.unwrap();
    let quiet = generate_peaks(&quiet_path, 1000).await.unwrap();

    assert_eq!(loud.len(), 1000);
    assert_eq!(quiet.len(), 1000);
    assert!(loud.iter().all(|&p| (0.0..=1.0).contains(&p)));
    let avg = |peaks: &[f64]| peaks.iter().sum::<f64>() / peaks.len() as f64;
    assert!(avg(&loud) > 0.35 && avg(&loud) < 0.65, "loud avg {}", avg(&loud));
    assert!(avg(&quiet) > 0.15 && avg(&quiet) < 0.35, "quiet avg {}", avg(&quiet));
}

#[tokio::test]
async fn silence_has_no_loudness_to_match() {
    let dir = TempDir::new().unwrap();
    let silent_path = make_opus_tone(dir.path(), "silent", 0.0);

    assert!(measure_loudness(&silent_path).await.is_none());
}

#[tokio::test]
async fn a_missing_file_has_no_loudness_and_no_peaks() {
    let dir = TempDir::new().unwrap();
    let missing = dir.path().join("missing.opus");

    assert!(measure_loudness(&missing).await.is_none());
    assert!(generate_peaks(&missing, 1000).await.is_err());
}

#[tokio::test]
async fn a_file_nothing_can_decode_gets_flat_placeholder_peaks() {
    let dir = TempDir::new().unwrap();
    let corrupt_path = dir.path().join("corrupt.opus");
    std::fs::write(&corrupt_path, b"not valid audio bytes").unwrap();

    let result = analyze_audio_file(&corrupt_path, 1000).await.unwrap();

    assert_eq!(result.peaks, vec![0.1; 1000]);
    assert!(result.loudness.is_none());
}

#[tokio::test]
async fn cancelling_a_file_stops_its_analysis() {
    let dir = TempDir::new().unwrap();
    let long = dir.path().join("long.wav");
    ffmpeg(&[
        "-f", "lavfi", "-i", "anoisesrc=d=900:a=0.3",
        "-ac", "1", "-ar", "8000", long.to_str().unwrap(),
    ]);
    let mut analysis = pin!(analyze_audio_file(&long, 1000));
    // The first poll registers the job and starts decoding
    assert!(tokio::time::timeout(Duration::from_millis(1), &mut analysis).await.is_err());

    cancel_waveform_for_file(long.to_str().unwrap());

    assert_eq!(analysis.await.unwrap_err(), ANALYSIS_CANCELLED);
}

fn ready_song(db: &Db, id: &str, file_path: &Path) {
    db.create_track(&NewTrack {
        id: id.into(),
        source_type: "local".into(),
        source_uri: file_path.to_string_lossy().to_string(),
        title: id.into(),
        duration: 4.0,
        file_path: Some(file_path.to_string_lossy().to_string()),
        status: Some("ready".into()),
        ..Default::default()
    })
    .unwrap();
}

#[tokio::test]
async fn measures_the_unmeasured_ready_songs_and_tells_clients_once() {
    let dir = TempDir::new().unwrap();
    let db = Db::open(dir.path().join("music.db"), true).unwrap();
    let events = EventBus::new();
    let worker = LoudnessWorker::new(db.clone(), events.clone());
    ready_song(&db, "trk_unmeasured", &make_opus_tone(dir.path(), "loud", 0.5));
    let recorded = Arc::new(Mutex::new(Vec::<Value>::new()));
    let sink = recorded.clone();
    events.on("track_updated", move |v| sink.lock().unwrap().push(v.clone()));

    worker.measure_missing_loudness().await;

    let track = db.get_track("trk_unmeasured").unwrap().unwrap();
    assert!(track.loudness.is_some());
    assert!((track.true_peak.unwrap() - (-6.0)).abs() < 0.7);
    assert_eq!(*recorded.lock().unwrap(), vec![serde_json::json!({ "reason": "loudness" })]);
}

#[tokio::test]
async fn measures_a_song_again_when_its_file_is_replaced() {
    let dir = TempDir::new().unwrap();
    let db = Db::open(dir.path().join("music.db"), true).unwrap();
    let worker = LoudnessWorker::new(db.clone(), EventBus::new());
    ready_song(&db, "trk_replaced", &make_opus_tone(dir.path(), "loud", 0.5));
    worker.measure_missing_loudness().await;

    let quiet = make_opus_tone(dir.path(), "quiet", 0.25);
    db.update_track(
        "trk_replaced",
        &TrackUpdates { file_path: Some(Some(quiet.to_string_lossy().to_string())), ..Default::default() },
    )
    .unwrap();
    assert!(db.get_track("trk_replaced").unwrap().unwrap().loudness.is_none());
    worker.measure_missing_loudness().await;

    let true_peak = db.get_track("trk_replaced").unwrap().unwrap().true_peak.unwrap();
    assert!((true_peak - (-12.0)).abs() < 0.7, "re-measured true peak {true_peak}");
}

#[tokio::test]
async fn skips_a_song_it_cannot_measure_and_finishes_the_rest() {
    let dir = TempDir::new().unwrap();
    let db = Db::open(dir.path().join("music.db"), true).unwrap();
    let worker = LoudnessWorker::new(db.clone(), EventBus::new());
    let corrupt = dir.path().join("corrupt.opus");
    std::fs::write(&corrupt, b"not audio").unwrap();
    ready_song(&db, "trk_good", &make_opus_tone(dir.path(), "loud", 0.5));
    ready_song(&db, "trk_corrupt", &corrupt);

    worker.measure_missing_loudness().await;

    assert!(db.get_track("trk_good").unwrap().unwrap().loudness.is_some());
    assert!(db.get_track("trk_corrupt").unwrap().unwrap().loudness.is_none());
}

#[tokio::test]
async fn measures_nothing_while_paused_and_catches_up_on_resume() {
    let dir = TempDir::new().unwrap();
    let db = Db::open(dir.path().join("music.db"), true).unwrap();
    let worker = LoudnessWorker::new(db.clone(), EventBus::new());
    ready_song(&db, "trk_waiting", &make_opus_tone(dir.path(), "loud", 0.5));

    let resume = worker.pause();
    worker.measure_missing_loudness().await;
    assert!(db.get_track("trk_waiting").unwrap().unwrap().loudness.is_none());

    resume();
    let measured = tokio::time::timeout(Duration::from_secs(10), async {
        while db.get_track("trk_waiting").unwrap().unwrap().loudness.is_none() {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await;
    assert!(measured.is_ok(), "resume should start measuring the backlog");
}
