import { getDb } from "./db";
import type { HomeSummary, PlayRecord, PlaySourceType } from "./types";

const SOURCE_TYPES: readonly PlaySourceType[] = ["playlist", "mixed", "slices_only", "original_only", "home"];
const HEAVY_ROTATION_DAYS = 30;
const HEAVY_ROTATION_SIZE = 25;
const SHELF_SIZE = 12;

// A play as the client posts it, or null when it isn't one
export function parsePlayRecord(body: unknown): PlayRecord | null {
  if (typeof body !== "object" || body === null) return null;
  const { track_id, segment_id, source_type, playlist_id, via_home } = body as Record<string, unknown>;
  if (typeof track_id !== "string" || !track_id) return null;
  if (segment_id !== null && typeof segment_id !== "string") return null;
  if (!SOURCE_TYPES.includes(source_type as PlaySourceType)) return null;
  if (typeof via_home !== "boolean") return null;
  const isPlaylist = source_type === "playlist";
  if (isPlaylist && (typeof playlist_id !== "string" || !playlist_id)) return null;
  return {
    track_id,
    segment_id,
    source_type: source_type as PlaySourceType,
    playlist_id: isPlaylist ? (playlist_id as string) : null,
    via_home,
  };
}

// False when the song is gone. A slice or playlist deleted while it played is left out, and the song still counts
export function recordPlay(play: PlayRecord): boolean {
  const result = getDb()
    .query(
      `INSERT INTO plays (track_id, segment_id, source_type, playlist_id, via_home)
       SELECT t.id,
         (SELECT s.id FROM segments s WHERE s.id = $segment_id AND s.track_id = t.id),
         $source_type,
         (SELECT p.id FROM playlists p WHERE p.id = $playlist_id),
         $via_home
       FROM tracks t WHERE t.id = $track_id`
    )
    .run({
      $track_id: play.track_id,
      $segment_id: play.segment_id,
      $source_type: play.source_type,
      $playlist_id: play.playlist_id,
      $via_home: play.via_home ? 1 : 0,
    });
  return result.changes === 1;
}

export function getHomeSummary(now = Math.floor(Date.now() / 1000)): HomeSummary {
  const db = getDb();
  const since = now - HEAVY_ROTATION_DAYS * 24 * 60 * 60;
  // Home's own lists are already on Home, and a deleted playlist can't be opened
  const recently_played = db
    .query(
      `SELECT source_type, playlist_id FROM plays
       WHERE source_type != 'home' AND (source_type != 'playlist' OR playlist_id IS NOT NULL)
       GROUP BY source_type, playlist_id
       ORDER BY MAX(played_at) DESC, MAX(id) DESC
       LIMIT $limit`
    )
    .all({ $limit: SHELF_SIZE }) as HomeSummary["recently_played"];
  // A slice's plays count for its song, however it was heard
  const heavy_rotation = db
    .query(
      `SELECT p.track_id, COUNT(*) AS plays FROM plays p
       JOIN tracks t ON t.id = p.track_id AND t.status = 'ready'
       WHERE p.played_at >= $since
       GROUP BY p.track_id
       ORDER BY plays DESC, MAX(p.played_at) DESC, MAX(p.id) DESC
       LIMIT $limit`
    )
    .all({ $since: since, $limit: HEAVY_ROTATION_SIZE }) as HomeSummary["heavy_rotation"];
  const top_playlists = db
    .query(
      `SELECT playlist_id, COUNT(*) AS plays FROM plays
       WHERE source_type = 'playlist' AND playlist_id IS NOT NULL AND played_at >= $since
       GROUP BY playlist_id
       ORDER BY plays DESC, MAX(played_at) DESC, MAX(id) DESC
       LIMIT $limit`
    )
    .all({ $since: since, $limit: SHELF_SIZE }) as HomeSummary["top_playlists"];
  return { recently_played, heavy_rotation, top_playlists };
}
