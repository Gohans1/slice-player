import { parseFile } from "music-metadata";
import { existsSync, writeFileSync, unlinkSync, readdirSync, mkdirSync, statSync, renameSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, resolve, extname, join } from "node:path";
import { createTrack, updateTrack, getTrack, getDb, reconcileTrackSegments } from "./db";
import { generatePeaks, isWaveformBusy, abortWaveformProcesses, cancelWaveformForFile } from "./waveform";
import { serverEvents } from "./events";
import { logEvent } from "./logger";
import type { Track } from "./types";


const MAX_DURATION_SECONDS = 1800; // 30 minutes cap
const DURATION_EPSILON_SECONDS = 2; // Container framing tolerance

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

export async function renameWithRetry(src: string, dest: string, maxAttempts = 5): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      renameSync(src, dest);
      return true;
    } catch (err: any) {
      if ((err.code === "EBUSY" || err.code === "EPERM") && i < maxAttempts - 1) {
        await Bun.sleep(100 * (i + 1));
      } else {
        throw err;
      }
    }
  }
  return false;
}

const cancelledTokens = new Set<string>();
let currentDownloadToken: string | null = null;

export interface IngestResult {
  success: boolean;
  message?: string;
  tracks?: Track[];
}

const YOUTUBE_URL_REGEX = /^https?:\/\/(?:[a-zA-Z0-9_-]+\.)*(?:youtube\.com|youtu\.be)\/.+/i;

const activeMetadataProcs = new Set<ReturnType<typeof Bun.spawn>>();
const MAX_CONCURRENT_METADATA = 2;
let activeMetadataCount = 0;
const metadataWaitQueue: Array<{ resolve: () => void; reject: (err: Error) => void }> = [];
let activeLocalIngests = 0;

