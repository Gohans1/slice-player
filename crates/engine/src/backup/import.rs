//! `POST /api/library/import`: restore a library archive in two phases. Everything is extracted
//! and validated into `.slice-restore-*` folders beside its destination first; only then are
//! ingest, HTTP mutations and analysis drained, the database closed and the files swapped in with
//! renames. Any failure puts every original back.

use super::export::BackupPaths;
use super::{
    is_safe_archive_filename, ALLOWED_THUMB_EXTENSIONS, LIBRARY_BUSY_MESSAGE, MAX_ARCHIVE_ENTRIES, MAX_AUDIO_FILE_BYTES,
    MAX_BACKUP_REQUEST_BYTES, MAX_COOKIE_FILE_BYTES, MAX_DB_FILE_BYTES, MAX_THUMB_FILE_BYTES, MAX_TOTAL_EXTRACTED_BYTES,
};
use crate::audio_analysis::abort_waveform_processes;
use crate::audio_source::{dotted_extension, SUPPORTED_AUDIO_EXTENSIONS};
use crate::db::get_cross_platform_basename;
use crate::http::AppState;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::io::Read;
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize)]
pub struct ImportResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub manifest: Option<Value>,
    pub message: String,
}

const MAX_DECOMPRESSED_STREAM_BYTES: u64 = MAX_TOTAL_EXTRACTED_BYTES + 64 * 1024 * 1024;

fn open_archive(path: &Path) -> Result<tar::Archive<std::io::Take<flate2::read::GzDecoder<std::fs::File>>>, String> {
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    Ok(tar::Archive::new(
        flate2::read::GzDecoder::new(file).take(MAX_DECOMPRESSED_STREAM_BYTES),
    ))
}

fn entry_size_limit(name: &str) -> Result<u64, String> {
    match name {
        "manifest.json" => Ok(1024 * 1024),
        "music.db" => Ok(MAX_DB_FILE_BYTES),
        "cookies.txt" => Ok(MAX_COOKIE_FILE_BYTES),
        _ => {
            if let Some(file) = name.strip_prefix("cache/audio/") {
                if !is_safe_archive_filename(file)
                    || !SUPPORTED_AUDIO_EXTENSIONS.contains(&dotted_extension(Path::new(file)).as_str())
                {
                    return Err(format!("File âm thanh không hợp lệ hoặc định dạng không được hỗ trợ: {file}"));
                }
                Ok(MAX_AUDIO_FILE_BYTES)
            } else if let Some(file) = name.strip_prefix("cache/thumbs/") {
                if !is_safe_archive_filename(file)
                    || !ALLOWED_THUMB_EXTENSIONS.contains(&dotted_extension(Path::new(file)).as_str())
                {
                    return Err(format!("File ảnh bìa không hợp lệ hoặc định dạng không được hỗ trợ: {file}"));
                }
                Ok(MAX_THUMB_FILE_BYTES)
            } else {
                Err(format!("File không hợp lệ trong gói lưu trữ: {name}"))
            }
        }
    }
}

/// (entry path, size) of every regular file in the archive. Validates entry type, entry count,
/// filename layout, and per-file + cumulative size limits immediately upon reading each 512-byte
/// tar header — BEFORE advancing the tar iterator (which would decompress the entry body).
fn list_entries(path: &Path) -> Result<Vec<(String, u64)>, String> {
    let mut archive = open_archive(path)?;
    let mut listed = Vec::new();
    let mut raw_entries: usize = 0;
    let mut total_size: u64 = 0;
    for entry in archive.entries().map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        raw_entries += 1;
        if raw_entries > MAX_ARCHIVE_ENTRIES || listed.len() >= MAX_ARCHIVE_ENTRIES {
            return Err(format!(
                "File backup vượt quá giới hạn số lượng file cho phép ({raw_entries} > {MAX_ARCHIVE_ENTRIES}).",
            ));
        }
        let size = entry.size();
        if size > MAX_DB_FILE_BYTES {
            return Err(format!(
                "File cơ sở dữ liệu vượt quá giới hạn cho phép ({:.1}MB > 500MB).",
                size as f64 / 1024.0 / 1024.0
            ));
        }
        let kind = entry.header().entry_type();
        if kind.is_dir() {
            continue;
        }
        if !kind.is_file() {
            return Err("File không hợp lệ trong gói lưu trữ (symlink hoặc special file).".into());
        }
        let name = String::from_utf8(entry.path_bytes().into_owned()).map_err(|_| "tên file không phải UTF-8".to_string())?;
        let limit = entry_size_limit(&name)?;
        if name == "music.db" && size > MAX_DB_FILE_BYTES {
            return Err(format!(
                "File cơ sở dữ liệu vượt quá giới hạn cho phép ({:.1}MB > 500MB).",
                size as f64 / 1024.0 / 1024.0
            ));
        }
        total_size = total_size.saturating_add(size);
        if size > limit || total_size > MAX_TOTAL_EXTRACTED_BYTES {
            return Err(format!("File {name} hoặc tổng dung lượng giải nén vượt quá giới hạn cho phép."));
        }
        listed.push((name, size));
    }
    Ok(listed)
}

