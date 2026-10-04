import { Database, constants } from "bun:sqlite";
import { mkdirSync, existsSync, readdirSync, unlinkSync } from "node:fs";
import { dirname, join, resolve, basename } from "node:path";
import type { Track, Segment, Playlist, PlaylistItem, PlaylistItemWithDetails } from "./types";

let dbInstance: Database | null = null;

function runMigrations(db: Database): void {
  try {
    const versionRow = db.query("PRAGMA user_version;").get() as { user_version: number } | null;
    const userVersion = versionRow?.user_version ?? 0;
    if (userVersion < 1) {
      db.transaction(() => {
        // v1: Ensure volume column exists for legacy tracks tables
        const cols = db.query("PRAGMA table_info(tracks);").all() as { name: string }[];
        if (!cols.some((c) => c.name === "volume")) {
          db.run("ALTER TABLE tracks ADD COLUMN volume REAL NOT NULL DEFAULT 0.5 CHECK(volume >= 0 AND volume <= 1);");
        }

        // v1: Upgrade legacy downscaled sqp thumbnails to maxresdefault
        db.run(`
          UPDATE tracks 
          SET thumbnail_url = 'https://i.ytimg.com/vi/' || SUBSTR(id, 4) || '/maxresdefault.jpg' 
          WHERE source_type = 'youtube' 
            AND SUBSTR(id, 1, 3) = 'yt_' 
            AND LENGTH(id) > 3
            AND thumbnail_url LIKE '%sqp=%';
        `);
        db.run("PRAGMA user_version = 1;");
      })();
    }

    if (userVersion < 2) {
      db.transaction(() => {
        // v2: Update legacy unadjusted default volume (0.8) to new default 0.5
        db.run("UPDATE tracks SET volume = 0.5 WHERE volume = 0.8;");
        db.run("PRAGMA user_version = 2;");
      })();
    }

    if (userVersion < 3) {
      db.transaction(() => {
        // v3: Add playlists and playlist_items tables with cascade delete
        db.run(`
          CREATE TABLE IF NOT EXISTS playlists (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            created_at INTEGER DEFAULT (unixepoch()),
            updated_at INTEGER DEFAULT (unixepoch()),
            is_custom_ordered INTEGER NOT NULL DEFAULT 0
          );
        `);
        db.run(`
          CREATE TABLE IF NOT EXISTS playlist_items (
            id TEXT PRIMARY KEY,
            playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
            track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
            segment_id TEXT REFERENCES segments(id) ON DELETE CASCADE,
            sort_order INTEGER NOT NULL DEFAULT 0,
            added_at INTEGER DEFAULT (unixepoch())
          );
        `);
        db.run(`CREATE INDEX IF NOT EXISTS idx_playlist_items_playlist ON playlist_items(playlist_id, sort_order ASC);`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_playlist_items_added ON playlist_items(playlist_id, added_at DESC, sort_order ASC);`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_playlist_items_track ON playlist_items(track_id);`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_playlist_items_segment ON playlist_items(segment_id);`);
        db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_playlist_items_unique ON playlist_items(playlist_id, track_id, IFNULL(segment_id, ''));`);
        db.run("PRAGMA user_version = 3;");
      })();
    } else {
      // Ensure unique index exists on existing v3 databases
      try {
        db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_playlist_items_unique ON playlist_items(playlist_id, track_id, IFNULL(segment_id, ''));`);
      } catch {}
    }

    if (userVersion < 4) {
      db.transaction(() => {
        // v4: Add is_custom_ordered flag to playlists to track manual drag-drop ordering
        const cols = db.query("PRAGMA table_info(playlists);").all() as { name: string }[];
        if (!cols.some((c) => c.name === "is_custom_ordered")) {
          db.run("ALTER TABLE playlists ADD COLUMN is_custom_ordered INTEGER NOT NULL DEFAULT 0;");
        }
        db.run("PRAGMA user_version = 4;");
      })();
    }

    if (userVersion < 5) {
      db.transaction(() => {
        // v5: Add indexes on tracks created_at and status for fast pagination and polling
        db.run("CREATE INDEX IF NOT EXISTS idx_tracks_created_at ON tracks(created_at DESC);");
        db.run("CREATE INDEX IF NOT EXISTS idx_tracks_status ON tracks(status);");
        db.run("PRAGMA user_version = 5;");
      })();
    }

    if (userVersion < 6) {
      db.transaction(() => {
        // v6: Add index on playlist_items for default added_at DESC sort
        db.run("CREATE INDEX IF NOT EXISTS idx_playlist_items_added ON playlist_items(playlist_id, added_at DESC, sort_order ASC);");
        db.run("PRAGMA user_version = 6;");
      })();
    }

    if (userVersion < 7) {
      db.transaction(() => {
        // v7: Optional playlist cover chosen from one of its tracks (guarded: migrations must stay re-runnable)
        const cols = db.query("PRAGMA table_info(playlists);").all() as { name: string }[];
        if (!cols.some((c) => c.name === "cover_track_id")) {
          db.run("ALTER TABLE playlists ADD COLUMN cover_track_id TEXT REFERENCES tracks(id) ON DELETE SET NULL;");
        }
        db.run("PRAGMA user_version = 7;");
      })();
    }

    if (userVersion < 8) {
      db.transaction(() => {
        // v8: Mix playlists are live views: no own items, only an ordered list of source playlists
        const cols = db.query("PRAGMA table_info(playlists);").all() as { name: string }[];
        if (!cols.some((c) => c.name === "is_mix")) {
          db.run("ALTER TABLE playlists ADD COLUMN is_mix INTEGER NOT NULL DEFAULT 0;");
        }
        db.run(`
          CREATE TABLE IF NOT EXISTS playlist_sources (
            mix_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
            source_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
            position INTEGER NOT NULL,
            PRIMARY KEY (mix_id, source_id)
          );
        `);
        db.run("CREATE INDEX IF NOT EXISTS idx_playlist_sources_source ON playlist_sources(source_id);");
        db.run("PRAGMA user_version = 8;");
      })();
    }

    if (userVersion < 9) {
      db.transaction(() => {
        // v9: Support sub-playlists with 1-level hierarchy
        const cols = db.query("PRAGMA table_info(playlists);").all() as { name: string }[];
        if (!cols.some((c) => c.name === "parent_id")) {
          db.run("ALTER TABLE playlists ADD COLUMN parent_id TEXT REFERENCES playlists(id) ON DELETE CASCADE;");
        }
        db.run("CREATE INDEX IF NOT EXISTS idx_playlists_parent_id ON playlists(parent_id);");
        db.run("PRAGMA user_version = 9;");
      })();
    }
  } catch (err) {
    console.error("[db] Error executing database migrations:", err);
    throw err;
  }
}

/**
 * Cross-platform basename extraction.
 * Handles both Windows ('\') and POSIX ('/') delimiters regardless of runtime OS.
 */
export function getCrossPlatformBasename(filePath: string): string {
  if (!filePath) return "";
  const parts = filePath.split(/[/\\]/);
  return parts.pop() || filePath;
}

export function healTrackFilePaths(customAudioDir?: string): number {
  const db = getDb();
  const audioCacheDir = resolve(customAudioDir || "./data/cache/audio");
  if (!existsSync(audioCacheDir)) return 0;

  const rows = db.query("SELECT id, file_path FROM tracks WHERE file_path IS NOT NULL").all() as { id: string; file_path: string }[];
  let healedCount = 0;

  db.transaction(() => {
    const updateStmt = db.prepare("UPDATE tracks SET file_path = $file_path WHERE id = $id");
    for (const row of rows) {
      if (!row.file_path) continue;
      if (!existsSync(row.file_path)) {
        const fileBase = getCrossPlatformBasename(row.file_path);
        const candidate = resolve(join(audioCacheDir, fileBase));
        if (existsSync(candidate)) {
          updateStmt.run({ $file_path: candidate, $id: row.id });
          healedCount++;
        }
      }
    }
  })();

  return healedCount;
}

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
  db.run("PRAGMA busy_timeout = 5000;");
  db.run("PRAGMA journal_mode = WAL;");
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
      duration REAL NOT NULL CHECK(duration >= 0 AND duration <= 1800),
      thumbnail_url TEXT DEFAULT '',
      file_path TEXT,
      peaks_json TEXT,
      status TEXT DEFAULT 'ready' CHECK(status IN ('queued', 'downloading', 'ready', 'error')),
      error_message TEXT,
      volume REAL NOT NULL DEFAULT 0.5 CHECK(volume >= 0 AND volume <= 1),
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
      CONSTRAINT chk_time CHECK (end_time > start_time AND start_time >= 0 AND end_time <= 1800)
    );
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_tracks_created_at ON tracks(created_at DESC);`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_tracks_status ON tracks(status);`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_segments_track ON segments(track_id);`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_segments_created_at ON segments(created_at DESC);`);

  // Execute versioned schema migrations
  runMigrations(db);

  // Set dbInstance before running helpers that query getDb()
  dbInstance = db;

  // Startup cleanup: heal paths and purge residual .part, .ytdl or orphaned cache files from disk
  if (dbPath === "./data/music.db" && process.env.NODE_ENV !== "test") {
    try {
      healTrackFilePaths();
      const audioCacheDir = "./data/cache/audio";
      if (existsSync(audioCacheDir)) {
        const existingFiles = readdirSync(audioCacheDir);
        const norm = (p: string) => process.platform === "win32" ? resolve(p).toLowerCase() : resolve(p);
        const rows = db.query("SELECT id, file_path FROM tracks WHERE file_path IS NOT NULL").all() as { id: string; file_path: string }[];
        const validPaths = new Set(rows.map((r) => norm(r.file_path)));
        const validBasenames = new Set(rows.map((r) => getCrossPlatformBasename(r.file_path).toLowerCase()));

        for (const file of existingFiles) {
          if (file.endsWith(".part") || file.endsWith(".ytdl")) {
            try { unlinkSync(join(audioCacheDir, file)); } catch {}
          } else {
            const resolvedPath = resolve(join(audioCacheDir, file));
            // Double safety safeguard: Don't delete if path matches OR basename matches a track in DB
            if (!validPaths.has(norm(resolvedPath)) && !validBasenames.has(file.toLowerCase())) {
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
  }

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
      thumbnail_url, file_path, peaks_json, status, error_message, volume
    ) VALUES (
      $id, $source_type, $source_uri, $title, $artist, $duration,
      $thumbnail_url, $file_path, $peaks_json, $status, $error_message, $volume
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
    $volume: typeof track.volume === "number" && Number.isFinite(track.volume)
      ? Math.max(0, Math.min(1, track.volume))
      : 0.5,
  }) as Track;
}

export function validateVolume(vol: unknown): boolean {
  return typeof vol === "number" && Number.isFinite(vol) && vol >= 0 && vol <= 1;
}

export function updateTrack(id: string, updates: Partial<Track>): Track | null {
  const db = getDb();
  const allowedKeys: (keyof Track)[] = [
    "title", "artist", "duration", "thumbnail_url",
    "file_path", "peaks_json", "status", "error_message", "volume"
  ];
  const keysToUpdate = Object.keys(updates).filter((k) => {
    if ((updates as any)[k] === undefined || !allowedKeys.includes(k as keyof Track)) return false;
    if (k === "volume") {
      const vol = (updates as any).volume;
      return typeof vol === "number" && Number.isFinite(vol);
    }
    return true;
  });
  if (keysToUpdate.length === 0) return getTrack(id);

  const setClauses = keysToUpdate.map((k) => `${k} = $${k}`).join(", ");
  const params: Record<string, any> = { $id: id };
  for (const k of keysToUpdate) {
    if (k === "volume") {
      const vol = (updates as any).volume;
      params[`$${k}`] = Math.max(0, Math.min(1, vol));
    } else {
      params[`$${k}`] = (updates as any)[k] ?? null;
    }
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
           tracks.status, tracks.error_message, tracks.volume, tracks.created_at,
           (SELECT COUNT(*) FROM segments WHERE segments.track_id = tracks.id) AS segment_count
    FROM tracks
    ORDER BY tracks.created_at DESC
  `).all() as (Track & { segment_count: number })[];
}

export function getTracksBatch(ids: string[]): { id: string; file_path: string | null }[] {
  if (!ids || ids.length === 0) return [];
  const db = getDb();
  const results: { id: string; file_path: string | null }[] = [];
  const CHUNK_SIZE = 500;
  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    const chunk = ids.slice(i, i + CHUNK_SIZE);
    const placeholders = chunk.map(() => "?").join(",");
    const rows = db.query(
      `SELECT id, file_path FROM tracks WHERE id IN (${placeholders})`
    ).all(...chunk) as { id: string; file_path: string | null }[];
    results.push(...rows);
  }
  return results;
}


export function deleteTrack(id: string): boolean {
  const db = getDb();
  const res = db.query("DELETE FROM tracks WHERE id = $id").run({ $id: id });
  return res.changes > 0;
}

export function deleteTracksBatch(ids: string[]): number {
  if (!ids || ids.length === 0) return 0;
  const db = getDb();
  let deletedCount = 0;
  const CHUNK_SIZE = 500;
  db.transaction(() => {
    for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
      const chunk = ids.slice(i, i + CHUNK_SIZE);
      const placeholders = chunk.map(() => "?").join(",");
      const res = db.query(`DELETE FROM tracks WHERE id IN (${placeholders})`).run(...chunk);
      deletedCount += res.changes;
    }
  })();
  return deletedCount;
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
  return db.query("SELECT * FROM segments WHERE track_id = $track_id ORDER BY sort_order ASC, start_time ASC").all({ $track_id: trackId }) as Segment[];
}

