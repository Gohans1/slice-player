import { getDb } from "./db";
import type { HomeSummary, PlayRecord, PlaySourceType } from "./types";

const SOURCE_TYPES: readonly PlaySourceType[] = ["playlist", "mixed", "slices_only", "original_only", "home"];
const HEAVY_ROTATION_DAYS = 30;
const HEAVY_ROTATION_SIZE = 25;
const SHELF_SIZE = 12;

function isSourceType(value: unknown): value is PlaySourceType {
  return SOURCE_TYPES.some((type) => type === value);
}

// A play as the client posts it, or null when it isn't one
export function parsePlayRecord(body: unknown): PlayRecord | null {
  if (typeof body !== "object" || body === null) return null;
  const field = (key: keyof PlayRecord): unknown => Reflect.get(body, key);
  const track_id = field("track_id");
  const segment_id = field("segment_id");
  const source_type = field("source_type");
  const playlist_id = field("playlist_id");
  const via_home = field("via_home");
  if (typeof track_id !== "string" || !track_id) return null;
  if (segment_id !== null && typeof segment_id !== "string") return null;
  if (!isSourceType(source_type) || typeof via_home !== "boolean") return null;
  // Only a playlist play names its playlist, and it must
  let playlistId: string | null = null;
  if (source_type === "playlist") {
    if (typeof playlist_id !== "string" || !playlist_id) return null;
    playlistId = playlist_id;
  }
  return { track_id, segment_id, source_type, playlist_id: playlistId, via_home };
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
    .query<HomeSummary["recently_played"][number], { $limit: number }>(
      `SELECT source_type, playlist_id FROM plays
       WHERE source_type != 'home' AND (source_type != 'playlist' OR playlist_id IS NOT NULL)
       GROUP BY source_type, playlist_id
       ORDER BY MAX(played_at) DESC, MAX(id) DESC
       LIMIT $limit`
    )
    .all({ $limit: SHELF_SIZE });
  // A slice's plays count for its song, however it was heard
  const heavy_rotation = db
    .query<HomeSummary["heavy_rotation"][number], { $since: number; $limit: number }>(
      `SELECT p.track_id, COUNT(*) AS plays FROM plays p
       JOIN tracks t ON t.id = p.track_id AND t.status = 'ready'
       WHERE p.played_at >= $since
       GROUP BY p.track_id
       ORDER BY plays DESC, MAX(p.played_at) DESC, MAX(p.id) DESC
       LIMIT $limit`
    )
    .all({ $since: since, $limit: HEAVY_ROTATION_SIZE });
  const top_playlists = db
    .query<HomeSummary["top_playlists"][number], { $since: number; $limit: number }>(
      `SELECT playlist_id, COUNT(*) AS plays FROM plays
       WHERE source_type = 'playlist' AND playlist_id IS NOT NULL AND played_at >= $since
       GROUP BY playlist_id
       ORDER BY plays DESC, MAX(played_at) DESC, MAX(id) DESC
       LIMIT $limit`
    )
    .all({ $since: since, $limit: SHELF_SIZE });
  return { recently_played, heavy_rotation, top_playlists };
}
