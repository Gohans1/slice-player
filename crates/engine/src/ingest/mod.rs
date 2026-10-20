//! Getting songs into the library (`ingest.ts`): YouTube links through yt-dlp, local files and
//! folders, and retries. Every ingest is a tracked operation so deletes and restores can wait for
//! the ones in flight instead of racing them.

pub mod local;
pub mod process;
pub mod upload;
pub mod video_extractor;
pub mod ytdlp;

use crate::audio_analysis::{cancel_waveform_for_file, is_waveform_busy, CancelFlag};
use crate::audio_source::SUPPORTED_AUDIO_EXTENSIONS;
use crate::db::{purge_track_cache_files_with_entries, Db};
use crate::events::EventBus;
use crate::http::ws_and_logs::ServerLogger;
use crate::models::Track;
use serde::Serialize;
use serde_json::json;
use std::collections::{HashMap, HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use tokio::sync::{watch, Semaphore};

pub const MAX_DURATION_SECONDS: f64 = 1800.0;
/// Container framing tolerance on the 30-minute cap
pub const DURATION_EPSILON_SECONDS: f64 = 2.0;
pub const MAX_PLAYLIST_ITEMS: usize = 5000;
pub const INGEST_PAUSED_MESSAGE: &str = "Thư viện đang tạm dừng nạp nhạc, vui lòng thử lại sau.";
pub(crate) const CANCELLED_MESSAGE: &str = "Yêu cầu đã bị hủy";

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
pub struct IngestResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tracks: Option<Vec<Track>>,
}

impl IngestResult {
    pub fn fail(message: impl Into<String>) -> Self {
        Self { success: false, message: Some(message.into()), tracks: None }
    }

    pub fn ok(tracks: Vec<Track>, message: impl Into<String>) -> Self {
        Self { success: true, message: Some(message.into()), tracks: Some(tracks) }
    }
}

#[derive(Debug, Clone, Default)]
struct Operations {
    total: usize,
    next_id: u64,
    active_cancels: HashMap<u64, CancelFlag>,
    by_track: HashMap<String, Vec<(u64, CancelFlag)>>,
}

#[derive(Default)]
struct Downloads {
    queue: VecDeque<(String, String)>,
    queued: HashSet<String>,
    /// The track being downloaded and the flag that cancels its yt-dlp run and analysis
    current: Option<(String, CancelFlag)>,
    worker_running: bool,
}

#[derive(Default)]
struct CookieState {
    last_failure: Option<std::time::Instant>,
    last_mtime: Option<std::time::SystemTime>,
}

pub(crate) struct Inner {
    pub(crate) db: Db,
    pub(crate) events: EventBus,
    pub(crate) logger: ServerLogger,
    pub(crate) data_dir: PathBuf,
    pub(crate) ytdlp: PathBuf,
    pause_depth: AtomicUsize,
    operations: watch::Sender<Operations>,
    metadata_slots: Semaphore,
    metadata_waiting: AtomicUsize,
    /// Cancelled (and replaced) by every drain: stops yt-dlp metadata runs and their queue
    abort_epoch: Mutex<CancelFlag>,
    downloads: Mutex<Downloads>,
    cookies: Mutex<CookieState>,
}

#[derive(Clone)]
pub struct Ingest {
    pub(crate) inner: Arc<Inner>,
}

/// Holds one ingest operation open; dropping it settles the operation
pub struct OperationGuard {
    inner: Arc<Inner>,
    op_id: u64,
    track_id: Option<String>,
    pub cancel: CancelFlag,
}

impl Drop for OperationGuard {
    fn drop(&mut self) {
        self.inner.operations.send_modify(|ops| {
            ops.total = ops.total.saturating_sub(1);
            ops.active_cancels.remove(&self.op_id);
            if let Some(id) = &self.track_id
                && let Some(list) = ops.by_track.get_mut(id)
            {
                list.retain(|(op_id, _)| *op_id != self.op_id);
                if list.is_empty() {
                    ops.by_track.remove(id);
                }
            }
        });
    }
}

/// Keeps intake closed until dropped (`pauseIngestOperations`)
pub struct IngestPause(Ingest);

impl Drop for IngestPause {
    fn drop(&mut self) {
        if self.0.inner.pause_depth.fetch_sub(1, Ordering::SeqCst) == 1 {
            self.0.start_download_worker();
        }
    }
}

impl Ingest {
    pub fn new(db: Db, events: EventBus, logger: ServerLogger, data_dir: PathBuf) -> Self {
        Self {
            inner: Arc::new(Inner {
                db,
                events,
                logger,
                data_dir,
                ytdlp: PathBuf::from("yt-dlp"),
                pause_depth: AtomicUsize::new(0),
                operations: watch::Sender::new(Operations::default()),
                metadata_slots: Semaphore::new(ytdlp::MAX_CONCURRENT_METADATA),
                metadata_waiting: AtomicUsize::new(0),
                abort_epoch: Mutex::new(CancelFlag::new()),
                downloads: Mutex::new(Downloads::default()),
                cookies: Mutex::new(CookieState::default()),
            }),
        }
    }

