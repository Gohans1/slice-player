use rusqlite::Connection;

pub fn create_base_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
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

        CREATE INDEX IF NOT EXISTS idx_tracks_created_at ON tracks(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_tracks_status ON tracks(status);
        CREATE INDEX IF NOT EXISTS idx_segments_track ON segments(track_id);
        CREATE INDEX IF NOT EXISTS idx_segments_created_at ON segments(created_at DESC);
        ",
    )
    .map_err(|e| format!("Failed to create base schema: {e}"))
}

fn has_column(conn: &Connection, table: &str, col_name: &str) -> Result<bool, String> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info({table});"))
        .map_err(|e| e.to_string())?;
    let names = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| e.to_string())?;
    for name in names {
        if name.map_err(|e| e.to_string())? == col_name {
            return Ok(true);
        }
    }
    Ok(false)
}

pub fn get_user_version(conn: &Connection) -> Result<i64, String> {
    conn.query_row("PRAGMA user_version;", [], |row| row.get(0))
        .map_err(|e| e.to_string())
}

pub fn run_migrations(conn: &mut Connection) -> Result<(), String> {
    let user_version = get_user_version(conn)?;

    if user_version < 1 {
        let has_vol = has_column(conn, "tracks", "volume")?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        if !has_vol {
            tx.execute_batch(
                "ALTER TABLE tracks ADD COLUMN volume REAL NOT NULL DEFAULT 0.5 CHECK(volume >= 0 AND volume <= 1);",
            )
            .map_err(|e| e.to_string())?;
        }
        tx.execute_batch(
            "
            UPDATE tracks
            SET thumbnail_url = 'https://i.ytimg.com/vi/' || SUBSTR(id, 4) || '/maxresdefault.jpg'
            WHERE source_type = 'youtube'
              AND SUBSTR(id, 1, 3) = 'yt_'
              AND LENGTH(id) > 3
              AND thumbnail_url LIKE '%sqp=%';
            PRAGMA user_version = 1;
            ",
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
    }

    if user_version < 2 {
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        tx.execute_batch(
            "
            UPDATE tracks SET volume = 0.5 WHERE volume = 0.8;
            PRAGMA user_version = 2;
            ",
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
    }

    if user_version < 3 {
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        tx.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS playlists (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              created_at INTEGER DEFAULT (unixepoch()),
              updated_at INTEGER DEFAULT (unixepoch()),
              is_custom_ordered INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS playlist_items (
              id TEXT PRIMARY KEY,
              playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
              track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
              segment_id TEXT REFERENCES segments(id) ON DELETE CASCADE,
              sort_order INTEGER NOT NULL DEFAULT 0,
              added_at INTEGER DEFAULT (unixepoch())
            );
            CREATE INDEX IF NOT EXISTS idx_playlist_items_playlist ON playlist_items(playlist_id, sort_order ASC);
            CREATE INDEX IF NOT EXISTS idx_playlist_items_added ON playlist_items(playlist_id, added_at DESC, sort_order ASC);
            CREATE INDEX IF NOT EXISTS idx_playlist_items_track ON playlist_items(track_id);
            CREATE INDEX IF NOT EXISTS idx_playlist_items_segment ON playlist_items(segment_id);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_playlist_items_unique ON playlist_items(playlist_id, track_id, IFNULL(segment_id, ''));
            PRAGMA user_version = 3;
            ",
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
    } else {
        let _ = conn.execute_batch(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_playlist_items_unique ON playlist_items(playlist_id, track_id, IFNULL(segment_id, ''));",
        );
    }

    if user_version < 4 {
        let has_custom = has_column(conn, "playlists", "is_custom_ordered")?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        if !has_custom {
            tx.execute_batch(
                "ALTER TABLE playlists ADD COLUMN is_custom_ordered INTEGER NOT NULL DEFAULT 0;",
            )
            .map_err(|e| e.to_string())?;
        }
        tx.execute_batch("PRAGMA user_version = 4;")
            .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
    }

    if user_version < 5 {
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        tx.execute_batch(
            "
            CREATE INDEX IF NOT EXISTS idx_tracks_created_at ON tracks(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_tracks_status ON tracks(status);
            PRAGMA user_version = 5;
            ",
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
    }

    if user_version < 6 {
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        tx.execute_batch(
            "
            CREATE INDEX IF NOT EXISTS idx_playlist_items_added ON playlist_items(playlist_id, added_at DESC, sort_order ASC);
            PRAGMA user_version = 6;
            ",
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
    }

    if user_version < 7 {
        let has_cover = has_column(conn, "playlists", "cover_track_id")?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        if !has_cover {
            tx.execute_batch(
                "ALTER TABLE playlists ADD COLUMN cover_track_id TEXT REFERENCES tracks(id) ON DELETE SET NULL;",
            )
            .map_err(|e| e.to_string())?;
        }
        tx.execute_batch("PRAGMA user_version = 7;")
            .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
    }

    if user_version < 8 {
        let has_mix = has_column(conn, "playlists", "is_mix")?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        if !has_mix {
            tx.execute_batch(
                "ALTER TABLE playlists ADD COLUMN is_mix INTEGER NOT NULL DEFAULT 0;",
            )
            .map_err(|e| e.to_string())?;
        }
        tx.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS playlist_sources (
              mix_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
              source_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
              position INTEGER NOT NULL,
              PRIMARY KEY (mix_id, source_id)
            );
            CREATE INDEX IF NOT EXISTS idx_playlist_sources_source ON playlist_sources(source_id);
            PRAGMA user_version = 8;
            ",
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
    }

    if user_version < 9 {
        let has_parent = has_column(conn, "playlists", "parent_id")?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        if !has_parent {
            tx.execute_batch(
                "ALTER TABLE playlists ADD COLUMN parent_id TEXT REFERENCES playlists(id) ON DELETE CASCADE;",
            )
            .map_err(|e| e.to_string())?;
        }
        tx.execute_batch(
            "
            CREATE INDEX IF NOT EXISTS idx_playlists_parent_id ON playlists(parent_id);
            PRAGMA user_version = 9;
            ",
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
    }

    if user_version < 10 {
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        tx.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS plays (
              id INTEGER PRIMARY KEY,
              track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
              segment_id TEXT REFERENCES segments(id) ON DELETE SET NULL,
              source_type TEXT NOT NULL CHECK(source_type IN ('playlist', 'mixed', 'slices_only', 'original_only', 'home')),
              playlist_id TEXT REFERENCES playlists(id) ON DELETE SET NULL,
              via_home INTEGER NOT NULL DEFAULT 0 CHECK(via_home IN (0, 1)),
              played_at INTEGER NOT NULL DEFAULT (unixepoch())
            );
            CREATE INDEX IF NOT EXISTS idx_plays_played_at ON plays(played_at);
            CREATE INDEX IF NOT EXISTS idx_plays_track ON plays(track_id);
            CREATE INDEX IF NOT EXISTS idx_plays_segment ON plays(segment_id);
            CREATE INDEX IF NOT EXISTS idx_plays_playlist ON plays(playlist_id);
            PRAGMA user_version = 10;
            ",
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
    }

    if user_version < 11 {
        let has_loudness = has_column(conn, "tracks", "loudness")?;
        let has_true_peak = has_column(conn, "tracks", "true_peak")?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        if !has_loudness {
            tx.execute_batch("ALTER TABLE tracks ADD COLUMN loudness REAL;")
                .map_err(|e| e.to_string())?;
        }
        if !has_true_peak {
            tx.execute_batch("ALTER TABLE tracks ADD COLUMN true_peak REAL;")
                .map_err(|e| e.to_string())?;
        }
        tx.execute_batch("PRAGMA user_version = 11;")
            .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
    }

    Ok(())
}
