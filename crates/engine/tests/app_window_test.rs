use slice_engine::app_window::{
    find_app_browser, is_server_running, maybe_chdir_to_exe_dir, WsLifecycleTracker,
};
use std::collections::{HashMap, HashSet};
use std::pin::pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tempfile::TempDir;
use tokio::time::timeout;

fn windows_env() -> HashMap<String, String> {
    let mut map = HashMap::new();
    map.insert(
        "ProgramFiles(x86)".to_string(),
        "C:\\Program Files (x86)".to_string(),
    );
    map.insert("ProgramFiles".to_string(), "C:\\Program Files".to_string());
    map.insert(
        "LOCALAPPDATA".to_string(),
        "C:\\Users\\me\\AppData\\Local".to_string(),
    );
    map
}

#[test]
fn prefers_edge_which_every_windows_install_ships() {
    let env = windows_env();
    let installed: HashSet<&str> = [
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    ]
    .into_iter()
    .collect();

    assert_eq!(
        find_app_browser(&env, |path| installed.contains(path)),
        Some("C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe".to_string())
    );
}

#[test]
fn falls_back_to_per_user_chrome_when_edge_is_missing() {
    let env = windows_env();
    let installed: HashSet<&str> = ["C:\\Users\\me\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe"]
        .into_iter()
        .collect();

    assert_eq!(
        find_app_browser(&env, |path| installed.contains(path)),
        Some("C:\\Users\\me\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe".to_string())
    );
}

#[test]
fn returns_none_when_no_chromium_browser_is_installed() {
    let env = windows_env();
    assert_eq!(find_app_browser(&env, |_| false), None);
}

#[test]
fn only_chdirs_to_exe_dir_when_cwd_has_no_dist_and_exe_dir_has_dist() {
    let tmp = TempDir::new().unwrap();
    let repo_root = tmp.path().join("repo");
    let exe_dir = repo_root.join("target").join("release");
    let exe_path = exe_dir.join("slice-server");
    std::fs::create_dir_all(repo_root.join("dist")).unwrap();
    std::fs::create_dir_all(&exe_dir).unwrap();

    // Running from repo_root where ./dist exists -> must NOT chdir to target/release
    assert_eq!(maybe_chdir_to_exe_dir(&repo_root, &exe_path), None);

    // Running from elsewhere when exe_dir has dist -> chdirs to exe_dir
    let other_cwd = tmp.path().join("other");
    std::fs::create_dir_all(&other_cwd).unwrap();
    std::fs::create_dir_all(exe_dir.join("dist")).unwrap();
    assert_eq!(
        maybe_chdir_to_exe_dir(&other_cwd, &exe_path),
        Some(exe_dir)
    );
}

#[tokio::test]
async fn detects_whether_tracks_endpoint_is_up() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let url = format!("http://127.0.0.1:{port}");

    let app = axum::Router::new().route(
        "/api/tracks",
        axum::routing::get(|| async { axum::Json(serde_json::json!([])) }),
    );
    let handle = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    assert!(is_server_running(&url).await);
    handle.abort();
}

// Lifecycle parity with index.ts: the production server exits when nobody opened a window within 180s of startup,
// or 60s after the last window closed. Each `timeout` polls the same pinned shutdown future for a slice of
// (paused) time; Err = still running, Ok = shutdown requested.

#[tokio::test(start_paused = true)]
async fn shuts_down_when_no_window_connects_within_180s() {
    let tracker = WsLifecycleTracker::new();
    let mut shutdown = pin!(tracker.wait_for_shutdown(|| false));

    assert!(timeout(Duration::from_secs(179), &mut shutdown).await.is_err());
    assert!(timeout(Duration::from_secs(2), &mut shutdown).await.is_ok());
}

#[tokio::test(start_paused = true)]
async fn shuts_down_60s_after_the_last_window_closes() {
    let tracker = WsLifecycleTracker::new();
    let mut shutdown = pin!(tracker.wait_for_shutdown(|| false));

    assert!(timeout(Duration::from_secs(10), &mut shutdown).await.is_err());
    tracker.on_ws_open();
    // Connected well past the 180s watchdog: no shutdown
    assert!(timeout(Duration::from_secs(300), &mut shutdown).await.is_err());
    tracker.on_ws_close();

    assert!(timeout(Duration::from_secs(59), &mut shutdown).await.is_err());
    assert!(timeout(Duration::from_secs(2), &mut shutdown).await.is_ok());
}

#[tokio::test(start_paused = true)]
async fn a_reload_restarts_the_60s_idle_timer() {
    let tracker = WsLifecycleTracker::new();
    let mut shutdown = pin!(tracker.wait_for_shutdown(|| false));
    tracker.on_ws_open();
    tracker.on_ws_close();
    assert!(timeout(Duration::from_secs(50), &mut shutdown).await.is_err());

    // A page reload: the socket reconnects and drops again between two polls
    tracker.on_ws_open();
    tracker.on_ws_close();

    assert!(timeout(Duration::from_secs(50), &mut shutdown).await.is_err());
    assert!(timeout(Duration::from_secs(11), &mut shutdown).await.is_ok());
}

#[tokio::test(start_paused = true)]
async fn keeps_running_while_an_ingest_is_busy_then_waits_another_60s() {
    let tracker = WsLifecycleTracker::new();
    let busy = AtomicBool::new(true);
    let mut shutdown = pin!(tracker.wait_for_shutdown(|| busy.load(Ordering::SeqCst)));
    tracker.on_ws_open();
    tracker.on_ws_close();

    assert!(timeout(Duration::from_secs(600), &mut shutdown).await.is_err());
    busy.store(false, Ordering::SeqCst);

    // The idle check that saw the ingest finish re-arms a fresh 60s timer
    assert!(timeout(Duration::from_secs(61), &mut shutdown).await.is_ok());
}

#[tokio::test(start_paused = true)]
async fn stays_up_while_any_window_is_still_open() {
    let tracker = WsLifecycleTracker::new();
    let mut shutdown = pin!(tracker.wait_for_shutdown(|| false));
    tracker.on_ws_open();
    tracker.on_ws_open();
    tracker.on_ws_close();

    assert!(timeout(Duration::from_secs(3600), &mut shutdown).await.is_err());
    assert_eq!(tracker.active_clients(), 1);
}
