use slice_engine::app_window::{find_app_browser, is_server_running, maybe_chdir_to_exe_dir};
use std::collections::{HashMap, HashSet};
use tempfile::TempDir;

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
