//! Local files and folders (`ingestLocalFile` / `ingestLocalDirectory`)

use super::video_extractor::extract_audio_from_video_with;
use super::{clean_input, file_name, round2, Ingest, IngestResult, DURATION_EPSILON_SECONDS, INGEST_PAUSED_MESSAGE, MAX_DURATION_SECONDS};
use crate::audio_analysis::{analyze_audio_file_with, CancelFlag, WAVEFORM_POINTS};
use crate::audio_source::{dotted_extension, validate_safe_local_audio_path, SUPPORTED_AUDIO_EXTENSIONS};
use crate::db::resolve_abs_path;
use crate::metadata::{read_local_metadata, save_cover_art};
use crate::models::{NewTrack, TrackUpdates};
use md5::{Digest, Md5};
use serde_json::json;
use std::path::{Path, PathBuf};

const MAX_DIR_FILES: usize = 100;

fn unsupported_extension_message(ext: &str) -> String {
    format!(
        "Định dạng file không được hỗ trợ ({}). Chỉ chấp nhận: {}",
        if ext.is_empty() { "không có phần mở rộng" } else { ext },
        SUPPORTED_AUDIO_EXTENSIONS.join(", ")
    )
}

/// `loc_` + the first 12 hex of the md5 of the absolute path (lowercased on Windows), so the same
/// file always maps to the same track
pub fn local_track_id(full_path: &Path) -> String {
    let path = full_path.to_string_lossy();
    let normalized = if cfg!(windows) { path.to_lowercase() } else { path.to_string() };
    format!("loc_{}", &format!("{:x}", Md5::digest(normalized.as_bytes()))[..12])
}

fn is_non_empty_file(path: &Path) -> bool {
    std::fs::metadata(path).map(|m| m.is_file() && m.len() > 0).unwrap_or(false)
}

impl Ingest {
    pub async fn ingest_local_file(&self, raw_path: &str, preferred_title: Option<&str>) -> IngestResult {
        let cleaned = clean_input(raw_path);
        self.log("info", &format!("Bắt đầu nạp file từ máy: {}", file_name(Path::new(cleaned))), None);

        if let Err(message) = validate_safe_local_audio_path(cleaned) {
            return IngestResult::fail(message);
        }
        let ext = dotted_extension(Path::new(cleaned));
        if !SUPPORTED_AUDIO_EXTENSIONS.contains(&ext.as_str()) {
            return IngestResult::fail(unsupported_extension_message(&ext));
        }
        let full_path = resolve_abs_path(Path::new(cleaned));
        if !full_path.is_file() {
            return IngestResult::fail(format!(
                "File không tồn tại hoặc không phải là file hợp lệ: {}",
                full_path.display()
            ));
        }

        let track_id = local_track_id(&full_path);
        let Some(operation) = self.begin_operation(Some(&track_id)) else {
            return IngestResult::fail(INGEST_PAUSED_MESSAGE);
        };
        let cancel = operation.cancel.clone();

        let mut newly_extracted: Option<PathBuf> = None;
        let result = self
            .ingest_local_file_inner(&full_path, &ext, &track_id, preferred_title, cancel, &mut newly_extracted)
            .await;
        match result {
            Ok(result) => result,
            Err(message) => {
                if let Some(path) = newly_extracted {
                    let _ = std::fs::remove_file(path);
                }
                self.log("error", &format!("Lỗi nạp file local: {message}"), None);
                IngestResult::fail(format!("Lỗi đọc file local: {message}"))
            }
        }
    }