export function listSegmentsByTrackIds(trackIds: string[]): { id: string; track_id: string }[] {
  if (!trackIds || trackIds.length === 0) return [];
  const db = getDb();
  const results: { id: string; track_id: string }[] = [];
  const CHUNK_SIZE = 500;
  for (let i = 0; i < trackIds.length; i += CHUNK_SIZE) {
    const chunk = trackIds.slice(i, i + CHUNK_SIZE);
    const placeholders = chunk.map(() => "?").join(",");
    const rows = db.query(
      `SELECT id, track_id FROM segments WHERE track_id IN (${placeholders})`
    ).all(...chunk) as { id: string; track_id: string }[];
    results.push(...rows);
  }
  return results;
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

export function deleteSegmentsBatch(ids: string[]): number {
  if (!ids || ids.length === 0) return 0;
  const db = getDb();
  let deletedCount = 0;
  const CHUNK_SIZE = 500;
  db.transaction(() => {
    for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
      const chunk = ids.slice(i, i + CHUNK_SIZE);
      const placeholders = chunk.map(() => "?").join(",");
      const res = db.query(`DELETE FROM segments WHERE id IN (${placeholders})`).run(...chunk);
      deletedCount += res.changes;
    }
  })();
  return deletedCount;
}

export function reconcileTrackSegments(trackId: string, duration: number): { pruned: { id: string }[]; clamped: { id: string }[] } {
  const db = getDb();
  let pruned: { id: string }[] = [];
  let clamped: { id: string }[] = [];
  db.transaction(() => {
    pruned = db.query("SELECT id FROM segments WHERE track_id = $track_id AND ($duration - start_time < 0.5);").all({
      $track_id: trackId,
      $duration: duration,
    }) as { id: string }[];
    db.query("DELETE FROM segments WHERE track_id = $track_id AND ($duration - start_time < 0.5);").run({
      $track_id: trackId,
      $duration: duration,
    });
    clamped = db.query("SELECT id FROM segments WHERE track_id = $track_id AND end_time > $duration;").all({
      $track_id: trackId,
      $duration: duration,
    }) as { id: string }[];
    db.query("UPDATE segments SET end_time = $duration WHERE track_id = $track_id AND end_time > $duration;").run({
      $track_id: trackId,
      $duration: duration,
    });
  })();
  return { pruned, clamped };
}

