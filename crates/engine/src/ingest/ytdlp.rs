//! YouTube links (`ingestYouTubeUrl` and the download queue in `ingest.ts`). Metadata comes from
//! `yt-dlp -J` (two at a time, at most 20 waiting); downloads run one at a time.

use super::process::{run_tool, ToolOutput};
use super::{clean_input, round2, Ingest, IngestResult, CANCELLED_MESSAGE, DURATION_EPSILON_SECONDS, INGEST_PAUSED_MESSAGE, MAX_DURATION_SECONDS, MAX_PLAYLIST_ITEMS};
use crate::audio_analysis::{analyze_audio_file_with, CancelFlag, WAVEFORM_POINTS};
use crate::audio_source::{dotted_extension, SUPPORTED_AUDIO_EXTENSIONS};
use crate::db::purge_track_cache_files;
use crate::db::tracks_segments::row_to_track_full;
use crate::metadata::read_local_metadata;
use crate::models::{Track, TrackUpdates};
use regex::Regex;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::LazyLock;
use std::time::{Duration, Instant};

pub(crate) const MAX_CONCURRENT_METADATA: usize = 2;
const MAX_METADATA_QUEUE_DEPTH: usize = 20;
const METADATA_QUEUE_TIMEOUT: Duration = Duration::from_secs(600);
const YTDLP_TIMEOUT: Duration = Duration::from_secs(300);
const COOKIE_COOLDOWN: Duration = Duration::from_secs(5 * 60);
const MIN_AUDIO_BYTES: u64 = 1024;
/// A failed or cancelled download waits this long before the next one starts
const BETWEEN_DOWNLOADS: Duration = Duration::from_secs(1);

static YOUTUBE_URL: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)^https?://(?:[a-zA-Z0-9_-]+\.)*(?:youtube\.com|youtu\.be)/.+").unwrap());
static AUTH_ERROR: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)sign in to confirm (?:you['’]re|you are) not a bot|sign in to view|login required|(?:cookie|cookies).*(?:expired|invalid|corrupt|failed|error)|(?:invalid|corrupt|failed|error|expired).*(?:cookie|cookies)|needs to be reloaded|403[:\s]+forbidden|401[:\s]+unauthorized|429[:\s]+too many requests|http error (?:403|401|429)|po[-_ ]?token|proof[-_ ]of[-_ ]origin").unwrap()
});
static VIDEO_RESTRICTION: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)private video|members-only|confirm your age").unwrap());
static FORMAT_OR_SABR: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)requested format is not available|forcing sabr streaming|only images are available for download").unwrap()
});
static UNAVAILABLE_TITLE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)^\[(private video|deleted video|unavailable video|video riêng tư|video bị xóa)\]$").unwrap()
});
static VIDEO_ID: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[a-zA-Z0-9_-]{1,64}$").unwrap());
static FILTERED_OUT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)does not pass filter|larger than max-filesize").unwrap());

fn match_filter() -> String {
    format!("duration <=? {MAX_DURATION_SECONDS} & !is_live & live_status != is_upcoming & live_status != post_live")
}

/// yt-dlp failed for a reason a fresh login or another client can fix
pub fn is_youtube_auth_error(stderr: &str) -> bool {
    AUTH_ERROR.is_match(stderr) && !VIDEO_RESTRICTION.is_match(stderr)
}

pub fn is_youtube_format_or_sabr_error(stderr: &str) -> bool {
    FORMAT_OR_SABR.is_match(stderr)
}

/// `/<name>` followed by an optional `.ext`, then `?` or the end of the URL
fn names_thumb_file(url: &str, name: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    let needle = format!("/{name}");
    lower.match_indices(&needle).any(|(i, _)| {
        let rest = &lower[i + needle.len()..];
        let rest = match rest.strip_prefix('.') {
            Some(after_dot) => {
                let ext_len = after_dot.bytes().take_while(u8::is_ascii_alphanumeric).count();
                if ext_len == 0 {
                    return false;
                }
                &after_dot[ext_len..]
            }
            None => rest,
        };
        rest.is_empty() || rest.starts_with('?')
    })
}

