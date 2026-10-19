use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

const APP_BROWSERS: [&str; 2] = [
    "Microsoft\\Edge\\Application\\msedge.exe",
    "Google\\Chrome\\Application\\chrome.exe",
];

fn win32_join(root: &str, suffix: &str) -> String {
    let trimmed = root.trim_end_matches(['\\', '/']);
    format!("{trimmed}\\{suffix}")
}

pub fn find_app_browser<F>(env: &HashMap<String, String>, exists: F) -> Option<String>
where
    F: Fn(&str) -> bool,
{
    let roots: Vec<&str> = ["ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA"]
        .into_iter()
        .filter_map(|k| env.get(k).map(|s| s.as_str()))
        .collect();

    for browser in APP_BROWSERS {
        for root in &roots {
            let candidate = win32_join(root, browser);
            if exists(&candidate) {
                return Some(candidate);
            }
        }
    }
    None
}

pub fn maybe_chdir_to_exe_dir(cwd: &Path, exe_path: &Path) -> Option<PathBuf> {
    if cwd.join("dist").exists() {
        return None;
    }
    let exe_dir = exe_path.parent()?;
    if exe_dir.join("dist").exists() {
        Some(exe_dir.to_path_buf())
    } else {
        None
    }
}

pub async fn is_server_running(url: &str) -> bool {
    let stripped = url
        .strip_prefix("http://")
        .or_else(|| url.strip_prefix("https://"))
        .unwrap_or(url);
    let host_port = stripped.split('/').next().unwrap_or("127.0.0.1:3000");
    let addr = if host_port.contains(':') {
        host_port.to_string()
    } else {
        format!("{host_port}:80")
    };

    let fut = async {
        let mut stream = TcpStream::connect(&addr).await.ok()?;
        let req = format!(
            "GET /api/tracks HTTP/1.1\r\nHost: {host_port}\r\nConnection: close\r\n\r\n"
        );
        stream.write_all(req.as_bytes()).await.ok()?;
        let mut buf = [0u8; 64];
        let n = stream.read(&mut buf).await.ok()?;
        let head = std::str::from_utf8(&buf[..n]).ok()?;
        Some(head.starts_with("HTTP/1.1 2") || head.starts_with("HTTP/1.0 2"))
    };

    tokio::time::timeout(Duration::from_millis(1000), fut)
        .await
        .ok()
        .flatten()
        .unwrap_or(false)
}

pub fn open_app_window(url: &str) {
    #[cfg(target_os = "windows")]
    {
        let env_map: HashMap<String, String> = std::env::vars().collect();
        let browser = find_app_browser(&env_map, |p| Path::new(p).exists());
        let profile_dir = std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join("data")
            .join("edge_profile");
        if let Some(browser_exe) = browser {
            let _ = std::process::Command::new(browser_exe)
                .arg(format!("--app={url}"))
                .arg(format!("--user-data-dir={}", profile_dir.display()))
                .arg("--autoplay-policy=no-user-gesture-required")
                .arg("--start-maximized")
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .spawn();
        } else {
            let _ = std::process::Command::new("cmd")
                .args(["/c", "start", "", url])
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .spawn();
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = url;
    }
}

/// No window connected within this long after startup: the server is an orphan (index.ts watchdog)
pub const INITIAL_CONNECTION_TIMEOUT: Duration = Duration::from_secs(180);
/// The last window closed this long ago: the user is done (index.ts checkIdleShutdown)
pub const IDLE_SHUTDOWN_DELAY: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, Copy, Default)]
struct WsState {
    active: usize,
    ever_connected: bool,
    // Bumped on every close so a reconnect + close between two checks still restarts the idle timer
    closes: u64,
}

pub struct WsLifecycleTracker {
    state: tokio::sync::watch::Sender<WsState>,
}

impl Default for WsLifecycleTracker {
    fn default() -> Self {
        Self::new()
    }
}

impl WsLifecycleTracker {
    pub fn new() -> Self {
        Self {
            state: tokio::sync::watch::Sender::new(WsState::default()),
        }
    }

    pub fn on_ws_open(&self) {
        self.state.send_modify(|s| {
            s.active += 1;
            s.ever_connected = true;
        });
    }

    pub fn on_ws_close(&self) {
        self.state.send_modify(|s| {
            s.active = s.active.saturating_sub(1);
            s.closes += 1;
        });
    }

    pub fn active_clients(&self) -> usize {
        self.state.borrow().active
    }

    pub fn has_ever_connected(&self) -> bool {
        self.state.borrow().ever_connected
    }

    /// Resolves when the production server should shut down: no window within
    /// [`INITIAL_CONNECTION_TIMEOUT`] of startup, or [`IDLE_SHUTDOWN_DELAY`] after the last window
    /// closed while `is_busy()` (an ingest in flight) is false. A busy check re-arms another delay.
    pub async fn wait_for_shutdown(&self, is_busy: impl Fn() -> bool) {
        let mut rx = self.state.subscribe();
        if tokio::time::timeout(INITIAL_CONNECTION_TIMEOUT, rx.wait_for(|s| s.ever_connected))
            .await
            .is_err()
        {
            return;
        }
        loop {
            // The sender lives in `self`, so these waits can only end by the predicate holding
            let Ok(idle) = rx.wait_for(|s| s.active == 0).await.map(|s| *s) else {
                return;
            };
            let interrupted = tokio::time::timeout(
                IDLE_SHUTDOWN_DELAY,
                rx.wait_for(|s| s.active > 0 || s.closes != idle.closes),
            )
            .await
            .is_ok();
            if !interrupted && !is_busy() {
                return;
            }
        }
    }
}

