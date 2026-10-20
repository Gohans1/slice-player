pub mod maintenance;
pub mod migrations;
pub mod playlists;
pub mod plays;
pub mod tracks_segments;

pub use maintenance::{
    get_cross_platform_basename, purge_track_cache_files, purge_track_cache_files_with_entries,
    purge_tracks_cache_files_batch, read_audio_dir_file_names, resolve_abs_path,
    INTERRUPTED_INGEST_ERROR_MESSAGE,
};
pub use plays::parse_play_record;
pub use tracks_segments::{clamp_volume, validate_volume};

use crate::events::EventBus;
use crate::models::*;
use rusqlite::Connection;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

pub const LIBRARY_DB_PATH: &str = "./data/music.db";

#[derive(Clone)]
pub struct Db {
    conn: Arc<Mutex<Option<Connection>>>,
    db_path: Arc<Mutex<PathBuf>>,
}

impl Db {
    pub fn open(db_path: impl AsRef<Path>, is_test: bool) -> Result<Self, String> {
        let db_path = db_path.as_ref();
        let env_is_test = std::env::var("NODE_ENV")
            .map(|v| v == "test")
            .unwrap_or(false);
        let resolved_target = resolve_abs_path(db_path);
        let resolved_library = resolve_abs_path(Path::new(LIBRARY_DB_PATH));

        if (is_test || env_is_test) && resolved_target == resolved_library {
            return Err(format!(
                "Refusing to open the library database ({LIBRARY_DB_PATH}) under test: call initDatabase() with a test database path first."
            ));
        }

        if let Some(parent) = db_path.parent()
            && !parent.as_os_str().is_empty()
            && !parent.exists()
        {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }

        let mut conn = Connection::open(db_path).map_err(|e| e.to_string())?;
        conn.execute_batch(
            "
            PRAGMA busy_timeout = 5000;
            PRAGMA journal_mode = WAL;
            PRAGMA foreign_keys = ON;
            ",
        )
        .map_err(|e| e.to_string())?;

        // Set SQLITE_FCNTL_PERSIST_WAL = 0 so WAL/SHM files are cleaned up on close
        unsafe {
            let mut persist_wal: std::os::raw::c_int = 0;
            let _ = rusqlite::ffi::sqlite3_file_control(
                conn.handle(),
                std::ptr::null(),
                rusqlite::ffi::SQLITE_FCNTL_PERSIST_WAL,
                &mut persist_wal as *mut _ as *mut std::os::raw::c_void,
            );
        }

        migrations::create_base_schema(&conn)?;
        migrations::run_migrations(&mut conn)?;

        if !is_test && !env_is_test && resolved_target == resolved_library {
            let _ = fs::create_dir_all("./data/cache/audio");
            let _ = fs::create_dir_all("./data/cache/thumbs");
            maintenance::sweep_startup_orphan_cache(
                &mut conn,
                Path::new("./data/cache/audio"),
                Path::new("./data/cache/thumbs"),
            );
        }

        Ok(Self {
            conn: Arc::new(Mutex::new(Some(conn))),
            db_path: Arc::new(Mutex::new(db_path.to_path_buf())),
        })
    }

