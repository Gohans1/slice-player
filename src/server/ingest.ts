import { parseFile } from "music-metadata";
import { existsSync, writeFileSync, unlinkSync, readdirSync, mkdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, resolve, extname, join } from "node:path";
import { createTrack, updateTrack, getTrack, getDb, reconcileTrackSegments } from "./db";
import { generatePeaks, isWaveformBusy } from "./waveform";
import { serverEvents } from "./events";
import type { Track } from "./types";

const MAX_DURATION_SECONDS = 1800; // 30 minutes cap

export async function unlinkWithRetry(filePath: string, maxAttempts = 5): Promise<boolean> {
  if (!existsSync(filePath)) return true;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      unlinkSync(filePath);
      return true;
    } catch (err: any) {
      if ((err.code === "EBUSY" || err.code === "EPERM") && i < maxAttempts - 1) {
        await Bun.sleep(100 * (i + 1));
      } else {
        break;
      }
    }
  }
  return !existsSync(filePath);
}

const cancelledTokens = new Set<string>();
let currentDownloadToken: string | null = null;

export function isTrackCancelled(trackId: string): boolean {
  return currentDownloadingTrackId === trackId && currentDownloadToken !== null && cancelledTokens.has(currentDownloadToken);
}

export interface IngestResult {
  success: boolean;
  message?: string;
  tracks?: Track[];
}

const YOUTUBE_URL_REGEX = /^https?:\/\/(?:[a-zA-Z0-9_-]+\.)*(?:youtube\.com|youtu\.be)\/.+/i;

const activeMetadataProcs = new Set<ReturnType<typeof Bun.spawn>>();
const MAX_CONCURRENT_METADATA = 2;
let activeMetadataCount = 0;
const metadataWaitQueue: Array<() => void> = [];
let activeLocalIngests = 0;

async function killProcessSafely(proc: ReturnType<typeof Bun.spawn> | null): Promise<void> {
  if (!proc) return;
  try {
    if (process.platform === "win32") {
      const killProc = Bun.spawn(["taskkill", "/F", "/T", "/PID", String(proc.pid)], {
        stdout: "ignore",
        stderr: "ignore",
      });
      await killProc.exited;
    } else {
      proc.kill();
    }
    try { await proc.exited; } catch {}
  } catch {}
}

const MAX_METADATA_QUEUE_DEPTH = 10;
async function acquireMetadataSlot(): Promise<void> {
  if (activeMetadataCount < MAX_CONCURRENT_METADATA) {
    activeMetadataCount++;
    return;
  }
  if (metadataWaitQueue.length >= MAX_METADATA_QUEUE_DEPTH) {
    throw new Error("Máy chủ đang bận xử lý nhiều yêu cầu tải nhạc, vui lòng thử lại sau.");
  }
  return new Promise<void>((resolve) => {
    metadataWaitQueue.push(() => {
      activeMetadataCount++;
      resolve();
    });
  });
}

