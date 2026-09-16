import { Database, constants } from "bun:sqlite";
import { mkdirSync, existsSync, readdirSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Track, Segment } from "./types";

let dbInstance: Database | null = null;

export function initDatabase(dbPath: string = "./data/music.db"): Database {
  if (dbInstance) {
    try {
      dbInstance.close(true);
    } catch {}
    dbInstance = null;
  }

  const dir = dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // Ensure cache directories exist in project folder
  mkdirSync("./data/cache/audio", { recursive: true });
  mkdirSync("./data/cache/thumbs", { recursive: true });

  const db = new Database(dbPath, { create: true });
  db.run("PRAGMA journal_mode = WAL;");
  db.run("PRAGMA busy_timeout = 5000;");
  db.run("PRAGMA foreign_keys = ON;");
  if (constants?.SQLITE_FCNTL_PERSIST_WAL) {
    db.fileControl(constants.SQLITE_FCNTL_PERSIST_WAL, 0);
  }

  // Schema creation
  db.run(`
    CREATE TABLE IF NOT EXISTS tracks (
      id TEXT PRIMARY KEY,
      source_type TEXT NOT NULL CHECK(source_type IN ('youtube', 'local')),
      source_uri TEXT NOT NULL,
      title TEXT NOT NULL,
      artist TEXT DEFAULT '',
      duration REAL NOT NULL,
      thumbnail_url TEXT DEFAULT '',
      file_path TEXT,
      peaks_json TEXT,
      status TEXT DEFAULT 'ready' CHECK(status IN ('queued', 'downloading', 'ready', 'error')),
      error_message TEXT,
      created_at INTEGER DEFAULT (unixepoch())
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS segments (
      id TEXT PRIMARY KEY,
      track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      start_time REAL NOT NULL,
      end_time REAL NOT NULL,
      color TEXT DEFAULT '#4385BE',
      sort_order INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (unixepoch()),
      CONSTRAINT chk_time CHECK (end_time > start_time)
    );
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_segments_track ON segments(track_id);`);

  db.run(`
    CREATE TABLE IF NOT EXISTS playlists (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at INTEGER DEFAULT (unixepoch())
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS playlist_items (
      id TEXT PRIMARY KEY,
      playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
      segment_id TEXT NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
      sort_order INTEGER DEFAULT 0
    );
  `);

  // Startup recovery: reconcile interrupted downloads from previous process crash
  db.run(`
    UPDATE tracks 
    SET status = 'error', error_message = 'Bị gián đoạn do ứng dụng đóng' 
    WHERE status IN ('downloading', 'queued');
  `);

  // Startup cleanup: purge residual .part, .ytdl or orphaned cache files from disk
  try {
    const audioCacheDir = "./data/cache/audio";
    if (existsSync(audioCacheDir)) {
      const existingFiles = readdirSync(audioCacheDir);
      const norm = (p: string) => process.platform === "win32" ? resolve(p).toLowerCase() : resolve(p);
      const rows = db.query("SELECT id, file_path FROM tracks WHERE file_path IS NOT NULL").all() as { id: string; file_path: string }[];
      const validPaths = new Set(rows.map((r) => norm(r.file_path)));

      for (const file of existingFiles) {
        if (file.endsWith(".part") || file.endsWith(".ytdl")) {
          try { unlinkSync(join(audioCacheDir, file)); } catch {}
        } else {
          const resolvedPath = resolve(join(audioCacheDir, file));
          if (!validPaths.has(norm(resolvedPath))) {
            try { unlinkSync(resolvedPath); } catch {}
          }
        }
      }
    }

    const thumbCacheDir = "./data/cache/thumbs";
    if (existsSync(thumbCacheDir)) {
      const existingThumbs = readdirSync(thumbCacheDir);
      const trackRows = db.query("SELECT id FROM tracks").all() as { id: string }[];
      const validTrackIds = new Set(trackRows.map((r) => r.id));
      for (const thumb of existingThumbs) {
        const dotIdx = thumb.lastIndexOf(".");
        const trackId = dotIdx !== -1 ? thumb.slice(0, dotIdx) : thumb;
        if (!validTrackIds.has(trackId)) {
          try { unlinkSync(join(thumbCacheDir, thumb)); } catch {}
        }
      }
    }
  } catch {}

  dbInstance = db;
  return db;
}

export function getDb(): Database {
  if (!dbInstance) {
    return initDatabase();
  }
  return dbInstance;
}

// --- TRACK OPERATIONS ---

export function createTrack(track: Omit<Track, 'created_at'>): Track {
  const db = getDb();
  const query = db.query(`
    INSERT INTO tracks (
      id, source_type, source_uri, title, artist, duration,
      thumbnail_url, file_path, peaks_json, status, error_message
    ) VALUES (
      $id, $source_type, $source_uri, $title, $artist, $duration,
      $thumbnail_url, $file_path, $peaks_json, $status, $error_message
    )
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      artist = excluded.artist
    RETURNING *;
  `);

  return query.get({
    $id: track.id,
    $source_type: track.source_type,
    $source_uri: track.source_uri,
    $title: track.title,
    $artist: track.artist ?? '',
    $duration: track.duration,
    $thumbnail_url: track.thumbnail_url ?? '',
    $file_path: track.file_path ?? null,
    $peaks_json: track.peaks_json ?? null,
    $status: track.status ?? 'ready',
    $error_message: track.error_message ?? null,
  }) as Track;
}

