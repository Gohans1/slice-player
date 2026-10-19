use crate::events::EventBus;
use rusqlite::{params, Connection};
use serde_json::json;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

pub fn get_cross_platform_basename(file_path: &str) -> String {
    if file_path.is_empty() {
        return String::new();
    }
    file_path
        .split(['/', '\\'])
        .next_back()
        .filter(|s| !s.is_empty())
        .unwrap_or(file_path)
        .to_string()
}

pub fn resolve_abs_path(path: &Path) -> PathBuf {
    if let Ok(canon) = path.canonicalize() {
        return canon;
    }
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(path)
    }
}

pub fn heal_track_file_paths_in_conn(
    conn: &mut Connection,
    audio_cache_dir: &Path,
) -> Result<usize, String> {
    if !audio_cache_dir.exists() {
        return Ok(0);
    }
    let abs_cache_dir = resolve_abs_path(audio_cache_dir);

    let rows: Vec<(String, String)> = {
        let mut stmt = conn
            .prepare("SELECT id, file_path FROM tracks WHERE file_path IS NOT NULL")
            .map_err(|e| e.to_string())?;
        let mapped = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for r in mapped {
            out.push(r.map_err(|e| e.to_string())?);
        }
        out
    };

    let mut healed_count = 0usize;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    {
        let mut update_stmt = tx
            .prepare("UPDATE tracks SET file_path = ?1 WHERE id = ?2")
            .map_err(|e| e.to_string())?;
        for (id, file_path) in rows {
            if file_path.is_empty() {
                continue;
            }
            if !Path::new(&file_path).exists() {
                let file_base = get_cross_platform_basename(&file_path);
                let candidate = abs_cache_dir.join(&file_base);
                if candidate.exists() {
                    let resolved = resolve_abs_path(&candidate);
                    update_stmt
                        .execute(params![resolved.to_string_lossy().to_string(), id])
                        .map_err(|e| e.to_string())?;
                    healed_count += 1;
                }
            }
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(healed_count)
}

pub fn purge_track_cache_files(audio_dir: &Path, track_id: &str) {
    let trimmed = track_id.trim();
    if trimmed.is_empty() || !audio_dir.exists() {
        return;
    }
    let prefix = format!("{trimmed}.");
    if let Ok(entries) = fs::read_dir(audio_dir) {
        for entry in entries.flatten() {
            if let Some(name) = entry.file_name().to_str() {
                if name == trimmed || name.starts_with(&prefix) {
                    let _ = fs::remove_file(entry.path());
                }
            }
        }
    }
}

pub fn sweep_thumbnail_variants(
    sized_dir: &Path,
    track_id: &str,
    valid_track_ids: Option<&HashSet<String>>,
) {
    if !sized_dir.exists() {
        return;
    }
    let prefix = format!("{track_id}-");
    if let Ok(entries) = fs::read_dir(sized_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
                continue;
            };
            if name.ends_with(".partial.jpg") {
                let _ = fs::remove_file(&path);
                continue;
            }
            if !track_id.is_empty() && name.starts_with(&prefix) {
                let _ = fs::remove_file(&path);
                continue;
            }
            if let Some(valid_ids) = valid_track_ids {
                // Variant format: <track_id>-<width>-<version>.jpg
                let parts: Vec<&str> = name.rsplitn(3, '-').collect();
                if parts.len() == 3 {
                    let tid = parts[2];
                    if !valid_ids.contains(tid) {
                        let _ = fs::remove_file(&path);
                    }
                }
            }
        }
    }
}

pub fn sweep_startup_orphan_cache(
    conn: &mut Connection,
    audio_cache_dir: &Path,
    thumb_cache_dir: &Path,
) {
    let _ = heal_track_file_paths_in_conn(conn, audio_cache_dir);

    if audio_cache_dir.exists() {
        let rows: Vec<String> = conn
            .prepare("SELECT file_path FROM tracks WHERE file_path IS NOT NULL")
            .ok()
            .and_then(|mut s| {
                s.query_map([], |r| r.get::<_, String>(0))
                    .ok()
                    .map(|it| it.flatten().collect())
            })
            .unwrap_or_default();

        let norm = |p: &Path| -> String {
            let abs = resolve_abs_path(p).to_string_lossy().to_string();
            if cfg!(target_os = "windows") {
                abs.to_lowercase()
            } else {
                abs
            }
        };

        let valid_paths: HashSet<String> = rows.iter().map(|p| norm(Path::new(p))).collect();
        let valid_basenames: HashSet<String> = rows
            .iter()
            .map(|p| get_cross_platform_basename(p).to_lowercase())
            .collect();

        if let Ok(entries) = fs::read_dir(audio_cache_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                let Some(file_name) = path.file_name().and_then(|n| n.to_str()) else {
                    continue;
                };
                if file_name.ends_with(".part") || file_name.ends_with(".ytdl") {
                    let _ = fs::remove_file(&path);
                } else if !valid_paths.contains(&norm(&path))
                    && !valid_basenames.contains(&file_name.to_lowercase())
                {
                    let _ = fs::remove_file(&path);
                }
            }
        }
    }

    if thumb_cache_dir.exists() {
        let valid_track_ids: HashSet<String> = conn
            .prepare("SELECT id FROM tracks")
            .ok()
            .and_then(|mut s| {
                s.query_map([], |r| r.get::<_, String>(0))
                    .ok()
                    .map(|it| it.flatten().collect())
            })
            .unwrap_or_default();

        if let Ok(entries) = fs::read_dir(thumb_cache_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
                    continue;
                };
                let track_id = match name.rfind('.') {
                    Some(idx) => &name[..idx],
                    None => name,
                };
                if !valid_track_ids.contains(track_id) {
                    let _ = fs::remove_file(&path);
                }
            }
        }
    }
}

pub const INTERRUPTED_INGEST_ERROR_MESSAGE: &str =
    "Tải bài hát bị gián đoạn do máy chủ khởi động lại. Vui lòng bấm Thử lại (Retry).";

pub fn recover_incomplete_ingests_in_conn(
    conn: &mut Connection,
    audio_dir: &Path,
    events: &EventBus,
) -> Result<usize, String> {
    let incomplete_ids: Vec<String> = {
        let mut stmt = conn
            .prepare("SELECT id FROM tracks WHERE status IN ('queued', 'downloading')")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        let mut ids = Vec::new();
        for id in rows {
            ids.push(id.map_err(|e| e.to_string())?);
        }
        ids
    };

    if incomplete_ids.is_empty() {
        return Ok(0);
    }

    for id in &incomplete_ids {
        purge_track_cache_files(audio_dir, id);
        conn.execute(
            "UPDATE tracks SET status = 'error', error_message = ?1 WHERE id = ?2",
            params![INTERRUPTED_INGEST_ERROR_MESSAGE, id],
        )
        .map_err(|e| e.to_string())?;
        events.emit("track_updated", json!({ "trackId": id }));
    }

    Ok(incomplete_ids.len())
}