    pub fn db_path(&self) -> PathBuf {
        self.db_path
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    pub fn close(&self) {
        let mut guard = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(conn) = guard.take() {
            let _ = conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
            let _ = conn.close();
        }
    }

    pub fn reopen(&self, new_path: impl AsRef<Path>, is_test: bool) -> Result<(), String> {
        let new_path = new_path.as_ref().to_path_buf();
        self.close();
        let reopened = Self::open(&new_path, is_test)?;
        let mut guard = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        let mut new_guard = reopened.conn.lock().unwrap_or_else(|e| e.into_inner());
        *guard = new_guard.take();
        *self.db_path.lock().unwrap_or_else(|e| e.into_inner()) = new_path;
        Ok(())
    }

    pub fn with_conn<F, R>(&self, f: F) -> R
    where
        F: FnOnce(&mut Connection) -> R,
    {
        let mut guard = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        if guard.is_none() {
            drop(guard);
            panic!("Database connection is closed");
        }
        f(guard.as_mut().unwrap())
    }

    pub fn user_version(&self) -> Result<i64, String> {
        self.with_conn(|conn| migrations::get_user_version(conn))
    }

    pub fn heal_track_file_paths(&self, audio_cache_dir: impl AsRef<Path>) -> Result<usize, String> {
        self.with_conn(|conn| {
            maintenance::heal_track_file_paths_in_conn(conn, audio_cache_dir.as_ref())
        })
    }

    pub fn recover_incomplete_ingests(
        &self,
        audio_dir: impl AsRef<Path>,
        events: &EventBus,
    ) -> Result<usize, String> {
        self.with_conn(|conn| {
            maintenance::recover_incomplete_ingests_in_conn(conn, audio_dir.as_ref(), events)
        })
    }

    pub fn create_track(&self, track: &NewTrack) -> Result<Track, String> {
        self.with_conn(|conn| tracks_segments::create_track_in_conn(conn, track))
    }

    pub fn get_track(&self, id: &str) -> Result<Option<Track>, String> {
        self.with_conn(|conn| tracks_segments::get_track_in_conn(conn, id))
    }

    pub fn update_track(&self, id: &str, updates: &TrackUpdates) -> Result<Option<Track>, String> {
        self.with_conn(|conn| tracks_segments::update_track_in_conn(conn, id, updates))
    }

    pub fn list_tracks(&self) -> Result<Vec<Track>, String> {
        self.with_conn(|conn| tracks_segments::list_tracks_in_conn(conn))
    }

    pub fn list_tracks_to_measure(&self) -> Result<Vec<(String, String)>, String> {
        self.with_conn(|conn| tracks_segments::list_tracks_to_measure_in_conn(conn))
    }

    pub fn set_track_loudness(&self, id: &str, loudness: f64, true_peak: f64) -> Result<(), String> {
        self.with_conn(|conn| tracks_segments::set_track_loudness_in_conn(conn, id, loudness, true_peak))
    }

    pub fn get_tracks_batch(&self, ids: &[String]) -> Result<Vec<(String, Option<String>)>, String> {
        self.with_conn(|conn| tracks_segments::get_tracks_batch_in_conn(conn, ids))
    }

    pub fn delete_track(&self, id: &str) -> Result<bool, String> {
        self.with_conn(|conn| tracks_segments::delete_track_in_conn(conn, id))
    }

    pub fn delete_tracks_batch(&self, ids: &[String]) -> Result<usize, String> {
        self.with_conn(|conn| tracks_segments::delete_tracks_batch_in_conn(conn, ids))
    }

    pub fn get_segment(&self, id: &str) -> Result<Option<Segment>, String> {
        self.with_conn(|conn| tracks_segments::get_segment_in_conn(conn, id))
    }

    pub fn create_segment(&self, seg: &NewSegment) -> Result<Segment, String> {
        self.with_conn(|conn| tracks_segments::create_segment_in_conn(conn, seg))
    }

    pub fn update_segment(
        &self,
        id: &str,
        updates: &SegmentUpdates,
    ) -> Result<Option<Segment>, String> {
        self.with_conn(|conn| tracks_segments::update_segment_in_conn(conn, id, updates))
    }

    pub fn list_segments_by_track(&self, track_id: &str) -> Result<Vec<Segment>, String> {
        self.with_conn(|conn| tracks_segments::list_segments_by_track_in_conn(conn, track_id))
    }

    pub fn list_segments_by_track_ids(
        &self,
        track_ids: &[String],
    ) -> Result<Vec<(String, String)>, String> {
        self.with_conn(|conn| tracks_segments::list_segments_by_track_ids_in_conn(conn, track_ids))
    }

    pub fn list_all_segments(&self) -> Result<Vec<Segment>, String> {
        self.with_conn(|conn| tracks_segments::list_all_segments_in_conn(conn))
    }

    pub fn delete_segment(&self, id: &str) -> Result<bool, String> {
        self.with_conn(|conn| tracks_segments::delete_segment_in_conn(conn, id))
    }

    pub fn delete_segments_batch(&self, ids: &[String]) -> Result<usize, String> {
        self.with_conn(|conn| tracks_segments::delete_segments_batch_in_conn(conn, ids))
    }

    pub fn reconcile_track_segments(
        &self,
        track_id: &str,
        duration: f64,
    ) -> Result<(Vec<String>, Vec<String>), String> {
        self.with_conn(|conn| {
            tracks_segments::reconcile_track_segments_in_conn(conn, track_id, duration)
        })
    }

    pub fn get_affected_playlist_ids_for_tracks(
        &self,
        track_ids: &[String],
    ) -> Result<Vec<String>, String> {
        self.with_conn(|conn| {
            tracks_segments::get_affected_playlist_ids_for_tracks_in_conn(conn, track_ids)
        })
    }

    pub fn get_affected_playlist_ids_for_segments(
        &self,
        segment_ids: &[String],
    ) -> Result<Vec<String>, String> {
        self.with_conn(|conn| {
            tracks_segments::get_affected_playlist_ids_for_segments_in_conn(conn, segment_ids)
        })
    }

    pub fn create_playlist(
        &self,
        name: &str,
        custom_id: Option<&str>,
        parent_id: Option<&str>,
    ) -> Result<Playlist, String> {
        self.with_conn(|conn| playlists::create_playlist_in_conn(conn, name, custom_id, parent_id))
    }

    pub fn get_playlist(&self, id: &str) -> Result<Option<Playlist>, String> {
        self.with_conn(|conn| playlists::get_playlist_in_conn(conn, id))
    }

    pub fn get_child_playlist_ids(&self, parent_id: &str) -> Result<Vec<String>, String> {
        self.with_conn(|conn| playlists::get_child_playlist_ids_in_conn(conn, parent_id))
    }

    pub fn create_mix_playlist(
        &self,
        name: &str,
        source_ids: &[String],
    ) -> Result<Playlist, String> {
        self.with_conn(|conn| playlists::create_mix_playlist_in_conn(conn, name, source_ids))
    }

    pub fn set_mix_sources(
        &self,
        mix_id: &str,
        source_ids: &[String],
    ) -> Result<Option<Playlist>, String> {
        self.with_conn(|conn| playlists::set_mix_sources_in_conn(conn, mix_id, source_ids))
    }

    pub fn list_playlists(&self) -> Result<Vec<Playlist>, String> {
        self.with_conn(|conn| playlists::list_playlists_in_conn(conn))
    }

    pub fn set_playlist_cover(
        &self,
        id: &str,
        track_id: Option<&str>,
    ) -> Result<Option<Playlist>, String> {
        self.with_conn(|conn| playlists::set_playlist_cover_in_conn(conn, id, track_id))
    }

    pub fn update_playlist(&self, id: &str, name: &str) -> Result<Option<Playlist>, String> {
        self.with_conn(|conn| playlists::update_playlist_in_conn(conn, id, name))
    }

    pub fn delete_playlist(&self, id: &str, keep_children: bool) -> Result<bool, String> {
        self.with_conn(|conn| playlists::delete_playlist_in_conn(conn, id, keep_children))
    }

    pub fn get_playlist_items(
        &self,
        playlist_id: &str,
    ) -> Result<Vec<PlaylistItemWithDetails>, String> {
        self.with_conn(|conn| playlists::get_playlist_items_in_conn(conn, playlist_id))
    }

    pub fn add_playlist_item(
        &self,
        playlist_id: &str,
        track_id: &str,
        segment_id: Option<&str>,
    ) -> Result<PlaylistItemWithDetails, String> {
        self.with_conn(|conn| {
            playlists::add_playlist_item_in_conn(conn, playlist_id, track_id, segment_id)
        })
    }

    pub fn add_playlist_items_batch(
        &self,
        playlist_id: &str,
        items: &[BatchPlaylistItemInput],
    ) -> Result<Vec<PlaylistItemWithDetails>, String> {
        self.with_conn(|conn| playlists::add_playlist_items_batch_in_conn(conn, playlist_id, items))
    }

    pub fn remove_playlist_item(
        &self,
        playlist_id: &str,
        item_id: &str,
    ) -> Result<bool, String> {
        self.with_conn(|conn| playlists::remove_playlist_item_in_conn(conn, playlist_id, item_id))
    }

    pub fn remove_playlist_items_batch(
        &self,
        playlist_id: &str,
        item_ids: &[String],
    ) -> Result<usize, String> {
        self.with_conn(|conn| {
            playlists::remove_playlist_items_batch_in_conn(conn, playlist_id, item_ids)
        })
    }

    pub fn reorder_playlist_items(
        &self,
        playlist_id: &str,
        item_ids: &[String],
    ) -> Result<bool, String> {
        self.with_conn(|conn| {
            playlists::reorder_playlist_items_in_conn(conn, playlist_id, item_ids)
        })
    }

    pub fn get_playlist_memberships(
        &self,
        track_id: &str,
        segment_id: Option<&str>,
        include_all_segments: bool,
    ) -> Result<Vec<PlaylistMembership>, String> {
        self.with_conn(|conn| {
            playlists::get_playlist_memberships_in_conn(
                conn,
                track_id,
                segment_id,
                include_all_segments,
            )
        })
    }

    pub fn record_play(&self, play: &PlayRecord) -> Result<bool, String> {
        self.with_conn(|conn| plays::record_play_in_conn(conn, play))
    }

    pub fn get_home_summary(&self, now: Option<i64>) -> Result<HomeSummary, String> {
        let now_sec = now.unwrap_or_else(|| {
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs() as i64
        });
        self.with_conn(|conn| plays::get_home_summary_in_conn(conn, now_sec))
    }
}
