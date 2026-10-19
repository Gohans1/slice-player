//! Multipart uploads (`ingestUploadedFile`): each file is streamed to a temp file in the audio cache
//! while its md5 is computed, renamed to `loc_<md5 12>.<ext>` (an `.mp4` keeps only its audio, as
//! `.m4a`), then ingested like a local file.

use super::video_extractor::extract_audio_from_video;
use super::{Ingest, IngestResult, OperationGuard, INGEST_PAUSED_MESSAGE};
use crate::audio_source::SUPPORTED_AUDIO_EXTENSIONS;
use bytes::Bytes;
use futures_util::{Stream, StreamExt};
use md5::{Digest, Md5};
use std::path::PathBuf;
use tokio::io::AsyncWriteExt;

pub const MAX_UPLOAD_BYTES: u64 = 300 * 1024 * 1024;

/// An upload written to disk, waiting for its ingest. Holds its ingest operation open so a restore
/// can't swap the library under it.
pub struct SpooledUpload {
    original_name: String,
    temp_path: PathBuf,
    content_hash: String,
    ext: String,
    _operation: OperationGuard,
}

impl Drop for SpooledUpload {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.temp_path);
    }
}

fn upload_extension(original_name: &str) -> String {
    original_name.rfind('.').map(|i| original_name[i..].to_lowercase()).unwrap_or_default()
}

fn size_message(bytes: u64, max_bytes: u64) -> String {
    if bytes == 0 {
        "File tải lên bị rỗng".into()
    } else {
        format!(
            "File vượt quá dung lượng tối đa {}MB ({:.1}MB)",
            max_bytes / 1024 / 1024,
            bytes as f64 / 1024.0 / 1024.0
        )
    }
}

impl Ingest {
    /// Writes one uploaded file to the audio cache. Errs with the user message (bad extension,
    /// empty, over `max_bytes`, paused for a restore); nothing is left on disk then.
    pub async fn spool_upload<S, E>(&self, original_name: &str, mut stream: S, max_bytes: u64) -> Result<SpooledUpload, String>
    where
        S: Stream<Item = Result<Bytes, E>> + Unpin,
        E: std::fmt::Display,
    {
        let ext = upload_extension(original_name);
        if !SUPPORTED_AUDIO_EXTENSIONS.contains(&ext.as_str()) {
            return Err(format!(
                "Định dạng {} không được hỗ trợ. Chỉ chấp nhận: {}",
                if ext.is_empty() { "không xác định" } else { &ext },
                SUPPORTED_AUDIO_EXTENSIONS.join(", ")
            ));
        }
        let operation = self.begin_operation(None).ok_or(INGEST_PAUSED_MESSAGE)?;
        let audio_dir = self.audio_dir();
        tokio::fs::create_dir_all(&audio_dir).await.map_err(|e| e.to_string())?;
        let temp_path = audio_dir.join(format!("temp_upload_{}{ext}", uuid::Uuid::new_v4().simple()));

        let mut spooled = SpooledUpload {
            original_name: original_name.to_string(),
            temp_path,
            content_hash: String::new(),
            ext,
            _operation: operation,
        };
        let mut file = tokio::fs::File::create(&spooled.temp_path).await.map_err(|e| format!("Lỗi xử lý file upload: {e}"))?;
        let mut hasher = Md5::new();
        let mut size = 0u64;
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| format!("Lỗi xử lý file upload: {e}"))?;
            size += chunk.len() as u64;
            if size > max_bytes {
                // Dropping `spooled` removes the partial file
                return Err(size_message(size, max_bytes));
            }
            hasher.update(&chunk);
            file.write_all(&chunk).await.map_err(|e| format!("Lỗi xử lý file upload: {e}"))?;
        }
        file.flush().await.map_err(|e| format!("Lỗi xử lý file upload: {e}"))?;
        if size == 0 {
            return Err(size_message(0, max_bytes));
        }
        spooled.content_hash = format!("{:x}", hasher.finalize())[..12].to_string();
        Ok(spooled)
    }

    /// Moves a spooled upload to its content-addressed name and ingests it. An upload of a file the
    /// cache already holds reuses it; a failed ingest of a new file removes it.
    pub async fn ingest_spooled_upload(&self, spooled: SpooledUpload) -> IngestResult {
        let audio_dir = self.audio_dir();
        let final_path = if spooled.ext == ".mp4" {
            audio_dir.join(format!("loc_{}.m4a", spooled.content_hash))
        } else {
            audio_dir.join(format!("loc_{}{}", spooled.content_hash, spooled.ext))
        };
        let already_exists = final_path.exists();
        if !already_exists {
            let placed = if spooled.ext == ".mp4" {
                extract_audio_from_video(&spooled.temp_path, &final_path).await
            } else {
                std::fs::rename(&spooled.temp_path, &final_path).map_err(|e| format!("Lỗi xử lý file upload: {e}"))
            };
            if let Err(message) = placed {
                return IngestResult::fail(if spooled.ext == ".mp4" && message.is_empty() {
                    "Lỗi trích xuất audio từ file MP4".to_string()
                } else {
                    message
                });
            }
        }

        let name = &spooled.original_name;
        let preferred_title = name.rfind('.').map(|i| &name[..i]).unwrap_or(name);
        let preferred_title = preferred_title.rsplit(['/', '\\']).next().unwrap_or(preferred_title).to_string();
        let res = self.ingest_local_file(&final_path.to_string_lossy(), Some(&preferred_title)).await;
        if !res.success && !already_exists {
            let _ = std::fs::remove_file(&final_path);
        }
        res
    }
}
