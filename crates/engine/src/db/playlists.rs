use crate::db::tracks_segments::{get_segment_in_conn, get_track_in_conn, row_to_segment, row_to_track_full};
use crate::models::{
    BatchPlaylistItemInput, Playlist, PlaylistItem, PlaylistItemWithDetails, PlaylistMembership,
    Segment, Track,
};
use rusqlite::{params, params_from_iter, Connection, OptionalExtension, Row};
use std::collections::{HashMap, HashSet};
use uuid::Uuid;

fn row_to_playlist_item(row: &Row<'_>) -> rusqlite::Result<PlaylistItem> {
    Ok(PlaylistItem {
        id: row.get("id")?,
        playlist_id: row.get("playlist_id")?,
        track_id: row.get("track_id")?,
        segment_id: row.get("segment_id")?,
        sort_order: row.get("sort_order")?,
        added_at: row.get("added_at")?,
    })
}

pub fn create_playlist_in_conn(
    conn: &Connection,
    name: &str,
    custom_id: Option<&str>,
    parent_id: Option<&str>,
) -> Result<Playlist, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("Playlist name cannot be empty".to_string());
    }

    let mut clean_parent_id: Option<String> = None;
    if let Some(pid) = parent_id {
        let p_trimmed = pid.trim();
        if !p_trimmed.is_empty() {
            let parent_row: Option<(String, i64, Option<String>)> = conn
                .query_row(
                    "SELECT id, is_mix, parent_id FROM playlists WHERE id = ?1",
                    params![p_trimmed],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )
                .optional()
                .map_err(|e| e.to_string())?;
            let Some((_, is_mix, parent_parent_id)) = parent_row else {
                return Err(format!("Parent playlist \"{p_trimmed}\" not found"));
            };
            if is_mix != 0 {
                return Err("A mix playlist cannot be a parent playlist".to_string());
            }
            if parent_parent_id.is_some() {
                return Err("Invalid parent_id: cannot nest beyond 1 level".to_string());
            }
            clean_parent_id = Some(p_trimmed.to_string());
        }
    }

    let id = custom_id
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("pl_{}", Uuid::new_v4()));

    conn.query_row(
        "
        INSERT INTO playlists (id, name, created_at, updated_at, is_custom_ordered, parent_id)
        VALUES (?1, ?2, unixepoch(), unixepoch(), 0, ?3)
        RETURNING id, name, created_at, updated_at, is_custom_ordered, cover_track_id, is_mix, parent_id;
        ",
        params![id, trimmed, clean_parent_id],
        |row| {
            Ok(Playlist {
                id: row.get(0)?,
                name: row.get(1)?,
                created_at: row.get(2)?,
                updated_at: row.get(3)?,
                item_count: Some(0),
                is_custom_ordered: false,
                cover_track_id: row.get(5)?,
                cover_url: None,
                mosaic_urls: None,
                is_mix: Some(row.get::<_, i64>(6).unwrap_or(0) != 0),
                source_ids: None,
                parent_id: row.get(7)?,
            })
        },
    )
    .map_err(|e| e.to_string())
}

pub fn get_child_playlist_ids_in_conn(
    conn: &Connection,
    parent_id: &str,
) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare("SELECT id FROM playlists WHERE parent_id = ?1")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![parent_id], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