/// Rejects anything but the known layout before a single byte is extracted into staging
fn validate_layout(entries: &[(String, u64)]) -> Result<(), String> {
    if !entries.iter().any(|(name, _)| name == "music.db") {
        return Err("File backup không hợp lệ: thiếu file music.db cơ sở dữ liệu.".into());
    }
    if entries.len() > MAX_ARCHIVE_ENTRIES {
        return Err(format!(
            "File backup vượt quá giới hạn số lượng file cho phép ({} > {MAX_ARCHIVE_ENTRIES}).",
            entries.len()
        ));
    }
    let mut seen = HashSet::new();
    for (name, _) in entries {
        if !seen.insert(name.as_str()) {
            return Err(format!("File không hợp lệ trong gói lưu trữ: {name}"));
        }
        entry_size_limit(name)?;
    }
    Ok(())
}

struct Staged {
    target: PathBuf,
    previous: PathBuf,
    incoming: Option<PathBuf>,
    moved: bool,
    installed: bool,
}

/// Staging folders live beside each destination (same filesystem, so the swap is a rename)
#[derive(Default)]
struct Stager {
    dirs: HashMap<PathBuf, PathBuf>,
    staged: Vec<Staged>,
    next: usize,
}

impl Stager {
    fn prepare(&mut self, target: &Path) -> Result<Staged, String> {
        let parent = target.parent().ok_or("restore target has no parent")?.to_path_buf();
        let dir = match self.dirs.get(&parent) {
            Some(dir) => dir.clone(),
            None => {
                std::fs::create_dir_all(&parent).map_err(|e| e.to_string())?;
                let dir = tempfile::Builder::new()
                    .prefix(".slice-restore-")
                    .tempdir_in(&parent)
                    .map_err(|e| e.to_string())?
                    .keep();
                self.dirs.insert(parent, dir.clone());
                dir
            }
        };
        let previous = dir.join(format!("{}.previous", self.next));
        self.next += 1;
        Ok(Staged { target: target.to_path_buf(), previous, incoming: None, moved: false, installed: false })
    }

    fn stage(&mut self, target: &Path, mut content: impl Read) -> Result<(PathBuf, u64), String> {
        let mut entry = self.prepare(target)?;
        let incoming = PathBuf::from(format!("{}.incoming", entry.previous.display()));
        let mut file = std::fs::File::create(&incoming).map_err(|e| e.to_string())?;
        let copied = std::io::copy(&mut content, &mut file).map_err(|e| e.to_string())?;
        entry.incoming = Some(incoming.clone());
        self.staged.push(entry);
        Ok((incoming, copied))
    }

    fn cleanup(&self) {
        for dir in self.dirs.values() {
            if let Err(e) = std::fs::remove_dir_all(dir) {
                eprintln!("[backup] Could not clean staging directory {}: {e}", dir.display());
            }
        }
    }
}

