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
