//! Library backup (`backup.ts`, `backupLimits.ts`, `archiveWriter.ts`): a `.tar.gz` of the
//! database, audio cache, cover art and (opt-in) cookies, and a two-phase restore that stages and
//! validates everything before swapping any live file, with rollback.

pub mod export;
pub mod import;

pub use export::export_library_archive;
pub use import::{import_library_archive, ImportResult};

pub const MAX_BACKUP_REQUEST_BYTES: u64 = 2 * 1024 * 1024 * 1024;
/// The app uploads one FormData file; ample room is kept for its multipart framing
pub const MAX_EXPORTED_BACKUP_BYTES: u64 = MAX_BACKUP_REQUEST_BYTES - 1024 * 1024;
pub const MAX_COOKIE_FILE_BYTES: u64 = 5 * 1024 * 1024;
pub const MAX_TOTAL_EXTRACTED_BYTES: u64 = 5 * 1024 * 1024 * 1024;
pub const MAX_ARCHIVE_ENTRIES: usize = 10_000;
pub const MAX_AUDIO_FILE_BYTES: u64 = 350 * 1024 * 1024;
pub const MAX_THUMB_FILE_BYTES: u64 = 15 * 1024 * 1024;
pub const MAX_DB_FILE_BYTES: u64 = 500 * 1024 * 1024;
pub const ALLOWED_THUMB_EXTENSIONS: [&str; 4] = [".jpg", ".jpeg", ".png", ".webp"];
pub const LIBRARY_BUSY_MESSAGE: &str =
    "Một tiến trình xuất hoặc khôi phục thư viện đang diễn ra. Vui lòng đợi trong giây lát.";

/// A plain file name: no path separators, `..`, `:` (NTFS streams), control characters or DOS
/// device names, so an archive entry can't write outside its folder (tar-slip)
pub fn is_safe_archive_filename(name: &str) -> bool {
    if name.is_empty() || name == "." || name.contains(['/', '\\', ':']) || name.contains("..") {
        return false;
    }
    if name.chars().any(|c| c.is_control()) {
        return false;
    }
    let stem = name.split('.').next().unwrap_or("").to_ascii_uppercase();
    let is_device = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && (b'1'..=b'9').contains(&stem.as_bytes()[3]));
    !is_device
}

fn entry_limit(name: &str) -> u64 {
    if name == "music.db" {
        MAX_DB_FILE_BYTES
    } else if name == "cookies.txt" {
        MAX_COOKIE_FILE_BYTES
    } else if name.starts_with("cache/audio/") {
        MAX_AUDIO_FILE_BYTES
    } else {
        MAX_THUMB_FILE_BYTES
    }
}

/// Refuses an export the same app's restore would refuse: too many entries, an oversized file,
/// too much in total, or an archive that can't fit the 2 GB upload once tar and gzip overhead count
pub fn assert_export_fits_restore(entries: &[(String, u64)]) -> Result<(), String> {
    if entries.len() > MAX_ARCHIVE_ENTRIES {
        return Err("Backup entry count exceeds restore limits.".into());
    }
    let mut total: u64 = 0;
    let mut tar_bytes: u64 = 1024; // end-of-archive records
    for (name, size) in entries {
        total += size;
        // Padded content, headers and long-name metadata
        tar_bytes += size.div_ceil(512) * 512 + 4096 + name.len() as u64;
        if *size > entry_limit(name) || total > MAX_TOTAL_EXTRACTED_BYTES {
            return Err(format!("Backup file or total size exceeds restore limits: {name}"));
        }
    }
    // zlib's deflateBound for default parameters, plus an 18-byte gzip wrapper
    let gzip_bound = tar_bytes + tar_bytes / 4096 + tar_bytes / 16384 + tar_bytes / 33_554_432 + 25;
    if gzip_bound > MAX_EXPORTED_BACKUP_BYTES {
        return Err("Backup exceeds the 2GB restore upload limit, including archive and multipart overhead.".into());
    }
    Ok(())
}
