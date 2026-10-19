//! The audio track of an `.mp4` (`audioExtractor.ts`): stream copy first, AAC transcode as fallback

use super::process::run_tool;
use crate::audio_analysis::CancelFlag;
use std::path::Path;
use std::time::Duration;

const PROBE_TIMEOUT: Duration = Duration::from_secs(5);
const COPY_TIMEOUT: Duration = Duration::from_secs(30);
const TRANSCODE_TIMEOUT: Duration = Duration::from_secs(60);

pub async fn has_audio_stream(file_path: &Path) -> bool {
    has_audio_stream_with(file_path, &[]).await
}

pub async fn has_audio_stream_with(file_path: &Path, cancels: &[&CancelFlag]) -> bool {
    if !file_path.exists() {
        return false;
    }
    let args = [
        "-v".as_ref(), "error".as_ref(), "-select_streams".as_ref(), "a:0".as_ref(), "-show_entries".as_ref(),
        "stream=codec_type".as_ref(), "-of".as_ref(), "default=noprint_wrappers=1:nokey=1".as_ref(),
        file_path.as_os_str(),
    ];
    match run_tool("ffprobe", &args, PROBE_TIMEOUT, cancels, true).await {
        Ok(out) => String::from_utf8_lossy(&out.stdout).trim().to_lowercase().contains("audio"),
        Err(_) => false,
    }
}

fn is_non_empty_file(path: &Path) -> bool {
    std::fs::metadata(path).map(|m| m.is_file() && m.len() > 0).unwrap_or(false)
}

/// Writes the audio of `input` to `output` (`.m4a`) without the video. Err carries the user message.
pub async fn extract_audio_from_video(input: &Path, output: &Path) -> Result<(), String> {
    extract_audio_from_video_with(input, output, &[]).await
}

pub async fn extract_audio_from_video_with(input: &Path, output: &Path, cancels: &[&CancelFlag]) -> Result<(), String> {
    if !input.exists() {
        return Err(format!("File không tồn tại: {}", input.display()));
    }
    if !has_audio_stream_with(input, cancels).await {
        return Err("File MP4 không chứa luồng âm thanh nào.".into());
    }

    let ffmpeg = |codec: &'static [&'static str]| {
        let mut args: Vec<&std::ffi::OsStr> = vec!["-v".as_ref(), "error".as_ref(), "-y".as_ref(), "-i".as_ref(), input.as_os_str(), "-vn".as_ref()];
        args.extend(codec.iter().map(std::ffi::OsStr::new));
        args.push(output.as_os_str());
        args
    };

    // Fast zero-copy extraction
    if let Ok(out) = run_tool("ffmpeg", &ffmpeg(&["-c:a", "copy"]), COPY_TIMEOUT, cancels, false).await
        && out.success()
        && is_non_empty_file(output)
    {
        return Ok(());
    }
    let _ = std::fs::remove_file(output);
    if cancels.iter().any(|c| c.is_cancelled()) {
        return Err("Lỗi trích xuất audio: Yêu cầu đã bị hủy.".into());
    }

    // The stream can't go into .m4a as is: transcode it
    let transcoded = run_tool("ffmpeg", &ffmpeg(&["-c:a", "aac", "-b:a", "256k"]), TRANSCODE_TIMEOUT, cancels, false).await;
    match transcoded {
        Ok(out) if out.success() && is_non_empty_file(output) => Ok(()),
        Ok(out) => {
            let _ = std::fs::remove_file(output);
            let err = out.stderr.trim();
            Err(if err.is_empty() {
                "Không thể trích xuất âm thanh từ file MP4.".into()
            } else {
                format!("Lỗi trích xuất audio: {err}")
            })
        }
        Err(e) => {
            let _ = std::fs::remove_file(output);
            Err(format!("Lỗi trích xuất audio: {e}"))
        }
    }
}
