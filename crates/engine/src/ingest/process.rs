//! Runs the external tools ingest relies on (yt-dlp, ffmpeg, ffprobe) with a deadline and a cancel
//! flag, and always kills the whole process tree (yt-dlp spawns ffmpeg), as `killProcessSafely` did.

use crate::audio_analysis::CancelFlag;
use std::ffi::OsStr;
use std::process::Stdio;
use std::time::{Duration, Instant};
use tokio::io::AsyncReadExt;

#[derive(Debug, Default)]
pub struct ToolOutput {
    /// `None` when the process was killed
    pub code: Option<i32>,
    pub stdout: Vec<u8>,
    pub stderr: String,
    pub timed_out: bool,
    pub cancelled: bool,
}

impl ToolOutput {
    pub fn success(&self) -> bool {
        self.code == Some(0)
    }

    /// The exit code as `index.ts` reported it (a killed process counts as 1)
    pub fn exit_code(&self) -> i32 {
        self.code.unwrap_or(1)
    }

    /// The last `ERROR:` line, else the last line, cut to 150 characters
    pub fn error_text(&self) -> String {
        let lines: Vec<&str> = self.stderr.trim().split(['\r', '\n']).filter(|l| !l.is_empty()).collect();
        let last = lines.iter().rev().find(|l| l.starts_with("ERROR:")).or(lines.last()).copied().unwrap_or("");
        last.chars().take(150).collect()
    }
}

/// Kills the process group on drop, so a dropped request (client gone) can't leave yt-dlp running
struct TreeKiller(Option<u32>);

impl TreeKiller {
    fn kill(&mut self) {
        if let Some(pid) = self.0.take() {
            kill_tree(pid);
        }
    }
}

impl Drop for TreeKiller {
    fn drop(&mut self) {
        self.kill();
    }
}

fn kill_tree(pid: u32) {
    #[cfg(unix)]
    unsafe {
        // The child leads its own process group (see `process_group(0)` below)
        libc::kill(-(pid as i32), libc::SIGKILL);
    }
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
}

pub async fn run_tool<S: AsRef<OsStr>>(
    program: impl AsRef<OsStr>,
    args: &[S],
    timeout: Duration,
    cancel: &[&CancelFlag],
    capture_stdout: bool,
) -> std::io::Result<ToolOutput> {
    let mut cmd = tokio::process::Command::new(program);
    cmd.args(args)
        .stdin(Stdio::null())
        .stdout(if capture_stdout { Stdio::piped() } else { Stdio::null() })
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(unix)]
    cmd.process_group(0);
    let mut child = cmd.spawn()?;
    let mut killer = TreeKiller(child.id());
    let mut stdout = child.stdout.take();
    let mut stderr = child.stderr.take();
    const MAX_TOOL_OUTPUT_BYTES: u64 = 32 * 1024 * 1024;

    let finished = async {
        let read_out = async {
            let mut buf = Vec::new();
            if let Some(out) = stdout.as_mut() {
                let _ = out.take(MAX_TOOL_OUTPUT_BYTES).read_to_end(&mut buf).await;
            }
            buf
        };
        let read_err = async {
            let mut buf = Vec::new();
            if let Some(err) = stderr.as_mut() {
                let _ = err.take(MAX_TOOL_OUTPUT_BYTES).read_to_end(&mut buf).await;
            }
            buf
        };
        let (out, err) = tokio::join!(read_out, read_err);
        (out, err, child.wait().await)
    };
    tokio::pin!(finished);

    let deadline = Instant::now() + timeout;
    let mut result = ToolOutput::default();
    // ponytail: the cancel flags are polled every 100ms; a notify per flag would be instant but needs more plumbing
    let (out, err, status) = loop {
        tokio::select! {
            done = &mut finished => break done,
            _ = tokio::time::sleep(Duration::from_millis(100)) => {
                if !result.cancelled && !result.timed_out {
                    if cancel.iter().any(|c| c.is_cancelled()) {
                        result.cancelled = true;
                        killer.kill();
                    } else if Instant::now() >= deadline {
                        result.timed_out = true;
                        killer.kill();
                    }
                }
            }
        }
    };
    killer.0 = None;
    result.stdout = out;
    result.stderr = String::from_utf8_lossy(&err).to_string();
    result.code = status.ok().and_then(|s| s.code());
    Ok(result)
}