// --- PLAYLIST OPERATIONS ---

export function createPlaylist(name: string, customId?: string, parentId?: string | null): Playlist {
  const db = getDb();
  const trimmed = (name || "").trim();
  if (!trimmed) {
    throw new Error("Playlist name cannot be empty");
  }
  let cleanParentId: string | null = null;
  if (typeof parentId === "string" && parentId.trim()) {
    cleanParentId = parentId.trim();
    const parentPl = db.query("SELECT id, is_mix, parent_id FROM playlists WHERE id = $id").get({ $id: cleanParentId }) as { id: string; is_mix: number; parent_id: string | null } | null;
    if (!parentPl) {
      throw new Error(`Parent playlist "${cleanParentId}" not found`);
    }
    if (parentPl.is_mix) {
      throw new Error("A mix playlist cannot be a parent playlist");
    }
    if (parentPl.parent_id) {
      throw new Error("Invalid parent_id: cannot nest beyond 1 level");
    }
  }
  const id = customId || `pl_${crypto.randomUUID()}`;
  const query = db.query(`
    INSERT INTO playlists (id, name, created_at, updated_at, is_custom_ordered, parent_id)
    VALUES ($id, $name, unixepoch(), unixepoch(), 0, $parent_id)
    RETURNING *;
  `);
  const pl = query.get({ $id: id, $name: trimmed, $parent_id: cleanParentId }) as any;
  return { ...pl, item_count: 0, is_custom_ordered: false, parent_id: pl.parent_id ?? null };
}