function releaseMetadataSlot(): void {
  activeMetadataCount = Math.max(0, activeMetadataCount - 1);
  const next = metadataWaitQueue.shift();
  if (next) {
    next();
  }
}

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
      "--js-runtimes",
      "bun",
      "--flat-playlist",
      "--playlist-end",
      "50",
      "--match-filter",
      "duration <=? 1800",
      "-J",
      "--skip-download",
      "--",
      url
    ];

    await acquireMetadataSlot();
    let outputText = "";
    let errText = "";
    try {
      const proc = Bun.spawn(metaCmd, {
        stdout: "pipe",
        stderr: "pipe",
      });
      activeMetadataProcs.add(proc);

      const killTimer = setTimeout(() => {
        killProcessSafely(proc);
      }, 45000);

      try {
        const res = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
        ]);
        outputText = res[0];
        errText = (res[1] || "").slice(0, 150);
        await proc.exited;
      } finally {
        clearTimeout(killTimer);
        activeMetadataProcs.delete(proc);
      }

      if (!outputText || outputText.trim() === "") {
        return { success: false, message: `yt-dlp error: ${errText || "No metadata returned"}` };
      }
    } finally {
      releaseMetadataSlot();
    }

    let data: any;
    try {
      const jsonStart = outputText.indexOf("{");
      const jsonEnd = outputText.lastIndexOf("}");
      if (jsonStart === -1 || jsonEnd === -1 || jsonEnd < jsonStart) {
        throw new Error("No JSON object found in output");
      }
      data = JSON.parse(outputText.slice(jsonStart, jsonEnd + 1));
    } catch (parseErr) {
      return { success: false, message: `yt-dlp JSON parse error: ${errText || outputText.slice(0, 150)}` };
    }

    const createdTracks: Track[] = [];

    // Check if it's a playlist or a single video
    const rawEntries = Array.isArray(data.entries) ? data.entries : [data];
    if (rawEntries.length === 0) {
      return {
        success: false,
        message: "Không tìm thấy bài hát nào (playlist rỗng hoặc video ở chế độ riêng tư)!",
      };
    }
    const MAX_PLAYLIST_ITEMS = 50;
    const entries = rawEntries.slice(0, MAX_PLAYLIST_ITEMS);

    for (const entry of entries) {
      if (!entry || !entry.id || !/^[a-zA-Z0-9_-]{1,64}$/.test(String(entry.id))) continue;
      if (entry.title === "[Private video]" || entry.title === "[Deleted video]") continue;

      // Skip livestreams
      if (entry.is_live || entry.live_status === "is_live") {
        console.warn(`[Skip] Bỏ qua livestream: ${entry.title}`);
        continue;
      }

      const duration = Number(entry.duration) || 0;
      const title = entry.title || "Unknown YouTube Track";
      const uploader = entry.uploader || entry.channel || "";
      const videoId = String(entry.id);
      const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
      const thumb = entry.thumbnail || entry.thumbnails?.[0]?.url || `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;

      // Strict 30-minute cap check (if duration is known from metadata)
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
        if (existing.status !== "queued") {
          updateTrack(trackId, { status: "queued", error_message: null });
          serverEvents.emit("track_updated", { trackId });
          triggerDownloadWorker(trackId, watchUrl);
        }
        existing = getTrack(trackId) || { ...existing, status: "queued", error_message: null };
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
let currentDownloadingTrackId: string | null = null;
let activeDownloadProc: ReturnType<typeof Bun.spawn> | null = null;

export function isIngestBusy(): boolean {
  return (
    isDownloading ||
    activeDownloadProc !== null ||
    downloadQueue.length > 0 ||
    activeMetadataProcs.size > 0 ||
    activeLocalIngests > 0 ||
    isWaveformBusy()
  );
}

export async function abortIngestProcesses(): Promise<void> {
  downloadQueue.length = 0;
  while (metadataWaitQueue.length > 0) {
    const fn = metadataWaitQueue.shift();
    try { fn?.(); } catch {}
  }
  activeMetadataCount = 0;
  for (const proc of activeMetadataProcs) {
    await killProcessSafely(proc);
  }
  activeMetadataProcs.clear();

  if (activeDownloadProc) {
    await killProcessSafely(activeDownloadProc);
    activeDownloadProc = null;
    currentDownloadingTrackId = null;
  }
}

export async function cancelDownloadIfActive(trackId: string): Promise<void> {
  const qIdx = downloadQueue.findIndex((q) => q.trackId === trackId);
  if (qIdx !== -1) {
    downloadQueue.splice(qIdx, 1);
  }

  if (currentDownloadingTrackId === trackId) {
    if (currentDownloadToken) {
      cancelledTokens.add(currentDownloadToken);
    }
    if (activeDownloadProc) {
      await killProcessSafely(activeDownloadProc);
      activeDownloadProc = null;
    }
    currentDownloadingTrackId = null;
    currentDownloadToken = null;
  }

  // Clean up any residual .part or .ytdl files
  try {
    const audioDir = resolve("./data/cache/audio");
    if (existsSync(audioDir)) {
      const files = readdirSync(audioDir);
      for (const f of files) {
        if (f === trackId || f.startsWith(`${trackId}.`)) {
          await unlinkWithRetry(join(audioDir, f));
        }
      }
    }
  } catch {}
}

function triggerDownloadWorker(trackId: string, url: string) {
  if (currentDownloadingTrackId === trackId || downloadQueue.some((q) => q.trackId === trackId)) return;
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
  currentDownloadingTrackId = trackId;
  const myToken = createHash("sha256").update(trackId + Date.now() + Math.random()).digest("hex");
  currentDownloadToken = myToken;

  // Check if track was deleted or is already ready
  const existingTrack = getTrack(trackId);
  if (!existingTrack || existingTrack.status === "ready") {
    currentDownloadingTrackId = null;
    currentDownloadToken = null;
    isDownloading = false;
    processDownloadQueue();
    return;
  }

  const audioDir = resolve("./data/cache/audio");
  if (!existsSync(audioDir)) {
    mkdirSync(audioDir, { recursive: true });
  }

  try {
    updateTrack(trackId, { status: "downloading" });
    serverEvents.emit("track_updated", { trackId });

    // Download audio using yt-dlp
    const dlCmd = [
      "yt-dlp",
      "--js-runtimes",
      "bun",
      "--no-playlist",
      "-x",
      "--audio-quality",
      "0",
      "--match-filter",
      `duration <= ${MAX_DURATION_SECONDS} & !is_live`,
      "--max-filesize",
      "150M",
      "-o",
      join(audioDir, `${trackId}.%(ext)s`),
      "--",
      url
    ];

    const proc = Bun.spawn(dlCmd, {
      stdout: "ignore",
      stderr: "pipe",
    });
    activeDownloadProc = proc;

    // 5-minute timeout to avoid hanging download indefinitely
    const dlTimeout = setTimeout(async () => {
      await killProcessSafely(proc);
    }, 300000);

    let errText = "";
    try {
      errText = await new Response(proc.stderr).text();
    } catch {}

    const exitCode = await proc.exited;
    clearTimeout(dlTimeout);
    activeDownloadProc = null;

    // Find actual downloaded file in ./data/cache/audio/ dynamically
    let finalPath = "";
    const AUDIO_EXTS = new Set([".m4a", ".mp3", ".opus", ".webm", ".ogg", ".flac", ".wav", ".aac"]);
    if (existsSync(audioDir)) {
      const files = readdirSync(audioDir);
      for (const f of files) {
        if (f.startsWith(`${trackId}.`) && !f.endsWith(".part") && !f.endsWith(".ytdl") && AUDIO_EXTS.has(extname(f).toLowerCase())) {
          finalPath = join(audioDir, f);
          break;
        }
      }
    }

    // If track was cancelled or deleted while download was running, clean up and exit silently
    if (cancelledTokens.has(myToken) || !getTrack(trackId)) {
      cancelledTokens.delete(myToken);
      if (finalPath && existsSync(finalPath)) {
        await unlinkWithRetry(finalPath);
      }
      return;
    }

    if (exitCode !== 0) {
      if (finalPath && existsSync(finalPath)) {
        await unlinkWithRetry(finalPath);
      }
      let errorMsg = `yt-dlp tải thất bại (exit code: ${exitCode})`;
      if (exitCode === 101) {
        errorMsg = `Video vượt quá giới hạn 30 phút (${MAX_DURATION_SECONDS}s)`;
      } else if (errText.trim()) {
        const lastLine = errText.trim().split(/[\r\n]+/).pop() || "";
        errorMsg = `yt-dlp: ${lastLine.slice(0, 150)}`;
      }
      updateTrack(trackId, { status: "error", error_message: errorMsg });
      serverEvents.emit("track_updated", { trackId });
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

      // If container duration is missing (e.g. DASH WebM/Opus wrapper), fallback to stage 1 validated duration
      if (actualDuration <= 0 && existingTrack?.duration && existingTrack.duration > 0 && existingTrack.duration <= MAX_DURATION_SECONDS) {
        actualDuration = existingTrack.duration;
      }

      // If duration is still undetermined, attempt fallback duration probe via ffprobe
      if (actualDuration <= 0) {
        try {
          const probeProc = Bun.spawn(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", finalPath], {
            stdout: "pipe",
            stderr: "ignore",
          });
          const probeTimer = setTimeout(() => { killProcessSafely(probeProc); }, 5000);
          const probeOut = await new Response(probeProc.stdout).text();
          clearTimeout(probeTimer);
          await probeProc.exited;
          const probed = parseFloat(probeOut.trim());
          if (Number.isFinite(probed) && probed > 0) {
            actualDuration = probed;
          }
        } catch {}
      }

      if (actualDuration < 0.5 || actualDuration > MAX_DURATION_SECONDS) {
        await unlinkWithRetry(finalPath);
        updateTrack(trackId, {
          status: "error",
          error_message: actualDuration < 0.5 
            ? "Thời lượng bài hát quá ngắn (tối thiểu 0.5 giây) hoặc file rỗng"
            : `Thời lượng thực tế (${actualDuration.toFixed(0)}s) vượt quá giới hạn 30 phút!`,
        });
        serverEvents.emit("track_updated", { trackId });
        return;
      }

      // Generate peaks
      const peaks = await generatePeaks(finalPath, 1000);

      // Check again if track was cancelled or deleted during peaks generation
      if (cancelledTokens.has(myToken) || !getTrack(trackId)) {
        cancelledTokens.delete(myToken);
        if (finalPath && existsSync(finalPath)) {
          await unlinkWithRetry(finalPath);
        }
        return;
      }

      const finalDuration = Number(actualDuration.toFixed(2));
      try {
        const { pruned, clamped } = reconcileTrackSegments(trackId, finalDuration);
        for (const p of pruned) {
          serverEvents.emit("segment_deleted", { segmentId: p.id, trackId });
        }
        for (const c of clamped) {
          serverEvents.emit("segment_updated", { segmentId: c.id, trackId });
        }
      } catch (e) {
        console.warn(`[Ingest] Segment reconciliation failed for track ${trackId}:`, e);
      }

      updateTrack(trackId, {
        file_path: finalPath,
        duration: finalDuration,
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
    currentDownloadingTrackId = null;
    isDownloading = false;
    // Process next item after small delay to be polite
    setTimeout(processDownloadQueue, 1000);
  }
}

/**
 * Handle Local FLAC or Audio File
 */
export async function ingestLocalFile(rawPath: string): Promise<IngestResult> {
  activeLocalIngests++;
  try {
    const cleanedPath = rawPath.trim().replace(/^["']|["']$/g, "");

    // Reject Windows UNC paths to prevent NetNTLM exfiltration
    if (/^[\\/]{2}/.test(cleanedPath) || /^[\\/]\?{1,2}[\\/]/.test(cleanedPath)) {
      return { success: false, message: "Đường dẫn mạng UNC không được hỗ trợ vì lý do bảo mật." };
    }

    // Reject Windows DOS device names (CON, PRN, AUX, NUL, COM1-9, LPT1-9)
    if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i.test(basename(cleanedPath))) {
      return { success: false, message: "Tên file thiết bị đặc biệt của hệ thống không được hỗ trợ." };
    }

    // Reject Windows NTFS Alternate Data Streams (: after drive specifier)
    if (cleanedPath.slice(2).includes(":")) {
      return { success: false, message: "Đường dẫn chứa luồng dữ liệu NTFS (Alternate Data Stream) không hợp lệ." };
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
    if (!existsSync(fullPath) || !statSync(fullPath).isFile()) {
      return { success: false, message: `File không tồn tại hoặc không phải là file hợp lệ: ${fullPath}` };
    }

    const metadata = await parseFile(fullPath);
    let duration = Number(metadata.format.duration) || 0;

    // Fallback probe via ffprobe if container duration is missing
    if (duration <= 0) {
      try {
        const probeProc = Bun.spawn(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", fullPath], {
          stdout: "pipe",
          stderr: "ignore",
        });
        const probeTimer = setTimeout(() => { killProcessSafely(probeProc); }, 5000);
        const probeOut = await new Response(probeProc.stdout).text();
        clearTimeout(probeTimer);
        await probeProc.exited;
        const probed = parseFloat(probeOut.trim());
        if (Number.isFinite(probed) && probed > 0) {
          duration = probed;
        }
      } catch {}
    }

    // 30 minute check & strictly positive check (minimum 0.5s for slicing compatibility)
    if (duration < 0.5 || duration > MAX_DURATION_SECONDS) {
      return {
        success: false,
        message: duration < 0.5
          ? "Thời lượng bài hát quá ngắn (tối thiểu 0.5 giây)!"
          : `File vượt quá thời lượng tối đa 30 phút (${duration.toFixed(0)}s > ${MAX_DURATION_SECONDS}s)!`,
      };
    }

    const normalizedPath = process.platform === "win32" ? fullPath.toLowerCase() : fullPath;
    const hash = createHash("md5").update(normalizedPath).digest("hex").slice(0, 12);
    const trackId = `loc_${hash}`;
    const title = metadata.common.title || basename(fullPath, extname(fullPath));
    const artist = metadata.common.artist || "Unknown Artist";

    // Extract cover art if present (bounded to 4MB and magic byte verified)
    let thumbUrl = "";
    if (metadata.common.picture && metadata.common.picture.length > 0) {
      const pic = metadata.common.picture[0];
      if (pic.data && pic.data.length >= 4 && pic.data.length <= 4 * 1024 * 1024) {
        const isJpeg = pic.data[0] === 0xff && pic.data[1] === 0xd8 && pic.data[2] === 0xff;
        const isPng = pic.data[0] === 0x89 && pic.data[1] === 0x50 && pic.data[2] === 0x4e && pic.data[3] === 0x47;
        const isWebp = pic.data.length >= 12 && pic.data[0] === 0x52 && pic.data[1] === 0x49 && pic.data[2] === 0x46 && pic.data[3] === 0x46;
        
        let imgExt = ".jpg";
        if (isPng) imgExt = ".png";
        else if (isWebp) imgExt = ".webp";

        if (isJpeg || isPng || isWebp) {
          const thumbCacheDir = "./data/cache/thumbs";
          mkdirSync(thumbCacheDir, { recursive: true });
          const thumbPath = join(thumbCacheDir, `${trackId}${imgExt}`);
          try {
            const oldPaths = [
              join(thumbCacheDir, `${trackId}.jpg`),
              join(thumbCacheDir, `${trackId}.png`),
              join(thumbCacheDir, `${trackId}.webp`),
            ];
            for (const oldP of oldPaths) {
              if (oldP !== thumbPath && existsSync(oldP)) {
                try { unlinkSync(oldP); } catch {}
              }
            }
            writeFileSync(thumbPath, pic.data);
            const thumbHash = createHash("md5").update(pic.data).digest("hex").slice(0, 8);
            thumbUrl = `/api/thumbs/${trackId}${imgExt}?v=${thumbHash}`;
          } catch {
            // ignore thumb write error
          }
        }
      }
    }

    // Generate peaks
    const peaks = await generatePeaks(fullPath, 1000);

    let existing = getTrack(trackId);
    const isExisting = !!existing;
    if (existing) {
      // Clean up zombie segments if file duration changed
      try {
        const { pruned, clamped } = reconcileTrackSegments(trackId, duration);
        for (const p of pruned) {
          serverEvents.emit("segment_deleted", { segmentId: p.id, trackId });
        }
        for (const c of clamped) {
          serverEvents.emit("segment_updated", { segmentId: c.id, trackId });
        }
        serverEvents.emit("track_updated", { trackId });
      } catch {}

      updateTrack(trackId, {
        title,
        artist,
        duration,
        file_path: fullPath,
        thumbnail_url: thumbUrl || existing.thumbnail_url,
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

    if (isExisting) {
      serverEvents.emit("track_updated", { trackId });
    } else {
      serverEvents.emit("track_created", { trackId });
    }

    return {
      success: true,
      tracks: [existing],
      message: `Đã nạp file local "${title}" thành công.`,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, message: `Lỗi đọc file local: ${msg}` };
  } finally {
    activeLocalIngests--;
  }
}