/// Extracts every entry into staging, with per-file and total size limits
fn stage_archive(archive_path: &Path, paths: &BackupPaths, stager: &mut Stager) -> Result<(Option<Value>, PathBuf), String> {
    let mut archive = open_archive(archive_path)?;
    let mut raw_entries: usize = 0;
    let mut total: u64 = 0;
    let mut manifest = None;
    let mut db_incoming = None;
    for entry in archive.entries().map_err(|e| e.to_string())? {
        let mut entry = entry.map_err(|e| e.to_string())?;
        raw_entries += 1;
        if raw_entries > MAX_ARCHIVE_ENTRIES {
            return Err(format!(
                "File backup vượt quá giới hạn số lượng file cho phép ({raw_entries} > {MAX_ARCHIVE_ENTRIES}).",
            ));
        }
        let size = entry.size();
        if size > MAX_DB_FILE_BYTES {
            return Err(format!(
                "File cơ sở dữ liệu vượt quá giới hạn cho phép ({:.1}MB > 500MB).",
                size as f64 / 1024.0 / 1024.0
            ));
        }
        if !entry.header().entry_type().is_file() {
            continue;
        }
        let name = String::from_utf8_lossy(&entry.path_bytes()).to_string();
        let (target, limit) = match name.as_str() {
            "manifest.json" => {
                let mut text = String::new();
                if entry.by_ref().take(1024 * 1024).read_to_string(&mut text).is_ok() {
                    manifest = serde_json::from_str(&text).ok();
                }
                continue;
            }
            "music.db" => {
                if size > MAX_DB_FILE_BYTES {
                    return Err(format!(
                        "File cơ sở dữ liệu vượt quá giới hạn cho phép ({:.1}MB > 500MB).",
                        size as f64 / 1024.0 / 1024.0
                    ));
                }
                (paths.db_path.clone(), MAX_DB_FILE_BYTES)
            }
            "cookies.txt" => (paths.cookie_path.clone(), MAX_COOKIE_FILE_BYTES),
            _ => match (name.strip_prefix("cache/audio/"), name.strip_prefix("cache/thumbs/")) {
                (Some(file), _) => (paths.audio_dir.join(file), MAX_AUDIO_FILE_BYTES),
                (_, Some(file)) => (paths.thumbs_dir.join(file), MAX_THUMB_FILE_BYTES),
                _ => continue,
            },
        };
        if size > limit || total.saturating_add(size) > MAX_TOTAL_EXTRACTED_BYTES {
            return Err(format!("File {name} hoặc tổng dung lượng giải nén vượt quá giới hạn cho phép."));
        }
        let (incoming, copied) = stager.stage(&target, entry.by_ref().take(limit + 1))?;
        total = total.saturating_add(copied);
        if copied > limit || total > MAX_TOTAL_EXTRACTED_BYTES {
            return Err(format!("File {name} hoặc tổng dung lượng giải nén vượt quá giới hạn cho phép."));
        }
        if name == "music.db" {
            db_incoming = Some(incoming);
        }
    }
    Ok((manifest, db_incoming.ok_or("File backup không hợp lệ: thiếu file music.db cơ sở dữ liệu.")?))
}

