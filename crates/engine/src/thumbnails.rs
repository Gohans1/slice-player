//! Cover art scaled to the slot the client shows it in (`thumbnails.ts`). Embedded art is often
//! 3000px square; the client asks for `small` (192px) or `large` (640px) and gets a JPEG copy that
//! is made once and reused until the art changes.

use md5::{Digest, Md5};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex};
use tokio::sync::Semaphore;

pub const THUMBNAIL_EXTENSIONS: [&str; 3] = [".jpg", ".png", ".webp"];

pub fn thumbnail_width(size: &str) -> Option<u32> {
    match size {
        "small" => Some(192),
        "large" => Some(640),
        _ => None,
    }
}

// A page of local tracks asks for many covers at once; scaling two at a time keeps the server
// responsive. Tokio's semaphore is FIFO, so a resize arriving just as another ends can't jump the queue.
static RESIZE_SLOTS: Semaphore = Semaphore::const_new(2);
static IN_FLIGHT: LazyLock<Mutex<HashMap<PathBuf, Arc<tokio::sync::Mutex<()>>>>> = LazyLock::new(Default::default);
const JPEG_QUALITY: u8 = 85;

/// Changes whenever the art file is written, even when a restore brings back an older modification
/// time, so a copy of earlier art is never taken for a copy of the current one
fn cover_art_version(path: &Path) -> Option<String> {
    let meta = std::fs::metadata(path).ok()?;
    let nanos = |t: std::time::SystemTime| t.duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let mtime = nanos(meta.modified().ok()?);
    #[cfg(unix)]
    let ctime = {
        use std::os::unix::fs::MetadataExt;
        meta.ctime() as i128 * 1_000_000_000 + meta.ctime_nsec() as i128
    };
    #[cfg(not(unix))]
    let ctime = meta.created().ok().map(nanos).unwrap_or(mtime) as i128;
    let digest = Md5::digest(format!("{}:{mtime}:{ctime}", meta.len()));
    Some(format!("{digest:x}")[..12].to_string())
}

/// `<track id>-<width>-<version>.jpg` → (track id, width, version)
fn parse_variant_name(name: &str) -> Option<(&str, u32, &str)> {
    let mut parts = name.strip_suffix(".jpg")?.rsplitn(3, '-');
    let version = parts.next()?;
    let width = parts.next()?;
    let track_id = parts.next()?;
    let valid_version = !version.is_empty() && version.bytes().all(|b| b.is_ascii_digit() || b.is_ascii_lowercase());
    let valid_width = !width.is_empty() && width.bytes().all(|b| b.is_ascii_digit());
    if track_id.is_empty() || !valid_version || !valid_width {
        return None;
    }
    Some((track_id, width.parse().ok()?, version))
}

fn remove_variants_where(variants_dir: &Path, should_remove: impl Fn(Option<(&str, u32, &str)>) -> bool) {
    let Ok(entries) = std::fs::read_dir(variants_dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if should_remove(parse_variant_name(&name)) {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

/// A deleted track takes its scaled copies with it
pub fn remove_thumbnail_variants(track_id: &str, variants_dir: &Path) {
    remove_variants_where(variants_dir, |v| v.is_some_and(|(id, _, _)| id == track_id));
}

/// Batch variant cleanup so deleting N tracks reads `variants_dir` once instead of N times
pub fn remove_thumbnail_variants_batch(
    track_ids: &std::collections::HashSet<String>,
    variants_dir: &Path,
) {
    if track_ids.is_empty() {
        return;
    }
    remove_variants_where(variants_dir, |v| v.is_some_and(|(id, _, _)| track_ids.contains(id)));
}

/// Startup: clears copies whose art is gone or changed (deleted track, re-import, restore), plus
/// partial files and anything else that isn't a copy
pub fn sweep_thumbnail_variants(thumbs_dir: &Path, variants_dir: &Path) {
    remove_variants_where(variants_dir, |variant| {
        let Some((track_id, _, version)) = variant else {
            return true;
        };
        let source = THUMBNAIL_EXTENSIONS
            .iter()
            .map(|ext| thumbs_dir.join(format!("{track_id}{ext}")))
            .find(|p| p.exists());
        source.and_then(|s| cover_art_version(&s)).as_deref() != Some(version)
    });
}

/// A copy of the art scaled down to fit `width` (never up), or `None` when it can't be made so the
/// caller serves the original. Concurrent requests for the same copy make it once.
pub async fn resized_thumbnail(source: &Path, width: u32, variants_dir: &Path) -> Option<PathBuf> {
    let version = cover_art_version(source)?;
    let track_id = source.file_stem()?.to_string_lossy().to_string();
    let variant_path = variants_dir.join(format!("{track_id}-{width}-{version}.jpg"));
    if variant_path.exists() {
        return Some(variant_path);
    }

    let lock = IN_FLIGHT.lock().unwrap().entry(variant_path.clone()).or_default().clone();
    let result = {
        let _making = lock.lock().await;
        if variant_path.exists() {
            Some(variant_path.clone())
        } else {
            let _slot = RESIZE_SLOTS.acquire().await.ok()?;
            let (source, target) = (source.to_path_buf(), variant_path.clone());
            tokio::task::spawn_blocking(move || scale_down(&source, width, &target, &version))
                .await
                .ok()
                .flatten()
        }
    };
    {
        let mut in_flight = IN_FLIGHT.lock().unwrap();
        if Arc::strong_count(&lock) == 2 {
            in_flight.remove(&variant_path);
        }
    }
    result
}

fn scale_down(source: &Path, width: u32, variant_path: &Path, version: &str) -> Option<PathBuf> {
    // Written under another name and renamed into place, so a request never reads a half-written file
    let partial = PathBuf::from(format!("{}.partial.jpg", variant_path.display()));
    let made = (|| {
        std::fs::create_dir_all(variant_path.parent()?).ok()?;
        let art = image::ImageReader::open(source).ok()?.with_guessed_format().ok()?.decode().ok()?;
        let art = if art.width() > width || art.height() > width {
            art.resize(width, width, image::imageops::FilterType::Lanczos3)
        } else {
            art
        };
        let out = std::io::BufWriter::new(std::fs::File::create(&partial).ok()?);
        image::codecs::jpeg::JpegEncoder::new_with_quality(out, JPEG_QUALITY)
            .encode_image(&art.to_rgb8())
            .ok()?;
        std::fs::rename(&partial, variant_path).ok()?;
        // The art was replaced, or its track deleted, while it was being scaled: this copy is of art that's gone
        if cover_art_version(source).as_deref() != Some(version) {
            let _ = std::fs::remove_file(variant_path);
            return None;
        }
        Some(variant_path.to_path_buf())
    })();
    let _ = std::fs::remove_file(&partial);
    made
}
