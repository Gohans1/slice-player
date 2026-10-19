use crate::models::{
    HeavyRotationItem, HomeSummary, PlayRecord, RecentlyPlayedItem, TopPlaylistItem,
};
use rusqlite::{params, Connection};
use serde_json::Value;

const SOURCE_TYPES: [&str; 5] = ["playlist", "mixed", "slices_only", "original_only", "home"];
const HEAVY_ROTATION_DAYS: i64 = 30;
const HEAVY_ROTATION_SIZE: i64 = 25;
const SHELF_SIZE: i64 = 12;

pub fn parse_play_record(body: &Value) -> Option<PlayRecord> {
    let obj = body.as_object()?;
    let track_id = obj.get("track_id")?.as_str()?;
    if track_id.is_empty() {
        return None;
    }

    let segment_id = match obj.get("segment_id") {
        Some(Value::Null) => None,
        Some(Value::String(s)) => Some(s.clone()),
        _ => return None,
    };

    let source_type = obj.get("source_type")?.as_str()?;
    if !SOURCE_TYPES.contains(&source_type) {
        return None;
    }

    let via_home = obj.get("via_home")?.as_bool()?;

    let playlist_id = if source_type == "playlist" {
        let pid = obj.get("playlist_id")?.as_str()?;
        if pid.is_empty() {
            return None;
        }
        Some(pid.to_string())
    } else {
        None
    };

    Some(PlayRecord {
        track_id: track_id.to_string(),
        segment_id,
        source_type: source_type.to_string(),
        playlist_id,
        via_home,
    })
}

pub fn record_play_in_conn(conn: &Connection, play: &PlayRecord) -> Result<bool, String> {
    let changes = conn
        .execute(
            "
            INSERT INTO plays (track_id, segment_id, source_type, playlist_id, via_home)
            SELECT t.id,
              (SELECT s.id FROM segments s WHERE s.id = ?2 AND s.track_id = t.id),
              ?3,
              (SELECT p.id FROM playlists p WHERE p.id = ?4),
              ?5
            FROM tracks t WHERE t.id = ?1
            ",
            params![
                play.track_id,
                play.segment_id,
                play.source_type,
                play.playlist_id,
                if play.via_home { 1 } else { 0 }
            ],
        )
        .map_err(|e| e.to_string())?;
    Ok(changes == 1)
}

pub fn get_home_summary_in_conn(conn: &Connection, now: i64) -> Result<HomeSummary, String> {
    let since = now - HEAVY_ROTATION_DAYS * 24 * 60 * 60;

    let recently_played = {
        let mut stmt = conn
            .prepare(
                "
                SELECT source_type, playlist_id FROM plays
                WHERE source_type != 'home' AND (source_type != 'playlist' OR playlist_id IS NOT NULL)
                GROUP BY source_type, playlist_id
                ORDER BY MAX(played_at) DESC, MAX(id) DESC
                LIMIT ?1
                ",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![SHELF_SIZE], |row| {
                Ok(RecentlyPlayedItem {
                    source_type: row.get(0)?,
                    playlist_id: row.get(1)?,
                })
            })
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| e.to_string())?);
        }
        out
    };

    let heavy_rotation = {
        let mut stmt = conn
            .prepare(
                "
                SELECT p.track_id, COUNT(*) AS plays FROM plays p
                JOIN tracks t ON t.id = p.track_id AND t.status = 'ready'
                WHERE p.played_at >= ?1
                GROUP BY p.track_id
                ORDER BY plays DESC, MAX(p.played_at) DESC, MAX(p.id) DESC
                LIMIT ?2
                ",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![since, HEAVY_ROTATION_SIZE], |row| {
                Ok(HeavyRotationItem {
                    track_id: row.get(0)?,
                    plays: row.get(1)?,
                })
            })
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| e.to_string())?);
        }
        out
    };

    let top_playlists = {
        let mut stmt = conn
            .prepare(
                "
                SELECT playlist_id, COUNT(*) AS plays FROM plays
                WHERE source_type = 'playlist' AND playlist_id IS NOT NULL AND played_at >= ?1
                GROUP BY playlist_id
                ORDER BY plays DESC, MAX(played_at) DESC, MAX(id) DESC
                LIMIT ?2
                ",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![since, SHELF_SIZE], |row| {
                Ok(TopPlaylistItem {
                    playlist_id: row.get(0)?,
                    plays: row.get(1)?,
                })
            })
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| e.to_string())?);
        }
        out
    };

    Ok(HomeSummary {
        recently_played,
        heavy_rotation,
        top_playlists,
    })
}
