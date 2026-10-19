//! Where a track's audio actually lives (`audioSource.ts`), and which local paths are safe to touch
//! (`validateSafeLocalAudioPath` in `ingest.ts`).

use crate::db::{get_cross_platform_basename, resolve_abs_path};
use std::path::{Path, PathBuf};

pub const SUPPORTED_AUDIO_EXTENSIONS: [&str; 9] =
    [".m4a", ".mp3", ".opus", ".webm", ".ogg", ".flac", ".wav", ".aac", ".mp4"];

/// Rejects paths that reach outside plain local files on Windows: UNC shares, DOS device names and
/// NTFS alternate data streams. Checked before the filesystem is touched.
pub fn validate_safe_local_audio_path(raw_path: &str) -> Result<(), &'static str> {
    let trimmed = raw_path.trim();
    if trimmed.is_empty() {
        return Err("Đường dẫn không hợp lệ.");
    }
    let cleaned = trimmed.strip_prefix(['"', '\'']).unwrap_or(trimmed);
    let cleaned = cleaned.strip_suffix(['"', '\'']).unwrap_or(cleaned);
    let is_sep = |c: char| c == '\\' || c == '/';

    // \\server\share, //server/share, \\?\UNC\ and \??\ prefixes
    let mut chars = cleaned.chars();
    let (first, second, third) = (chars.next(), chars.next(), chars.next());
    let unc = matches!((first, second), (Some(a), Some(b)) if is_sep(a) && is_sep(b));
    let device_prefix = first.is_some_and(is_sep)
        && second == Some('?')
        && (third.is_some_and(is_sep) || (third == Some('?') && chars.next().is_some_and(is_sep)));
    if unc || device_prefix {
        return Err("Đường dẫn mạng UNC không được hỗ trợ vì lý do bảo mật.");
    }

    if cleaned.split(is_sep).any(is_dos_device_name) {
        return Err("Tên file hoặc thư mục chứa tên thiết bị đặc biệt của hệ thống không được hỗ trợ.");
    }

    let bytes = cleaned.as_bytes();
    let without_drive = if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
        let rest = &cleaned[2..];
        rest.strip_prefix(is_sep).unwrap_or(rest)
    } else {
        cleaned
    };
    if without_drive.contains(':') {
        return Err("Đường dẫn chứa luồng dữ liệu NTFS (Alternate Data Stream) không hợp lệ.");
    }
    Ok(())
}

/// CON, PRN, AUX, NUL, COM1-9, LPT1-9, CONIN$, CONOUT$, with or without an extension
fn is_dos_device_name(segment: &str) -> bool {
    let stem = segment.split('.').next().unwrap_or("").to_ascii_uppercase();
    match stem.as_str() {
        "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$" => true,
        _ => {
            let b = stem.as_bytes();
            b.len() == 4 && (stem.starts_with("COM") || stem.starts_with("LPT")) && (b'1'..=b'9').contains(&b[3])
        }
    }
}

/// The file to serve for a track: its recorded path, or the file of the same name in the audio cache
/// when the library came from another machine. Never writes the fallback back to SQLite, so a slow
/// read can't overwrite a concurrent delete or restore. Errs with (HTTP status, message).
pub fn resolve_audio_source(file_path: &str, cache_dir: &Path) -> Result<PathBuf, (u16, &'static str)> {
    if validate_safe_local_audio_path(file_path).is_err() {
        return Err((403, "Invalid or forbidden audio file path"));
    }
    let path = PathBuf::from(file_path);
    if path.is_file() {
        return Ok(path);
    }
    let candidate = resolve_abs_path(&cache_dir.join(get_cross_platform_basename(file_path)));
    if validate_safe_local_audio_path(&candidate.to_string_lossy()).is_err() || !candidate.is_file() {
        return Err((404, "Audio file missing on disk"));
    }
    Ok(candidate)
}

/// Lowercase extension with its dot (".opus"), as `extname` gave it
pub fn dotted_extension(path: &Path) -> String {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| format!(".{}", e.to_ascii_lowercase()))
        .unwrap_or_default()
}

pub fn audio_mime_type(dotted_ext: &str) -> &'static str {
    match dotted_ext {
        ".m4a" | ".mp4" => "audio/mp4",
        ".webm" => "audio/webm",
        ".flac" => "audio/flac",
        ".opus" | ".ogg" => "audio/ogg",
        ".mp3" => "audio/mpeg",
        ".wav" => "audio/wav",
        ".aac" => "audio/aac",
        _ => "application/octet-stream",
    }
}
