use crate::models::{NewSegment, NewTrack, Segment, SegmentUpdates, Track, TrackUpdates};
use rusqlite::{params, params_from_iter, Connection, OptionalExtension, Row};

pub fn validate_volume(vol: f64) -> bool {
    vol.is_finite() && (0.0..=1.0).contains(&vol)
}

pub fn clamp_volume(vol: Option<f64>) -> f64 {
    match vol {
        Some(v) if v.is_finite() => v.clamp(0.0, 1.0),
        _ => 0.5,
    }
}

pub fn row_to_track_full(row: &Row<'_>) -> rusqlite::Result<Track> {
    Ok(Track {
        id: row.get("id")?,
        source_type: row.get("source_type")?,
        source_uri: row.get("source_uri")?,
        title: row.get("title")?,
        artist: row.get::<_, Option<String>>("artist")?.unwrap_or_default(),
        duration: row.get("duration")?,
        thumbnail_url: row
            .get::<_, Option<String>>("thumbnail_url")?
            .unwrap_or_default(),
        file_path: row.get("file_path")?,
        peaks_json: row.get("peaks_json")?,
        status: row
            .get::<_, Option<String>>("status")?
            .unwrap_or_else(|| "ready".to_string()),
        error_message: row.get("error_message")?,
        volume: row.get::<_, Option<f64>>("volume")?.unwrap_or(0.5),
        loudness: row.get("loudness").ok().flatten(),
        true_peak: row.get("true_peak").ok().flatten(),
        created_at: row.get("created_at")?,
        segment_count: None,
        download_index: None,
    })
}

pub fn row_to_segment(row: &Row<'_>) -> rusqlite::Result<Segment> {
    Ok(Segment {
        id: row.get("id")?,
        track_id: row.get("track_id")?,
        name: row.get("name")?,
        start_time: row.get("start_time")?,
        end_time: row.get("end_time")?,
        color: row
            .get::<_, Option<String>>("color")?
            .unwrap_or_else(|| "#4385BE".to_string()),
        sort_order: row.get::<_, Option<i64>>("sort_order")?.unwrap_or(0),
        created_at: row.get("created_at")?,
    })
}

pub fn create_track_in_conn(conn: &Connection, track: &NewTrack) -> Result<Track, String> {
    let volume = clamp_volume(track.volume);
    conn.query_row(
        "
        INSERT INTO tracks (
          id, source_type, source_uri, title, artist, duration,
          thumbnail_url, file_path, peaks_json, status, error_message, volume, loudness, true_peak
        ) VALUES (
          ?1, ?2, ?3, ?4, ?5, ?6,
          ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14
        )
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          artist = excluded.artist
        RETURNING *;
        ",
        params![
            track.id,
            track.source_type,
            track.source_uri,
            track.title,
            track.artist.clone().unwrap_or_default(),
            track.duration,
            track.thumbnail_url.clone().unwrap_or_default(),
            track.file_path,
            track.peaks_json,
            track.status.clone().unwrap_or_else(|| "ready".to_string()),
            track.error_message,
            volume,
            track.loudness,
            track.true_peak,
        ],
        row_to_track_full,
    )
    .map_err(|e| e.to_string())
}

pub fn get_track_in_conn(conn: &Connection, id: &str) -> Result<Option<Track>, String> {
    conn.query_row(
        "SELECT * FROM tracks WHERE id = ?1",
        params![id],
        row_to_track_full,
    )
    .optional()
    .map_err(|e| e.to_string())
}