fn is_usable_thumb_url(url: &str) -> bool {
    !url.contains("sqp=") && (url.starts_with("https://") || url.starts_with("http://") || url.starts_with("//"))
}

fn normalize_thumb_url(url: &str) -> String {
    if url.starts_with("//") { format!("https:{url}") } else { url.to_string() }
}

/// `encodeURIComponent` for the characters a video id can't normally hold
fn encode_uri_component(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'!' | b'~' | b'*' | b'\'' | b'(' | b')' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

/// The best thumbnail of a video: yt-dlp's list ranked by quality (never a downscaled `sqp=` copy),
/// else the constructed `maxresdefault.jpg`, else a clean default
pub fn resolve_best_youtube_thumbnail(video_id: &str, thumbnails: Option<&Value>, default_thumbnail: Option<&str>) -> String {
    let video_id = video_id.trim();
    let constructed = if video_id.is_empty() {
        String::new()
    } else {
        format!("https://i.ytimg.com/vi/{}/maxresdefault.jpg", encode_uri_component(video_id))
    };
    let mut valid: Vec<&Value> = thumbnails
        .and_then(Value::as_array)
        .map(|list| {
            list.iter()
                .filter(|t| t.get("url").and_then(Value::as_str).is_some_and(is_usable_thumb_url))
                .collect()
        })
        .unwrap_or_default();
    if !valid.is_empty() {
        let score = |t: &Value| -> f64 {
            let dim = |key: &str| t.get(key).and_then(Value::as_f64).filter(|v| v.is_finite() && *v > 0.0).unwrap_or(0.0);
            let (width, height) = (dim("width"), dim("height"));
            let area = if width * height > 0.0 { width * height } else { width + height };
            let id = t.get("id").and_then(Value::as_str).unwrap_or("");
            let url = t.get("url").and_then(Value::as_str).unwrap_or("");
            let tier = |name: &str| id == name || names_thumb_file(url, name);
            if tier("maxresdefault") || width >= 1280.0 {
                1_000_000.0 + area
            } else if tier("hq720") {
                800_000.0 + area
            } else if tier("sddefault") || width >= 640.0 {
                500_000.0 + area
            } else if tier("hqdefault") || width >= 480.0 {
                300_000.0 + area
            } else if tier("mqdefault") || width >= 320.0 {
                200_000.0 + area
            } else {
                match t.get("preference").and_then(Value::as_f64) {
                    Some(p) if p > 0.0 => p * 10_000.0 + area,
                    _ => area,
                }
            }
        };
        // Stable sort, best first, like Array.prototype.sort with (b - a)
        valid.sort_by(|a, b| score(b).partial_cmp(&score(a)).unwrap_or(std::cmp::Ordering::Equal));
        let best_url = valid[0].get("url").and_then(Value::as_str).unwrap_or("");
        // Only a medium-or-better listed thumbnail beats the constructed maxresdefault
        if score(valid[0]) >= 200_000.0 {
            return normalize_thumb_url(best_url);
        }
        if !constructed.is_empty() {
            return constructed;
        }
        return normalize_thumb_url(best_url);
    }
    match default_thumbnail {
        Some(url) if is_usable_thumb_url(url) => normalize_thumb_url(url),
        _ => constructed,
    }
}

impl Ingest {
    fn cookie_path(&self) -> PathBuf {
        crate::db::resolve_abs_path(&self.inner.data_dir.join("cookies.txt"))
    }

    pub fn mark_cookies_failed(&self) {
        self.inner.cookies.lock().unwrap().last_failure = Some(Instant::now());
    }

    pub fn reset_cookies_status(&self) {
        *self.inner.cookies.lock().unwrap() = Default::default();
    }

    /// `./data/cookies.txt` exists and isn't in its 5-minute cooldown after an auth failure; a newly
    /// written cookie file ends the cooldown
    fn has_valid_cookies(&self) -> bool {
        let Ok(meta) = std::fs::metadata(self.cookie_path()) else {
            return false;
        };
        if !meta.is_file() || meta.len() == 0 {
            return false;
        }
        let mtime = meta.modified().ok();
        let mut cookies = self.inner.cookies.lock().unwrap();
        if mtime != cookies.last_mtime {
            cookies.last_mtime = mtime;
            cookies.last_failure = None;
            return true;
        }
        cookies.last_failure.is_none_or(|at| at.elapsed() > COOKIE_COOLDOWN)
    }

    pub fn youtube_auth_args(&self, use_cookies: bool, fallback_client: bool) -> Vec<String> {
        let mut args: Vec<String> = ["--js-runtimes", "bun", "--js-runtimes", "node", "--extractor-args"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        args.push(if fallback_client { "youtube:player_client=mweb,android,ios,web" } else { "youtube:player_client=default,-tv" }.into());
        if use_cookies && self.has_valid_cookies() {
            args.push("--cookies".into());
            args.push(self.cookie_path().to_string_lossy().to_string());
        }
        args
    }

    fn abort_epoch(&self) -> CancelFlag {
        self.inner.abort_epoch.lock().unwrap().clone()
    }

    /// One of the two metadata slots: at most 20 requests wait, none longer than 10 minutes
    async fn acquire_metadata_slot(&self, abort: &CancelFlag) -> Result<tokio::sync::SemaphorePermit<'_>, String> {
        let slots = &self.inner.metadata_slots;
        if let Ok(permit) = slots.try_acquire() {
            return Ok(permit);
        }
        struct WaitingGuard<'a>(&'a std::sync::atomic::AtomicUsize);
        impl Drop for WaitingGuard<'_> {
            fn drop(&mut self) {
                self.0.fetch_sub(1, Ordering::SeqCst);
            }
        }
        let waiting = &self.inner.metadata_waiting;
        if waiting.fetch_add(1, Ordering::SeqCst) >= MAX_METADATA_QUEUE_DEPTH {
            waiting.fetch_sub(1, Ordering::SeqCst);
            return Err("Máy chủ đang bận xử lý nhiều yêu cầu tải nhạc, vui lòng thử lại sau.".into());
        }
        let _waiting_guard = WaitingGuard(waiting);
        let deadline = Instant::now() + METADATA_QUEUE_TIMEOUT;
        let acquire = slots.acquire();
        tokio::pin!(acquire);
        loop {
            tokio::select! {
                permit = &mut acquire => break permit.map_err(|e| e.to_string()),
                _ = tokio::time::sleep(Duration::from_millis(100)) => {
                    if abort.is_cancelled() {
                        break Err(CANCELLED_MESSAGE.into());
                    }
                    if Instant::now() >= deadline {
                        break Err("Quá thời gian chờ hàng đợi xử lý YouTube (chờ quá 10 phút)".into());
                    }
                }
            }
        }
    }

    async fn run_ytdlp(&self, args: Vec<String>, cancel: &[&CancelFlag], capture_stdout: bool) -> ToolOutput {
        match run_tool(&self.inner.ytdlp, &args, YTDLP_TIMEOUT, cancel, capture_stdout).await {
            Ok(out) => out,
            Err(e) => ToolOutput { code: Some(1), stderr: format!("ERROR: cannot run yt-dlp: {e}"), ..Default::default() },
        }
    }

    /// Runs `attempt(with_cookies, fallback_client)`; on a failure that isn't a timeout, retries with
    /// the fallback client (dropping cookies that failed auth), then once more without cookies
    async fn with_client_fallback<F, Fut>(&self, mut attempt: F) -> ToolOutput
    where
        F: FnMut(bool, bool) -> Fut,
        Fut: std::future::Future<Output = ToolOutput>,
    {
        let used_cookies = self.has_valid_cookies();
        let mut out = attempt(used_cookies, false).await;
        if out.success() || out.timed_out || out.cancelled {
            return out;
        }
        let auth_error = is_youtube_auth_error(&out.stderr);
        if auth_error && used_cookies {
            self.mark_cookies_failed();
        }
        eprintln!(
            "[Ingest] yt-dlp failed with {} (exit code {}), retrying with fallback client...",
            if auth_error { "auth/bot challenge" } else { "format/SABR/client restriction" },
            out.exit_code()
        );
        out = attempt(used_cookies && !auth_error, true).await;
        if !out.success() && !out.timed_out && !out.cancelled && used_cookies && !auth_error {
            out = attempt(false, true).await;
        }
        out
    }

    pub async fn ingest_youtube_url(&self, raw_url: &str) -> IngestResult {
        let mut url = clean_input(raw_url).to_string();
        if !url.to_ascii_lowercase().starts_with("http://") && !url.to_ascii_lowercase().starts_with("https://") {
            url = format!("https://{url}");
        }
        if !YOUTUBE_URL.is_match(&url) {
            self.log("warn", &format!("URL không hợp lệ: {raw_url}"), None);
            return IngestResult::fail(
                "URL không hợp lệ. Chỉ chấp nhận link YouTube (youtube.com, m.youtube.com, music.youtube.com, hoặc youtu.be)!",
            );
        }
        let Some(_operation) = self.begin_operation(None) else {
            return IngestResult::fail(INGEST_PAUSED_MESSAGE);
        };
        match self.ingest_youtube_url_inner(&url).await {
            Ok(result) => result,
            Err(message) => {
                self.log("error", &format!("Lỗi xử lý YouTube: {message}"), Some(json!({ "url": url, "error": message })));
                IngestResult::fail(format!("Lỗi xử lý YouTube: {message}"))
            }
        }
    }

    async fn ingest_youtube_url_inner(&self, url: &str) -> Result<IngestResult, String> {
        self.log("info", &format!("Bắt đầu quét metadata YouTube: {url}"), None);
        let abort = self.abort_epoch();
        let out = {
            let _slot = self.acquire_metadata_slot(&abort).await?;
            self.with_client_fallback(|with_cookies, fallback| {
                let mut args = self.youtube_auth_args(with_cookies, fallback);
                args.extend([
                    "--flat-playlist".into(),
                    "--playlist-end".into(),
                    MAX_PLAYLIST_ITEMS.to_string(),
                    "--match-filter".into(),
                    match_filter(),
                    "-J".into(),
                    "--skip-download".into(),
                    "--socket-timeout".into(),
                    "30".into(),
                    "--".into(),
                    url.to_string(),
                ]);
                let abort = abort.clone();
                async move { self.run_ytdlp(args, &[&abort], true).await }
            })
            .await
        };
        if out.cancelled {
            return Ok(IngestResult::fail(CANCELLED_MESSAGE));
        }
        let output_text = String::from_utf8_lossy(&out.stdout).to_string();
        if !out.success() || output_text.trim().is_empty() {
            let message = if out.timed_out {
                "Quá thời gian trích xuất thông tin YouTube (timeout 5 phút)".to_string()
            } else if out.code == Some(101) {
                "Lỗi kết nối mạng: Không thể kết nối tới máy chủ YouTube (Network unreachable / Code 101)".to_string()
            } else if out.success() {
                "Video không đáp ứng điều kiện (vượt quá 30 phút, livestream hoặc bị chặn)".to_string()
            } else {
                let err = out.error_text();
                format!("yt-dlp error (exit code {}): {}", out.exit_code(), if err.is_empty() { "No metadata returned" } else { &err })
            };
            self.log("error", &format!("Lỗi quét metadata YouTube: {message}"), Some(json!({ "url": url, "exitCode": out.exit_code() })));
            return Ok(IngestResult::fail(message));
        }

        let data: Value = match (output_text.find('{'), output_text.rfind('}')) {
            (Some(start), Some(end)) if end > start => match serde_json::from_str(&output_text[start..=end]) {
                Ok(data) => data,
                Err(_) => return Ok(IngestResult::fail(json_parse_error(&out, &output_text))),
            },
            _ => return Ok(IngestResult::fail(json_parse_error(&out, &output_text))),
        };

        let raw_entries: Vec<Value> = match data.get("entries").and_then(Value::as_array) {
            Some(entries) => entries.clone(),
            None => vec![data.clone()],
        };
        if raw_entries.is_empty() {
            return Ok(IngestResult::fail("Không tìm thấy bài hát nào (playlist rỗng hoặc video ở chế độ riêng tư)!"));
        }
        let entries = &raw_entries[..raw_entries.len().min(MAX_PLAYLIST_ITEMS)];
        let is_playlist = data.get("entries").is_some_and(Value::is_array) || entries.len() > 1;

        let batch = self.queue_youtube_entries(entries)?;
        for (event, track_id) in &batch.events {
            self.emit(event, json!({ "trackId": track_id }));
        }
        for (track_id, watch_url) in &batch.workers {
            self.trigger_download(track_id, watch_url, !is_playlist);
        }

        if batch.tracks.is_empty() {
            return Ok(IngestResult::fail(format!(
                "Mọi video trong link đều vượt quá giới hạn 30 phút ({MAX_DURATION_SECONDS}s), là livestream hoặc không hợp lệ!"
            )));
        }
        if is_playlist && batch.queued > 0 {
            self.log("info", &format!("Đã nạp {} bài hát từ playlist vào hàng đợi tải.", batch.queued), Some(json!({ "count": batch.queued })));
        }
        if batch.skipped_duration > 0 {
            self.log("warn", &format!("Bỏ qua {} bài trong playlist do thời lượng vượt quá 30 phút.", batch.skipped_duration), Some(json!({ "count": batch.skipped_duration })));
        }
        if batch.skipped_invalid > 0 {
            self.log("warn", &format!("Bỏ qua {} video không hợp lệ, riêng tư hoặc livestream trong playlist.", batch.skipped_invalid), Some(json!({ "count": batch.skipped_invalid })));
        }
        let message = if is_playlist {
            format!("Đã xử lý {} bài hát từ playlist ({} bài được đưa vào hàng đợi tải).", batch.tracks.len(), batch.queued)
        } else {
            "Đã nạp thành công bài hát vào hàng đợi tải.".to_string()
        };
        self.log("success", &format!("Đã xử lý YouTube URL: tạo/cập nhật {} bài hát", batch.tracks.len()), Some(json!({ "count": batch.tracks.len() })));
        Ok(IngestResult::ok(batch.tracks, message))
    }

    /// Inserts new `yt_<id>` rows as queued and requeues unfinished ones, in one transaction
    fn queue_youtube_entries(&self, entries: &[Value]) -> Result<QueuedBatch, String> {
        let active: HashSet<String> = self.download_queue_order().into_iter().collect();
        self.inner.db.with_conn(|conn| {
            let tx = conn.transaction().map_err(|e| e.to_string())?;
            let mut batch = QueuedBatch::default();
            let mut seen = HashSet::new();
            for entry in entries {
                let id = match entry.get("id") {
                    Some(Value::String(s)) => s.clone(),
                    Some(Value::Number(n)) => n.to_string(),
                    _ => String::new(),
                };
                let title = entry.get("title").and_then(Value::as_str).unwrap_or("");
                if !VIDEO_ID.is_match(&id) || title.is_empty() || UNAVAILABLE_TITLE.is_match(title.trim()) {
                    batch.skipped_invalid += 1;
                    continue;
                }
                let live_status = entry.get("live_status").and_then(Value::as_str).unwrap_or("");
                if entry.get("is_live").and_then(Value::as_bool).unwrap_or(false)
                    || matches!(live_status, "is_live" | "is_upcoming" | "post_live")
                {
                    eprintln!("[Skip] Bỏ qua livestream hoặc lịch phát sóng sắp diễn ra: {title}");
                    batch.skipped_invalid += 1;
                    continue;
                }
                let duration = entry.get("duration").and_then(Value::as_f64).unwrap_or(0.0);
                if duration > MAX_DURATION_SECONDS {
                    eprintln!("[Skip] Track \"{title}\" exceeds 30m limit ({duration}s > {MAX_DURATION_SECONDS}s)");
                    batch.skipped_duration += 1;
                    continue;
                }
                let track_id = format!("yt_{id}");
                if !seen.insert(track_id.clone()) {
                    continue;
                }
                let uploader = entry
                    .get("uploader")
                    .and_then(Value::as_str)
                    .filter(|s| !s.is_empty())
                    .or_else(|| entry.get("channel").and_then(Value::as_str))
                    .unwrap_or("");
                let watch_url = format!("https://www.youtube.com/watch?v={id}");
                let thumb = resolve_best_youtube_thumbnail(&id, entry.get("thumbnails"), entry.get("thumbnail").and_then(Value::as_str));

                let existing: Option<Track> = tx
                    .query_row("SELECT * FROM tracks WHERE id = ?1 LIMIT 1", [&track_id], row_to_track_full)
                    .ok();
                let track = match existing {
                    None => {
                        let created = tx
                            .query_row(
                                "INSERT INTO tracks (id, source_type, source_uri, title, artist, duration, thumbnail_url, file_path, peaks_json, status, error_message, volume)
                                 VALUES (?1, 'youtube', ?2, ?3, ?4, ?5, ?6, NULL, NULL, 'queued', NULL, 0.5) RETURNING *",
                                rusqlite::params![track_id, watch_url, title, uploader, duration, thumb],
                                row_to_track_full,
                            )
                            .map_err(|e| e.to_string())?;
                        batch.queued += 1;
                        batch.events.push(("track_created", track_id.clone()));
                        batch.workers.push((track_id.clone(), watch_url));
                        created
                    }
                    Some(existing) if !active.contains(&track_id) && existing.status != "ready" => {
                        let updated = tx
                            .query_row(
                                "UPDATE tracks SET status = 'queued', error_message = NULL, thumbnail_url = ?2 WHERE id = ?1 RETURNING *",
                                rusqlite::params![track_id, thumb],
                                row_to_track_full,
                            )
                            .map_err(|e| e.to_string())?;
                        batch.queued += 1;
                        batch.events.push(("track_updated", track_id.clone()));
                        batch.workers.push((track_id.clone(), watch_url));
                        updated
                    }
                    Some(existing) => existing,
                };
                batch.tracks.push(track);
            }
            tx.commit().map_err(|e| e.to_string())?;
            Ok(batch)
        })
    }

    pub(crate) fn trigger_download(&self, track_id: &str, url: &str, should_log: bool) {
        if self.inner.pause_depth.load(Ordering::SeqCst) > 0 {
            return;
        }
        {
            let mut downloads = self.inner.downloads.lock().unwrap();
            let is_current = downloads.current.as_ref().is_some_and(|(id, _)| id == track_id);
            if is_current || downloads.queued.contains(track_id) {
                return;
            }
            downloads.queue.push_back((track_id.to_string(), url.to_string()));
            downloads.queued.insert(track_id.to_string());
        }
        if should_log {
            let title = self.inner.db.get_track(track_id).ok().flatten().map(|t| t.title).unwrap_or_else(|| track_id.to_string());
            self.log("info", &format!("Đã đưa vào hàng đợi tải: [{title}]"), Some(json!({ "trackId": track_id })));
        }
        self.start_download_worker();
    }

    pub(crate) fn start_download_worker(&self) {
        if self.is_paused() {
            return;
        }
        {
            let mut downloads = self.inner.downloads.lock().unwrap();
            if self.is_paused() || downloads.worker_running || downloads.queue.is_empty() {
                return;
            }
            downloads.worker_running = true;
        }
        let ingest = self.clone();
        if let Ok(handle) = tokio::runtime::Handle::try_current() {
            handle.spawn(async move {
                loop {
                    let Some((track_id, url, operation)) = ingest.take_next_download() else { break };
                    let attempted = ingest.process_download(&track_id, &url).await;
                    ingest.inner.downloads.lock().unwrap().current = None;
                    let cancelled = operation.cancel.is_cancelled();
                    drop(operation);
                    if attempted && !cancelled && !ingest.is_paused() {
                        let deadline = tokio::time::Instant::now() + BETWEEN_DOWNLOADS;
                        while !ingest.is_paused() && tokio::time::Instant::now() < deadline {
                            tokio::time::sleep(Duration::from_millis(50)).await;
                        }
                    }
                    if ingest.is_paused() {
                        break;
                    }
                }
                ingest.inner.downloads.lock().unwrap().worker_running = false;
                // A download queued between the last look and the flag reset starts its own worker
                ingest.start_download_worker();
            });
        } else {
            self.inner.downloads.lock().unwrap().worker_running = false;
        }
    }

    fn take_next_download(&self) -> Option<(String, String, super::OperationGuard)> {
        let mut downloads = self.inner.downloads.lock().unwrap();
        let (track_id, url) = downloads.queue.front()?.clone();
        let operation = self.begin_operation(Some(&track_id))?;
        downloads.queue.pop_front();
        downloads.queued.remove(&track_id);
        downloads.current = Some((track_id.clone(), operation.cancel.clone()));
        Some((track_id, url, operation))
    }

    fn current_cancel(&self) -> CancelFlag {
        self.inner.downloads.lock().unwrap().current.as_ref().map(|(_, c)| c.clone()).unwrap_or_default()
    }

    /// Downloads, checks and analyses one queued track. Returns whether yt-dlp ran.
    async fn process_download(&self, track_id: &str, url: &str) -> bool {
        let cancel = self.current_cancel();
        let db = &self.inner.db;
        let gone = || cancel.is_cancelled() || db.get_track(track_id).ok().flatten().is_none();

        let Some(existing) = db.get_track(track_id).ok().flatten() else { return false };
        let file_exists = existing.file_path.as_deref().is_some_and(|p| Path::new(p).exists());
        if existing.status == "ready" && file_exists {
            return false;
        }
        let audio_dir = self.audio_dir();
        let _ = std::fs::create_dir_all(&audio_dir);
        purge_track_cache_files(&audio_dir, track_id);

        let _ = db.update_track(track_id, &TrackUpdates { status: Some("downloading".into()), ..Default::default() });
        self.log("info", &format!("Bắt đầu tải audio yt-dlp: [{}]", existing.title), Some(json!({ "trackId": track_id })));
        self.emit("track_updated", json!({ "trackId": track_id }));

        let output_template = audio_dir.join(format!("{track_id}.%(ext)s")).to_string_lossy().to_string();
        let out = self
            .with_client_fallback(|with_cookies, fallback| {
                let mut args = self.youtube_auth_args(with_cookies, fallback);
                args.extend(
                    [
                        "--no-playlist", "-f", "ba/b", "-x", "--audio-quality", "0", "--match-filter",
                    ]
                    .map(String::from),
                );
                args.push(match_filter());
                args.extend(
                    ["--max-filesize", "150M", "--socket-timeout", "30", "--retries", "3", "--fragment-retries", "3", "-o"].map(String::from),
                );
                args.push(output_template.clone());
                args.push("--".into());
                args.push(url.to_string());
                let cancel = cancel.clone();
                let audio_dir = audio_dir.clone();
                async move {
                    // A retry starts from a clean slate, and not at all for a cancelled or deleted track
                    if fallback {
                        purge_track_cache_files(&audio_dir, track_id);
                    }
                    if cancel.is_cancelled() || db.get_track(track_id).ok().flatten().is_none() {
                        return ToolOutput { code: Some(1), cancelled: true, ..Default::default() };
                    }
                    self.run_ytdlp(args, &[&cancel], false).await
                }
            })
            .await;

        let final_path = find_downloaded_file(&audio_dir, track_id);
        if gone() {
            if let Some(path) = &final_path {
                let _ = std::fs::remove_file(path);
            }
            return true;
        }
        if !out.success() {
            purge_track_cache_files(&audio_dir, track_id);
            let err = out.error_text();
            let message = if out.timed_out {
                "Quá thời gian tải âm thanh (timeout 5 phút)".to_string()
            } else if out.code == Some(101) {
                "Lỗi mạng khi tải âm thanh: Không thể kết nối tới YouTube (Network unreachable / Code 101)".to_string()
            } else if !err.trim().is_empty() {
                format!("yt-dlp: {err}")
            } else {
                format!("yt-dlp tải thất bại (exit code: {})", out.exit_code())
            };
            self.log("error", &format!("Tải audio yt-dlp thất bại cho [{}]: {message}", existing.title), None);
            self.mark_error(track_id, &message);
            return true;
        }
        let Some(final_path) = final_path else {
            let message = if FILTERED_OUT.is_match(&out.stderr) {
                "Video không đáp ứng điều kiện tải (vượt quá 30 phút, quá 150MB hoặc livestream)"
            } else {
                "Tải thất bại, file vượt quá 30m/150MB hoặc không tìm thấy"
            };
            self.log("error", &format!("Không tìm thấy file audio tải về cho [{}]: {message}", existing.title), None);
            self.mark_error(track_id, message);
            return true;
        };

        if std::fs::metadata(&final_path).map(|m| m.len()).unwrap_or(0) < MIN_AUDIO_BYTES {
            let _ = std::fs::remove_file(&final_path);
            self.mark_error(track_id, "Tải thất bại: File âm thanh rỗng hoặc bị hỏng");
            return true;
        }

        // The file's own duration wins over what the metadata announced
        let mut duration = read_local_metadata(&final_path).await.duration;
        if duration <= 0.0 && (0.5..=MAX_DURATION_SECONDS).contains(&existing.duration) {
            duration = existing.duration;
        }
        if !(0.5..=MAX_DURATION_SECONDS + DURATION_EPSILON_SECONDS).contains(&duration) {
            let _ = std::fs::remove_file(&final_path);
            let message = if duration < 0.5 {
                "Không thể đọc định dạng âm thanh hoặc file bị hỏng (thời lượng < 0.5s)".to_string()
            } else {
                format!("Thời lượng thực tế ({:.0}s) vượt quá giới hạn 30 phút!", duration)
            };
            self.log("error", &format!("Lỗi thời lượng [{}]: {message}", existing.title), None);
            self.mark_error(track_id, &message);
            return true;
        }

        self.log("info", &format!("Đang trích xuất waveform: [{}]", existing.title), None);
        let analysis = analyze_audio_file_with(&final_path, WAVEFORM_POINTS, cancel.clone()).await;
        // Cancelled or deleted while it was being analysed: leave nothing behind
        if gone() {
            let _ = std::fs::remove_file(&final_path);
            return true;
        }
        let analysis = match analysis {
            Ok(analysis) => analysis,
            Err(message) => {
                purge_track_cache_files(&audio_dir, track_id);
                self.log("error", &format!("Lỗi khi tải bài hát [{track_id}]: {message}"), None);
                self.mark_error(track_id, &message);
                return true;
            }
        };

        let duration = MAX_DURATION_SECONDS.min(round2(duration));
        self.reconcile_segments(track_id, duration);
        let updated = db.update_track(
            track_id,
            &TrackUpdates {
                file_path: Some(Some(final_path.to_string_lossy().to_string())),
                duration: Some(duration),
                peaks_json: Some(serde_json::to_string(&analysis.peaks).ok()),
                status: Some("ready".into()),
                error_message: Some(None),
                loudness: Some(analysis.loudness.map(|l| l.loudness)),
                true_peak: Some(analysis.loudness.map(|l| l.true_peak)),
                ..Default::default()
            },
        );
        match updated {
            Ok(Some(track)) => {
                self.log("success", &format!("Bài hát sẵn sàng phát: [{}] ({}s)", track.title, duration.round()), None);
                self.emit("track_updated", json!({ "trackId": track_id }));
            }
            _ => {
                let _ = std::fs::remove_file(&final_path);
            }
        }
        true
    }
}

#[derive(Default)]
struct QueuedBatch {
    tracks: Vec<Track>,
    events: Vec<(&'static str, String)>,
    workers: Vec<(String, String)>,
    queued: usize,
    skipped_duration: usize,
    skipped_invalid: usize,
}

fn json_parse_error(out: &ToolOutput, output_text: &str) -> String {
    let err = out.error_text();
    let detail = if err.is_empty() { output_text.chars().take(150).collect() } else { err };
    format!("yt-dlp JSON parse error: {detail}")
}

/// `<track id>.<audio ext>` in the cache, skipping yt-dlp's `.part`/`.ytdl` leftovers
fn find_downloaded_file(audio_dir: &Path, track_id: &str) -> Option<PathBuf> {
    std::fs::read_dir(audio_dir).ok()?.flatten().map(|e| e.path()).find(|path| {
        let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        let ext = dotted_extension(path);
        path.file_stem().is_some_and(|stem| stem == track_id)
            && !name.ends_with(".part")
            && !name.ends_with(".ytdl")
            && SUPPORTED_AUDIO_EXTENSIONS.contains(&ext.as_str())
    })
}