async function killProcessSafely(proc: ReturnType<typeof Bun.spawn> | null): Promise<void> {
  if (!proc || proc.exitCode !== null || proc.killed || typeof proc.pid !== "number" || proc.pid <= 0) return;
  try {
    if (process.platform === "win32") {
      const killProc = Bun.spawn(["taskkill", "/F", "/T", "/PID", String(proc.pid)], {
        stdout: "ignore",
        stderr: "ignore",
      });
      await killProc.exited;
    } else {
      try {
        const pkill = Bun.spawn(["pkill", "-9", "-P", String(proc.pid)], {
          stdout: "ignore",
          stderr: "ignore",
        });
        await pkill.exited;
      } catch {}
      try {
        process.kill(-proc.pid, "SIGKILL");
      } catch {
        proc.kill();
      }
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
  return new Promise<void>((res, rej) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const item = {
      resolve: () => {
        if (timer) clearTimeout(timer);
        activeMetadataCount++;
        res();
      },
      reject: (err: Error) => {
        if (timer) clearTimeout(timer);
        rej(err);
      },
    };
    timer = setTimeout(() => {
      const idx = metadataWaitQueue.indexOf(item);
      if (idx !== -1) metadataWaitQueue.splice(idx, 1);
      rej(new Error("Quá thời gian chờ hàng đợi xử lý YouTube (chờ quá 120s)"));
    }, 120000);
    metadataWaitQueue.push(item);
  });
}

function releaseMetadataSlot(): void {
  activeMetadataCount = Math.max(0, activeMetadataCount - 1);
  const next = metadataWaitQueue.shift();
  if (next) {
    next.resolve();
  }
}

export async function purgeTrackCacheFiles(audioDir: string, trackId: string): Promise<void> {
  if (!trackId || typeof trackId !== "string" || !trackId.trim()) return;
  try {
    if (existsSync(audioDir)) {
      const files = readdirSync(audioDir);
      await Promise.allSettled(
        files
          .filter((f) => f === trackId || f.startsWith(`${trackId}.`))
          .map((f) => unlinkWithRetry(join(audioDir, f)))
      );
    }
  } catch {}
}

export const SUPPORTED_AUDIO_EXTENSIONS = [".m4a", ".mp3", ".opus", ".webm", ".ogg", ".flac", ".wav", ".aac"] as const;

export function validateSafeLocalAudioPath(rawPath: string): { ok: boolean; message?: string } {
  if (typeof rawPath !== "string" || !rawPath.trim()) {
    return { ok: false, message: "Đường dẫn không hợp lệ." };
  }
  const cleaned = rawPath.trim().replace(/^["']|["']$/g, "");

  // Reject Windows UNC paths (e.g. \\server\share, //server/share, \\?\UNC\)
  if (/^[\\/]{2}/.test(cleaned) || /^[\\/]\?{1,2}[\\/]/.test(cleaned)) {
    return { ok: false, message: "Đường dẫn mạng UNC không được hỗ trợ vì lý do bảo mật." };
  }

  // Reject Windows DOS device names across any path segment (e.g. CON, PRN, AUX, NUL, COM1-9, LPT1-9, CONIN$, CONOUT$)
  const segments = cleaned.split(/[\\/]/);
  const dosDeviceRegex = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9]|CONIN\$|CONOUT\$)(\..*)?$/i;
  for (const seg of segments) {
    if (dosDeviceRegex.test(seg)) {
      return { ok: false, message: "Tên file hoặc thư mục chứa tên thiết bị đặc biệt của hệ thống không được hỗ trợ." };
    }
  }

  // Reject Windows NTFS Alternate Data Streams (e.g. file:stream or :stream)
  const withoutDrive = cleaned.replace(/^[a-zA-Z]:[\\/]?/, "");
  if (withoutDrive.includes(":")) {
    return { ok: false, message: "Đường dẫn chứa luồng dữ liệu NTFS (Alternate Data Stream) không hợp lệ." };
  }

  return { ok: true };
}

export function isYouTubeAuthError(stderr: string): boolean {
  return (
    /sign in to confirm (?:you['’]re|you are) not a bot|sign in to view|login required|(?:cookie|cookies).*(?:expired|invalid|corrupt|failed|error)|(?:invalid|corrupt|failed|error|expired).*(?:cookie|cookies)|needs to be reloaded|403[:\s]+forbidden|401[:\s]+unauthorized|429[:\s]+too many requests|http error (?:403|401|429)|po[-_ ]?token|proof[-_ ]of[-_ ]origin/i.test(stderr) &&
    !/private video|members-only|confirm your age/i.test(stderr)
  );
}

export function isYouTubeFormatOrSabrError(stderr: string): boolean {
  return /requested format is not available|forcing sabr streaming|only images are available for download/i.test(stderr);
}

let lastCookieFailureTime = 0;
let lastCookieMtime = 0;
const COOKIE_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes cooldown

export function markCookiesFailed(): void {
  lastCookieFailureTime = Date.now();
}

export function resetCookiesStatus(): void {
  lastCookieFailureTime = 0;
  lastCookieMtime = 0;
}

function hasValidCookies(): boolean {
  try {
    const cookiePath = resolve("./data/cookies.txt");
    const st = statSync(cookiePath, { throwIfNoEntry: false });
    if (!st || !st.isFile() || st.size === 0) return false;
    if (st.mtimeMs !== lastCookieMtime) {
      lastCookieMtime = st.mtimeMs;
      lastCookieFailureTime = 0;
      return true;
    }
    return Date.now() - lastCookieFailureTime > COOKIE_COOLDOWN_MS;
  } catch {
    return false;
  }
}

export function getYouTubeAuthArgs(useCookies = true, fallbackClient = false): string[] {
  const args = [
    "--js-runtimes",
    "bun",
    "--js-runtimes",
    "node",
    "--extractor-args",
    fallbackClient
      ? "youtube:player_client=mweb,android,ios,web"
      : "youtube:player_client=default,-tv",
  ];
  const cookiePath = resolve("./data/cookies.txt");
  if (useCookies && hasValidCookies()) {
    args.push("--cookies", cookiePath);
  }
  return args;
}

export async function recoverIncompleteIngests(): Promise<void> {
  try {
    const db = getDb();
    const audioDir = resolve("./data/cache/audio");
    const incompleteTracks = db.query(
      "SELECT id, source_uri FROM tracks WHERE source_type = 'youtube' AND status IN ('queued', 'downloading')"
    ).all() as { id: string; source_uri: string }[];

    for (const track of incompleteTracks) {
      try {
        await purgeTrackCacheFiles(audioDir, track.id);
      } catch {}
      updateTrack(track.id, {
        status: "error",
        error_message: "Tải bài hát bị gián đoạn do máy chủ khởi động lại. Vui lòng bấm Thử lại (Retry)."
      });
      serverEvents.emit("track_updated", { trackId: track.id });
    }
  } catch (e) {
    console.warn("[Ingest] Failed to recover incomplete tracks:", e);
  }
}

const MAXRES_FILE_REGEX = /\/maxresdefault(?:\.[a-zA-Z0-9]+)?(?:\?|$)/i;
const HQ720_FILE_REGEX = /\/hq720(?:\.[a-zA-Z0-9]+)?(?:\?|$)/i;
const SDDEFAULT_FILE_REGEX = /\/sddefault(?:\.[a-zA-Z0-9]+)?(?:\?|$)/i;
const HQDEFAULT_FILE_REGEX = /\/hqdefault(?:\.[a-zA-Z0-9]+)?(?:\?|$)/i;
const MQDEFAULT_FILE_REGEX = /\/mqdefault(?:\.[a-zA-Z0-9]+)?(?:\?|$)/i;

function normalizeThumbUrl(url: string): string {
  return url.startsWith("//") ? `https:${url}` : url;
}

/**
 * Select the highest quality available YouTube thumbnail, filtering out downscaled playlist sqp thumbnails.
 */
export function resolveBestYouTubeThumbnail(
  videoId: string,
  thumbnails?: Array<{ id?: string; url?: string; width?: number; height?: number; preference?: number }>,
  defaultThumbnail?: string
): string {
  const cleanVideoId = typeof videoId === "string" ? videoId.trim() : "";
  const thumb = cleanVideoId ? `https://i.ytimg.com/vi/${encodeURIComponent(cleanVideoId)}/maxresdefault.jpg` : "";
  if (thumbnails && Array.isArray(thumbnails)) {
    const validThumbs = thumbnails.filter(
      (t) =>
        t?.url &&
        typeof t.url === "string" &&
        !t.url.includes("sqp=") &&
        (t.url.startsWith("https://") || t.url.startsWith("http://") || t.url.startsWith("//"))
    );
    if (validThumbs.length > 0) {
      const getQualityScore = (t: { id?: string; url?: string; width?: number; height?: number; preference?: number }) => {
        const width = typeof t.width === "number" && Number.isFinite(t.width) && t.width > 0 ? t.width : 0;
        const height = typeof t.height === "number" && Number.isFinite(t.height) && t.height > 0 ? t.height : 0;
        const resArea = (width * height) || (width + height);
        const u = t.url || "";
        if (t.id === "maxresdefault" || MAXRES_FILE_REGEX.test(u) || width >= 1280) return 1_000_000 + resArea;
        if (t.id === "hq720" || HQ720_FILE_REGEX.test(u)) return 800_000 + resArea;
        if (t.id === "sddefault" || SDDEFAULT_FILE_REGEX.test(u) || width >= 640) return 500_000 + resArea;
        if (t.id === "hqdefault" || HQDEFAULT_FILE_REGEX.test(u) || width >= 480) return 300_000 + resArea;
        if (t.id === "mqdefault" || MQDEFAULT_FILE_REGEX.test(u) || width >= 320) return 200_000 + resArea;
        if (typeof t.preference === "number" && t.preference > 0) return t.preference * 10_000 + resArea;
        return resArea;
      };
      validThumbs.sort((a, b) => getQualityScore(b) - getQualityScore(a));
      const topScore = getQualityScore(validThumbs[0]);
      // Only prefer metadata thumbnail over constructed maxresdefault if it's at least medium quality (>= 320px) or high quality tier
      if (topScore >= 200_000 && validThumbs[0]?.url) {
        return normalizeThumbUrl(validThumbs[0].url);
      }
      if (thumb) {
        return thumb;
      }
      if (validThumbs[0]?.url) {
        return normalizeThumbUrl(validThumbs[0].url);
      }
    }
  }
  if (
    defaultThumbnail &&
    typeof defaultThumbnail === "string" &&
    !defaultThumbnail.includes("sqp=") &&
    (defaultThumbnail.startsWith("https://") || defaultThumbnail.startsWith("http://") || defaultThumbnail.startsWith("//"))
  ) {
    return normalizeThumbUrl(defaultThumbnail);
  }
  return thumb;
}

/**
 * Handle YouTube URL (single video or playlist)
 */
export async function ingestYouTubeUrl(rawUrl: string): Promise<IngestResult> {
  let url = rawUrl.trim().replace(/^["']|["']$/g, "");
  if (!/^https?:\/\//i.test(url)) {
    url = "https://" + url;
  }
  if (!YOUTUBE_URL_REGEX.test(url)) {
    logEvent("warn", "download", `URL không hợp lệ: ${rawUrl}`);
    return { success: false, message: "URL không hợp lệ. Chỉ chấp nhận link YouTube (youtube.com, m.youtube.com, music.youtube.com, hoặc youtu.be)!" };
  }

  try {
    logEvent("info", "download", `Bắt đầu quét metadata YouTube: ${url}`);
    // Stage 1: Fast metadata extraction via yt-dlp
    await acquireMetadataSlot();
    let outputText = "";
    let errText = "";
    let rawStderr = "";
    let metaTimedOut = false;
    try {
      let exitCode = 1;
      const usedCookies = hasValidCookies();

      const runMetaExtraction = async (withCookies: boolean, fallbackClient = false): Promise<number> => {
        const metaCmd = [
          "yt-dlp",
          ...getYouTubeAuthArgs(withCookies, fallbackClient),
          "--flat-playlist",
          "--playlist-end",
          "50",
          "--match-filter",
          `duration <=? ${MAX_DURATION_SECONDS} & !is_live & live_status != is_upcoming & live_status != post_live`,
          "-J",
          "--skip-download",
          "--socket-timeout",
          "30",
          "--",
          url
        ];

        const proc = Bun.spawn(metaCmd, {
          stdout: "pipe",
          stderr: "pipe",
        });
        activeMetadataProcs.add(proc);

        const killTimer = setTimeout(async () => {
          metaTimedOut = true;
          await killProcessSafely(proc);
        }, 45000);

        try {
          const res = await Promise.all([
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
          ]);
          outputText = res[0];
          rawStderr = res[1] || "";
          const errLines = rawStderr.trim().split(/[\r\n]+/);
          const lastErr = errLines.filter((l) => l.startsWith("ERROR:")).pop() || errLines.pop() || "";
          errText = lastErr.slice(0, 150);
          return await proc.exited;
        } finally {
          clearTimeout(killTimer);
          activeMetadataProcs.delete(proc);
          if (proc.exitCode === null) {
            await killProcessSafely(proc);
          }
        }
      };

      exitCode = await runMetaExtraction(usedCookies);
      if (exitCode !== 0 && !metaTimedOut) {
        const isMetaAuthErr = isYouTubeAuthError(rawStderr);
        if (isMetaAuthErr && usedCookies) {
          markCookiesFailed();
        }
        console.warn(
          `[Ingest] Metadata extraction failed with ${isMetaAuthErr ? "auth/bot challenge" : "format/SABR/client restriction"} (exit code ${exitCode}), retrying with fallback client...`
        );
        exitCode = await runMetaExtraction(usedCookies && !isMetaAuthErr, true);
        if (exitCode !== 0 && !metaTimedOut && usedCookies && !isMetaAuthErr) {
          exitCode = await runMetaExtraction(false, true);
        }
      }

      if (exitCode !== 0 || !outputText || outputText.trim() === "") {
        let userMsg = `yt-dlp error (exit code ${exitCode}): ${errText || "No metadata returned"}`;
        if (metaTimedOut) {
          userMsg = "Quá thời gian trích xuất thông tin YouTube (timeout 45s)";
        } else if (exitCode === 101) {
          userMsg = "Lỗi kết nối mạng: Không thể kết nối tới máy chủ YouTube (Network unreachable / Code 101)";
        } else if (exitCode === 0 && (!outputText || outputText.trim() === "")) {
          userMsg = "Video không đáp ứng điều kiện (vượt quá 30 phút, livestream hoặc bị chặn)";
        }
        logEvent("error", "download", `Lỗi quét metadata YouTube: ${userMsg}`, { url, exitCode });
        return { success: false, message: userMsg };
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
    } catch {
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
      if (!entry.title || /^\[(private video|deleted video|unavailable video|video riêng tư|video bị xóa)\]$/i.test(String(entry.title).trim())) continue;

      // Skip livestreams and upcoming premieres
      if (entry.is_live || entry.live_status === "is_live" || entry.live_status === "is_upcoming" || entry.live_status === "post_live") {
        console.warn(`[Skip] Bỏ qua livestream hoặc lịch phát sóng sắp diễn ra: ${entry.title}`);
        continue;
      }

      const duration = Number(entry.duration) || 0;
      const title = entry.title || "Unknown YouTube Track";
      const uploader = entry.uploader || entry.channel || "";
      const videoId = String(entry.id);
      const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
      const thumb = resolveBestYouTubeThumbnail(videoId, entry.thumbnails, entry.thumbnail);

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
      } else {
        const isCurrentlyActive = currentDownloadingTrackId === trackId || downloadQueue.some((q) => q.trackId === trackId);
        const fileMissing = !existing.file_path || !existsSync(existing.file_path);
        if ((existing.status !== "ready" || fileMissing) && !isCurrentlyActive) {
          const updated = updateTrack(trackId, { status: "queued", error_message: null, thumbnail_url: thumb });
          serverEvents.emit("track_updated", { trackId });
          triggerDownloadWorker(trackId, watchUrl);
          existing = updated || { ...existing, status: "queued", error_message: null, thumbnail_url: thumb };
        }
      }

      createdTracks.push(existing);
    }

    if (createdTracks.length === 0 && entries.length > 0) {
      return {
        success: false,
        message: `Mọi video trong link đều vượt quá giới hạn 30 phút (${MAX_DURATION_SECONDS}s), là livestream hoặc không hợp lệ!`,
      };
    }

    logEvent("success", "download", `Đã xử lý YouTube URL: tạo/cập nhật ${createdTracks.length} bài hát`, { count: createdTracks.length });
    return {
      success: true,
      tracks: createdTracks,
      message: `Đã nạp thành công ${createdTracks.length} bài hát vào hàng đợi tải.`,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logEvent("error", "download", `Lỗi xử lý YouTube: ${msg}`, { url, error: msg });
    return { success: false, message: `Lỗi xử lý YouTube: ${msg}` };
  }
}

// Queue worker for downloads (strictly sequential: concurrency = 1)
const downloadQueue: Array<{ trackId: string; url: string }> = [];
let isDownloading = false;
let currentDownloadingTrackId: string | null = null;
let activeDownloadProc: ReturnType<typeof Bun.spawn> | null = null;

export function getDownloadQueueOrder(): string[] {
  const list: string[] = [];
  if (currentDownloadingTrackId) {
    list.push(currentDownloadingTrackId);
  }
  for (const item of downloadQueue) {
    if (item.trackId && !list.includes(item.trackId)) {
      list.push(item.trackId);
    }
  }
  return list;
}

export function isIngestBusy(): boolean {
  return (
    isDownloading ||
    activeDownloadProc !== null ||
    downloadQueue.length > 0 ||
    activeMetadataProcs.size > 0 ||
    activeMetadataCount > 0 ||
    metadataWaitQueue.length > 0 ||
    activeLocalIngests > 0 ||
    isWaveformBusy()
  );
}

export async function abortIngestProcesses(): Promise<void> {
  downloadQueue.length = 0;
  while (metadataWaitQueue.length > 0) {
    const item = metadataWaitQueue.shift();
    try { item?.reject(new Error("Yêu cầu đã bị hủy")); } catch {}
  }
  const procsToKill = Array.from(activeMetadataProcs);
  activeMetadataProcs.clear();
  await Promise.allSettled(procsToKill.map((proc) => killProcessSafely(proc)));

  await abortWaveformProcesses();

  if (currentDownloadToken) {
    cancelledTokens.add(currentDownloadToken);
  }

  if (activeDownloadProc) {
    await killProcessSafely(activeDownloadProc);
    activeDownloadProc = null;
  }
}

export async function cancelDownloadIfActive(trackId: string): Promise<void> {
  for (let i = downloadQueue.length - 1; i >= 0; i--) {
    if (downloadQueue[i].trackId === trackId) {
      downloadQueue.splice(i, 1);
    }
  }

  if (currentDownloadingTrackId === trackId) {
    if (currentDownloadToken) {
      cancelledTokens.add(currentDownloadToken);
    }
    if (activeDownloadProc) {
      await killProcessSafely(activeDownloadProc);
      activeDownloadProc = null;
    }
  }

  const audioDir = resolve("./data/cache/audio");
  // Cancel any active waveform generation for this track
  try {
    await Promise.allSettled(
      SUPPORTED_AUDIO_EXTENSIONS.map((ext) => cancelWaveformForFile(join(audioDir, `${trackId}${ext}`)))
    );
  } catch {}

  // Clean up any residual .part or .ytdl files
  await purgeTrackCacheFiles(audioDir, trackId);
}

function triggerDownloadWorker(trackId: string, url: string) {
  if (currentDownloadingTrackId === trackId || downloadQueue.some((q) => q.trackId === trackId)) return;
  const existing = getTrack(trackId);
  logEvent("info", "download", `Đã đưa vào hàng đợi tải: [${existing?.title || trackId}]`, { trackId });
  downloadQueue.push({ trackId, url });
  processDownloadQueue();
}

async function processDownloadQueue() {
  if (isDownloading || downloadQueue.length === 0) return;
  isDownloading = true;

  let trackId = "";
  let myToken: string | null = null;
  let finalPath = "";
  let didAttemptDownload = false;

  try {
    const item = downloadQueue.shift();
    if (!item) return;

    trackId = item.trackId;
    const { url } = item;
    currentDownloadingTrackId = trackId;
    myToken = createHash("sha256").update(trackId + Date.now() + Math.random()).digest("hex");
    currentDownloadToken = myToken;

    // Check if track was deleted or is already ready with valid file on disk
    const existingTrack = getTrack(trackId);
    const fileExists = existingTrack?.file_path && existsSync(existingTrack.file_path);
    if (!existingTrack || (existingTrack.status === "ready" && fileExists)) {
      return;
    }

    const audioDir = resolve("./data/cache/audio");
    if (!existsSync(audioDir)) {
      mkdirSync(audioDir, { recursive: true });
    }

    // Pre-purge any residual or stale files for this trackId
    await purgeTrackCacheFiles(audioDir, trackId);

    updateTrack(trackId, { status: "downloading" });
    logEvent("info", "download", `Bắt đầu tải audio yt-dlp: [${existingTrack.title}]`, { trackId });
    serverEvents.emit("track_updated", { trackId });
    didAttemptDownload = true;

    // Download audio using yt-dlp
    let errText = "";
    let rawDlStderr = "";
    let dlTimedOut = false;
    let exitCode = 1;
    const usedCookies = hasValidCookies();

    const runYtDlp = async (withCookies: boolean, fallbackClient = false): Promise<number> => {
      const dlCmd = [
        "yt-dlp",
        ...getYouTubeAuthArgs(withCookies, fallbackClient),
        "--no-playlist",
        "-f",
        "ba/b",
        "-x",
        "--audio-quality",
        "0",
        "--match-filter",
        `duration <=? ${MAX_DURATION_SECONDS} & !is_live & live_status != is_upcoming & live_status != post_live`,
        "--max-filesize",
        "150M",
        "--socket-timeout",
        "30",
        "--retries",
        "3",
        "--fragment-retries",
        "3",
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

      const dlTimeout = setTimeout(async () => {
        dlTimedOut = true;
        await killProcessSafely(proc);
      }, 300000);

      try {
        rawDlStderr = await new Response(proc.stderr).text();
        const errLines = rawDlStderr.trim().split(/[\r\n]+/);
        const lastErr = errLines.filter(l => l.startsWith("ERROR:")).pop() || errLines.pop() || "";
        errText = lastErr.slice(0, 150);
        return await proc.exited;
      } finally {
        clearTimeout(dlTimeout);
        activeDownloadProc = null;
        if (proc.exitCode === null) {
          await killProcessSafely(proc);
        }
      }
    };

    exitCode = await runYtDlp(usedCookies);

    // If download failed due to auth / bot challenge / token expiration or cookie-enforced format/SABR restrictions,
    // retry once with anonymous client fallback (only invalidating cookies globally if it was a true auth error).
    if (exitCode !== 0 && !dlTimedOut) {
      if ((myToken && cancelledTokens.has(myToken)) || !getTrack(trackId)) {
        return;
      }
      const isDlAuthErr = isYouTubeAuthError(rawDlStderr);
      if (isDlAuthErr && usedCookies) {
        markCookiesFailed();
      }
      console.warn(
        `[Ingest] YouTube download failed for ${trackId} with ${isDlAuthErr ? "auth/bot challenge" : "format/SABR/client restriction"} (exit code ${exitCode}), retrying with fallback client...`
      );
      await purgeTrackCacheFiles(audioDir, trackId);
      if ((myToken && cancelledTokens.has(myToken)) || !getTrack(trackId)) {
        return;
      }
      exitCode = await runYtDlp(usedCookies && !isDlAuthErr, true);
      if (exitCode !== 0 && !dlTimedOut && usedCookies && !isDlAuthErr) {
        if ((myToken && cancelledTokens.has(myToken)) || !getTrack(trackId)) {
          return;
        }
        await purgeTrackCacheFiles(audioDir, trackId);
        exitCode = await runYtDlp(false, true);
      }
    }

    // Find actual downloaded file in ./data/cache/audio/ dynamically
    if (existsSync(audioDir)) {
      const files = readdirSync(audioDir);
      for (const f of files) {
        const ext = extname(f).toLowerCase();
        if (basename(f, ext) === trackId && !f.endsWith(".part") && !f.endsWith(".ytdl") && (SUPPORTED_AUDIO_EXTENSIONS as readonly string[]).includes(ext)) {
          finalPath = join(audioDir, f);
          break;
        }
      }
    }

    // If track was cancelled or deleted while download was running, clean up and exit silently
    if ((myToken && cancelledTokens.has(myToken)) || !getTrack(trackId)) {
      if (finalPath && existsSync(finalPath)) {
        await unlinkWithRetry(finalPath);
      }
      return;
    }

    if (exitCode !== 0) {
      await purgeTrackCacheFiles(audioDir, trackId);
      let errorMsg = `yt-dlp tải thất bại (exit code: ${exitCode})`;
      if (dlTimedOut) {
        errorMsg = `Quá thời gian tải âm thanh (timeout 5 phút)`;
      } else if (exitCode === 101) {
        errorMsg = `Lỗi mạng khi tải âm thanh: Không thể kết nối tới YouTube (Network unreachable / Code 101)`;
      } else if (errText.trim()) {
        errorMsg = `yt-dlp: ${errText}`;
      }
      logEvent("error", "download", `Tải audio yt-dlp thất bại cho [${existingTrack?.title || trackId}]: ${errorMsg}`);
      updateTrack(trackId, { status: "error", error_message: errorMsg });
      serverEvents.emit("track_updated", { trackId });
      return;
    }

    if (!finalPath) {
      let errorMsg = "Tải thất bại, file vượt quá 30m/150MB hoặc không tìm thấy";
      if (/does not pass filter/i.test(rawDlStderr) || /larger than max-filesize/i.test(rawDlStderr)) {
        errorMsg = "Video không đáp ứng điều kiện tải (vượt quá 30 phút, quá 150MB hoặc livestream)";
      }
      logEvent("error", "download", `Không tìm thấy file audio tải về cho [${existingTrack?.title || trackId}]: ${errorMsg}`);
      updateTrack(trackId, { status: "error", error_message: errorMsg });
      serverEvents.emit("track_updated", { trackId });
      return;
    }

    // Physical audio file size validation (prevent corrupted or 0-byte downloads from passing)
    const fileStat = statSync(finalPath, { throwIfNoEntry: false });
    if (!fileStat || fileStat.size < 1024) {
      await unlinkWithRetry(finalPath);
      updateTrack(trackId, { status: "error", error_message: "Tải thất bại: File âm thanh rỗng hoặc bị hỏng" });
      serverEvents.emit("track_updated", { trackId });
      return;
    }

    // Re-verify actual audio duration with physical file preferred over Stage 1 metadata
    let actualDuration = 0;
    try {
      const meta = await parseFile(finalPath);
      actualDuration = Number(meta.format.duration) || 0;
    } catch (e) {
      console.warn(`[Ingest] Could not parse downloaded metadata: ${e}`);
    }

    // Fallback duration probe via ffprobe on physical file
    if (actualDuration <= 0) {
      let probeProc: ReturnType<typeof Bun.spawn> | null = null;
      let probeTimer: ReturnType<typeof setTimeout> | null = null;
      try {
        probeProc = Bun.spawn(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", finalPath], {
          stdout: "pipe",
          stderr: "ignore",
        });
        probeTimer = setTimeout(async () => { await killProcessSafely(probeProc); }, 5000);
        const probeOut = probeProc.stdout ? await new Response(probeProc.stdout as ReadableStream<Uint8Array>).text() : "";
        await probeProc.exited;
        const probed = parseFloat(probeOut.trim());
        if (Number.isFinite(probed) && probed > 0) {
          actualDuration = probed;
        }
      } catch {} finally {
        if (probeTimer) clearTimeout(probeTimer);
        if (probeProc && probeProc.exitCode === null) {
          await killProcessSafely(probeProc);
        }
      }
    }

    // Safe fallback to Stage 1 metadata duration if physical container duration header is omitted but file size is valid
    if (actualDuration <= 0 && existingTrack?.duration && existingTrack.duration >= 0.5 && existingTrack.duration <= MAX_DURATION_SECONDS) {
      actualDuration = existingTrack.duration;
    }

    if (actualDuration < 0.5 || actualDuration > MAX_DURATION_SECONDS + DURATION_EPSILON_SECONDS) {
      await unlinkWithRetry(finalPath);
      const errMsg = actualDuration < 0.5
        ? "Không thể đọc định dạng âm thanh hoặc file bị hỏng (thời lượng < 0.5s)"
        : `Thời lượng thực tế (${actualDuration.toFixed(0)}s) vượt quá giới hạn 30 phút!`;
      logEvent("error", "download", `Lỗi thời lượng [${existingTrack?.title || trackId}]: ${errMsg}`);
      updateTrack(trackId, {
        status: "error",
        error_message: errMsg,
      });
      serverEvents.emit("track_updated", { trackId });
      return;
    }

    // Generate peaks
    logEvent("info", "download", `Đang trích xuất waveform: [${existingTrack?.title || trackId}]`);
    const peaks = await generatePeaks(finalPath, 1000);

    // Check again if track was cancelled or deleted during peaks generation
    if ((myToken && cancelledTokens.has(myToken)) || !getTrack(trackId)) {
      if (finalPath && existsSync(finalPath)) {
        await unlinkWithRetry(finalPath);
      }
      return;
    }

    const finalDuration = Math.min(MAX_DURATION_SECONDS, Number(actualDuration.toFixed(2)));
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

    const updatedTrack = updateTrack(trackId, {
      file_path: finalPath,
      duration: finalDuration,
      peaks_json: JSON.stringify(peaks),
      status: "ready",
      error_message: null,
    });
    if (!updatedTrack) {
      if (finalPath && existsSync(finalPath)) {
        await unlinkWithRetry(finalPath);
      }
      return;
    }
    logEvent("success", "download", `Bài hát sẵn sàng phát: [${updatedTrack.title}] (${Math.round(finalDuration)}s)`);
    serverEvents.emit("track_updated", { trackId });
  } catch (err: unknown) {
    if (trackId) {
      try {
        const audioDir = resolve("./data/cache/audio");
        await purgeTrackCacheFiles(audioDir, trackId);
      } catch {}
    }
    if (finalPath && existsSync(finalPath)) {
      try {
        await unlinkWithRetry(finalPath);
      } catch {}
    }
    if ((myToken && cancelledTokens.has(myToken)) || !getTrack(trackId)) {
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (trackId) {
      logEvent("error", "download", `Lỗi khi tải bài hát [${trackId}]: ${msg}`, err);
      updateTrack(trackId, { status: "error", error_message: msg });
      serverEvents.emit("track_updated", { trackId });
    }
  } finally {
    if (myToken) {
      cancelledTokens.delete(myToken);
    }
    currentDownloadingTrackId = null;
    currentDownloadToken = null;
    isDownloading = false;
    setTimeout(processDownloadQueue, didAttemptDownload ? 1000 : 0);
  }
}

/**
 * Handle Local FLAC or Audio File
 */
export async function ingestLocalFile(rawPath: string, preferredTitle?: string): Promise<IngestResult> {
  activeLocalIngests++;
  try {
    const cleanedPath = rawPath.trim().replace(/^["']|["']$/g, "");
    logEvent("info", "download", `Bắt đầu nạp file từ máy: ${basename(cleanedPath)}`);

    const pathCheck = validateSafeLocalAudioPath(cleanedPath);
    if (!pathCheck.ok) {
      return { success: false, message: pathCheck.message || "Đường dẫn không hợp lệ" };
    }

    const ext = extname(cleanedPath).toLowerCase();
    if (!(SUPPORTED_AUDIO_EXTENSIONS as readonly string[]).includes(ext)) {
      return {
        success: false,
        message: `Định dạng file không được hỗ trợ (${ext || "không có phần mở rộng"}). Chỉ chấp nhận: ${SUPPORTED_AUDIO_EXTENSIONS.join(", ")}`,
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
      let probeProc: ReturnType<typeof Bun.spawn> | null = null;
      let probeTimer: ReturnType<typeof setTimeout> | null = null;
      try {
        probeProc = Bun.spawn(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", fullPath], {
          stdout: "pipe",
          stderr: "ignore",
        });
        probeTimer = setTimeout(async () => { await killProcessSafely(probeProc); }, 5000);
        const probeOut = probeProc.stdout ? await new Response(probeProc.stdout as ReadableStream<Uint8Array>).text() : "";
        await probeProc.exited;
        const probed = parseFloat(probeOut.trim());
        if (Number.isFinite(probed) && probed > 0) {
          duration = probed;
        }
      } catch {} finally {
        if (probeTimer) clearTimeout(probeTimer);
        if (probeProc && probeProc.exitCode === null) {
          await killProcessSafely(probeProc);
        }
      }
    }

    // 30 minute check & strictly positive check (minimum 0.5s for slicing compatibility)
    if (duration < 0.5 || duration > MAX_DURATION_SECONDS + DURATION_EPSILON_SECONDS) {
      return {
        success: false,
        message: duration < 0.5
          ? "Thời lượng bài hát quá ngắn (tối thiểu 0.5 giây)!"
          : `File vượt quá thời lượng tối đa 30 phút (${duration.toFixed(0)}s > ${MAX_DURATION_SECONDS}s)!`,
      };
    }

    duration = Math.min(MAX_DURATION_SECONDS, Number(duration.toFixed(2)));

    const normalizedPath = process.platform === "win32" ? fullPath.toLowerCase() : fullPath;
    const hash = createHash("md5").update(normalizedPath).digest("hex").slice(0, 12);
    const trackId = `loc_${hash}`;
    const title = metadata.common.title || preferredTitle?.trim() || basename(fullPath, extname(fullPath));
    const artist = metadata.common.artist || "Unknown Artist";

    // Extract cover art if present (bounded to 4MB and magic byte verified)
    let thumbUrl = "";
    if (metadata.common.picture && metadata.common.picture.length > 0) {
      const pic = metadata.common.picture[0];
      if (pic.data && pic.data.length >= 4 && pic.data.length <= 4 * 1024 * 1024) {
        const isJpeg = pic.data[0] === 0xff && pic.data[1] === 0xd8 && pic.data[2] === 0xff;
        const isPng = pic.data[0] === 0x89 && pic.data[1] === 0x50 && pic.data[2] === 0x4e && pic.data[3] === 0x47;
        const isWebp = pic.data.length >= 12 &&
          pic.data[0] === 0x52 && pic.data[1] === 0x49 && pic.data[2] === 0x46 && pic.data[3] === 0x46 &&
          pic.data[8] === 0x57 && pic.data[9] === 0x45 && pic.data[10] === 0x42 && pic.data[11] === 0x50;
        
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

    logEvent("success", "download", `Nạp file local thành công: [${title}] (${Math.round(duration)}s)`, { trackId, duration });
    return {
      success: true,
      tracks: [existing],
      message: `Đã nạp file local "${title}" thành công.`,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logEvent("error", "download", `Lỗi nạp file local: ${msg}`);
    return { success: false, message: `Lỗi đọc file local: ${msg}` };
  } finally {
    activeLocalIngests--;
  }
}

/**
 * Ingest all supported audio files in a local directory
 */
export async function ingestLocalDirectory(rawDir: string): Promise<IngestResult> {
  const cleanedDir = rawDir.trim().replace(/^["']|["']$/g, "");

  const pathCheck = validateSafeLocalAudioPath(cleanedDir);
  if (!pathCheck.ok) {
    return { success: false, message: pathCheck.message || "Đường dẫn thư mục không hợp lệ" };
  }

  try {
    const fullDir = resolve(cleanedDir);
    if (!existsSync(fullDir) || !statSync(fullDir).isDirectory()) {
      return { success: false, message: `Thư mục không tồn tại: ${fullDir}` };
    }

    const entries = readdirSync(fullDir);
    const audioFiles = entries
      .filter((f) => (SUPPORTED_AUDIO_EXTENSIONS as readonly string[]).includes(extname(f).toLowerCase()))
      .map((f) => join(fullDir, f));

    if (audioFiles.length === 0) {
      return {
        success: false,
        message: `Không tìm thấy file audio được hỗ trợ (${SUPPORTED_AUDIO_EXTENSIONS.join(", ")}) trong thư mục.`,
      };
    }

    const MAX_DIR_FILES = 100;
    const targetFiles = audioFiles.slice(0, MAX_DIR_FILES);

    const tracks: Track[] = [];
    const errors: string[] = [];

    for (const filePath of targetFiles) {
      const res = await ingestLocalFile(filePath);
      if (res.success && res.tracks) {
        tracks.push(...res.tracks);
      } else if (res.message) {
        errors.push(`${basename(filePath)}: ${res.message}`);
      }
    }

    if (tracks.length === 0) {
      return {
        success: false,
        message: `Không nạp được bài hát nào: ${errors.slice(0, 3).join("; ")}`,
      };
    }

    return {
      success: true,
      tracks,
      message: `Đã nạp thành công ${tracks.length}/${targetFiles.length} bài hát.${errors.length > 0 ? ` (${errors.length} bài lỗi)` : ""}${audioFiles.length > MAX_DIR_FILES ? ` (Giới hạn tối đa ${MAX_DIR_FILES} bài)` : ""}`,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, message: `Lỗi đọc thư mục: ${msg}` };
  }
}

/**
 * Ingest an uploaded audio file (from multipart/form-data)
 */
export async function ingestUploadedFile(file: File, fallbackName?: string): Promise<IngestResult> {
  const originalName = typeof file.name === "string" && file.name.trim() ? file.name : (fallbackName || "audio.flac");
  const lastDot = originalName.lastIndexOf(".");
  const ext = lastDot !== -1 ? originalName.slice(lastDot).toLowerCase() : "";

  if (!(SUPPORTED_AUDIO_EXTENSIONS as readonly string[]).includes(ext)) {
    return {
      success: false,
      message: `Định dạng ${ext || "không xác định"} không được hỗ trợ. Chỉ chấp nhận: ${SUPPORTED_AUDIO_EXTENSIONS.join(", ")}`,
    };
  }

  const MAX_UPLOAD_BYTES = 300 * 1024 * 1024; // 300MB
  if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) {
    return {
      success: false,
      message: file.size <= 0 ? "File tải lên bị rỗng" : `File vượt quá dung lượng tối đa 300MB (${(file.size / 1024 / 1024).toFixed(1)}MB)`,
    };
  }

  const audioCacheDir = resolve("./data/cache/audio");
  mkdirSync(audioCacheDir, { recursive: true });

  const tempName = `temp_upload_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`;
  const tempPath = join(audioCacheDir, tempName);

  let finalPath = "";
  let alreadyExists = false;

  try {
    // Stream directly to disk using Bun.write (zero-copy streaming)
    await Bun.write(tempPath, file);

    // Stream hash calculation from disk in chunks
    const hash = createHash("md5");
    for await (const chunk of (Bun.file(tempPath).stream() as any)) {
      hash.update(chunk);
    }
    const contentHash = hash.digest("hex").slice(0, 12);
    const finalFileName = `loc_${contentHash}${ext}`;
    finalPath = join(audioCacheDir, finalFileName);

    alreadyExists = existsSync(finalPath);
    if (!alreadyExists) {
      await renameWithRetry(tempPath, finalPath);
    } else {
      await unlinkWithRetry(tempPath);
    }

    const preferredTitle = basename(lastDot !== -1 ? originalName.slice(0, lastDot) : originalName);
    const res = await ingestLocalFile(finalPath, preferredTitle);
    if (!res.success && !alreadyExists) {
      await unlinkWithRetry(finalPath);
    }
    return res;
  } catch (err: unknown) {
    await unlinkWithRetry(tempPath);
    if (!alreadyExists && finalPath && existsSync(finalPath)) {
      await unlinkWithRetry(finalPath);
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, message: `Lỗi xử lý file upload: ${msg}` };
  }
}