pub fn update_track_in_conn(
    conn: &Connection,
    id: &str,
    updates: &TrackUpdates,
) -> Result<Option<Track>, String> {
    let Some(mut current) = get_track_in_conn(conn, id)? else {
        return Ok(None);
    };

    let mut any_changed = false;
    if let Some(ref title) = updates.title {
        current.title = title.clone();
        any_changed = true;
    }
    if let Some(ref artist) = updates.artist {
        current.artist = artist.clone();
        any_changed = true;
    }
    if let Some(duration) = updates.duration {
        current.duration = duration;
        any_changed = true;
    }
    if let Some(ref thumbnail_url) = updates.thumbnail_url {
        current.thumbnail_url = thumbnail_url.clone();
        any_changed = true;
    }
    let mut file_path_changed = false;
    if let Some(ref file_path) = updates.file_path {
        current.file_path = file_path.clone();
        file_path_changed = true;
        any_changed = true;
    }
    if let Some(ref peaks_json) = updates.peaks_json {
        current.peaks_json = peaks_json.clone();
        any_changed = true;
    }
    if let Some(ref status) = updates.status {
        current.status = status.clone();
        any_changed = true;
    }
    if let Some(ref error_message) = updates.error_message {
        current.error_message = error_message.clone();
        any_changed = true;
    }
    if let Some(vol) = updates.volume {
        if vol.is_finite() {
            current.volume = vol.clamp(0.0, 1.0);
            any_changed = true;
        }
    }

    // If file_path is updated, reset loudness and true_peak to None unless explicitly supplied
    if file_path_changed {
        current.loudness = updates.loudness.flatten();
        current.true_peak = updates.true_peak.flatten();
    } else {
        if let Some(loudness) = updates.loudness {
            current.loudness = loudness;
            any_changed = true;
        }
        if let Some(true_peak) = updates.true_peak {
            current.true_peak = true_peak;
            any_changed = true;
        }
    }

    if !any_changed {
        return Ok(Some(current));
    }

    conn.query_row(
        "
        UPDATE tracks
        SET title = ?1,
            artist = ?2,
            duration = ?3,
            thumbnail_url = ?4,
            file_path = ?5,
            peaks_json = ?6,
            status = ?7,
            error_message = ?8,
            volume = ?9,
            loudness = ?10,
            true_peak = ?11
        WHERE id = ?12
        RETURNING *;
        ",
        params![
            current.title,
            current.artist,
            current.duration,
            current.thumbnail_url,
            current.file_path,
            current.peaks_json,
            current.status,
            current.error_message,
            current.volume,
            current.loudness,
            current.true_peak,
            id,
        ],
        row_to_track_full,
    )
    .optional()
    .map_err(|e| e.to_string())
}