export function updateTrack(id: string, updates: Partial<Track>): Track | null {
  const db = getDb();
  const allowedKeys: (keyof Track)[] = [
    "title", "artist", "duration", "thumbnail_url",
    "file_path", "peaks_json", "status", "error_message"
  ];
  const keysToUpdate = Object.keys(updates).filter((k) => (updates as any)[k] !== undefined && allowedKeys.includes(k as keyof Track));
  if (keysToUpdate.length === 0) return getTrack(id);

  const setClauses = keysToUpdate.map((k) => `${k} = $${k}`).join(", ");
  const params: Record<string, any> = { $id: id };
  for (const k of keysToUpdate) {
    params[`$${k}`] = (updates as any)[k] ?? null;
  }

  const query = db.query(`
    UPDATE tracks
    SET ${setClauses}
    WHERE id = $id
    RETURNING *;
  `);

  return query.get(params) as Track | null;
}

export function getTrack(id: string): Track | null {
  const db = getDb();
  return db.query("SELECT * FROM tracks WHERE id = $id").get({ $id: id }) as Track | null;
}

export function listTracks(): (Track & { segment_count: number })[] {
  const db = getDb();
  return db.query(`
    SELECT tracks.id, tracks.source_type, tracks.source_uri, tracks.title,
           tracks.artist, tracks.duration, tracks.thumbnail_url, tracks.file_path,
           tracks.status, tracks.error_message, tracks.created_at,
           COUNT(segments.id) AS segment_count
    FROM tracks
    LEFT JOIN segments ON tracks.id = segments.track_id
    GROUP BY tracks.id
    ORDER BY tracks.created_at DESC
  `).all() as (Track & { segment_count: number })[];
}

export function deleteTrack(id: string): boolean {
  const db = getDb();
  const res = db.query("DELETE FROM tracks WHERE id = $id").run({ $id: id });
  return res.changes > 0;
}

// --- SEGMENT OPERATIONS ---

export function getSegment(id: string): Segment | null {
  const db = getDb();
  return db.query("SELECT * FROM segments WHERE id = $id").get({ $id: id }) as Segment | null;
}

export function createSegment(seg: Omit<Segment, 'created_at'>): Segment {
  const db = getDb();
  const query = db.query(`
    INSERT INTO segments (
      id, track_id, name, start_time, end_time, color, sort_order
    ) VALUES (
      $id, $track_id, $name, $start_time, $end_time, $color, $sort_order
    ) RETURNING *;
  `);

  return query.get({
    $id: seg.id,
    $track_id: seg.track_id,
    $name: seg.name,
    $start_time: seg.start_time,
    $end_time: seg.end_time,
    $color: seg.color ?? '#4385BE',
    $sort_order: seg.sort_order ?? 0,
  }) as Segment;
}

export function updateSegment(id: string, updates: Partial<Segment>): Segment | null {
  const db = getDb();
  const allowedKeys: (keyof Segment)[] = [
    "name", "start_time", "end_time", "color", "sort_order"
  ];
  const keysToUpdate = Object.keys(updates).filter((k) => (updates as any)[k] !== undefined && allowedKeys.includes(k as keyof Segment));
  if (keysToUpdate.length === 0) {
    return db.query("SELECT * FROM segments WHERE id = $id").get({ $id: id }) as Segment | null;
  }

  const setClauses = keysToUpdate.map((k) => `${k} = $${k}`).join(", ");
  const params: Record<string, any> = { $id: id };
  for (const k of keysToUpdate) {
    params[`$${k}`] = (updates as any)[k] ?? null;
  }

  const query = db.query(`
    UPDATE segments
    SET ${setClauses}
    WHERE id = $id
    RETURNING *;
  `);

  return query.get(params) as Segment | null;
}

export function closeDatabase(): void {
  if (dbInstance) {
    try {
      dbInstance.run("PRAGMA wal_checkpoint(TRUNCATE);");
      dbInstance.close(true);
    } catch (e) {
      console.error("[DB] Error closing database:", e);
    }
    dbInstance = null;
  }
}

export function listSegmentsByTrack(trackId: string): Segment[] {
  const db = getDb();
  return db.query("SELECT * FROM segments WHERE track_id = $track_id ORDER BY start_time ASC").all({ $track_id: trackId }) as Segment[];
}

export function listAllSegments(): Segment[] {
  const db = getDb();
  return db.query("SELECT * FROM segments ORDER BY created_at DESC").all() as Segment[];
}

export function deleteSegment(id: string): boolean {
  const db = getDb();
  const res = db.query("DELETE FROM segments WHERE id = $id").run({ $id: id });
  return res.changes > 0;
}