export function getPlaylist(id: string): (Playlist & { item_count: number }) | null {
  const db = getDb();
  const row = db.query(`
    SELECT p.id, p.name, p.created_at, p.updated_at, p.is_custom_ordered, p.is_mix, p.parent_id, COUNT(pi.id) as item_count
    FROM playlists p
    LEFT JOIN playlist_items pi ON p.id = pi.playlist_id
    WHERE p.id = $id
    GROUP BY p.id
  `).get({ $id: id }) as any;
  if (!row) return null;
  if (row.is_mix) {
    return {
      ...row,
      parent_id: null,
      is_custom_ordered: true,
      is_mix: true,
      item_count: getMixItems(id).length,
      source_ids: getMixSourceIds(id),
    };
  }
  return { ...row, parent_id: row.parent_id ?? null, is_custom_ordered: Boolean(row.is_custom_ordered), is_mix: false };
}

export function getChildPlaylistIds(parentId: string): string[] {
  const db = getDb();
  const rows = db.query("SELECT id FROM playlists WHERE parent_id = $id").all({ $id: parentId }) as { id: string }[];
  return rows.map((r) => r.id);
}

function getMixSourceIds(mixId: string): string[] {
  const rows = getDb()
    .query("SELECT source_id FROM playlist_sources WHERE mix_id = $id ORDER BY position ASC")
    .all({ $id: mixId }) as { source_id: string }[];
  return rows.map((r) => r.source_id);
}