    /// Uses another yt-dlp executable (tests run a scripted stand-in)
    pub fn with_ytdlp(self, program: impl Into<PathBuf>) -> Self {
        let inner = Arc::try_unwrap(self.inner).unwrap_or_else(|_| panic!("with_ytdlp must be called before the Ingest is shared"));
        Self { inner: Arc::new(Inner { ytdlp: program.into(), ..inner }) }
    }

    pub(crate) fn audio_dir(&self) -> PathBuf {
        self.inner.data_dir.join("cache").join("audio")
    }

    pub(crate) fn thumbs_dir(&self) -> PathBuf {
        self.inner.data_dir.join("cache").join("thumbs")
    }

    pub(crate) fn emit(&self, event: &str, payload: serde_json::Value) {
        self.inner.events.emit(event, payload);
    }

    pub(crate) fn log(&self, level: &str, message: &str, details: Option<serde_json::Value>) {
        self.inner.logger.add_log(level, "download", message, details);
    }

    fn is_paused(&self) -> bool {
        self.inner.pause_depth.load(Ordering::SeqCst) > 0
    }

    pub fn begin_operation(&self, track_id: Option<&str>) -> Option<OperationGuard> {
        let cancel = CancelFlag::new();
        let mut op_id = 0u64;
        // Counted before the pause check, so a drain that pauses next always waits for this one
        self.inner.operations.send_modify(|ops| {
            ops.next_id += 1;
            op_id = ops.next_id;
            ops.total += 1;
            ops.active_cancels.insert(op_id, cancel.clone());
            if let Some(id) = track_id {
                ops.by_track.entry(id.to_string()).or_default().push((op_id, cancel.clone()));
            }
        });
        let guard = OperationGuard {
            inner: self.inner.clone(),
            op_id,
            track_id: track_id.map(str::to_string),
            cancel,
        };
        if self.is_paused() {
            return None;
        }
        Some(guard)
    }

    pub fn is_ingesting_track(&self, track_id: &str) -> bool {
        self.inner.operations.borrow().by_track.contains_key(track_id)
    }

    /// Closes intake (new ingests answer [`INGEST_PAUSED_MESSAGE`]) until the guard is dropped
    pub fn pause(&self) -> IngestPause {
        self.inner.pause_depth.fetch_add(1, Ordering::SeqCst);
        IngestPause(self.clone())
    }