/// The incoming database must be intact SQLite holding Slice Player's tables. Every track's
/// `file_path` (and non-YouTube `source_uri`) is restricted strictly to packaged `cache/audio/`
/// entries so an imported DB can never reference or exfiltrate arbitrary host files.
fn validate_incoming_db(db_path: &Path, audio_names: &HashSet<String>, audio_dir: &Path) -> Result<(), String> {
    let mut conn = rusqlite::Connection::open(db_path).map_err(|e| format!("File cơ sở dữ liệu bị lỗi hỏng ({e})"))?;
    let check: String = conn
        .query_row("PRAGMA quick_check;", [], |r| r.get(0))
        .unwrap_or_else(|_| "failed".into());
    if check != "ok" {
        return Err(format!("File cơ sở dữ liệu bị lỗi hỏng (quick_check: {check})"));
    }
    let tables: HashSet<String> = conn
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .and_then(|mut s| s.query_map([], |r| r.get(0))?.collect())
        .map_err(|e| e.to_string())?;
    if !tables.contains("tracks") || !tables.contains("segments") {
        return Err("File cơ sở dữ liệu không hợp lệ: thiếu cấu trúc bảng của Slice Player.".into());
    }
    let tracks: Vec<(String, String, String, Option<String>)> = conn
        .prepare("SELECT id, COALESCE(source_type, 'local'), COALESCE(source_uri, ''), file_path FROM tracks")
        .and_then(|mut s| s.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?.collect())
        .map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    {
        let mut stmt = tx
            .prepare("UPDATE tracks SET file_path = ?1, source_uri = ?2 WHERE id = ?3")
            .map_err(|e| e.to_string())?;
        for (id, source_type, source_uri, file_path) in tracks {
            let rewritten_fp: Option<String> = file_path.and_then(|fp| {
                let name = get_cross_platform_basename(&fp);
                if is_safe_archive_filename(&name)
                    && SUPPORTED_AUDIO_EXTENSIONS.contains(&dotted_extension(Path::new(&name)).as_str())
                    && audio_names.contains(&name)
                {
                    Some(audio_dir.join(&name).to_string_lossy().to_string())
                } else {
                    None
                }
            });
            let rewritten_uri = if source_type == "youtube" {
                source_uri
            } else if let Some(ref fp) = rewritten_fp {
                fp.clone()
            } else {
                let uri_name = get_cross_platform_basename(&source_uri);
                if is_safe_archive_filename(&uri_name)
                    && SUPPORTED_AUDIO_EXTENSIONS.contains(&dotted_extension(Path::new(&uri_name)).as_str())
                    && audio_names.contains(&uri_name)
                {
                    audio_dir.join(&uri_name).to_string_lossy().to_string()
                } else {
                    String::new()
                }
            };
            stmt.execute(rusqlite::params![rewritten_fp, rewritten_uri, id])
                .map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    // Leave no WAL behind: the file is renamed into place on its own
    let _ = conn.execute_batch("PRAGMA journal_mode = DELETE;");
    Ok(())
}

pub async fn import_library_archive(state: &AppState, archive_path: &Path) -> Result<ImportResult, String> {
    let Some(restoring_guard) = state.mutation_gate.try_begin_restore() else {
        return Err(LIBRARY_BUSY_MESSAGE.into());
    };
    if state.exporting.load(std::sync::atomic::Ordering::SeqCst) {
        return Err(LIBRARY_BUSY_MESSAGE.into());
    }
    let size = std::fs::metadata(archive_path).map(|m| m.len()).unwrap_or(0);
    if size < 50 {
        return Err("Dữ liệu file backup không hợp lệ hoặc quá nhỏ.".into());
    }
    if size > MAX_BACKUP_REQUEST_BYTES {
        return Err("Backup exceeds the 2GB restore upload limit.".into());
    }

    // Intake closes before the first await, so nothing new starts during staging either
    let ingest_pause = state.ingest.pause();
    state.mutation_gate.pause();
    let resume_loudness = state.loudness.pause();

    let mut stager = Stager::default();
    let mut keep_recovery_files = false;
    let result = restore(state, archive_path, &mut stager, &mut keep_recovery_files).await;

    drop(restoring_guard);
    drop(ingest_pause);
    state.mutation_gate.resume();
    resume_loudness();
    if !keep_recovery_files {
        stager.cleanup();
    }
    result
}

async fn restore(state: &AppState, archive_path: &Path, stager: &mut Stager, keep_recovery_files: &mut bool) -> Result<ImportResult, String> {
    let paths = BackupPaths::of(state);
    let archive = archive_path.to_path_buf();

    // Phase 1: list, validate, extract and check everything without touching the live library
    let (owned, paths, manifest) = {
        let mut owned = std::mem::take(stager);
        tokio::task::spawn_blocking(move || {
            let mut run = || -> Result<Option<Value>, String> {
                let entries = list_entries(&archive).map_err(|e| format!("Không thể giải nén file backup: {e}"))?;
                validate_layout(&entries)?;
                let audio_names: HashSet<String> = entries
                    .iter()
                    .filter_map(|(name, _)| name.strip_prefix("cache/audio/").map(str::to_string))
                    .collect();
                let (manifest, db_incoming) =
                    stage_archive(&archive, &paths, &mut owned).map_err(|e| format!("Không thể giải nén file backup: {e}"))?;
                validate_incoming_db(&db_incoming, &audio_names, &paths.audio_dir)?;
                Ok(manifest)
            };
            let result = run();
            (owned, paths, result)
        })
        .await
        .map_err(|e| e.to_string())?
    };
    *stager = owned;
    let manifest = manifest?;

    // Phase 2: nothing may still write to the old library while it is swapped out
    state.ingest.abort().await;
    state.mutation_gate.drain().await;
    abort_waveform_processes();
    state.loudness.drain().await;
    state.db.close();

    // The WAL and shared-memory files belong with the database they came from
    for suffix in ["-wal", "-shm"] {
        let sidecar = PathBuf::from(format!("{}{suffix}", paths.db_path.display()));
        if sidecar.exists() {
            let entry = stager.prepare(&sidecar)?;
            stager.staged.insert(0, entry);
        }
    }
    let swapped = swap_in(stager).and_then(|()| {
        state.db.reopen(&paths.db_path, state.config.is_test)?;
        state.db.heal_track_file_paths(&paths.audio_dir).map(|_| ())
    });
    if let Err(restore_error) = swapped {
        rollback(state, &paths, stager, keep_recovery_files, restore_error)?;
    }

    state.events.emit("library_restored", json!({ "timestamp": now_millis() }));
    state.events.emit("playlist_items_changed", json!({}));
    let message = match &manifest {
        Some(m) => format!(
            "Khôi phục thư viện thành công: {} bài, {} lát cắt, {} playlist.",
            m["trackCount"], m["segmentCount"], m["playlistCount"]
        ),
        None => "Khôi phục thư viện thành công.".to_string(),
    };
    state.logger.add_log("info", "system", &message, None);
    Ok(ImportResult { success: true, manifest, message })
}

/// Originals move aside (same folder) and the staged files take their place
fn swap_in(stager: &mut Stager) -> Result<(), String> {
    for entry in stager.staged.iter_mut() {
        if let Ok(meta) = std::fs::symlink_metadata(&entry.target) {
            if !meta.is_file() {
                return Err(format!("Restore destination is not a regular file: {}", entry.target.display()));
            }
            std::fs::rename(&entry.target, &entry.previous).map_err(|e| e.to_string())?;
            entry.moved = true;
        }
        if let Some(incoming) = &entry.incoming {
            std::fs::rename(incoming, &entry.target).map_err(|e| e.to_string())?;
            entry.installed = true;
        }
    }
    Ok(())
}

/// Puts every original back in reverse order; if that fails too, the staging folders are kept
fn rollback(state: &AppState, paths: &BackupPaths, stager: &Stager, keep_recovery_files: &mut bool, restore_error: String) -> Result<(), String> {
    state.db.close();
    let mut errors: Vec<String> = Vec::new();
    let db_installed = stager.staged.iter().any(|e| e.target == paths.db_path && e.installed);
    if db_installed {
        for suffix in ["-wal", "-shm"] {
            let sidecar = PathBuf::from(format!("{}{suffix}", paths.db_path.display()));
            if let Err(e) = std::fs::remove_file(&sidecar)
                && e.kind() != std::io::ErrorKind::NotFound
            {
                errors.push(e.to_string());
            }
        }
    }
    for entry in stager.staged.iter().rev() {
        if entry.installed
            && let Err(e) = std::fs::remove_file(&entry.target)
        {
            errors.push(e.to_string());
        }
        if entry.moved
            && let Err(e) = std::fs::rename(&entry.previous, &entry.target)
        {
            errors.push(e.to_string());
        }
    }
    if paths.db_path.exists()
        && let Err(e) = state.db.reopen(&paths.db_path, state.config.is_test)
    {
        errors.push(e);
    }
    if errors.is_empty() {
        return Err(restore_error);
    }
    *keep_recovery_files = true;
    let dirs: Vec<String> = stager.dirs.values().map(|d| d.display().to_string()).collect();
    Err(format!(
        "Restore rollback failed; recovery files retained in: {} ({restore_error}; {})",
        dirs.join(", "),
        errors.join("; ")
    ))
}

fn now_millis() -> u128 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0)
}