pub fn list_tracks_in_conn(conn: &Connection) -> Result<Vec<Track>, String> {
    let mut stmt = conn
        .prepare(
            "
            SELECT tracks.id, tracks.source_type, tracks.source_uri, tracks.title,
                   tracks.artist, tracks.duration, tracks.thumbnail_url, tracks.file_path,
                   tracks.status, tracks.error_message, tracks.volume, tracks.loudness, tracks.true_peak, tracks.created_at,
                   (SELECT COUNT(*) FROM segments WHERE segments.track_id = tracks.id) AS segment_count
            FROM tracks
            ORDER BY tracks.created_at DESC
            ",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(Track {
                id: row.get("id")?,
                source_type: row.get("source_type")?,
                source_uri: row.get("source_uri")?,
                title: row.get("title")?,
                artist: row.get::<_, Option<String>>("artist")?.unwrap_or_default(),
                duration: row.get("duration")?,
                thumbnail_url: row
                    .get::<_, Option<String>>("thumbnail_url")?
                    .unwrap_or_default(),
                file_path: row.get("file_path")?,
                peaks_json: None,
                status: row
                    .get::<_, Option<String>>("status")?
                    .unwrap_or_else(|| "ready".to_string()),
                error_message: row.get("error_message")?,
                volume: row.get::<_, Option<f64>>("volume")?.unwrap_or(0.5),
                loudness: row.get("loudness").ok().flatten(),
                true_peak: row.get("true_peak").ok().flatten(),
                created_at: row.get("created_at")?,
                segment_count: Some(row.get("segment_count")?),
                download_index: None,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

pub fn list_tracks_to_measure_in_conn(conn: &Connection) -> Result<Vec<(String, String)>, String> {
    let mut stmt = conn
        .prepare(
            "
            SELECT id, file_path FROM tracks
            WHERE status = 'ready' AND file_path IS NOT NULL AND loudness IS NULL
            ORDER BY created_at DESC
            ",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

pub fn set_track_loudness_in_conn(
    conn: &Connection,
    id: &str,
    loudness: f64,
    true_peak: f64,
) -> Result<(), String> {
    conn.execute(
        "UPDATE tracks SET loudness = ?1, true_peak = ?2 WHERE id = ?3",
        params![loudness, true_peak, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn get_tracks_batch_in_conn(
    conn: &Connection,
    ids: &[String],
) -> Result<Vec<(String, Option<String>)>, String> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for chunk in ids.chunks(500) {
        let placeholders = vec!["?"; chunk.len()].join(",");
        let sql = format!("SELECT id, file_path FROM tracks WHERE id IN ({placeholders})");
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params_from_iter(chunk.iter()), |row| {
                Ok((row.get(0)?, row.get(1)?))
            })
            .map_err(|e| e.to_string())?;
        for r in rows {
            out.push(r.map_err(|e| e.to_string())?);
        }
    }
    Ok(out)
}

pub fn delete_track_in_conn(conn: &Connection, id: &str) -> Result<bool, String> {
    let changed = conn
        .execute("DELETE FROM tracks WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(changed > 0)
}

pub fn delete_tracks_batch_in_conn(conn: &mut Connection, ids: &[String]) -> Result<usize, String> {
    if ids.is_empty() {
        return Ok(0);
    }
    let mut deleted = 0usize;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for chunk in ids.chunks(500) {
        let placeholders = vec!["?"; chunk.len()].join(",");
        let sql = format!("DELETE FROM tracks WHERE id IN ({placeholders})");
        let changes = tx
            .execute(&sql, params_from_iter(chunk.iter()))
            .map_err(|e| e.to_string())?;
        deleted += changes;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(deleted)
}

pub fn get_segment_in_conn(conn: &Connection, id: &str) -> Result<Option<Segment>, String> {
    conn.query_row(
        "SELECT * FROM segments WHERE id = ?1",
        params![id],
        row_to_segment,
    )
    .optional()
    .map_err(|e| e.to_string())
}

pub fn create_segment_in_conn(conn: &Connection, seg: &NewSegment) -> Result<Segment, String> {
    conn.query_row(
        "
        INSERT INTO segments (
          id, track_id, name, start_time, end_time, color, sort_order
        ) VALUES (
          ?1, ?2, ?3, ?4, ?5, ?6, ?7
        ) RETURNING *;
        ",
        params![
            seg.id,
            seg.track_id,
            seg.name,
            seg.start_time,
            seg.end_time,
            seg.color.clone().unwrap_or_else(|| "#4385BE".to_string()),
            seg.sort_order.unwrap_or(0),
        ],
        row_to_segment,
    )
    .map_err(|e| e.to_string())
}

pub fn update_segment_in_conn(
    conn: &Connection,
    id: &str,
    updates: &SegmentUpdates,
) -> Result<Option<Segment>, String> {
    let Some(mut current) = get_segment_in_conn(conn, id)? else {
        return Ok(None);
    };
    let mut changed = false;
    if let Some(ref name) = updates.name {
        current.name = name.clone();
        changed = true;
    }
    if let Some(start_time) = updates.start_time {
        current.start_time = start_time;
        changed = true;
    }
    if let Some(end_time) = updates.end_time {
        current.end_time = end_time;
        changed = true;
    }
    if let Some(ref color) = updates.color {
        current.color = color.clone();
        changed = true;
    }
    if let Some(sort_order) = updates.sort_order {
        current.sort_order = sort_order;
        changed = true;
    }
    if !changed {
        return Ok(Some(current));
    }

    conn.query_row(
        "
        UPDATE segments
        SET name = ?1,
            start_time = ?2,
            end_time = ?3,
            color = ?4,
            sort_order = ?5
        WHERE id = ?6
        RETURNING *;
        ",
        params![
            current.name,
            current.start_time,
            current.end_time,
            current.color,
            current.sort_order,
            id,
        ],
        row_to_segment,
    )
    .optional()
    .map_err(|e| e.to_string())
}

pub fn list_segments_by_track_in_conn(
    conn: &Connection,
    track_id: &str,
) -> Result<Vec<Segment>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT * FROM segments WHERE track_id = ?1 ORDER BY sort_order ASC, start_time ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![track_id], row_to_segment)
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

pub fn list_segments_by_track_ids_in_conn(
    conn: &Connection,
    track_ids: &[String],
) -> Result<Vec<(String, String)>, String> {
    if track_ids.is_empty() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for chunk in track_ids.chunks(500) {
        let placeholders = vec!["?"; chunk.len()].join(",");
        let sql = format!("SELECT id, track_id FROM segments WHERE track_id IN ({placeholders})");
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params_from_iter(chunk.iter()), |row| {
                Ok((row.get(0)?, row.get(1)?))
            })
            .map_err(|e| e.to_string())?;
        for r in rows {
            out.push(r.map_err(|e| e.to_string())?);
        }
    }
    Ok(out)
}

pub fn list_all_segments_in_conn(conn: &Connection) -> Result<Vec<Segment>, String> {
    let mut stmt = conn
        .prepare("SELECT * FROM segments ORDER BY created_at DESC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], row_to_segment)
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

pub fn delete_segment_in_conn(conn: &Connection, id: &str) -> Result<bool, String> {
    let changes = conn
        .execute("DELETE FROM segments WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(changes > 0)
}

pub fn delete_segments_batch_in_conn(
    conn: &mut Connection,
    ids: &[String],
) -> Result<usize, String> {
    if ids.is_empty() {
        return Ok(0);
    }
    let mut deleted = 0usize;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for chunk in ids.chunks(500) {
        let placeholders = vec!["?"; chunk.len()].join(",");
        let sql = format!("DELETE FROM segments WHERE id IN ({placeholders})");
        let changes = tx
            .execute(&sql, params_from_iter(chunk.iter()))
            .map_err(|e| e.to_string())?;
        deleted += changes;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(deleted)
}

pub fn reconcile_track_segments_in_conn(
    conn: &mut Connection,
    track_id: &str,
    duration: f64,
) -> Result<(Vec<String>, Vec<String>), String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let pruned: Vec<String> = {
        let mut stmt = tx
            .prepare("SELECT id FROM segments WHERE track_id = ?1 AND (?2 - start_time < 0.5)")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![track_id, duration], |row| row.get(0))
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| e.to_string())?);
        }
        out
    };
    tx.execute(
        "DELETE FROM segments WHERE track_id = ?1 AND (?2 - start_time < 0.5)",
        params![track_id, duration],
    )
    .map_err(|e| e.to_string())?;

    let clamped: Vec<String> = {
        let mut stmt = tx
            .prepare("SELECT id FROM segments WHERE track_id = ?1 AND end_time > ?2")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![track_id, duration], |row| row.get(0))
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| e.to_string())?);
        }
        out
    };
    tx.execute(
        "UPDATE segments SET end_time = ?2 WHERE track_id = ?1 AND end_time > ?2",
        params![track_id, duration],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;

    Ok((pruned, clamped))
}

pub fn get_affected_playlist_ids_for_tracks_in_conn(
    conn: &Connection,
    track_ids: &[String],
) -> Result<Vec<String>, String> {
    if track_ids.is_empty() {
        return Ok(Vec::new());
    }
    let mut direct_set = std::collections::HashSet::new();
    let mut direct_vec = Vec::new();
    for chunk in track_ids.chunks(500) {
        let placeholders = vec!["?"; chunk.len()].join(",");
        let sql = format!(
            "SELECT DISTINCT playlist_id FROM playlist_items WHERE track_id IN ({placeholders})"
        );
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params_from_iter(chunk.iter()), |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        for r in rows {
            let pid = r.map_err(|e| e.to_string())?;
            if direct_set.insert(pid.clone()) {
                direct_vec.push(pid);
            }
        }
    }
    let mut all_vec = direct_vec.clone();
    for chunk in direct_vec.chunks(500) {
        let placeholders = vec!["?"; chunk.len()].join(",");
        let sql = format!(
            "SELECT DISTINCT mix_playlist_id FROM playlist_sources WHERE source_playlist_id IN ({placeholders})"
        );
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params_from_iter(chunk.iter()), |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        for r in rows {
            let mid = r.map_err(|e| e.to_string())?;
            if direct_set.insert(mid.clone()) {
                all_vec.push(mid);
            }
        }
    }
    Ok(all_vec)
}

pub fn get_affected_playlist_ids_for_segments_in_conn(
    conn: &Connection,
    segment_ids: &[String],
) -> Result<Vec<String>, String> {
    if segment_ids.is_empty() {
        return Ok(Vec::new());
    }
    let mut direct_set = std::collections::HashSet::new();
    let mut direct_vec = Vec::new();
    for chunk in segment_ids.chunks(500) {
        let placeholders = vec!["?"; chunk.len()].join(",");
        let sql = format!(
            "SELECT DISTINCT playlist_id FROM playlist_items WHERE segment_id IN ({placeholders})"
        );
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params_from_iter(chunk.iter()), |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        for r in rows {
            let pid = r.map_err(|e| e.to_string())?;
            if direct_set.insert(pid.clone()) {
                direct_vec.push(pid);
            }
        }
    }
    let mut all_vec = direct_vec.clone();
    for chunk in direct_vec.chunks(500) {
        let placeholders = vec!["?"; chunk.len()].join(",");
        let sql = format!(
            "SELECT DISTINCT mix_playlist_id FROM playlist_sources WHERE source_playlist_id IN ({placeholders})"
        );
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params_from_iter(chunk.iter()), |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        for r in rows {
            let mid = r.map_err(|e| e.to_string())?;
            if direct_set.insert(mid.clone()) {
                all_vec.push(mid);
            }
        }
    }
    Ok(all_vec)
}