// Sources in order, each in its own default order; a song in several sources is kept at its first position.
// sort_order is rewritten to the merged position so the client's "manual" sort shows this exact order.
// ponytail: computed on every read (no cache); fine for a local library, add caching if mixes feel slow.
function getMixItems(mixId: string): PlaylistItemWithDetails[] {
  const seen = new Set<string>();
  const merged: PlaylistItemWithDetails[] = [];
  for (const sourceId of getMixSourceIds(mixId)) {
    for (const item of getPlaylistItems(sourceId)) {
      const key = `${item.track_id}|${item.segment_id ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push({ ...item, sort_order: merged.length });
    }
  }
  return merged;
}

function validateMixSources(sourceIds: string[], mixId?: string): string[] {
  const unique = [...new Set(sourceIds)];
  if (unique.length < 2) throw new Error("A mix playlist needs at least 2 different source playlists");
  const db = getDb();
  for (const id of unique) {
    if (id === mixId) throw new Error("A mix playlist cannot include itself");
    const src = db.query("SELECT is_mix FROM playlists WHERE id = $id").get({ $id: id }) as { is_mix: number } | null;
    if (!src) throw new Error(`Playlist ${id} not found`);
    if (src.is_mix) throw new Error("A mix playlist cannot use another mix as a source");
  }
  return unique;
}

function writeMixSources(mixId: string, sourceIds: string[]): void {
  const db = getDb();
  db.query("DELETE FROM playlist_sources WHERE mix_id = $id").run({ $id: mixId });
  const insert = db.query("INSERT INTO playlist_sources (mix_id, source_id, position) VALUES ($mix, $src, $pos)");
  sourceIds.forEach((src, pos) => insert.run({ $mix: mixId, $src: src, $pos: pos }));
}

export function createMixPlaylist(name: string, sourceIds: string[]): Playlist & { item_count: number } {
  const db = getDb();
  let mixId = "";
  db.transaction(() => {
    const sources = validateMixSources(sourceIds);
    mixId = createPlaylist(name).id;
    db.query("UPDATE playlists SET is_mix = 1, is_custom_ordered = 1 WHERE id = $id").run({ $id: mixId });
    writeMixSources(mixId, sources);
  })();
  return getPlaylist(mixId)!;
}

export function setMixSources(mixId: string, sourceIds: string[]): (Playlist & { item_count: number }) | null {
  const db = getDb();
  const mix = db.query("SELECT is_mix FROM playlists WHERE id = $id").get({ $id: mixId }) as { is_mix: number } | null;
  if (!mix) return null;
  if (!mix.is_mix) throw new Error("Playlist is not a mix playlist");
  db.transaction(() => {
    writeMixSources(mixId, validateMixSources(sourceIds, mixId));
    db.query("UPDATE playlists SET updated_at = unixepoch() WHERE id = $id").run({ $id: mixId });
  })();
  return getPlaylist(mixId);
}

export function listPlaylists(): (Playlist & { item_count: number })[] {
  const db = getDb();
  // Mosaic follows the same item order as getPlaylistItems(); a track sliced several times fills only one tile.
  // Cover only counts while its track is still in the playlist.
  const rows = db.query(`
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
  `).all() as any[];
  return rows.map((r) => {
    if (!r.is_mix) {
      return {
        ...r,
        parent_id: r.parent_id ?? null,
        is_custom_ordered: Boolean(r.is_custom_ordered),
        is_mix: false,
        mosaic_urls: JSON.parse(r.mosaic_urls || "[]"),
      };
    }
    // Mix rows have no items of their own, so count, cover and mosaic come from the merged view
    const items = getMixItems(r.id);
    const thumbs = new Map<string, string>();
    for (const it of items) {
      if (it.track.thumbnail_url && !thumbs.has(it.track_id)) thumbs.set(it.track_id, it.track.thumbnail_url);
    }
    return {
      ...r,
      parent_id: null,
      is_custom_ordered: true,
      is_mix: true,
      item_count: items.length,
      source_ids: getMixSourceIds(r.id),
      cover_url: (r.cover_track_id && thumbs.get(r.cover_track_id)) || null,
      mosaic_urls: [...thumbs.values()].slice(0, 4),
    };
  });
}

export function setPlaylistCover(id: string, trackId: string | null): Playlist | null {
  const db = getDb();
  const pl = getPlaylist(id);
  if (!pl) return null;
  if (trackId !== null) {
    const inPlaylist = pl.is_mix
      ? getMixItems(id).some((it) => it.track_id === trackId)
      : db
          .query("SELECT 1 FROM playlist_items WHERE playlist_id = $id AND track_id = $trackId LIMIT 1")
          .get({ $id: id, $trackId: trackId });
    if (!inPlaylist) throw new Error("Track is not in this playlist");
  }
  // updated_at is left alone on purpose: changing a cover should not reorder the playlist list
  return db
    .query("UPDATE playlists SET cover_track_id = $trackId WHERE id = $id RETURNING *;")
    .get({ $id: id, $trackId: trackId }) as Playlist;
}

export function updatePlaylist(id: string, name: string): Playlist | null {
  const db = getDb();
  const trimmed = (name || "").trim();
  if (!trimmed) {
    throw new Error("Playlist name cannot be empty");
  }
  const query = db.query(`
    UPDATE playlists
    SET name = $name, updated_at = unixepoch()
    WHERE id = $id
    RETURNING *;
  `);
  const row = query.get({ $id: id, $name: trimmed }) as any;
  if (!row) return null;
  if (row.is_mix) return getPlaylist(id);
  const countRow = db.query("SELECT COUNT(*) as count FROM playlist_items WHERE playlist_id = $id").get({ $id: id }) as { count: number };
  return { ...row, item_count: countRow?.count ?? 0, is_custom_ordered: Boolean(row.is_custom_ordered), parent_id: row.parent_id ?? null };
}

export function deletePlaylist(id: string, keepChildren = false): boolean {
  const db = getDb();
  const childIds = getChildPlaylistIds(id);
  let success = false;
  db.transaction(() => {
    if (keepChildren) {
      db.query("UPDATE playlists SET parent_id = NULL WHERE parent_id = $id").run({ $id: id });
    } else {
      for (const cId of childIds) {
        db.query("DELETE FROM playlists WHERE id = $id").run({ $id: cId });
      }
    }
    const res = db.query("DELETE FROM playlists WHERE id = $id").run({ $id: id });
    success = res.changes > 0;
  })();
  return success;
}

export function getPlaylistItems(playlistId: string): PlaylistItemWithDetails[] {
  const db = getDb();
  const pl = db.query("SELECT is_custom_ordered, is_mix FROM playlists WHERE id = $id").get({ $id: playlistId }) as
    | { is_custom_ordered: number; is_mix: number }
    | null;
  if (pl?.is_mix) return getMixItems(playlistId);
  const orderClause = pl?.is_custom_ordered
    ? "ORDER BY pi.sort_order ASC, pi.added_at ASC"
    : "ORDER BY pi.added_at DESC, pi.sort_order ASC";
  const rows = db.query(`
    SELECT 
      pi.id, pi.playlist_id, pi.track_id, pi.segment_id, pi.sort_order, pi.added_at,
      t.source_type, t.source_uri, t.title as track_title, t.artist as track_artist,
      t.duration as track_duration, t.thumbnail_url, t.file_path,
      t.status as track_status, t.error_message as track_error, t.volume as track_volume,
      t.created_at as track_created_at,
      s.name as segment_name, s.start_time as segment_start_time, s.end_time as segment_end_time,
      s.color as segment_color, s.sort_order as segment_sort_order, s.created_at as segment_created_at
    FROM playlist_items pi
    JOIN tracks t ON pi.track_id = t.id
    LEFT JOIN segments s ON pi.segment_id = s.id
    WHERE pi.playlist_id = $playlist_id
    ${orderClause}
  `).all({ $playlist_id: playlistId }) as any[];

  return rows.map((r) => {
    const track: Track = {
      id: r.track_id,
      source_type: r.source_type,
      source_uri: r.source_uri,
      title: r.track_title,
      artist: r.track_artist || "",
      duration: r.track_duration,
      thumbnail_url: r.thumbnail_url || "",
      file_path: r.file_path || null,
      peaks_json: undefined, // Omit heavy peaks payload from list views
      status: r.track_status || "ready",
      error_message: r.track_error || null,
      volume: r.track_volume ?? 0.5,
      created_at: r.track_created_at,
    };

    const segment: Segment | null = (r.segment_id && r.segment_name != null)
      ? {
          id: r.segment_id,
          track_id: r.track_id,
          name: r.segment_name,
          start_time: r.segment_start_time,
          end_time: r.segment_end_time,
          color: r.segment_color || "#4385BE",
          sort_order: r.segment_sort_order ?? 0,
          created_at: r.segment_created_at,
        }
      : null;

    return {
      id: r.id,
      playlist_id: r.playlist_id,
      track_id: r.track_id,
      segment_id: r.segment_id || null,
      sort_order: r.sort_order,
      added_at: r.added_at,
      track,
      segment,
    };
  });
}

export function addPlaylistItem(playlistId: string, trackId: string, segmentId?: string | null): PlaylistItemWithDetails {
  const cleanSegId = typeof segmentId === "string" && segmentId.trim() ? segmentId.trim() : null;
  let result: PlaylistItemWithDetails | null = null;
  const db = getDb();

  db.transaction(() => {
    const pl = db.query("SELECT id, is_mix, parent_id FROM playlists WHERE id = $id").get({ $id: playlistId }) as { id: string; is_mix: number; parent_id: string | null } | null;
    if (!pl) throw new Error(`Playlist ${playlistId} not found`);
    if (pl.is_mix) throw new Error("Cannot add items to a mix playlist");

    const trk = getTrack(trackId);
    if (!trk) throw new Error(`Track ${trackId} not found`);
    const cleanTrk = { ...trk, peaks_json: undefined };

    let seg: Segment | null = null;
    if (cleanSegId) {
      seg = getSegment(cleanSegId);
      if (!seg || seg.track_id !== trackId) {
        throw new Error(`Segment ${cleanSegId} not found or does not belong to track ${trackId}`);
      }
    }

    // Auto-bubble to parent playlist if this is a child playlist
    if (pl.parent_id) {
      const existingInParent = db.query(`
        SELECT id FROM playlist_items 
        WHERE playlist_id = $playlist_id 
          AND track_id = $track_id 
          AND segment_id IS $segment_id
      `).get({
        $playlist_id: pl.parent_id,
        $track_id: trackId,
        $segment_id: cleanSegId,
      });

      if (!existingInParent) {
        db.query(`
          UPDATE playlist_items 
          SET sort_order = sort_order + 1 
          WHERE playlist_id = $playlist_id
        `).run({ $playlist_id: pl.parent_id });

        const parentItemId = `pli_${crypto.randomUUID()}`;
        db.query(`
          INSERT INTO playlist_items (id, playlist_id, track_id, segment_id, sort_order, added_at)
          VALUES ($id, $playlist_id, $track_id, $segment_id, 0, unixepoch())
        `).run({
          $id: parentItemId,
          $playlist_id: pl.parent_id,
          $track_id: trackId,
          $segment_id: cleanSegId,
        });
        db.query("UPDATE playlists SET updated_at = unixepoch() WHERE id = $id").run({ $id: pl.parent_id });
      }
    }

    // Check if item already exists in this playlist
    const existing = db.query(`
      SELECT * FROM playlist_items 
      WHERE playlist_id = $playlist_id 
        AND track_id = $track_id 
        AND segment_id IS $segment_id
    `).get({
      $playlist_id: playlistId,
      $track_id: trackId,
      $segment_id: cleanSegId,
    }) as PlaylistItem | null;

    if (existing) {
      result = {
        ...existing,
        track: cleanTrk,
        segment: seg,
      };
      return;
    }

    db.query(`
      UPDATE playlist_items 
      SET sort_order = sort_order + 1 
      WHERE playlist_id = $playlist_id
    `).run({ $playlist_id: playlistId });

    const id = `pli_${crypto.randomUUID()}`;
    try {
      const item = db.query(`
        INSERT INTO playlist_items (id, playlist_id, track_id, segment_id, sort_order, added_at)
        VALUES ($id, $playlist_id, $track_id, $segment_id, 0, unixepoch())
        RETURNING *;
      `).get({
        $id: id,
        $playlist_id: playlistId,
        $track_id: trackId,
        $segment_id: cleanSegId,
      }) as PlaylistItem;

      db.query("UPDATE playlists SET updated_at = unixepoch() WHERE id = $id").run({ $id: playlistId });

      result = {
        ...item,
        track: cleanTrk,
        segment: seg,
      };
    } catch (err: any) {
      if (err?.message?.includes("UNIQUE constraint failed")) {
        const existingNow = db.query(`
          SELECT * FROM playlist_items 
          WHERE playlist_id = $playlist_id 
            AND track_id = $track_id 
            AND segment_id IS $segment_id
        `).get({
          $playlist_id: playlistId,
          $track_id: trackId,
          $segment_id: cleanSegId,
        }) as PlaylistItem | null;
        if (existingNow) {
          result = {
            ...existingNow,
            track: cleanTrk,
            segment: seg,
          };
          return;
        }
      }
      throw err;
    }
  })();

  if (!result) {
    throw new Error("Failed to add playlist item");
  }
  return result;
}

export function addPlaylistItemsBatch(
  playlistId: string,
  items: { trackId: string; segmentId?: string | null }[]
): PlaylistItemWithDetails[] {
  if (!items || items.length === 0) return [];
  const db = getDb();
  const results: PlaylistItemWithDetails[] = [];

  db.transaction(() => {
    const pl = db.query("SELECT id, is_mix, parent_id FROM playlists WHERE id = $id").get({ $id: playlistId }) as { id: string; is_mix: number; parent_id: string | null } | null;
    if (!pl) throw new Error(`Playlist ${playlistId} not found`);
    if (pl.is_mix) throw new Error("Cannot add items to a mix playlist");

    const maxOrderRow = db.query(`
      SELECT COALESCE(MAX(sort_order), -1) as max_order 
      FROM playlist_items 
      WHERE playlist_id = $playlist_id
    `).get({ $playlist_id: playlistId }) as { max_order: number };
    let nextOrder = (maxOrderRow?.max_order ?? -1) + 1;

    const checkStmt = db.query(`
      SELECT * FROM playlist_items 
      WHERE playlist_id = $playlist_id 
        AND track_id = $track_id 
        AND segment_id IS $segment_id
    `);

    const insertStmt = db.query(`
      INSERT INTO playlist_items (id, playlist_id, track_id, segment_id, sort_order, added_at)
      VALUES ($id, $playlist_id, $track_id, $segment_id, $sort_order, unixepoch())
      RETURNING *;
    `);

    // Pre-fetch unique tracks and segments in bulk to eliminate N+1 queries
    const uniqueTrackIds = Array.from(new Set(items.map((i) => i.trackId).filter(Boolean)));
    const uniqueSegIds = Array.from(
      new Set(
        items
          .map((i) => (typeof i.segmentId === "string" && i.segmentId.trim() ? i.segmentId.trim() : null))
          .filter((id): id is string => Boolean(id))
      )
    );

    const trackMap = new Map<string, Track>();
    const CHUNK_SIZE = 500;
    for (let i = 0; i < uniqueTrackIds.length; i += CHUNK_SIZE) {
      const chunk = uniqueTrackIds.slice(i, i + CHUNK_SIZE);
      const placeholders = chunk.map(() => "?").join(",");
      const trks = db.query(`SELECT * FROM tracks WHERE id IN (${placeholders})`).all(...chunk) as Track[];
      for (const t of trks) trackMap.set(t.id, t);
    }

    const segMap = new Map<string, Segment>();
    for (let i = 0; i < uniqueSegIds.length; i += CHUNK_SIZE) {
      const chunk = uniqueSegIds.slice(i, i + CHUNK_SIZE);
      const placeholders = chunk.map(() => "?").join(",");
      const segs = db.query(`SELECT * FROM segments WHERE id IN (${placeholders})`).all(...chunk) as Segment[];
      for (const s of segs) segMap.set(s.id, s);
    }

    // Auto-bubble to parent playlist if this is a child playlist
    if (pl.parent_id) {
      const parentExisting = db.query(
        `SELECT track_id, segment_id FROM playlist_items WHERE playlist_id = $parent_id`
      ).all({ $parent_id: pl.parent_id }) as { track_id: string; segment_id: string | null }[];
      const parentExistingSet = new Set(parentExisting.map((i) => `${i.track_id}::${i.segment_id || ""}`));

      const parentMaxOrderRow = db.query(`
        SELECT COALESCE(MAX(sort_order), -1) as max_order 
        FROM playlist_items 
        WHERE playlist_id = $playlist_id
      `).get({ $playlist_id: pl.parent_id }) as { max_order: number };
      let parentNextOrder = (parentMaxOrderRow?.max_order ?? -1) + 1;

      let parentAdded = false;
      for (const entry of items) {
        const trackId = entry.trackId;
        const cleanSegId = typeof entry.segmentId === "string" && entry.segmentId.trim() ? entry.segmentId.trim() : null;

        const trk = trackMap.get(trackId);
        if (!trk) continue;
        if (cleanSegId) {
          const seg = segMap.get(cleanSegId);
          if (!seg || seg.track_id !== trackId) continue;
        }

        const key = `${trackId}::${cleanSegId || ""}`;
        if (!parentExistingSet.has(key)) {
          const pItemId = `pli_${crypto.randomUUID()}`;
          try {
            insertStmt.run({
              $id: pItemId,
              $playlist_id: pl.parent_id,
              $track_id: trackId,
              $segment_id: cleanSegId,
              $sort_order: parentNextOrder++,
            });
            parentExistingSet.add(key);
            parentAdded = true;
          } catch {
            // Ignore race conditions
          }
        }
      }
      if (parentAdded) {
        db.query("UPDATE playlists SET updated_at = unixepoch() WHERE id = $id").run({ $id: pl.parent_id });
      }
    }

    // Pre-fetch existing playlist items for this playlist
    const existingItems = db.query(
      `SELECT * FROM playlist_items WHERE playlist_id = $playlist_id`
    ).all({ $playlist_id: playlistId }) as PlaylistItem[];
    const existingMap = new Map<string, PlaylistItem>();
    for (const item of existingItems) {
      existingMap.set(`${item.track_id}::${item.segment_id || ""}`, item);
    }

    for (const entry of items) {
      const trackId = entry.trackId;
      const cleanSegId = typeof entry.segmentId === "string" && entry.segmentId.trim() ? entry.segmentId.trim() : null;

      const trk = trackMap.get(trackId);
      if (!trk) continue;
      const cleanTrk = { ...trk, peaks_json: undefined };

      let seg: Segment | null = null;
      if (cleanSegId) {
        seg = segMap.get(cleanSegId) ?? null;
        if (!seg || seg.track_id !== trackId) continue;
      }

      const key = `${trackId}::${cleanSegId || ""}`;
      const existing = existingMap.get(key);

      if (existing) {
        results.push({
          ...existing,
          track: cleanTrk,
          segment: seg,
        });
        continue;
      }

      const id = `pli_${crypto.randomUUID()}`;
      try {
        const item = insertStmt.get({
          $id: id,
          $playlist_id: playlistId,
          $track_id: trackId,
          $segment_id: cleanSegId,
          $sort_order: nextOrder++,
        }) as PlaylistItem;

        existingMap.set(key, item);
        results.push({
          ...item,
          track: cleanTrk,
          segment: seg,
        });
      } catch (err: any) {
        if (err?.message?.includes("UNIQUE constraint failed")) {
          const existingNow = checkStmt.get({
            $playlist_id: playlistId,
            $track_id: trackId,
            $segment_id: cleanSegId,
          }) as PlaylistItem | null;
          if (existingNow) {
            existingMap.set(key, existingNow);
            results.push({
              ...existingNow,
              track: cleanTrk,
              segment: seg,
            });
          }
        } else {
          throw err;
        }
      }
    }

    db.query("UPDATE playlists SET updated_at = unixepoch() WHERE id = $id").run({ $id: playlistId });
  })();

  return results;
}

export function removePlaylistItem(playlistId: string, itemId: string): boolean {
  const db = getDb();
  let success = false;
  db.transaction(() => {
    // 1. Get the item to know its track_id and segment_id
    const item = db.query(`
      SELECT track_id, segment_id FROM playlist_items WHERE id = $id AND playlist_id = $playlist_id
    `).get({ $id: itemId, $playlist_id: playlistId }) as { track_id: string; segment_id: string | null } | null;

    if (!item) return;

    // 2. Cascade delete from child playlists if this playlist is a parent
    const childIds = getChildPlaylistIds(playlistId);
    if (childIds.length > 0) {
      const childRes = db.query(`
        DELETE FROM playlist_items 
        WHERE playlist_id IN (SELECT id FROM playlists WHERE parent_id = $parent_id)
          AND track_id = $track_id
          AND segment_id IS $segment_id
      `).run({
        $parent_id: playlistId,
        $track_id: item.track_id,
        $segment_id: item.segment_id,
      });
      if (childRes.changes > 0) {
        for (const cId of childIds) {
          db.query("UPDATE playlists SET updated_at = unixepoch() WHERE id = $id").run({ $id: cId });
        }
      }
    }

    // 3. Delete from the playlist itself
    const res = db.query("DELETE FROM playlist_items WHERE id = $id AND playlist_id = $playlist_id").run({
      $id: itemId,
      $playlist_id: playlistId,
    });
    if (res.changes > 0) {
      db.query("UPDATE playlists SET updated_at = unixepoch() WHERE id = $id").run({ $id: playlistId });
      success = true;
    }
  })();
  return success;
}

export function removePlaylistItemsBatch(playlistId: string, itemIds: string[]): number {
  if (!itemIds || itemIds.length === 0) return 0;
  const db = getDb();
  let deletedCount = 0;
  const CHUNK_SIZE = 500;
  db.transaction(() => {
    // 1. Find items being removed to know their (track_id, segment_id)
    const itemsToRemove: { track_id: string; segment_id: string | null }[] = [];
    for (let i = 0; i < itemIds.length; i += CHUNK_SIZE) {
      const chunk = itemIds.slice(i, i + CHUNK_SIZE);
      const placeholders = chunk.map(() => "?").join(",");
      const rows = db.query(
        `SELECT track_id, segment_id FROM playlist_items WHERE playlist_id = ? AND id IN (${placeholders})`
      ).all(playlistId, ...chunk) as { track_id: string; segment_id: string | null }[];
      itemsToRemove.push(...rows);
    }

    // 2. Cascade delete from child playlists if this playlist is a parent
    const childIds = getChildPlaylistIds(playlistId);
    if (childIds.length > 0 && itemsToRemove.length > 0) {
      let cascadedAny = false;
      for (const it of itemsToRemove) {
        const res = db.query(`
          DELETE FROM playlist_items 
          WHERE playlist_id IN (SELECT id FROM playlists WHERE parent_id = $parent_id)
            AND track_id = $track_id
            AND segment_id IS $segment_id
        `).run({
          $parent_id: playlistId,
          $track_id: it.track_id,
          $segment_id: it.segment_id,
        });
        if (res.changes > 0) cascadedAny = true;
      }
      if (cascadedAny) {
        for (const cId of childIds) {
          db.query("UPDATE playlists SET updated_at = unixepoch() WHERE id = $id").run({ $id: cId });
        }
      }
    }

    // 3. Delete from the playlist itself
    for (let i = 0; i < itemIds.length; i += CHUNK_SIZE) {
      const chunk = itemIds.slice(i, i + CHUNK_SIZE);
      const placeholders = chunk.map(() => "?").join(",");
      const res = db.query(
        `DELETE FROM playlist_items WHERE playlist_id = ? AND id IN (${placeholders})`
      ).run(playlistId, ...chunk);
      deletedCount += res.changes;
    }
    if (deletedCount > 0) {
      db.query("UPDATE playlists SET updated_at = unixepoch() WHERE id = $id").run({ $id: playlistId });
    }
  })();
  return deletedCount;
}

export function reorderPlaylistItems(playlistId: string, itemIds: string[]): boolean {
  const db = getDb();
  let success = false;
  const updateStmt = db.query(`
    UPDATE playlist_items 
    SET sort_order = $order 
    WHERE id = $id AND playlist_id = $playlist_id
  `);
  try {
    db.transaction(() => {
      const pl = db.query("SELECT id FROM playlists WHERE id = $id").get({ $id: playlistId });
      if (!pl) throw new Error("Playlist not found");

      const countRow = db.query<{ c: number }, { $id: string }>(
        "SELECT COUNT(*) as c FROM playlist_items WHERE playlist_id = $id"
      ).get({ $id: playlistId });
      const totalItems = countRow?.c ?? 0;
      if (itemIds.length !== totalItems || new Set(itemIds).size !== totalItems) {
        throw new Error("Invalid itemIds count or duplicate IDs");
      }

      for (let i = 0; i < itemIds.length; i++) {
        const res = updateStmt.run({
          $order: i,
          $id: itemIds[i],
          $playlist_id: playlistId,
        });
        if (res.changes === 0) {
          throw new Error(`Item ${itemIds[i]} does not belong to playlist`);
        }
      }
      db.query("UPDATE playlists SET is_custom_ordered = 1, updated_at = unixepoch() WHERE id = $id").run({ $id: playlistId });
      success = true;
    })();
  } catch {
    return false;
  }
  return success;
}

export function getPlaylistMemberships(
  trackId: string,
  segmentId?: string | null,
  includeAllSegments = false
): { playlist_id: string; item_id: string }[] {
  const db = getDb();
  if (includeAllSegments) {
    return db.query(`
      SELECT playlist_id, min(id) as item_id FROM playlist_items
      WHERE track_id = $track_id
      GROUP BY playlist_id
    `).all({ $track_id: trackId }) as { playlist_id: string; item_id: string }[];
  }
  const cleanSegId = typeof segmentId === "string" && segmentId.trim() ? segmentId.trim() : null;
  if (cleanSegId) {
    return db.query(`
      SELECT playlist_id, id as item_id FROM playlist_items
      WHERE track_id = $track_id AND segment_id = $segment_id
    `).all({ $track_id: trackId, $segment_id: cleanSegId }) as { playlist_id: string; item_id: string }[];
  } else {
    return db.query(`
      SELECT playlist_id, id as item_id FROM playlist_items
      WHERE track_id = $track_id AND (segment_id IS NULL OR segment_id = '')
    `).all({ $track_id: trackId }) as { playlist_id: string; item_id: string }[];
  }
}

