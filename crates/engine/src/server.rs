//! Full runtime wiring for `slice-server` (`src/server/index.ts`): startup sequence, single-instance
//! probe, DB open + incomplete ingest recovery, background Sound Check loudness worker, HTTP/WS
//! listener, production browser window + idle/orphan watchdog, and graceful shutdown.

use crate::app_window::{is_server_running, maybe_chdir_to_exe_dir, open_app_window, WsLifecycleTracker};
use crate::audio_analysis::{abort_waveform_processes, analyze_audio_file, WAVEFORM_POINTS};
use crate::db::{resolve_abs_path, Db};
use crate::events::EventBus;
use crate::http::{build_router, AppState};
use crate::models::TrackUpdates;
use crate::EngineConfig;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::sync::oneshot;
use tokio::task::JoinHandle;

pub struct RunningServer {
    pub addr: SocketAddr,
    pub state: AppState,
    shutdown_tx: Option<oneshot::Sender<()>>,
    server_task: JoinHandle<()>,
    loudness_task: JoinHandle<()>,
}

impl RunningServer {
    pub fn app_url(&self) -> String {
        format!("http://127.0.0.1:{}", self.addr.port())
    }

    /// Gracefully stops the HTTP listener, aborts in-flight ingests and waveform jobs, and closes
    /// SQLite (which runs `PRAGMA wal_checkpoint(TRUNCATE)`).
    pub async fn shutdown(mut self) {
        println!("[Server] Shutting down cleanly: closing DB and stopping workers.");
        self.loudness_task.abort();
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }
        let _ = tokio::time::timeout(std::time::Duration::from_secs(5), self.server_task).await;
        self.state.ingest.abort().await;
        let _ = self.state.loudness.pause();
        abort_waveform_processes();
        self.state.loudness.drain().await;
        self.state.db.close();
    }
}

/// Boots the engine in-process (`Db::open` -> `recover_incomplete_ingests` -> loudness worker ->
/// bind `127.0.0.1:<port>`) and returns a [`RunningServer`] handle. Passing `config.port = 0` binds
/// an ephemeral port and updates `state.config.port` to the bound port.
pub async fn start_server(mut config: EngineConfig) -> Result<RunningServer, String> {
    let db = Db::open(&config.db_path, config.is_test)?;
    let listener = TcpListener::bind(("127.0.0.1", config.port))
        .await
        .map_err(|e| format!("Failed to bind 127.0.0.1:{}: {e}", config.port))?;
    let addr = listener.local_addr().map_err(|e| e.to_string())?;
    config.port = addr.port();

    let events = EventBus::new();
    let mut state = AppState::new(config.clone(), db, events);
    state.ws_lifecycle = Some(Arc::new(WsLifecycleTracker::new()));

    let _ = state
        .db
        .recover_incomplete_ingests(state.config.data_dir.join("cache").join("audio"), &state.events);

    let loudness = state.loudness.clone();
    let loudness_task = tokio::spawn(async move {
        loudness.measure_missing_loudness().await;
    });

    let app_url = format!("http://127.0.0.1:{}", addr.port());
    state
        .logger
        .add_log("info", "system", &format!("Máy chủ Slice Player đang chạy tại {app_url}"), None);

    let router = build_router(state.clone());
    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    let server_task = tokio::spawn(async move {
        let _ = axum::serve(listener, router)
            .with_graceful_shutdown(async move {
                let _ = shutdown_rx.await;
            })
            .await;
    });

    Ok(RunningServer {
        addr,
        state,
        shutdown_tx: Some(shutdown_tx),
        server_task,
        loudness_task,
    })
}

/// CLI entrypoint used by `slice-server`: handles standalone exe directory switch, production
/// single-instance window handoff, server startup, OS signal traps, and production idle/orphan
/// shutdown.
pub async fn run_cli(config: EngineConfig) -> Result<(), String> {
    if let (Ok(cwd), Ok(exe)) = (std::env::current_dir(), std::env::current_exe())
        && let Some(target_dir) = maybe_chdir_to_exe_dir(&cwd, &exe)
    {
        let _ = std::env::set_current_dir(target_dir);
    }

    let initial_url = format!("http://127.0.0.1:{}", config.port);
    if config.is_production && is_server_running(&initial_url).await {
        open_app_window(&initial_url);
        return Ok(());
    }

    let is_production = config.is_production;
    let running = start_server(config).await?;
    let app_url = running.app_url();

    if is_production {
        open_app_window(&app_url);
    }

    let ws_lifecycle = running.state.ws_lifecycle.clone();
    let ingest = running.state.ingest.clone();

    tokio::select! {
        _ = wait_for_os_signal() => {}
        _ = async {
            if is_production
                && let Some(tracker) = ws_lifecycle
            {
                tracker.wait_for_shutdown(|| ingest.is_busy()).await;
            } else {
                std::future::pending::<()>().await;
            }
        } => {
            println!("[Server] Production lifecycle watchdog/idle timer elapsed. Shutting down.");
        }
    }

    running.shutdown().await;
    Ok(())
}

async fn wait_for_os_signal() {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{signal, SignalKind};
        let mut sigint = signal(SignalKind::interrupt()).expect("SIGINT handler");
        let mut sigterm = signal(SignalKind::terminate()).expect("SIGTERM handler");
        tokio::select! {
            _ = sigint.recv() => {}
            _ = sigterm.recv() => {}
        }
    }
    #[cfg(windows)]
    {
        use tokio::signal::windows::{ctrl_break, ctrl_c};
        let mut sigint = ctrl_c().expect("Ctrl+C handler");
        let mut sigbreak = ctrl_break().expect("Ctrl+Break handler");
        tokio::select! {
            _ = sigint.recv() => {}
            _ = sigbreak.recv() => {}
        }
    }
}

/// Recomputes the 1,000-point Rust 200Hz raw peak envelope for every `ready` track in the library
/// while preserving existing EBU R128 loudness measurements (unless missing).
pub async fn reanalyze_library_waveforms(config: &EngineConfig) -> Result<usize, String> {
    if let (Ok(cwd), Ok(exe)) = (std::env::current_dir(), std::env::current_exe())
        && let Some(target_dir) = maybe_chdir_to_exe_dir(&cwd, &exe)
    {
        let _ = std::env::set_current_dir(target_dir);
    }
    let db = Db::open(&config.db_path, config.is_test)?;
    let audio_cache_dir = resolve_abs_path(&config.data_dir.join("cache").join("audio"));
    let tracks = db.list_tracks()?;
    let mut updated = 0usize;

    for track in tracks {
        if track.status != "ready" {
            continue;
        }
        let Some(raw_path) = track.file_path.as_deref() else {
            continue;
        };
        let Ok(candidate) = crate::audio_source::resolve_audio_source(raw_path, &audio_cache_dir) else {
            continue;
        };
        if let Ok(analysis) = analyze_audio_file(&candidate, WAVEFORM_POINTS).await
            && let Ok(peaks_json) = serde_json::to_string(&analysis.peaks)
        {
            let loudness = track.loudness.or_else(|| analysis.loudness.map(|m| m.loudness));
            let true_peak = track.true_peak.or_else(|| analysis.loudness.map(|m| m.true_peak));
            db.update_track(
                &track.id,
                &TrackUpdates {
                    peaks_json: Some(Some(peaks_json)),
                    loudness: Some(loudness),
                    true_peak: Some(true_peak),
                    ..Default::default()
                },
            )?;
            updated += 1;
        }
    }

    db.close();
    Ok(updated)
}
