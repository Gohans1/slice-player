//! `GET /api/library/export`: a consistent snapshot of the library streamed as `.tar.gz`

use super::{assert_export_fits_restore, is_safe_archive_filename, ALLOWED_THUMB_EXTENSIONS, LIBRARY_BUSY_MESSAGE, MAX_EXPORTED_BACKUP_BYTES};
use crate::audio_source::{dotted_extension, SUPPORTED_AUDIO_EXTENSIONS};
use crate::db::{get_cross_platform_basename, resolve_abs_path};
use crate::http::AppState;
use bytes::Bytes;
use rusqlite::{Connection, OpenFlags};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::mpsc;

pub struct BackupPaths {
    pub db_path: PathBuf,
    pub audio_dir: PathBuf,
    pub thumbs_dir: PathBuf,
    pub cookie_path: PathBuf,
}

impl BackupPaths {
    pub fn of(state: &AppState) -> Self {
        let data = &state.config.data_dir;
        Self {
            db_path: resolve_abs_path(&state.config.db_path),
            audio_dir: resolve_abs_path(&data.join("cache").join("audio")),
            thumbs_dir: resolve_abs_path(&data.join("cache").join("thumbs")),
            cookie_path: resolve_abs_path(&data.join("cookies.txt")),
        }
    }
}

enum Source {
    File(PathBuf),
    Data(Vec<u8>),
}

struct Snapshot {
    db_bytes: Vec<u8>,
    track_count: i64,
    segment_count: i64,
    playlist_count: i64,
    /// Archive name under `cache/audio/` → file to read
    audio_files: BTreeMap<String, PathBuf>,
}

fn is_file(path: &Path) -> bool {
    path.is_file()
}

/// A self-contained copy of the database whose tracks point at `cache/audio/<name>` inside the
/// archive. Local files outside the cache get a name derived from the track id (sha256), so two
/// files with the same base name from different folders don't collide.
fn read_library_snapshot(paths: &BackupPaths) -> Result<Snapshot, String> {
    let dir = tempfile::Builder::new().prefix("slice-export-").tempdir().map_err(|e| e.to_string())?;
    let snapshot_path = dir.path().join("music.db");
    {
        let source = Connection::open_with_flags(&paths.db_path, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(|e| e.to_string())?;
        // VACUUM INTO includes committed WAL frames even when another reader blocks checkpointing
        source
            .execute("VACUUM INTO ?1", [snapshot_path.to_string_lossy().as_ref()])
            .map_err(|e| e.to_string())?;
    }

    let mut audio_files = BTreeMap::new();
    if let Ok(entries) = std::fs::read_dir(&paths.audio_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            let path = entry.path();
            if is_safe_archive_filename(&name)
                && SUPPORTED_AUDIO_EXTENSIONS.contains(&dotted_extension(&path).as_str())
                && is_file(&path)
            {
                audio_files.insert(name, path);
            }
        }
    }

    let mut snapshot = Connection::open(&snapshot_path).map_err(|e| e.to_string())?;
    let tracks: Vec<(String, String, String)> = snapshot
        .prepare("SELECT id, file_path, COALESCE(status, '') FROM tracks WHERE file_path IS NOT NULL")
        .and_then(|mut stmt| stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?.collect())
        .map_err(|e| e.to_string())?;
    let tx = snapshot.transaction().map_err(|e| e.to_string())?;
    for (id, file_path, status) in tracks {
        let original_name = get_cross_platform_basename(&file_path);
        let cached_path = paths.audio_dir.join(&original_name);
        let mut source = resolve_abs_path(Path::new(&file_path));
        if !is_file(&source) {
            source = cached_path.clone();
        }
        if !is_file(&source) {
            if status == "ready" {
                return Err(format!("Cannot back up missing audio for track: {id}"));
            }
            continue;
        }
        let mut name = original_name.clone();
        if source != cached_path || !audio_files.contains_key(&name) {
            let ext = dotted_extension(&source);
            if !SUPPORTED_AUDIO_EXTENSIONS.contains(&ext.as_str()) {
                return Err(format!("Unsupported backup audio format for track: {id}"));
            }
            let hash = format!("{:x}", Sha256::digest(id.as_bytes()));
            name = format!("local_{hash}{ext}");
            let mut suffix = 1;
            while audio_files.contains_key(&name) {
                name = format!("local_{hash}_{suffix}{ext}");
                suffix += 1;
            }
            audio_files.insert(name.clone(), source);
        }
        tx.execute("UPDATE tracks SET file_path = ?1 WHERE id = ?2", [format!("cache/audio/{name}"), id])
            .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    let count = |table: &str| -> Result<i64, String> {
        snapshot.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0)).map_err(|e| e.to_string())
    };
    let (track_count, segment_count, playlist_count) = (count("tracks")?, count("segments")?, count("playlists")?);
    drop(snapshot);
    let db_bytes = std::fs::read(&snapshot_path).map_err(|e| e.to_string())?;
    Ok(Snapshot { db_bytes, track_count, segment_count, playlist_count, audio_files })
}

/// Sends the gzip output to the HTTP body in chunks, refusing to grow past what a restore accepts
struct ChunkSender {
    tx: mpsc::Sender<Result<Bytes, std::io::Error>>,
    written: u64,
}

