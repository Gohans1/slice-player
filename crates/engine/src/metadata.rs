//! Tags, duration and embedded cover art of a local file (the `music-metadata` + `ffprobe` part of
//! `ingestLocalFile` in `ingest.ts`).

use lofty::prelude::*;
use md5::{Digest, Md5};
use std::path::Path;
use std::time::Duration;

const MAX_COVER_ART_BYTES: usize = 4 * 1024 * 1024;
const FFPROBE_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, Default, PartialEq)]
pub struct LocalMetadata {
    pub title: Option<String>,
    pub artist: Option<String>,
    /// Seconds; 0 when neither the tags nor ffprobe know
    pub duration: f64,
    /// The first embedded picture, unverified
    pub picture: Option<Vec<u8>>,
}

pub async fn read_local_metadata(path: &Path) -> LocalMetadata {
    let owned = path.to_path_buf();
    let mut meta = tokio::task::spawn_blocking(move || read_tags(&owned))
        .await
        .unwrap_or_default();
    if meta.duration <= 0.0 {
        meta.duration = ffprobe_duration(path).await.unwrap_or(0.0);
    }
    meta
}

fn read_tags(path: &Path) -> LocalMetadata {
    let Ok(file) = lofty::read_from_path(path) else {
        return LocalMetadata::default();
    };
    let non_empty = |s: std::borrow::Cow<'_, str>| {
        let s = s.trim().to_string();
        (!s.is_empty()).then_some(s)
    };
    let tag = file.primary_tag().or_else(|| file.first_tag());
    LocalMetadata {
        title: tag.and_then(|t| t.title()).and_then(non_empty),
        artist: tag.and_then(|t| t.artist()).and_then(non_empty),
        duration: file.properties().duration().as_secs_f64(),
        picture: tag.and_then(|t| t.pictures().first()).map(|p| p.data().to_vec()),
    }
}

async fn ffprobe_duration(path: &Path) -> Option<f64> {
    let probe = tokio::process::Command::new("ffprobe")
        .args(["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1"])
        .arg(path)
        .kill_on_drop(true)
        .output();
    let out = tokio::time::timeout(FFPROBE_TIMEOUT, probe).await.ok()?.ok()?;
    let seconds: f64 = String::from_utf8_lossy(&out.stdout).trim().parse().ok()?;
    (seconds.is_finite() && seconds > 0.0).then_some(seconds)
}

fn cover_art_extension(data: &[u8]) -> Option<&'static str> {
    match data {
        [0xFF, 0xD8, 0xFF, ..] => Some(".jpg"),
        [0x89, 0x50, 0x4E, 0x47, ..] => Some(".png"),
        [b'R', b'I', b'F', b'F', _, _, _, _, b'W', b'E', b'B', b'P', ..] => Some(".webp"),
        _ => None,
    }
}

/// Saves embedded art as `<thumbs_dir>/<track id><ext>` (replacing the track's art in any other
/// format) and returns its cache-busting URL. Only JPEG/PNG/WebP between 4 bytes and 4 MiB.
pub fn save_cover_art(track_id: &str, data: &[u8], thumbs_dir: &Path) -> Option<String> {
    if !(4..=MAX_COVER_ART_BYTES).contains(&data.len()) {
        return None;
    }
    let ext = cover_art_extension(data)?;
    std::fs::create_dir_all(thumbs_dir).ok()?;
    for old in crate::thumbnails::THUMBNAIL_EXTENSIONS.iter().filter(|e| **e != ext) {
        let _ = std::fs::remove_file(thumbs_dir.join(format!("{track_id}{old}")));
    }
    std::fs::write(thumbs_dir.join(format!("{track_id}{ext}")), data).ok()?;
    let hash = format!("{:x}", Md5::digest(data));
    Some(format!("/api/thumbs/{track_id}{ext}?v={}", &hash[..8]))
}
