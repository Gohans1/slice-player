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
    let abs = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(path)
    };
    let mut out = PathBuf::new();
    for comp in abs.components() {
        match comp {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                out.pop();
            }
            other => out.push(other.as_os_str()),
        }
    }
    let s = out.to_string_lossy();
    if let Some(stripped) = s.strip_prefix(r"\\?\")
        && !stripped.starts_with("UNC\\")
    {
        return PathBuf::from(stripped);
    }
    out
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
                if crate::audio_source::is_supported_audio_file(&candidate)
                    && crate::audio_source::is_regular_non_symlink_file(&candidate)
                {
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

pub fn read_audio_dir_file_names(audio_dir: &Path) -> Vec<String> {
    fs::read_dir(audio_dir)
        .ok()
        .map(|entries| {
            entries
                .flatten()
                .filter_map(|e| e.file_name().to_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

pub fn purge_track_cache_files_with_entries(
    audio_dir: &Path,
    track_id: &str,
    entries: Option<&[String]>,
) {
    let trimmed = track_id.trim();
    if trimmed.is_empty() || !audio_dir.exists() {
        return;
    }
    let prefix = format!("{trimmed}.");
    if let Some(names) = entries {
        for name in names {
            if name == trimmed || name.starts_with(&prefix) {
                let _ = fs::remove_file(audio_dir.join(name));
            }
        }
        return;
    }
    if let Ok(entries) = fs::read_dir(audio_dir) {
        for entry in entries.flatten() {
            if let Some(name) = entry.file_name().to_str()
                && (name == trimmed || name.starts_with(&prefix))
            {
                let _ = fs::remove_file(entry.path());
            }
        }
    }
}

pub fn purge_track_cache_files(audio_dir: &Path, track_id: &str) {
    purge_track_cache_files_with_entries(audio_dir, track_id, None);
}

pub fn purge_tracks_cache_files_batch(
    audio_dir: &Path,
    track_ids: &HashSet<String>,
    entries: Option<&[String]>,
) {
    if track_ids.is_empty() || !audio_dir.exists() {
        return;
    }
    let matches_track = |name: &str| -> bool {
        if track_ids.contains(name) {
            return true;
        }
        if let Some((stem, _)) = name.split_once('.') {
            track_ids.contains(stem)
        } else {
            false
        }
    };
    if let Some(names) = entries {
        for name in names {
            if matches_track(name) {
                let _ = fs::remove_file(audio_dir.join(name));
            }
        }
        return;
    }
    if let Ok(dir_entries) = fs::read_dir(audio_dir) {
        for entry in dir_entries.flatten() {
            if let Some(name) = entry.file_name().to_str()
                && matches_track(name)
            {
                let _ = fs::remove_file(entry.path());
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
                let is_temp = file_name.ends_with(".part") || file_name.ends_with(".ytdl");
                let is_orphan = !valid_paths.contains(&norm(&path))
                    && !valid_basenames.contains(&file_name.to_lowercase());
                if is_temp || is_orphan {
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
        // Scaled copies of art that is now gone or changed go too (variants live beside thumbs/)
        if let Some(cache_dir) = thumb_cache_dir.parent() {
            crate::thumbnails::sweep_thumbnail_variants(thumb_cache_dir, &cache_dir.join("thumbs-sized"));
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
