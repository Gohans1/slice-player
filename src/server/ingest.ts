import { parseFile } from "music-metadata";
import { existsSync, writeFileSync, unlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, resolve, extname } from "node:path";
import { createTrack, updateTrack, getTrack } from "./db";
import { generatePeaks } from "./waveform";
import { serverEvents } from "./events";
import type { Track } from "./types";

const MAX_DURATION_SECONDS = 1800; // 30 minutes cap

export interface IngestResult {
  success: boolean;
  message?: string;
  tracks?: Track[];
}

const YOUTUBE_URL_REGEX = /^https?:\/\/(?:[a-zA-Z0-9_-]+\.)*(?:youtube\.com|youtu\.be)\/.+/i;

/**
 * Handle YouTube URL (single video or playlist)
 */
export async function ingestYouTubeUrl(rawUrl: string): Promise<IngestResult> {
  const url = rawUrl.trim();
  if (!YOUTUBE_URL_REGEX.test(url)) {
    return { success: false, message: "URL không hợp lệ. Chỉ chấp nhận link YouTube (youtube.com, m.youtube.com, music.youtube.com, hoặc youtu.be)!" };
  }

  try {
    // Stage 1: Fast metadata extraction via yt-dlp
    const metaCmd = [
      "yt-dlp",
      "--flat-playlist",
      "-J",
      "--skip-download",
      "--",
      url
    ];

    const proc = Bun.spawn(metaCmd, {
      stdout: "pipe",
      stderr: "pipe",
    });

    const killTimer = setTimeout(() => {
      try { proc.kill(); } catch {}
    }, 45000);

    const [outputText, errText] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);

    clearTimeout(killTimer);
    await proc.exited;

    if (!outputText || outputText.trim() === "") {
      return { success: false, message: `yt-dlp error: ${errText || "No metadata returned"}` };
    }

    const data = JSON.parse(outputText);
    const createdTracks: Track[] = [];

    // Check if it's a playlist or a single video
    const entries = Array.isArray(data.entries) ? data.entries : [data];

    for (const entry of entries) {
      if (!entry || !entry.id) continue;

      // Skip livestreams
      if (entry.is_live || entry.live_status === "is_live") {
        console.warn(`[Skip] Bỏ qua livestream: ${entry.title}`);
        continue;
      }

      const duration = Number(entry.duration) || 0;
      const title = entry.title || "Unknown YouTube Track";
      const uploader = entry.uploader || entry.channel || "";
      const videoId = entry.id;
      const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
      const thumb = entry.thumbnail || entry.thumbnails?.[0]?.url || `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;

      // 30-minute cap check (if duration is known)
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
        serverEvents.emit("track_created", { trackId });
        // Trigger background audio download for this track
        triggerDownloadWorker(trackId, watchUrl);
      } else if (existing.status !== "ready" && existing.status !== "downloading") {
        triggerDownloadWorker(trackId, watchUrl);
      }

      createdTracks.push(existing);
    }

    if (createdTracks.length === 0 && entries.length > 0) {
      return {
        success: false,
        message: `Mọi video trong link đều vượt quá giới hạn 30 phút (${MAX_DURATION_SECONDS}s), là livestream hoặc không hợp lệ!`,
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
let activeDownloadProc: ReturnType<typeof Bun.spawn> | null = null;

export function abortIngestProcesses() {
  if (activeDownloadProc) {
    try {
      if (process.platform === "win32") {
        Bun.spawn(["taskkill", "/F", "/T", "/PID", String(activeDownloadProc.pid)]).unref();
      } else {
        activeDownloadProc.kill();
      }
    } catch {}
    activeDownloadProc = null;
  }
}

function triggerDownloadWorker(trackId: string, url: string) {
  if (downloadQueue.some((q) => q.trackId === trackId)) return;
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

  // Check if track was deleted or is already ready
  const existingTrack = getTrack(trackId);
  if (!existingTrack || existingTrack.status === "ready") {
    isDownloading = false;
    processDownloadQueue();
    return;
  }

  try {
    updateTrack(trackId, { status: "downloading" });
    const outputTemplate = `./data/cache/audio/${trackId}.%(ext)s`;

    // Download format 140 (AAC/M4A) without re-encoding, or bestaudio
    const dlCmd = [
      "yt-dlp",
      "-f", "140/ba[ext=m4a]/ba",
      "-o", outputTemplate,
      "--no-playlist",
      "--match-filter", "duration <= 1800",
      "--max-filesize", "150M",
      "--",
      url
    ];

    const proc = Bun.spawn(dlCmd, {
      stdout: "ignore",
      stderr: "ignore",
    });
    activeDownloadProc = proc;

    // 5-minute timeout to avoid hanging download indefinitely
    const dlTimeout = setTimeout(() => {
      try { proc.kill(); } catch {}
    }, 300000);

    await proc.exited;
    clearTimeout(dlTimeout);
    activeDownloadProc = null;

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

    // Check again if track was deleted while download was running
    if (!getTrack(trackId)) {
      if (finalPath && existsSync(finalPath)) {
        try { unlinkSync(finalPath); } catch {}
      }
      return;
    }

    if (!finalPath) {
      updateTrack(trackId, { status: "error", error_message: "Tải thất bại, file vượt quá 30m/150MB hoặc không tìm thấy" });
      serverEvents.emit("track_updated", { trackId });
    } else {
      // Re-verify actual audio duration using music-metadata
      let actualDuration = 0;
      try {
        const meta = await parseFile(finalPath);
        actualDuration = Number(meta.format.duration) || 0;
      } catch (e) {
        console.warn(`[Ingest] Could not parse downloaded metadata: ${e}`);
      }

      if (actualDuration <= 0 || actualDuration > MAX_DURATION_SECONDS) {
        try { unlinkSync(finalPath); } catch {}
        updateTrack(trackId, {
          status: "error",
          error_message: actualDuration <= 0 
            ? "Không thể xác định thời lượng audio hoặc file rỗng"
            : `Thời lượng thực tế (${actualDuration.toFixed(0)}s) vượt quá giới hạn 30 phút!`,
        });
        serverEvents.emit("track_updated", { trackId });
        return;
      }

      // Generate peaks
      const peaks = await generatePeaks(finalPath, 1000);
      updateTrack(trackId, {
        file_path: finalPath,
        duration: Number(actualDuration.toFixed(2)),
        peaks_json: JSON.stringify(peaks),
        status: "ready",
      });
      serverEvents.emit("track_updated", { trackId });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    updateTrack(trackId, { status: "error", error_message: msg });
    serverEvents.emit("track_updated", { trackId });
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
    const cleanedPath = rawPath.trim().replace(/^["']|["']$/g, "");

    // Reject Windows UNC paths to prevent NetNTLM exfiltration
    if (/^[\\/]{2}/.test(cleanedPath) || /^[\\/]\?[\\/]/.test(cleanedPath)) {
      return { success: false, message: "Đường dẫn mạng UNC không được hỗ trợ vì lý do bảo mật." };
    }

    const ext = extname(cleanedPath).toLowerCase();
    const ALLOWED_EXTS = [".flac", ".mp3", ".m4a", ".wav", ".ogg", ".opus", ".webm"];
    if (!ALLOWED_EXTS.includes(ext)) {
      return {
        success: false,
        message: `Định dạng file không được hỗ trợ (${ext || "không có phần mở rộng"}). Chỉ chấp nhận: ${ALLOWED_EXTS.join(", ")}`,
      };
    }

    const fullPath = resolve(cleanedPath);
    const { statSync } = await import("node:fs");
    if (!existsSync(fullPath) || !statSync(fullPath).isFile()) {
      return { success: false, message: `File không tồn tại hoặc không phải là file hợp lệ: ${fullPath}` };
    }

    const metadata = await parseFile(fullPath);
    const duration = Number(metadata.format.duration) || 0;

    // 30 minute check & strictly positive check
    if (duration <= 0 || duration > MAX_DURATION_SECONDS) {
      return {
        success: false,
        message: duration <= 0
          ? "File không có thời lượng hợp lệ hoặc bị lỗi!"
          : `File vượt quá thời lượng tối đa 30 phút (${duration.toFixed(0)}s > ${MAX_DURATION_SECONDS}s)!`,
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

    serverEvents.emit("track_created", { trackId });

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
