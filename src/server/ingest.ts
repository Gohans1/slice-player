import { parseFile } from "music-metadata";
import { existsSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, resolve } from "node:path";
import { createTrack, updateTrack, getTrack } from "./db";
import { generatePeaks } from "./waveform";
import type { Track } from "./types";

const MAX_DURATION_SECONDS = 1800; // 30 minutes cap

export interface IngestResult {
  success: boolean;
  message?: string;
  tracks?: Track[];
}

/**
 * Handle YouTube URL (single video or playlist)
 */
export async function ingestYouTubeUrl(url: string): Promise<IngestResult> {
  try {
    // Stage 1: Fast metadata extraction via yt-dlp
    const metaCmd = [
      "yt-dlp",
      "--flat-playlist",
      "-J",
      "--skip-download",
      url
    ];

    const proc = Bun.spawn(metaCmd, {
      stdout: "pipe",
      stderr: "pipe",
    });

    const outputText = await new Response(proc.stdout).text();
    await proc.exited;

    if (!outputText || outputText.trim() === "") {
      const errText = await new Response(proc.stderr).text();
      return { success: false, message: `yt-dlp error: ${errText || "No metadata returned"}` };
    }

    const data = JSON.parse(outputText);
    const createdTracks: Track[] = [];

    // Check if it's a playlist or a single video
    const entries = Array.isArray(data.entries) ? data.entries : [data];

    for (const entry of entries) {
      if (!entry || !entry.id) continue;

      const duration = Number(entry.duration) || 0;
      const title = entry.title || "Unknown YouTube Track";
      const uploader = entry.uploader || entry.channel || "";
      const videoId = entry.id;
      const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
      const thumb = entry.thumbnail || entry.thumbnails?.[0]?.url || `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;

      // 30-minute cap check
      if (duration > MAX_DURATION_SECONDS) {
        console.warn(`[Skip] Track "${title}" exceeds 30m limit (${duration}s > ${MAX_DURATION_SECONDS}s)`);
        continue;
      }

      const trackId = `yt_${videoId}`;
      // Check if already exists in DB
      let existing = getTrack(trackId);
      if (!existing) {
        existing = createTrack({
          id: trackId,
          source_type: "youtube",
          source_uri: watchUrl,
          title,
          artist: uploader,
          duration,
          thumbnail_url: thumb,
          status: "queued",
        });
      }

      createdTracks.push(existing);
      // Trigger background audio download for this track
      triggerDownloadWorker(trackId, watchUrl);
    }

    if (createdTracks.length === 0 && entries.length > 0) {
      return {
        success: false,
        message: `Mọi video trong link đều vượt quá giới hạn 30 phút (${MAX_DURATION_SECONDS}s) hoặc không hợp lệ!`,
      };
    }

    return {
      success: true,
      tracks: createdTracks,
      message: `Đã nạp thành công ${createdTracks.length} bài hát vào hàng đợi tải.`,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, message: `Lỗi xử lý YouTube: ${msg}` };
  }
}

// Queue worker for downloads (strictly sequential: concurrency = 1)
const downloadQueue: Array<{ trackId: string; url: string }> = [];
let isDownloading = false;

function triggerDownloadWorker(trackId: string, url: string) {
  downloadQueue.push({ trackId, url });
  processDownloadQueue();
}

async function processDownloadQueue() {
  if (isDownloading || downloadQueue.length === 0) return;
  isDownloading = true;

  const item = downloadQueue.shift();
  if (!item) {
    isDownloading = false;
    return;
  }

  const { trackId, url } = item;
  try {
    updateTrack(trackId, { status: "downloading" });
    const outputTemplate = `./data/cache/audio/${trackId}.%(ext)s`;

    // Download format 140 (AAC/M4A) without re-encoding, or bestaudio
    const dlCmd = [
      "yt-dlp",
      "-f", "140/ba[ext=m4a]/ba",
      "-o", outputTemplate,
      "--no-playlist",
      url
    ];

    const proc = Bun.spawn(dlCmd, {
      stdout: "pipe",
      stderr: "pipe",
    });

    await proc.exited;

    // Find actual downloaded file in ./data/cache/audio/
    const possibleExtensions = ["m4a", "webm", "opus", "mp4"];
    let finalPath = "";
    for (const ext of possibleExtensions) {
      const p = `./data/cache/audio/${trackId}.${ext}`;
      if (existsSync(p)) {
        finalPath = p;
        break;
      }
    }

    if (!finalPath) {
      updateTrack(trackId, { status: "error", error_message: "Download failed or output file not found" });
    } else {
      // Generate peaks
      const peaks = await generatePeaks(finalPath, 1000);
      updateTrack(trackId, {
        file_path: finalPath,
        peaks_json: JSON.stringify(peaks),
        status: "ready",
      });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    updateTrack(trackId, { status: "error", error_message: msg });
  } finally {
    isDownloading = false;
    // Process next item after small delay to be polite
    setTimeout(processDownloadQueue, 1000);
  }
}

/**
 * Handle Local FLAC or Audio File
 */
export async function ingestLocalFile(rawPath: string): Promise<IngestResult> {
  try {
    const fullPath = resolve(rawPath);
    if (!existsSync(fullPath)) {
      return { success: false, message: `File không tồn tại: ${fullPath}` };
    }

    const metadata = await parseFile(fullPath);
    const duration = Number(metadata.format.duration) || 0;

    // 30 minute check
    if (duration > MAX_DURATION_SECONDS) {
      return {
        success: false,
        message: `File vượt quá thời lượng tối đa 30 phút (${duration.toFixed(0)}s > ${MAX_DURATION_SECONDS}s)!`,
      };
    }

    const hash = createHash("md5").update(fullPath).digest("hex").slice(0, 12);
    const trackId = `loc_${hash}`;
    const title = metadata.common.title || basename(fullPath, ".flac");
    const artist = metadata.common.artist || "Unknown Artist";

    // Extract cover art if present
    let thumbUrl = "";
    if (metadata.common.picture && metadata.common.picture.length > 0) {
      const pic = metadata.common.picture[0];
      const thumbPath = `./data/cache/thumbs/${trackId}.jpg`;
      writeFileSync(thumbPath, pic.data);
      thumbUrl = `/api/thumbs/${trackId}`;
    }

    // Generate peaks
    const peaks = await generatePeaks(fullPath, 1000);

    let existing = getTrack(trackId);
    if (existing) {
      updateTrack(trackId, {
        title,
        artist,
        duration,
        file_path: fullPath,
        thumbnail_url: thumbUrl,
        peaks_json: JSON.stringify(peaks),
        status: "ready",
      });
      existing = getTrack(trackId)!;
    } else {
      existing = createTrack({
        id: trackId,
        source_type: "local",
        source_uri: fullPath,
        title,
        artist,
        duration,
        thumbnail_url: thumbUrl,
        file_path: fullPath,
        peaks_json: JSON.stringify(peaks),
        status: "ready",
      });
    }

    return {
      success: true,
      tracks: [existing],
      message: `Đã nạp file local "${title}" thành công.`,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, message: `Lỗi đọc file local: ${msg}` };
  }
}
