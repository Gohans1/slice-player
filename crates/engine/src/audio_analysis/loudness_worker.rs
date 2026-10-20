//! Sound Check's background measuring (`loudness.ts`): the ready songs without a loudness yet are
//! measured one at a time, newest first; clients hear about it every 10s and once the backlog is done.

use super::decoder::{analyze_audio_file_with, CancelFlag, WAVEFORM_POINTS};
use crate::db::Db;
use crate::events::EventBus;
use serde_json::json;
use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const ANNOUNCE_EVERY: Duration = Duration::from_secs(10);

#[derive(Clone)]
pub struct LoudnessWorker {
    inner: Arc<Inner>,
}

struct Inner {
    db: Db,
    events: EventBus,
    running: AtomicBool,
    run_again: AtomicBool,
    pause_depth: AtomicUsize,
    notify: tokio::sync::Notify,
    // Songs nothing could measure are tried again after a restart or restore, not over and over
    unmeasurable: Mutex<HashSet<String>>,
    current: Mutex<Option<CancelFlag>>,
}

impl LoudnessWorker {
    pub fn new(db: Db, events: EventBus) -> Self {
        Self {
            inner: Arc::new(Inner {
                db,
                events,
                running: AtomicBool::new(false),
                run_again: AtomicBool::new(false),
                pause_depth: AtomicUsize::new(0),
                notify: tokio::sync::Notify::new(),
                unmeasurable: Mutex::new(HashSet::new()),
                current: Mutex::new(None),
            }),
        }
    }

    fn is_paused(&self) -> bool {
        self.inner.pause_depth.load(Ordering::SeqCst) > 0
    }

    pub async fn drain(&self) {
        loop {
            let notified = self.inner.notify.notified();
            if !self.inner.running.load(Ordering::SeqCst) {
                return;
            }
            notified.await;
        }
    }

    /// Measures every ready song still missing a loudness. Called while a run is in flight, it
    /// only asks that run to look again for songs added since, and returns at once.
    pub async fn measure_missing_loudness(&self) {
        let inner = &self.inner;
        if self.is_paused() {
            return;
        }
        if inner.running.swap(true, Ordering::SeqCst) {
            inner.run_again.store(true, Ordering::SeqCst);
            return;
        }
        let mut unannounced = 0usize;
        let mut announced_at = Instant::now();
        loop {
            loop {
                inner.run_again.store(false, Ordering::SeqCst);
                if let Err(err) = self.measure_pass(&mut unannounced, &mut announced_at).await {
                    eprintln!("[Loudness] Measuring stopped: {err}");
                    break;
                }
                if !inner.run_again.load(Ordering::SeqCst) || self.is_paused() {
                    break;
                }
            }
            inner.running.store(false, Ordering::SeqCst);
            inner.notify.notify_waiters();
            // A request that slipped in after the last look starts another run, unless one already did
            if !inner.run_again.load(Ordering::SeqCst)
                || self.is_paused()
                || inner.running.swap(true, Ordering::SeqCst)
            {
                break;
            }
        }
        if unannounced > 0 && !self.is_paused() {
            self.announce();
        }
    }

    async fn measure_pass(&self, unannounced: &mut usize, announced_at: &mut Instant) -> Result<(), String> {
        let inner = &self.inner;
        if self.is_paused() {
            return Ok(());
        }
        let candidates = inner.db.list_tracks_to_measure()?;
        for (id, file_path) in candidates {
            if self.is_paused() {
                return Ok(());
            }
            if inner.unmeasurable.lock().unwrap().contains(&id) {
                continue;
            }
            if !crate::audio_source::is_supported_audio_file(std::path::Path::new(&file_path)) {
                inner.unmeasurable.lock().unwrap().insert(id);
                continue;
            }

            let cancel = {
                let mut current = inner.current.lock().unwrap();
                if self.is_paused() {
                    return Ok(());
                }
                let cancel = CancelFlag::new();
                *current = Some(cancel.clone());
                cancel
            };
            let measured = analyze_audio_file_with(&file_path, WAVEFORM_POINTS, cancel.clone())
                .await
                .ok()
                .and_then(|result| result.loudness);
            *inner.current.lock().unwrap() = None;

            // A pause (restore) cut this measurement short: it says nothing about the song
            if self.is_paused() || cancel.is_cancelled() {
                return Ok(());
            }
            let Some(measured) = measured else {
                inner.unmeasurable.lock().unwrap().insert(id);
                continue;
            };
            inner.db.set_track_loudness(&id, measured.loudness, measured.true_peak)?;
            *unannounced += 1;
            if announced_at.elapsed() > ANNOUNCE_EVERY {
                self.announce();
                *unannounced = 0;
                *announced_at = Instant::now();
            }
        }
        Ok(())
    }

    fn announce(&self) {
        self.inner.events.emit("track_updated", json!({ "reason": "loudness" }));
    }

    /// A restore swaps the library's files and database: measuring stops now, and starts over
    /// once every pause has been resumed. Must be resumed from inside a Tokio runtime.
    pub fn pause(&self) -> Box<dyn FnOnce() + Send> {
        let inner = &self.inner;
        {
            let current = inner.current.lock().unwrap();
            inner.pause_depth.fetch_add(1, Ordering::SeqCst);
            if let Some(cancel) = current.as_ref() {
                cancel.cancel();
            }
        }
        inner.unmeasurable.lock().unwrap().clear();
        let worker = self.clone();
        Box::new(move || {
            if worker.inner.pause_depth.fetch_sub(1, Ordering::SeqCst) == 1 {
                tokio::spawn(async move { worker.measure_missing_loudness().await });
            }
        })
    }
}