    async fn ingest_local_file_inner(
        &self,
        full_path: &Path,
        ext: &str,
        track_id: &str,
        preferred_title: Option<&str>,
        cancel: CancelFlag,
        newly_extracted: &mut Option<PathBuf>,
    ) -> Result<IngestResult, String> {
        let meta = read_local_metadata(full_path).await;
        if cancel.is_cancelled() {
            return Err("Audio analysis cancelled".to_string());
        }
        let duration = meta.duration;
        if duration < 0.5 {
            return Ok(IngestResult::fail("Thời lượng bài hát quá ngắn (tối thiểu 0.5 giây)!"));
        }
        if duration > MAX_DURATION_SECONDS + DURATION_EPSILON_SECONDS {
            return Ok(IngestResult::fail(format!(
                "File vượt quá thời lượng tối đa 30 phút ({:.0}s > {MAX_DURATION_SECONDS}s)!",
                duration
            )));
        }

        let mut audio_path = full_path.to_path_buf();
        if ext == ".mp4" {
            let audio_dir = self.audio_dir();
            std::fs::create_dir_all(&audio_dir).map_err(|e| e.to_string())?;
            let extracted = audio_dir.join(format!("{track_id}.m4a"));
            if !is_non_empty_file(&extracted) {
                if let Err(message) = extract_audio_from_video_with(full_path, &extracted, &[&cancel]).await {
                    return Ok(IngestResult::fail(message));
                }
                *newly_extracted = Some(extracted.clone());
            }
            audio_path = extracted;
        }

        let duration = MAX_DURATION_SECONDS.min(round2(duration));
        let title = meta
            .title
            .clone()
            .or_else(|| preferred_title.map(str::trim).filter(|t| !t.is_empty()).map(str::to_string))
            .unwrap_or_else(|| full_path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default());
        let artist = meta.artist.clone().unwrap_or_else(|| "Unknown Artist".to_string());
        let thumbnail_url = meta
            .picture
            .as_deref()
            .and_then(|data| save_cover_art(track_id, data, &self.thumbs_dir()))
            .unwrap_or_default();

        // One decode for the waveform and Sound Check, stored together
        let analysis = analyze_audio_file_with(&audio_path, WAVEFORM_POINTS, cancel.clone()).await?;
        if cancel.is_cancelled() {
            return Err("Audio analysis cancelled".to_string());
        }
        let peaks_json = serde_json::to_string(&analysis.peaks).map_err(|e| e.to_string())?;
        let file_path = audio_path.to_string_lossy().to_string();
        let db = &self.inner.db;

        let track = match db.get_track(track_id)? {
            Some(existing) => {
                // A re-imported file may be shorter: slices past its end go
                self.reconcile_segments(track_id, duration);
                db.update_track(
                    track_id,
                    &TrackUpdates {
                        title: Some(title.clone()),
                        artist: Some(artist),
                        duration: Some(duration),
                        file_path: Some(Some(file_path)),
                        thumbnail_url: Some(if thumbnail_url.is_empty() { existing.thumbnail_url } else { thumbnail_url }),
                        peaks_json: Some(Some(peaks_json)),
                        status: Some("ready".into()),
                        error_message: Some(None),
                        loudness: Some(analysis.loudness.map(|l| l.loudness)),
                        true_peak: Some(analysis.loudness.map(|l| l.true_peak)),
                        ..Default::default()
                    },
                )?;
                self.emit("track_updated", json!({ "trackId": track_id }));
                db.get_track(track_id)?.ok_or("Track vanished during ingest")?
            }
            None => {
                let created = db.create_track(&NewTrack {
                    id: track_id.to_string(),
                    source_type: "local".into(),
                    source_uri: full_path.to_string_lossy().to_string(),
                    title: title.clone(),
                    artist: Some(artist),
                    duration,
                    thumbnail_url: Some(thumbnail_url),
                    file_path: Some(file_path),
                    peaks_json: Some(peaks_json),
                    status: Some("ready".into()),
                    loudness: analysis.loudness.map(|l| l.loudness),
                    true_peak: analysis.loudness.map(|l| l.true_peak),
                    ..Default::default()
                })?;
                self.emit("track_created", json!({ "trackId": track_id }));
                created
            }
        };

        self.log(
            "success",
            &format!("Nạp file local thành công: [{title}] ({}s)", duration.round()),
            Some(json!({ "trackId": track_id, "duration": duration })),
        );
        Ok(IngestResult::ok(vec![track], format!("Đã nạp file local \"{title}\" thành công.")))
    }

    pub async fn ingest_local_directory(&self, raw_dir: &str) -> IngestResult {
        let cleaned = clean_input(raw_dir);
        if let Err(message) = validate_safe_local_audio_path(cleaned) {
            return IngestResult::fail(message);
        }
        let Some(_operation) = self.begin_operation(None) else {
            return IngestResult::fail(INGEST_PAUSED_MESSAGE);
        };
        let full_dir = resolve_abs_path(Path::new(cleaned));
        if !full_dir.is_dir() {
            return IngestResult::fail(format!("Thư mục không tồn tại: {}", full_dir.display()));
        }
        let entries = match std::fs::read_dir(&full_dir) {
            Ok(entries) => entries,
            Err(e) => return IngestResult::fail(format!("Lỗi đọc thư mục: {e}")),
        };
        // Sorted so the same 100 files are taken every time
        let mut audio_files: Vec<PathBuf> = entries
            .flatten()
            .map(|e| e.path())
            .filter(|p| SUPPORTED_AUDIO_EXTENSIONS.contains(&dotted_extension(p).as_str()))
            .collect();
        audio_files.sort();
        if audio_files.is_empty() {
            return IngestResult::fail(format!(
                "Không tìm thấy file audio được hỗ trợ ({}) trong thư mục.",
                SUPPORTED_AUDIO_EXTENSIONS.join(", ")
            ));
        }

        let targets = &audio_files[..audio_files.len().min(MAX_DIR_FILES)];
        let mut tracks = Vec::new();
        let mut errors = Vec::new();
        for path in targets {
            let res = self.ingest_local_file(&path.to_string_lossy(), None).await;
            match (res.success, res.tracks, res.message) {
                (true, Some(found), _) => tracks.extend(found),
                (_, _, Some(message)) => errors.push(format!("{}: {message}", file_name(path))),
                _ => {}
            }
        }

        if tracks.is_empty() {
            let first: Vec<String> = errors.iter().take(3).cloned().collect();
            return IngestResult::fail(format!("Không nạp được bài hát nào: {}", first.join("; ")));
        }
        let mut message = format!("Đã nạp thành công {}/{} bài hát.", tracks.len(), targets.len());
        if !errors.is_empty() {
            message.push_str(&format!(" ({} bài lỗi)", errors.len()));
        }
        if audio_files.len() > MAX_DIR_FILES {
            message.push_str(&format!(" (Giới hạn tối đa {MAX_DIR_FILES} bài)"));
        }
        IngestResult::ok(tracks, message)
    }
}