    /// Stops everything in flight and waits until no ingest can still write (`abortIngestProcesses`)
    pub async fn abort(&self) {
        let _paused = self.pause();
        {
            let mut downloads = self.inner.downloads.lock().unwrap();
            downloads.queue.clear();
            downloads.queued.clear();
            if let Some((_, cancel)) = &downloads.current {
                cancel.cancel();
            }
        }
        {
            let mut epoch = self.inner.abort_epoch.lock().unwrap();
            epoch.cancel();
            *epoch = CancelFlag::new();
        }
        for cancel in self.inner.operations.borrow().active_cancels.values() {
            cancel.cancel();
        }
        // Killing a process is not completion: an ingest may still write after its next await
        let mut ops = self.inner.operations.subscribe();
        let _ = ops.wait_for(|o| o.total == 0).await;
        while self.inner.downloads.lock().unwrap().worker_running {
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
        let mut downloads = self.inner.downloads.lock().unwrap();
        downloads.queue.clear();
        downloads.queued.clear();
    }

    pub fn is_busy(&self) -> bool {
        let downloads = self.inner.downloads.lock().unwrap();
        downloads.worker_running
            || downloads.current.is_some()
            || !downloads.queue.is_empty()
            || self.inner.metadata_slots.available_permits() < ytdlp::MAX_CONCURRENT_METADATA
            || self.inner.metadata_waiting.load(Ordering::SeqCst) > 0
            || self.inner.operations.borrow().total > 0
            || self.is_paused()
            || is_waveform_busy()
    }

    /// The downloading track first, then the queue in order
    pub fn download_queue_order(&self) -> Vec<String> {
        let downloads = self.inner.downloads.lock().unwrap();
        let mut seen = HashSet::new();
        downloads
            .current
            .iter()
            .map(|(id, _)| id.clone())
            .chain(downloads.queue.iter().map(|(id, _)| id.clone()))
            .filter(|id| seen.insert(id.clone()))
            .collect()
    }

    /// Stops a track's download or ingest and waits for it to settle, so a delete can't be undone
    /// by an ingest still running (`cancelDownloadIfActive`)
    pub async fn cancel_download_if_active(&self, track_id: &str) {
        self.cancel_download_if_active_with_entries(track_id, None).await;
    }

    pub async fn cancel_download_if_active_with_entries(
        &self,
        track_id: &str,
        pre_read_audio_files: Option<&[String]>,
    ) {
        {
            let mut downloads = self.inner.downloads.lock().unwrap();
            downloads.queue.retain(|(id, _)| id != track_id);
            downloads.queued.remove(track_id);
            if let Some((id, cancel)) = &downloads.current
                && id == track_id
            {
                cancel.cancel();
            }
        }
        if let Some(list) = self.inner.operations.borrow().by_track.get(track_id) {
            for (_, cancel) in list {
                cancel.cancel();
            }
        }
        let audio_dir = self.audio_dir();
        for ext in SUPPORTED_AUDIO_EXTENSIONS {
            cancel_waveform_for_file(&audio_dir.join(format!("{track_id}{ext}")).to_string_lossy());
        }
        if self.is_ingesting_track(track_id) {
            if let Ok(Some(track)) = self.inner.db.get_track(track_id)
                && let Some(path) = track.file_path
            {
                cancel_waveform_for_file(&path);
            }
            let mut ops = self.inner.operations.subscribe();
            let _ = ops.wait_for(|o| !o.by_track.contains_key(track_id)).await;
        }
        purge_track_cache_files_with_entries(&audio_dir, track_id, pre_read_audio_files);
    }

    /// Queues the errored tracks again (all of them, or only `track_ids`); returns how many
    pub fn requeue_error_tracks(&self, track_ids: Option<&[String]>) -> usize {
        if self.is_paused() || track_ids.is_some_and(|ids| ids.is_empty()) {
            return 0;
        }
        self.reset_cookies_status();
        let wanted: Option<HashSet<&str>> = track_ids.map(|ids| ids.iter().map(String::as_str).collect());
        let errored: Vec<(String, String, String)> = self.inner.db.with_conn(|conn| {
            let rows: Vec<(String, String, String)> = conn
                .prepare("SELECT id, source_type, source_uri FROM tracks WHERE status = 'error'")
                .and_then(|mut stmt| {
                    stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?.collect()
                })
                .unwrap_or_default();
            let rows: Vec<_> = rows.into_iter().filter(|(id, _, _)| wanted.as_ref().is_none_or(|w| w.contains(id.as_str()))).collect();
            if let Ok(tx) = conn.transaction() {
                for (id, _, _) in &rows {
                    let _ = tx.execute("UPDATE tracks SET status = 'queued', error_message = NULL WHERE id = ?1", [id]);
                }
                let _ = tx.commit();
            }
            rows
        });

        let mut requeued = 0;
        for (id, source_type, source_uri) in errored {
            match source_type.as_str() {
                "youtube" => {
                    if !ytdlp::is_valid_youtube_url(&source_uri) {
                        self.mark_error(&id, "URL không hợp lệ. Chỉ chấp nhận link YouTube!");
                        continue;
                    }
                    self.trigger_download(&id, &source_uri, false);
                    requeued += 1;
                }
                "local" => {
                    let Some(operation) = self.begin_operation(Some(&id)) else {
                        continue;
                    };
                    let ingest = self.clone();
                    let id = id.clone();
                    if let Ok(handle) = tokio::runtime::Handle::try_current() {
                        handle.spawn(async move {
                            let res = ingest.ingest_local_file(&source_uri, None).await;
                            if !res.success
                                && !operation.cancel.is_cancelled()
                                && !ingest.is_paused()
                                && ingest.inner.db.get_track(&id).ok().flatten().is_some()
                            {
                                let message = res.message.unwrap_or_else(|| "Tải lại thất bại".into());
                                ingest.mark_error(&id, &message);
                            }
                            drop(operation);
                        });
                    }
                    requeued += 1;
                }
                _ => {}
            }
            self.emit("track_updated", json!({ "trackId": id }));
        }
        requeued
    }

    pub(crate) fn mark_error(&self, track_id: &str, message: &str) {
        let _ = self.inner.db.update_track(
            track_id,
            &crate::models::TrackUpdates {
                status: Some("error".into()),
                error_message: Some(Some(message.to_string())),
                ..Default::default()
            },
        );
        self.emit("track_updated", json!({ "trackId": track_id }));
    }

    /// Prunes/clamps a track's slices to a new duration and tells clients
    pub(crate) fn reconcile_segments(&self, track_id: &str, duration: f64) {
        match self.inner.db.reconcile_track_segments(track_id, duration) {
            Ok((pruned, clamped)) => {
                for id in pruned {
                    self.emit("segment_deleted", json!({ "segmentId": id, "trackId": track_id }));
                }
                for id in clamped {
                    self.emit("segment_updated", json!({ "segmentId": id, "trackId": track_id }));
                }
            }
            Err(e) => eprintln!("[Ingest] Segment reconciliation failed for track {track_id}: {e}"),
        }
    }
}

/// Trims whitespace and one pair of surrounding quotes, as pasted paths and links often carry
pub(crate) fn clean_input(raw: &str) -> &str {
    let trimmed = raw.trim();
    let trimmed = trimmed.strip_prefix(['"', '\'']).unwrap_or(trimmed);
    trimmed.strip_suffix(['"', '\'']).unwrap_or(trimmed)
}

pub fn clean_input_owned(raw: &str) -> String {
    clean_input(raw).to_string()
}

pub(crate) fn round2(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}

pub fn file_name(path: &Path) -> String {
    path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default()
}