fn get_mix_source_ids_in_conn(conn: &Connection, mix_id: &str) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare("SELECT source_id FROM playlist_sources WHERE mix_id = ?1 ORDER BY position ASC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![mix_id], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

fn get_mix_items_for_sources_in_conn(
    conn: &Connection,
    source_ids: &[String],
) -> Result<Vec<PlaylistItemWithDetails>, String> {
    let mut seen = HashSet::new();
    let mut merged = Vec::new();
    for source_id in source_ids {
        for mut item in get_playlist_items_in_conn(conn, source_id)? {
            let key = format!(
                "{}|{}",
                item.track_id,
                item.segment_id.as_deref().unwrap_or("")
            );
            if seen.insert(key) {
                item.sort_order = merged.len() as i64;
                merged.push(item);
            }
        }
    }
    Ok(merged)
}

fn get_mix_items_in_conn(
    conn: &Connection,
    mix_id: &str,
) -> Result<Vec<PlaylistItemWithDetails>, String> {
    let source_ids = get_mix_source_ids_in_conn(conn, mix_id)?;
    get_mix_items_for_sources_in_conn(conn, &source_ids)
}

fn validate_mix_sources_in_conn(
    conn: &Connection,
    source_ids: &[String],
    mix_id: Option<&str>,
) -> Result<Vec<String>, String> {
    let mut unique = Vec::new();
    let mut seen = HashSet::new();
    for id in source_ids {
        if seen.insert(id.clone()) {
            unique.push(id.clone());
        }
    }
    if unique.len() < 2 {
        return Err("A mix playlist needs at least 2 different source playlists".to_string());
    }
    for id in &unique {
        if Some(id.as_str()) == mix_id {
            return Err("A mix playlist cannot include itself".to_string());
        }
        let is_mix: Option<i64> = conn
            .query_row(
                "SELECT is_mix FROM playlists WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        let Some(is_mix_val) = is_mix else {
            return Err(format!("Playlist {id} not found"));
        };
        if is_mix_val != 0 {
            return Err("A mix playlist cannot use another mix as a source".to_string());
        }
    }
    Ok(unique)
}

fn write_mix_sources_in_conn(
    conn: &Connection,
    mix_id: &str,
    source_ids: &[String],
) -> Result<(), String> {
    conn.execute(
        "DELETE FROM playlist_sources WHERE mix_id = ?1",
        params![mix_id],
    )
    .map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("INSERT INTO playlist_sources (mix_id, source_id, position) VALUES (?1, ?2, ?3)")
        .map_err(|e| e.to_string())?;
    for (pos, src) in source_ids.iter().enumerate() {
        stmt.execute(params![mix_id, src, pos as i64])
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[allow(clippy::type_complexity)]
pub fn get_playlist_in_conn(conn: &Connection, id: &str) -> Result<Option<Playlist>, String> {
    let row: Option<(String, String, i64, i64, i64, i64, Option<String>, Option<String>, i64)> = conn
        .query_row(
            "
            SELECT p.id, p.name, p.created_at, p.updated_at, p.is_custom_ordered, p.is_mix, p.parent_id, p.cover_track_id, COUNT(pi.id) as item_count
            FROM playlists p
            LEFT JOIN playlist_items pi ON p.id = pi.playlist_id
            WHERE p.id = ?1
            GROUP BY p.id
            ",
            params![id],
            |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                    r.get(6)?,
                    r.get(7)?,
                    r.get(8)?,
                ))
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;

    let Some((
        pl_id,
        name,
        created_at,
        updated_at,
        is_custom_ordered,
        is_mix,
        parent_id,
        cover_track_id,
        item_count,
    )) = row
    else {
        return Ok(None);
    };

    if is_mix != 0 {
        let source_ids = get_mix_source_ids_in_conn(conn, &pl_id)?;
        let items = get_mix_items_for_sources_in_conn(conn, &source_ids)?;
        return Ok(Some(Playlist {
            id: pl_id,
            name,
            created_at,
            updated_at,
            item_count: Some(items.len() as i64),
            is_custom_ordered: true,
            cover_track_id,
            cover_url: None,
            mosaic_urls: None,
            is_mix: Some(true),
            source_ids: Some(source_ids),
            parent_id: None,
        }));
    }

    Ok(Some(Playlist {
        id: pl_id,
        name,
        created_at,
        updated_at,
        item_count: Some(item_count),
        is_custom_ordered: is_custom_ordered != 0,
        cover_track_id,
        cover_url: None,
        mosaic_urls: None,
        is_mix: Some(false),
        source_ids: None,
        parent_id,
    }))
}

pub fn create_mix_playlist_in_conn(
    conn: &mut Connection,
    name: &str,
    source_ids: &[String],
) -> Result<Playlist, String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let sources = validate_mix_sources_in_conn(&tx, source_ids, None)?;
    let created = create_playlist_in_conn(&tx, name, None, None)?;
    tx.execute(
        "UPDATE playlists SET is_mix = 1, is_custom_ordered = 1 WHERE id = ?1",
        params![created.id],
    )
    .map_err(|e| e.to_string())?;
    write_mix_sources_in_conn(&tx, &created.id, &sources)?;
    tx.commit().map_err(|e| e.to_string())?;
    get_playlist_in_conn(conn, &created.id)?
        .ok_or_else(|| "Failed to load created mix playlist".to_string())
}

pub fn set_mix_sources_in_conn(
    conn: &mut Connection,
    mix_id: &str,
    source_ids: &[String],
) -> Result<Option<Playlist>, String> {
    let is_mix: Option<i64> = conn
        .query_row(
            "SELECT is_mix FROM playlists WHERE id = ?1",
            params![mix_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let Some(is_mix_val) = is_mix else {
        return Ok(None);
    };
    if is_mix_val == 0 {
        return Err("Playlist is not a mix playlist".to_string());
    }
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let validated = validate_mix_sources_in_conn(&tx, source_ids, Some(mix_id))?;
    write_mix_sources_in_conn(&tx, mix_id, &validated)?;
    tx.execute(
        "UPDATE playlists SET updated_at = unixepoch() WHERE id = ?1",
        params![mix_id],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    get_playlist_in_conn(conn, mix_id)
}

#[allow(clippy::type_complexity)]
pub fn list_playlists_in_conn(conn: &Connection) -> Result<Vec<Playlist>, String> {
    let mut stmt = conn
        .prepare(
            "
            SELECT p.id, p.name, p.created_at, p.updated_at, p.is_custom_ordered, p.is_mix, p.cover_track_id, p.parent_id,
              (SELECT COUNT(*) FROM playlist_items pi WHERE pi.playlist_id = p.id) as item_count,
              (SELECT NULLIF(t.thumbnail_url, '') FROM tracks t
                WHERE t.id = p.cover_track_id
                  AND EXISTS (SELECT 1 FROM playlist_items y WHERE y.playlist_id = p.id AND y.track_id = t.id)
              ) as cover_url,
              (SELECT json_group_array(url) FROM (
                SELECT url FROM (
                  SELECT t.id as tid, t.thumbnail_url as url,
                    ROW_NUMBER() OVER (ORDER BY
                      CASE WHEN p.is_custom_ordered THEN x.sort_order ELSE 0 END ASC,
                      CASE WHEN p.is_custom_ordered THEN x.added_at ELSE -x.added_at END ASC,
                      x.sort_order ASC
                    ) as rn
                  FROM playlist_items x JOIN tracks t ON t.id = x.track_id
                  WHERE x.playlist_id = p.id AND t.thumbnail_url <> ''
                )
                GROUP BY tid ORDER BY MIN(rn) LIMIT 4
              )) as mosaic_urls
            FROM playlists p
            ORDER BY p.updated_at DESC, p.created_at DESC
            ",
        )
        .map_err(|e| e.to_string())?;

    let raw_rows: Vec<(
        String,
        String,
        i64,
        i64,
        i64,
        i64,
        Option<String>,
        Option<String>,
        i64,
        Option<String>,
        Option<String>,
    )> = stmt
        .query_map([], |r| {
            Ok((
                r.get(0)?,
                r.get(1)?,
                r.get(2)?,
                r.get(3)?,
                r.get(4)?,
                r.get(5)?,
                r.get(6)?,
                r.get(7)?,
                r.get(8)?,
                r.get(9)?,
                r.get(10)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let mut out = Vec::with_capacity(raw_rows.len());
    for (
        id,
        name,
        created_at,
        updated_at,
        is_custom_ordered,
        is_mix,
        cover_track_id,
        parent_id,
        item_count,
        cover_url,
        mosaic_json,
    ) in raw_rows
    {
        if is_mix == 0 {
            let mosaic_urls: Vec<String> = mosaic_json
                .as_deref()
                .and_then(|s| serde_json::from_str::<Vec<String>>(s).ok())
                .unwrap_or_default();
            out.push(Playlist {
                id,
                name,
                created_at,
                updated_at,
                item_count: Some(item_count),
                is_custom_ordered: is_custom_ordered != 0,
                cover_track_id,
                cover_url,
                mosaic_urls: Some(mosaic_urls),
                is_mix: Some(false),
                source_ids: None,
                parent_id,
            });
        } else {
            let source_ids = get_mix_source_ids_in_conn(conn, &id)?;
            let items = get_mix_items_for_sources_in_conn(conn, &source_ids)?;
            let mut thumb_order = Vec::new();
            let mut thumb_map = HashMap::new();
            for it in &items {
                if !it.track.thumbnail_url.is_empty() && !thumb_map.contains_key(&it.track_id) {
                    thumb_map.insert(it.track_id.clone(), it.track.thumbnail_url.clone());
                    thumb_order.push(it.track.thumbnail_url.clone());
                }
            }
            let resolved_cover = cover_track_id
                .as_ref()
                .and_then(|cid| thumb_map.get(cid).cloned());
            out.push(Playlist {
                id,
                name,
                created_at,
                updated_at,
                item_count: Some(items.len() as i64),
                is_custom_ordered: true,
                cover_track_id,
                cover_url: resolved_cover,
                mosaic_urls: Some(thumb_order.into_iter().take(4).collect()),
                is_mix: Some(true),
                source_ids: Some(source_ids),
                parent_id: None,
            });
        }
    }
    Ok(out)
}

pub fn set_playlist_cover_in_conn(
    conn: &Connection,
    id: &str,
    track_id: Option<&str>,
) -> Result<Option<Playlist>, String> {
    let Some(pl) = get_playlist_in_conn(conn, id)? else {
        return Ok(None);
    };
    if let Some(tid) = track_id {
        let in_playlist = if pl.is_mix == Some(true) {
            get_mix_items_in_conn(conn, id)?
                .iter()
                .any(|it| it.track_id == tid)
        } else {
            conn.query_row(
                "SELECT 1 FROM playlist_items WHERE playlist_id = ?1 AND track_id = ?2 LIMIT 1",
                params![id, tid],
                |_| Ok(true),
            )
            .optional()
            .map_err(|e| e.to_string())?
            .unwrap_or(false)
        };
        if !in_playlist {
            return Err("Track is not in this playlist".to_string());
        }
    }
    conn.execute(
        "UPDATE playlists SET cover_track_id = ?1 WHERE id = ?2",
        params![track_id, id],
    )
    .map_err(|e| e.to_string())?;
    get_playlist_in_conn(conn, id)
}

pub fn update_playlist_in_conn(
    conn: &Connection,
    id: &str,
    name: &str,
) -> Result<Option<Playlist>, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("Playlist name cannot be empty".to_string());
    }
    let changes = conn
        .execute(
            "UPDATE playlists SET name = ?1, updated_at = unixepoch() WHERE id = ?2",
            params![trimmed, id],
        )
        .map_err(|e| e.to_string())?;
    if changes == 0 {
        return Ok(None);
    }
    get_playlist_in_conn(conn, id)
}

pub fn delete_playlist_in_conn(
    conn: &mut Connection,
    id: &str,
    keep_children: bool,
) -> Result<bool, String> {
    let child_ids = get_child_playlist_ids_in_conn(conn, id)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    if keep_children {
        tx.execute(
            "UPDATE playlists SET parent_id = NULL WHERE parent_id = ?1",
            params![id],
        )
        .map_err(|e| e.to_string())?;
    } else {
        for cid in &child_ids {
            tx.execute("DELETE FROM playlists WHERE id = ?1", params![cid])
                .map_err(|e| e.to_string())?;
        }
    }
    let changes = tx
        .execute("DELETE FROM playlists WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(changes > 0)
}

pub fn get_playlist_items_in_conn(
    conn: &Connection,
    playlist_id: &str,
) -> Result<Vec<PlaylistItemWithDetails>, String> {
    let pl_meta: Option<(i64, i64)> = conn
        .query_row(
            "SELECT is_custom_ordered, is_mix FROM playlists WHERE id = ?1",
            params![playlist_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    if let Some((_, is_mix)) = pl_meta
        && is_mix != 0
    {
        return get_mix_items_in_conn(conn, playlist_id);
    }

    let is_custom = pl_meta.map(|(c, _)| c != 0).unwrap_or(false);
    let order_clause = if is_custom {
        "ORDER BY pi.sort_order ASC, pi.added_at ASC"
    } else {
        "ORDER BY pi.added_at DESC, pi.sort_order ASC"
    };

    let sql = format!(
        "
        SELECT
          pi.id, pi.playlist_id, pi.track_id, pi.segment_id, pi.sort_order, pi.added_at,
          t.source_type, t.source_uri, t.title as track_title, t.artist as track_artist,
          t.duration as track_duration, t.thumbnail_url, t.file_path,
          t.status as track_status, t.error_message as track_error, t.volume as track_volume,
          t.loudness as track_loudness, t.true_peak as track_true_peak,
          t.created_at as track_created_at,
          s.name as segment_name, s.start_time as segment_start_time, s.end_time as segment_end_time,
          s.color as segment_color, s.sort_order as segment_sort_order, s.created_at as segment_created_at
        FROM playlist_items pi
        JOIN tracks t ON pi.track_id = t.id
        LEFT JOIN segments s ON pi.segment_id = s.id
        WHERE pi.playlist_id = ?1
        {order_clause}
        "
    );

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![playlist_id], |r| {
            let track_id: String = r.get("track_id")?;
            let segment_id: Option<String> = r.get("segment_id")?;
            let segment_name: Option<String> = r.get("segment_name")?;

            let track = Track {
                id: track_id.clone(),
                source_type: r.get("source_type")?,
                source_uri: r.get("source_uri")?,
                title: r.get("track_title")?,
                artist: r.get::<_, Option<String>>("track_artist")?.unwrap_or_default(),
                duration: r.get("track_duration")?,
                thumbnail_url: r
                    .get::<_, Option<String>>("thumbnail_url")?
                    .unwrap_or_default(),
                file_path: r.get("file_path")?,
                peaks_json: None,
                status: r
                    .get::<_, Option<String>>("track_status")?
                    .unwrap_or_else(|| "ready".to_string()),
                error_message: r.get("track_error")?,
                volume: r.get::<_, Option<f64>>("track_volume")?.unwrap_or(0.5),
                loudness: r.get("track_loudness").ok().flatten(),
                true_peak: r.get("track_true_peak").ok().flatten(),
                created_at: r.get("track_created_at")?,
                segment_count: None,
                download_index: None,
            };

            let segment = match (segment_id.clone(), segment_name) {
                (Some(seg_id), Some(seg_name)) => Some(Segment {
                    id: seg_id,
                    track_id: track_id.clone(),
                    name: seg_name,
                    start_time: r.get("segment_start_time")?,
                    end_time: r.get("segment_end_time")?,
                    color: r
                        .get::<_, Option<String>>("segment_color")?
                        .unwrap_or_else(|| "#4385BE".to_string()),
                    sort_order: r.get::<_, Option<i64>>("segment_sort_order")?.unwrap_or(0),
                    created_at: r.get("segment_created_at")?,
                }),
                _ => None,
            };

            Ok(PlaylistItemWithDetails {
                id: r.get("id")?,
                playlist_id: r.get("playlist_id")?,
                track_id,
                segment_id,
                sort_order: r.get("sort_order")?,
                added_at: r.get("added_at")?,
                track,
                segment,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

pub fn add_playlist_item_in_conn(
    conn: &mut Connection,
    playlist_id: &str,
    track_id: &str,
    segment_id: Option<&str>,
) -> Result<PlaylistItemWithDetails, String> {
    let clean_seg_id: Option<String> = segment_id
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());

    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let pl_row: Option<(String, i64, Option<String>)> = tx
        .query_row(
            "SELECT id, is_mix, parent_id FROM playlists WHERE id = ?1",
            params![playlist_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let Some((_, is_mix, parent_id)) = pl_row else {
        return Err(format!("Playlist {playlist_id} not found"));
    };
    if is_mix != 0 {
        return Err("Cannot add items to a mix playlist".to_string());
    }

    let Some(mut trk) = get_track_in_conn(&tx, track_id)? else {
        return Err(format!("Track {track_id} not found"));
    };
    trk.peaks_json = None;

    let mut seg: Option<Segment> = None;
    if let Some(ref sid) = clean_seg_id {
        let fetched_seg = get_segment_in_conn(&tx, sid)?;
        match fetched_seg {
            Some(s) if s.track_id == track_id => seg = Some(s),
            _ => {
                return Err(format!(
                    "Segment {sid} not found or does not belong to track {track_id}"
                ))
            }
        }
    }

    // Auto-bubble to parent playlist if this is a child playlist
    if let Some(ref pid) = parent_id {
        let exists_in_parent: Option<String> = tx
            .query_row(
                "SELECT id FROM playlist_items WHERE playlist_id = ?1 AND track_id = ?2 AND segment_id IS ?3",
                params![pid, track_id, clean_seg_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;

        if exists_in_parent.is_none() {
            tx.execute(
                "UPDATE playlist_items SET sort_order = sort_order + 1 WHERE playlist_id = ?1",
                params![pid],
            )
            .map_err(|e| e.to_string())?;
            let parent_item_id = format!("pli_{}", Uuid::new_v4());
            tx.execute(
                "INSERT INTO playlist_items (id, playlist_id, track_id, segment_id, sort_order, added_at)
                 VALUES (?1, ?2, ?3, ?4, 0, unixepoch())",
                params![parent_item_id, pid, track_id, clean_seg_id],
            )
            .map_err(|e| e.to_string())?;
            tx.execute(
                "UPDATE playlists SET updated_at = unixepoch() WHERE id = ?1",
                params![pid],
            )
            .map_err(|e| e.to_string())?;
        }
    }

    let existing: Option<PlaylistItem> = tx
        .query_row(
            "SELECT * FROM playlist_items WHERE playlist_id = ?1 AND track_id = ?2 AND segment_id IS ?3",
            params![playlist_id, track_id, clean_seg_id],
            row_to_playlist_item,
        )
        .optional()
        .map_err(|e| e.to_string())?;

    if let Some(item) = existing {
        tx.commit().map_err(|e| e.to_string())?;
        return Ok(PlaylistItemWithDetails {
            id: item.id,
            playlist_id: item.playlist_id,
            track_id: item.track_id,
            segment_id: item.segment_id,
            sort_order: item.sort_order,
            added_at: item.added_at,
            track: trk,
            segment: seg,
        });
    }

    tx.execute(
        "UPDATE playlist_items SET sort_order = sort_order + 1 WHERE playlist_id = ?1",
        params![playlist_id],
    )
    .map_err(|e| e.to_string())?;

    let item_id = format!("pli_{}", Uuid::new_v4());
    let item = tx
        .query_row(
            "INSERT INTO playlist_items (id, playlist_id, track_id, segment_id, sort_order, added_at)
             VALUES (?1, ?2, ?3, ?4, 0, unixepoch())
             RETURNING *;",
            params![item_id, playlist_id, track_id, clean_seg_id],
            row_to_playlist_item,
        )
        .map_err(|e| e.to_string())?;

    tx.execute(
        "UPDATE playlists SET updated_at = unixepoch() WHERE id = ?1",
        params![playlist_id],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;

    Ok(PlaylistItemWithDetails {
        id: item.id,
        playlist_id: item.playlist_id,
        track_id: item.track_id,
        segment_id: item.segment_id,
        sort_order: item.sort_order,
        added_at: item.added_at,
        track: trk,
        segment: seg,
    })
}

pub fn add_playlist_items_batch_in_conn(
    conn: &mut Connection,
    playlist_id: &str,
    items: &[BatchPlaylistItemInput],
) -> Result<Vec<PlaylistItemWithDetails>, String> {
    if items.is_empty() {
        return Ok(Vec::new());
    }
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let pl_row: Option<(String, i64, Option<String>)> = tx
        .query_row(
            "SELECT id, is_mix, parent_id FROM playlists WHERE id = ?1",
            params![playlist_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let Some((_, is_mix, parent_id)) = pl_row else {
        return Err(format!("Playlist {playlist_id} not found"));
    };
    if is_mix != 0 {
        return Err("Cannot add items to a mix playlist".to_string());
    }

    let max_order: i64 = tx
        .query_row(
            "SELECT COALESCE(MAX(sort_order), -1) FROM playlist_items WHERE playlist_id = ?1",
            params![playlist_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    let mut next_order = max_order + 1;

    // Pre-fetch tracks & segments
    let unique_track_ids: Vec<String> = items
        .iter()
        .map(|i| i.track_id.clone())
        .filter(|s| !s.is_empty())
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    let unique_seg_ids: Vec<String> = items
        .iter()
        .filter_map(|i| i.segment_id.as_deref())
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();

    let mut track_map = HashMap::new();
    for chunk in unique_track_ids.chunks(500) {
        let placeholders = vec!["?"; chunk.len()].join(",");
        let sql = format!("SELECT * FROM tracks WHERE id IN ({placeholders})");
        let mut stmt = tx.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params_from_iter(chunk.iter()), row_to_track_full)
            .map_err(|e| e.to_string())?;
        for r in rows {
            let mut t = r.map_err(|e| e.to_string())?;
            t.peaks_json = None;
            track_map.insert(t.id.clone(), t);
        }
    }

    let mut seg_map = HashMap::new();
    for chunk in unique_seg_ids.chunks(500) {
        let placeholders = vec!["?"; chunk.len()].join(",");
        let sql = format!("SELECT * FROM segments WHERE id IN ({placeholders})");
        let mut stmt = tx.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params_from_iter(chunk.iter()), row_to_segment)
            .map_err(|e| e.to_string())?;
        for r in rows {
            let s = r.map_err(|e| e.to_string())?;
            seg_map.insert(s.id.clone(), s);
        }
    }

    // Auto-bubble to parent playlist if this is a child playlist
    if let Some(ref pid) = parent_id {
        let mut parent_existing_set: HashSet<String> = {
            let mut stmt = tx
                .prepare("SELECT track_id, segment_id FROM playlist_items WHERE playlist_id = ?1")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(params![pid], |row| {
                    let tid: String = row.get(0)?;
                    let sid: Option<String> = row.get(1)?;
                    Ok(format!("{}::{}", tid, sid.unwrap_or_default()))
                })
                .map_err(|e| e.to_string())?;
            rows.flatten().collect()
        };
        let parent_max_order: i64 = tx
            .query_row(
                "SELECT COALESCE(MAX(sort_order), -1) FROM playlist_items WHERE playlist_id = ?1",
                params![pid],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        let mut parent_next_order = parent_max_order + 1;
        let mut parent_added = false;

        {
            let mut parent_insert_stmt = tx
                .prepare(
                    "INSERT INTO playlist_items (id, playlist_id, track_id, segment_id, sort_order, added_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, unixepoch())",
                )
                .map_err(|e| e.to_string())?;
            for entry in items {
                let clean_seg_id = entry
                    .segment_id
                    .as_deref()
                    .map(|s| s.trim())
                    .filter(|s| !s.is_empty())
                    .map(|s| s.to_string());
                if !track_map.contains_key(&entry.track_id) {
                    continue;
                }
                if let Some(ref sid) = clean_seg_id {
                    let Some(s) = seg_map.get(sid) else {
                        continue;
                    };
                    if s.track_id != entry.track_id {
                        continue;
                    }
                }
                let key = format!(
                    "{}::{}",
                    entry.track_id,
                    clean_seg_id.as_deref().unwrap_or("")
                );
                if parent_existing_set.insert(key) {
                    let p_item_id = format!("pli_{}", Uuid::new_v4());
                    let _ = parent_insert_stmt.execute(params![
                        p_item_id,
                        pid,
                        entry.track_id,
                        clean_seg_id,
                        parent_next_order
                    ]);
                    parent_next_order += 1;
                    parent_added = true;
                }
            }
        }
        if parent_added {
            tx.execute(
                "UPDATE playlists SET updated_at = unixepoch() WHERE id = ?1",
                params![pid],
            )
            .map_err(|e| e.to_string())?;
        }
    }

    let mut existing_map: HashMap<String, PlaylistItem> = {
        let mut stmt = tx
            .prepare("SELECT * FROM playlist_items WHERE playlist_id = ?1")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![playlist_id], row_to_playlist_item)
            .map_err(|e| e.to_string())?;
        let mut map = HashMap::new();
        for r in rows {
            let it = r.map_err(|e| e.to_string())?;
            let key = format!(
                "{}::{}",
                it.track_id,
                it.segment_id.as_deref().unwrap_or("")
            );
            map.insert(key, it);
        }
        map
    };

    let mut results = Vec::new();
    {
        let mut insert_stmt = tx
            .prepare(
                "INSERT INTO playlist_items (id, playlist_id, track_id, segment_id, sort_order, added_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, unixepoch())
                 RETURNING *;",
            )
            .map_err(|e| e.to_string())?;
        for entry in items {
            let clean_seg_id = entry
                .segment_id
                .as_deref()
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string());
            let Some(trk) = track_map.get(&entry.track_id).cloned() else {
                continue;
            };
            let mut seg = None;
            if let Some(ref sid) = clean_seg_id {
                let Some(s) = seg_map.get(sid).cloned() else {
                    continue;
                };
                if s.track_id != entry.track_id {
                    continue;
                }
                seg = Some(s);
            }

            let key = format!(
                "{}::{}",
                entry.track_id,
                clean_seg_id.as_deref().unwrap_or("")
            );
            if let Some(existing) = existing_map.get(&key).cloned() {
                results.push(PlaylistItemWithDetails {
                    id: existing.id,
                    playlist_id: existing.playlist_id,
                    track_id: existing.track_id,
                    segment_id: existing.segment_id,
                    sort_order: existing.sort_order,
                    added_at: existing.added_at,
                    track: trk,
                    segment: seg,
                });
                continue;
            }

            let id = format!("pli_{}", Uuid::new_v4());
            let item = insert_stmt
                .query_row(
                    params![id, playlist_id, entry.track_id, clean_seg_id, next_order],
                    row_to_playlist_item,
                )
                .map_err(|e| e.to_string())?;
            next_order += 1;
            existing_map.insert(key, item.clone());
            results.push(PlaylistItemWithDetails {
                id: item.id,
                playlist_id: item.playlist_id,
                track_id: item.track_id,
                segment_id: item.segment_id,
                sort_order: item.sort_order,
                added_at: item.added_at,
                track: trk,
                segment: seg,
            });
        }
    }

    tx.execute(
        "UPDATE playlists SET updated_at = unixepoch() WHERE id = ?1",
        params![playlist_id],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(results)
}

pub fn remove_playlist_item_in_conn(
    conn: &mut Connection,
    playlist_id: &str,
    item_id: &str,
) -> Result<bool, String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let item: Option<(String, Option<String>)> = tx
        .query_row(
            "SELECT track_id, segment_id FROM playlist_items WHERE id = ?1 AND playlist_id = ?2",
            params![item_id, playlist_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let Some((track_id, segment_id)) = item else {
        return Ok(false);
    };

    let child_ids = get_child_playlist_ids_in_conn(&tx, playlist_id)?;
    if !child_ids.is_empty() {
        let child_changes = tx
            .execute(
                "DELETE FROM playlist_items
                 WHERE playlist_id IN (SELECT id FROM playlists WHERE parent_id = ?1)
                   AND track_id = ?2
                   AND segment_id IS ?3",
                params![playlist_id, track_id, segment_id],
            )
            .map_err(|e| e.to_string())?;
        if child_changes > 0 {
            for cid in &child_ids {
                tx.execute(
                    "UPDATE playlists SET updated_at = unixepoch() WHERE id = ?1",
                    params![cid],
                )
                .map_err(|e| e.to_string())?;
            }
        }
    }

    let changes = tx
        .execute(
            "DELETE FROM playlist_items WHERE id = ?1 AND playlist_id = ?2",
            params![item_id, playlist_id],
        )
        .map_err(|e| e.to_string())?;
    if changes > 0 {
        tx.execute(
            "UPDATE playlists SET updated_at = unixepoch() WHERE id = ?1",
            params![playlist_id],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(changes > 0)
}

pub fn remove_playlist_items_batch_in_conn(
    conn: &mut Connection,
    playlist_id: &str,
    item_ids: &[String],
) -> Result<usize, String> {
    if item_ids.is_empty() {
        return Ok(0);
    }
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut items_to_remove: Vec<(String, Option<String>)> = Vec::new();

    for chunk in item_ids.chunks(500) {
        let placeholders = vec!["?"; chunk.len()].join(",");
        let sql = format!(
            "SELECT track_id, segment_id FROM playlist_items WHERE playlist_id = ? AND id IN ({placeholders})"
        );
        let mut stmt = tx.prepare(&sql).map_err(|e| e.to_string())?;
        let mut args: Vec<&dyn rusqlite::ToSql> = Vec::with_capacity(chunk.len() + 1);
        let pid_str = playlist_id.to_string();
        args.push(&pid_str);
        for id in chunk {
            args.push(id);
        }
        let rows = stmt
            .query_map(args.as_slice(), |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(|e| e.to_string())?;
        for r in rows {
            items_to_remove.push(r.map_err(|e| e.to_string())?);
        }
    }

    let child_ids = get_child_playlist_ids_in_conn(&tx, playlist_id)?;
    if !child_ids.is_empty() && !items_to_remove.is_empty() {
        let mut cascaded_any = false;
        {
            let mut cascade_stmt = tx
                .prepare(
                    "DELETE FROM playlist_items
                     WHERE playlist_id IN (SELECT id FROM playlists WHERE parent_id = ?1)
                       AND track_id = ?2
                       AND segment_id IS ?3",
                )
                .map_err(|e| e.to_string())?;
            for (track_id, segment_id) in &items_to_remove {
                let res = cascade_stmt
                    .execute(params![playlist_id, track_id, segment_id])
                    .map_err(|e| e.to_string())?;
                if res > 0 {
                    cascaded_any = true;
                }
            }
        }
        if cascaded_any {
            for cid in &child_ids {
                tx.execute(
                    "UPDATE playlists SET updated_at = unixepoch() WHERE id = ?1",
                    params![cid],
                )
                .map_err(|e| e.to_string())?;
            }
        }
    }

    let mut deleted_count = 0usize;
    let pid_str = playlist_id.to_string();
    for chunk in item_ids.chunks(500) {
        let placeholders = vec!["?"; chunk.len()].join(",");
        let sql = format!(
            "DELETE FROM playlist_items WHERE playlist_id = ? AND id IN ({placeholders})"
        );
        let mut args: Vec<&dyn rusqlite::ToSql> = Vec::with_capacity(chunk.len() + 1);
        args.push(&pid_str);
        for id in chunk {
            args.push(id);
        }
        let changes = tx.execute(&sql, args.as_slice()).map_err(|e| e.to_string())?;
        deleted_count += changes;
    }

    if deleted_count > 0 {
        tx.execute(
            "UPDATE playlists SET updated_at = unixepoch() WHERE id = ?1",
            params![playlist_id],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(deleted_count)
}

pub fn reorder_playlist_items_in_conn(
    conn: &mut Connection,
    playlist_id: &str,
    item_ids: &[String],
) -> Result<bool, String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let pl_exists: Option<String> = tx
        .query_row(
            "SELECT id FROM playlists WHERE id = ?1",
            params![playlist_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if pl_exists.is_none() {
        return Ok(false);
    }

    let total_items: usize = tx
        .query_row(
            "SELECT COUNT(*) FROM playlist_items WHERE playlist_id = ?1",
            params![playlist_id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|e| e.to_string())? as usize;

    let unique_count = item_ids.iter().collect::<HashSet<_>>().len();
    if item_ids.len() != total_items || unique_count != total_items {
        return Ok(false);
    }

    {
        let mut reorder_stmt = tx
            .prepare("UPDATE playlist_items SET sort_order = ?1 WHERE id = ?2 AND playlist_id = ?3")
            .map_err(|e| e.to_string())?;
        for (idx, item_id) in item_ids.iter().enumerate() {
            let changes = reorder_stmt
                .execute(params![idx as i64, item_id, playlist_id])
                .map_err(|e| e.to_string())?;
            if changes == 0 {
                return Ok(false);
            }
        }
    }

    tx.execute(
        "UPDATE playlists SET is_custom_ordered = 1, updated_at = unixepoch() WHERE id = ?1",
        params![playlist_id],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(true)
}

pub fn get_playlist_memberships_in_conn(
    conn: &Connection,
    track_id: &str,
    segment_id: Option<&str>,
    include_all_segments: bool,
) -> Result<Vec<PlaylistMembership>, String> {
    if include_all_segments {
        let mut stmt = conn
            .prepare(
                "SELECT playlist_id, min(id) as item_id FROM playlist_items
                 WHERE track_id = ?1
                 GROUP BY playlist_id",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![track_id], |row| {
                Ok(PlaylistMembership {
                    playlist_id: row.get(0)?,
                    item_id: row.get(1)?,
                })
            })
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| e.to_string())?);
        }
        return Ok(out);
    }

    let clean_seg_id = segment_id.map(|s| s.trim()).filter(|s| !s.is_empty());
    if let Some(sid) = clean_seg_id {
        let mut stmt = conn
            .prepare(
                "SELECT playlist_id, id as item_id FROM playlist_items
                 WHERE track_id = ?1 AND segment_id = ?2",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![track_id, sid], |row| {
                Ok(PlaylistMembership {
                    playlist_id: row.get(0)?,
                    item_id: row.get(1)?,
                })
            })
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| e.to_string())?);
        }
        Ok(out)
    } else {
        let mut stmt = conn
            .prepare(
                "SELECT playlist_id, id as item_id FROM playlist_items
                 WHERE track_id = ?1 AND (segment_id IS NULL OR segment_id = '')",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![track_id], |row| {
                Ok(PlaylistMembership {
                    playlist_id: row.get(0)?,
                    item_id: row.get(1)?,
                })
            })
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| e.to_string())?);
        }
        Ok(out)
    }
}