impl Write for ChunkSender {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.written += buf.len() as u64;
        if self.written > MAX_EXPORTED_BACKUP_BYTES {
            return Err(std::io::Error::other("Backup exceeds the restore upload limit."));
        }
        self.tx
            .blocking_send(Ok(Bytes::copy_from_slice(buf)))
            .map_err(|_| std::io::Error::new(std::io::ErrorKind::BrokenPipe, "export download closed"))?;
        Ok(buf.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

fn write_archive(entries: Vec<(String, Source)>, out: ChunkSender) -> std::io::Result<()> {
    let gzip = flate2::write::GzEncoder::new(out, flate2::Compression::default());
    let mut tar = tar::Builder::new(gzip);
    let mtime = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    for (name, source) in entries {
        let mut header = tar::Header::new_gnu();
        header.set_mode(0o644);
        header.set_mtime(mtime);
        match source {
            Source::Data(bytes) => {
                header.set_size(bytes.len() as u64);
                tar.append_data(&mut header, &name, bytes.as_slice())?;
            }
            Source::File(path) => {
                let file = std::fs::File::open(&path)?;
                header.set_size(file.metadata()?.len());
                tar.append_data(&mut header, &name, file)?;
            }
        }
    }
    tar.into_inner()?.finish()?;
    Ok(())
}

/// Clears the exporting flag when the export ends, however it ends
struct ExportingGuard(Arc<AtomicBool>);

impl Drop for ExportingGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

pub type ArchiveStream = futures_util::stream::BoxStream<'static, Result<Bytes, std::io::Error>>;

/// Starts streaming the library archive. Errs before any byte is sent (busy, missing audio, over
/// the restore limits); a failure mid-stream aborts the download.
pub async fn export_library_archive(state: &AppState, include_cookies: bool) -> Result<ArchiveStream, String> {
    if state.mutation_gate.is_restoring() || state.exporting.swap(true, Ordering::SeqCst) {
        return Err(LIBRARY_BUSY_MESSAGE.into());
    }
    let guard = ExportingGuard(state.exporting.clone());
    let paths = BackupPaths::of(state);
    let snapshot = tokio::task::spawn_blocking(move || read_library_snapshot(&paths).map(|s| (s, paths)))
        .await
        .map_err(|e| e.to_string())??;
    let (snapshot, paths) = snapshot;

    let manifest = json!({
        "version": 1,
        "app": "slice-player",
        "exportedAt": iso_now(),
        "trackCount": snapshot.track_count,
        "segmentCount": snapshot.segment_count,
        "playlistCount": snapshot.playlist_count,
    });
    let mut entries: Vec<(String, Source)> = vec![
        ("manifest.json".into(), Source::Data(serde_json::to_vec_pretty(&manifest).unwrap_or_default())),
        ("music.db".into(), Source::Data(snapshot.db_bytes)),
    ];
    // Session cookies never leave the machine unless asked for
    if include_cookies && paths.cookie_path.is_file() {
        entries.push(("cookies.txt".into(), Source::File(paths.cookie_path.clone())));
    }
    for (name, path) in snapshot.audio_files {
        entries.push((format!("cache/audio/{name}"), Source::File(path)));
    }
    if let Ok(dir) = std::fs::read_dir(&paths.thumbs_dir) {
        let mut thumbs: Vec<_> = dir.flatten().map(|e| e.path()).collect();
        thumbs.sort();
        for path in thumbs {
            let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            if is_safe_archive_filename(&name) && ALLOWED_THUMB_EXTENSIONS.contains(&dotted_extension(&path).as_str()) && path.is_file() {
                entries.push((format!("cache/thumbs/{name}"), Source::File(path)));
            }
        }
    }

    let sizes: Vec<(String, u64)> = entries
        .iter()
        .map(|(name, source)| {
            let size = match source {
                Source::Data(bytes) => bytes.len() as u64,
                Source::File(path) => std::fs::metadata(path).map(|m| m.len()).unwrap_or(0),
            };
            (name.clone(), size)
        })
        .collect();
    assert_export_fits_restore(&sizes)?;

    let (tx, rx) = mpsc::channel::<Result<Bytes, std::io::Error>>(8);
    let logger = state.logger.clone();
    let summary = format!(
        "Xuất thư viện thành công: {} bài, {} lát cắt, {} playlist",
        snapshot.track_count, snapshot.segment_count, snapshot.playlist_count
    );
    let exporting = state.exporting.clone();
    tokio::task::spawn_blocking(move || {
        let error_tx = tx.clone();
        match write_archive(entries, ChunkSender { tx, written: 0 }) {
            Ok(()) => logger.add_log("info", "system", &summary, None),
            Err(e) => {
                let _ = error_tx.blocking_send(Err(e));
            }
        }
        exporting.store(false, Ordering::SeqCst);
        drop(error_tx);
    });
    Ok(Box::pin(futures_util::stream::unfold(
        (rx, guard),
        |(mut rx, guard)| async move { rx.recv().await.map(|item| (item, (rx, guard))) },
    )))
}

/// `new Date().toISOString()`
pub(crate) fn iso_now() -> String {
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default();
    iso8601(now.as_secs() as i64, now.subsec_millis())
}

/// UTC `YYYY-MM-DDTHH:MM:SS.mmmZ` from a Unix time (civil-from-days, H. Hinnant)
pub(crate) fn iso8601(secs: i64, millis: u32) -> String {
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + if month <= 2 { 1 } else { 0 };
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{millis:03}Z",
        rem / 3600,
        rem % 3600 / 60,
        rem % 60
    )
}
