import { serve, file as bunFile, type ServerWebSocket } from "bun";
import { existsSync, statSync, mkdirSync, unlinkSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, join, extname, basename, sep } from "node:path";
import {
  initDatabase, closeDatabase, getTrack, listTracks, updateTrack, deleteTrack, deleteTracksBatch,
  getSegment, createSegment, updateSegment, deleteSegment, deleteSegmentsBatch, listSegmentsByTrack, listAllSegments, validateVolume,
  createPlaylist, getPlaylist, listPlaylists, updatePlaylist, deletePlaylist,
  getPlaylistItems, addPlaylistItem, addPlaylistItemsBatch, removePlaylistItem, removePlaylistItemsBatch, reorderPlaylistItems,
  getPlaylistMemberships, getCrossPlatformBasename
} from "./db";
import { ingestYouTubeUrl, ingestLocalFile, ingestLocalDirectory, ingestUploadedFile, validateSafeLocalAudioPath, abortIngestProcesses, cancelDownloadIfActive, unlinkWithRetry, isIngestBusy, recoverIncompleteIngests, resetCookiesStatus, getDownloadQueueOrder, requeueErrorTracks } from "./ingest";
import { abortWaveformProcesses, cancelWaveformForFile } from "./waveform";
import { serverEvents } from "./events";
import { getRecentLogs, clearServerLogs, logEvent } from "./logger";
import { exportLibraryArchive, importLibraryArchive, isLibraryRestoring } from "./backup";
import type { Segment, Track, Playlist, PlaylistItem } from "./types";

const PORT = Number(process.env.PORT) || 3000;

// Initialize SQLite database
initDatabase("./data/music.db");
await recoverIncompleteIngests();

logEvent("info", "system", `Máy chủ Slice Player đang chạy tại http://127.0.0.1:${PORT}`);


const activeSockets = new Set<ServerWebSocket>();
let shutdownTimer: Timer | null = null;
let isShuttingDown = false;
let hasHadInitialConnection = false;

async function gracefulShutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log("[Server] Shutting down cleanly: closing DB and stopping workers.");
  if (shutdownTimer) {
    clearTimeout(shutdownTimer);
    shutdownTimer = null;
  }
  await server.stop(true);
  await abortIngestProcesses();
  await abortWaveformProcesses();
  closeDatabase();
  process.exit(0);
}

process.on("SIGINT", () => { gracefulShutdown(); });
process.on("SIGTERM", () => { gracefulShutdown(); });
if (process.platform === "win32") {
  process.on("SIGBREAK", () => { gracefulShutdown(); });
}

if (process.env.NODE_ENV === "production") {
  // Watchdog: If no browser connects within 180s of startup, terminate headless orphan
  const initialConnectionWatchdog = setTimeout(() => {
    if (!hasHadInitialConnection && activeSockets.size === 0) {
      console.log("[Server] No client connection established within 180s. Shutting down.");
      gracefulShutdown();
    }
  }, 180000);
  initialConnectionWatchdog.unref?.();
}

const mimeTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".m4a": "audio/mp4",
  ".webm": "audio/webm",
  ".flac": "audio/flac",
  ".opus": "audio/ogg",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".aac": "audio/aac",
};

function isSubdirectoryOf(parent: string, child: string): boolean {
  const normParent = process.platform === "win32" ? resolve(parent).toLowerCase() : resolve(parent);
  const normChild = process.platform === "win32" ? resolve(child).toLowerCase() : resolve(child);
  return normChild.startsWith(normParent + sep);
}

const MAX_BATCH_LIMIT = 5000;
const MAX_BATCH_PAYLOAD_BYTES = 2 * 1024 * 1024; // 2MB for batch operations

async function parseJsonBody<T = Record<string, any>>(req: Request, maxLimit = 65536): Promise<T> {
  const text = await req.text();
  if (text.length > maxLimit) {
    throw new Error(`Payload too large (max ${Math.round(maxLimit / 1024)}KB)`);
  }
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SyntaxError("Invalid JSON: syntax error in request body");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError("Invalid JSON: expected an object");
  }
  return parsed as T;
}

const server = serve({
  hostname: "127.0.0.1",
  port: PORT,
  idleTimeout: 120,
  maxRequestBodySize: 2048 * 1024 * 1024, // 2GB max upload limit for library backup restore
  async fetch(req, server) {
    const url = new URL(req.url);

    // If a library restore operation is actively in progress, prevent race conditions
    if (isLibraryRestoring() && !url.pathname.startsWith("/api/library")) {
      return Response.json(
        { error: "Thư viện đang được khôi phục, vui lòng thử lại sau giây lát." },
        { status: 503, headers: { "Retry-After": "5", "Content-Type": "application/json" } }
      );
    }

    // Prevent cross-site subresource leakage while permitting top-level navigation
    const secFetchSite = req.headers.get("sec-fetch-site");
    const isTopLevelNav = req.method === "GET" && req.headers.get("sec-fetch-mode") === "navigate";
    if (secFetchSite === "cross-site" && !isTopLevelNav) {
      return new Response("Forbidden: Cross-site requests rejected", { status: 403 });
    }

    // Host header validation to prevent DNS rebinding attacks
    const host = req.headers.get("host");
    const isDev = process.env.NODE_ENV !== "production";
    const allowedHosts = [
      `127.0.0.1:${PORT}`,
      `localhost:${PORT}`,
      `[::1]:${PORT}`,
      `::1:${PORT}`,
      ...(PORT === 80 || PORT === 443 ? ["127.0.0.1", "localhost", "[::1]", "::1"] : []),
      ...(isDev ? ["127.0.0.1:5173", "localhost:5173", "[::1]:5173", "::1:5173"] : []),
    ];
    if (!host || !allowedHosts.includes(host)) {
      return new Response("Forbidden: Invalid Host header", { status: 403 });
    }

    // CORS & Origin validation (strict loopback only)
    const origin = req.headers.get("origin");
    const allowedOrigins = [
      `http://127.0.0.1:${PORT}`,
      `http://localhost:${PORT}`,
      `http://[::1]:${PORT}`,
      ...(isDev ? ["http://localhost:5173", "http://127.0.0.1:5173", "http://[::1]:5173"] : []),
    ];

    if (origin && !allowedOrigins.includes(origin)) {
      return new Response("Forbidden: Cross-origin request not allowed", { status: 403 });
    }

    // WebSocket upgrade (origin verified)
    if (url.pathname === "/ws") {
      if (origin && !allowedOrigins.includes(origin)) {
        return new Response("Forbidden: Cross-origin WebSocket request not allowed", { status: 403 });
      }
      const upgraded = server.upgrade(req);
      if (upgraded) return undefined;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    const corsHeaders = {
      "Access-Control-Allow-Origin": origin || `http://127.0.0.1:${PORT}`,
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges",
      "Content-Security-Policy": "default-src 'self'; media-src 'self' blob:; img-src 'self' data: https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; script-src 'self' blob:; worker-src blob:; frame-ancestors 'none';",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
    };

    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // --- API ROUTES ---
    if (url.pathname.startsWith("/api/")) {
      if (req.method === "POST" || req.method === "PUT" || req.method === "PATCH") {
        const rawLen = req.headers.get("content-length");
        const isChunked = req.headers.get("transfer-encoding")?.toLowerCase().includes("chunked");
        if (isChunked) {
          return Response.json(
            { error: "Chunked transfer encoding is not supported" },
            { status: 400, headers: corsHeaders }
          );
        }
        const isBodyOptional = url.pathname.endsWith("/retry") || url.pathname === "/api/tracks/retry-all";
        if (!rawLen && !isBodyOptional) {
          return Response.json(
            { error: "Content-Length header is required for mutating requests" },
            { status: 411, headers: corsHeaders }
          );
        }
        if (rawLen) {
          const contentLength = Number(rawLen);
          if (!Number.isFinite(contentLength) || contentLength < 0 || (!isBodyOptional && contentLength === 0)) {
            return Response.json(
              { error: "Empty or invalid request body" },
              { status: 400, headers: corsHeaders }
            );
          }
          const isTrackUpload = url.pathname === "/api/tracks/upload";
          const isLibraryImport = url.pathname === "/api/library/import";
          const isBatchEndpoint =
            url.pathname === "/api/tracks/batch-delete" ||
            url.pathname === "/api/segments/batch-delete" ||
            url.pathname.endsWith("/items/batch") ||
            url.pathname.endsWith("/items/batch-delete") ||
            url.pathname.endsWith("/reorder");
          const maxLimit = isLibraryImport
            ? 2048 * 1024 * 1024
            : isTrackUpload
            ? 305 * 1024 * 1024
            : isBatchEndpoint
            ? MAX_BATCH_PAYLOAD_BYTES
            : 65536;
          if (contentLength > maxLimit) {
            return Response.json(
              {
                error: isLibraryImport
                  ? "Payload too large (max 2GB)"
                  : isTrackUpload
                  ? "Payload too large (max 300MB)"
                  : isBatchEndpoint
                  ? "Payload too large (max 2MB)"
                  : "Payload too large (max 64KB)",
              },
              { status: 413, headers: corsHeaders }
            );
          }
        }
      }

      // 1. Tracks API
      if (url.pathname === "/api/tracks" && req.method === "GET") {
        const tracks = listTracks();
        const queueOrder = getDownloadQueueOrder();
        const UNINDEXED_QUEUE_FALLBACK = 999_999;
        const queueMap = new Map<string, number>(queueOrder.map((id, idx) => [id, idx]));
        const enrichedTracks = tracks.map((track) => {
          if (track.status === "downloading" || track.status === "queued") {
            const idx = queueMap.get(track.id);
            return {
              ...track,
              download_index: idx !== undefined ? idx : (track.status === "downloading" ? 0 : UNINDEXED_QUEUE_FALLBACK),
            };
          }
          return track;
        });
        return Response.json(enrichedTracks, { headers: corsHeaders });
      }

      if (url.pathname === "/api/tracks/ingest-youtube" && req.method === "POST") {
        try {
          const body = await parseJsonBody<{ url?: string }>(req);
          if (!body.url) return Response.json({ error: "Missing YouTube URL" }, { status: 400, headers: corsHeaders });
          const res = await ingestYouTubeUrl(body.url, req.signal);
          return Response.json(res, { status: res.success ? 200 : 400, headers: corsHeaders });
        } catch (err: unknown) {
          const isClientErr = err instanceof SyntaxError || err instanceof TypeError;
          const msg = err instanceof Error ? err.message : String(err);
          return Response.json({ error: msg }, { status: isClientErr ? 400 : 500, headers: corsHeaders });
        }
      }

      if (url.pathname === "/api/tracks/ingest-local" && req.method === "POST") {
        try {
          const body = await parseJsonBody<{ path?: string; paths?: string[] }>(req);
          const rawItems = Array.from(
            new Set(
              (Array.isArray(body.paths) ? body.paths : (body.path ? [body.path] : []))
                .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
                .map((p) => p.trim().replace(/^["']|["']$/g, ""))
            )
          );

          if (rawItems.length === 0) {
            return Response.json({ error: "Missing file path" }, { status: 400, headers: corsHeaders });
          }

          if (rawItems.length > 50) {
            return Response.json({ error: "Chỉ được nạp tối đa 50 đường dẫn mỗi lần" }, { status: 400, headers: corsHeaders });
          }

          // Security: Validate UNC, DOS devices, and NTFS ADS BEFORE filesystem access to prevent NetNTLM hash exfiltration on Windows
          for (const item of rawItems) {
            const check = validateSafeLocalAudioPath(item);
            if (!check.ok) {
              return Response.json(
                { success: false, message: check.message || "Đường dẫn không hợp lệ." },
                { status: 400, headers: corsHeaders }
              );
            }
          }

          const tracks: Track[] = [];
          const errors: string[] = [];
          const MAX_BATCH_TRACKS = 50;

          for (const cleaned of rawItems) {
            if (tracks.length >= MAX_BATCH_TRACKS) {
              errors.push(`Đã đạt giới hạn tối đa ${MAX_BATCH_TRACKS} bài nạp trong một lượt.`);
              break;
            }
            try {
              const resolved = resolve(cleaned);
              if (!existsSync(resolved)) {
                errors.push(`${basename(cleaned)}: File hoặc thư mục không tồn tại`);
                continue;
              }
              if (statSync(resolved).isDirectory()) {
                const dirRes = await ingestLocalDirectory(resolved);
                if (dirRes.success && dirRes.tracks) {
                  const remaining = MAX_BATCH_TRACKS - tracks.length;
                  tracks.push(...dirRes.tracks.slice(0, remaining));
                  if (dirRes.tracks.length > remaining) {
                    errors.push(`Thư mục "${basename(cleaned)}" có nhiều file hơn số lượng cho phép trong lượt này.`);
                  }
                } else if (dirRes.message) {
                  errors.push(dirRes.message);
                }
              } else {
                const fileRes = await ingestLocalFile(resolved);
                if (fileRes.success && fileRes.tracks) {
                  tracks.push(...fileRes.tracks);
                } else if (fileRes.message) {
                  errors.push(fileRes.message);
                }
              }
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : String(err);
              errors.push(`${basename(cleaned)}: ${msg}`);
            }
          }

          if (tracks.length === 0) {
            return Response.json(
              { success: false, message: `Không thể nạp bài hát nào: ${errors.join("; ")}` },
              { status: 400, headers: corsHeaders }
            );
          }

          return Response.json({
            success: true,
            tracks,
            message: `Đã nạp thành công ${tracks.length} bài hát.${errors.length > 0 ? ` (${errors.length} bài lỗi)` : ""}`,
          }, { status: 200, headers: corsHeaders });
        } catch (err: unknown) {
          const isClientErr = err instanceof SyntaxError || err instanceof TypeError;
          const msg = err instanceof Error ? err.message : String(err);
          return Response.json({ error: msg }, { status: isClientErr ? 400 : 500, headers: corsHeaders });
        }
      }

      if (url.pathname === "/api/tracks/upload" && req.method === "POST") {
        try {
          const formData = await req.formData();
          const allEntries = [...formData.getAll("files"), ...formData.getAll("file")];
          const allFiles = allEntries.filter((f): f is File => f instanceof Blob);

          if (allFiles.length === 0) {
            return Response.json({ error: "Không tìm thấy file tải lên" }, { status: 400, headers: corsHeaders });
          }

          if (allFiles.length > 20) {
            return Response.json({ error: "Chỉ được tải lên tối đa 20 file mỗi lần" }, { status: 400, headers: corsHeaders });
          }

          const tracks: Track[] = [];
          const errors: string[] = [];

          for (const file of allFiles) {
            const originalName = typeof file.name === "string" ? file.name : "audio.flac";
            const res = await ingestUploadedFile(file, originalName);
            if (res.success && res.tracks) {
              tracks.push(...res.tracks);
            } else {
              errors.push(`${originalName}: ${res.message || "Lỗi nạp file"}`);
            }
          }

          if (tracks.length === 0) {
            return Response.json(
              { success: false, message: `Không thể nạp file: ${errors.join("; ")}` },
              { status: 400, headers: corsHeaders }
            );
          }

          return Response.json({
            success: true,
            tracks,
            message: `Đã nạp thành công ${tracks.length}/${allFiles.length} bài hát.${errors.length > 0 ? ` (${errors.length} bài lỗi)` : ""}`,
          }, { status: 200, headers: corsHeaders });
        } catch (err: unknown) {
          const isClientErr = err instanceof SyntaxError || err instanceof TypeError;
          const msg = err instanceof Error ? err.message : String(err);
          return Response.json({ error: msg }, { status: isClientErr ? 400 : 500, headers: corsHeaders });
        }
      }

      // Track batch delete
      if (url.pathname === "/api/tracks/batch-delete" && req.method === "POST") {
        try {
          const body = await parseJsonBody<{ ids: string[] }>(req, MAX_BATCH_PAYLOAD_BYTES);
          if (!body || !Array.isArray(body.ids)) {
            return Response.json({ error: "Invalid request: ids must be an array of strings" }, { status: 400, headers: corsHeaders });
          }
          const ids = Array.from(new Set(body.ids.filter((id) => typeof id === "string" && id.trim().length > 0)));
          if (ids.length > MAX_BATCH_LIMIT) {
            return Response.json({ error: `Batch size limit exceeded (max ${MAX_BATCH_LIMIT})` }, { status: 400, headers: corsHeaders });
          }
          if (ids.length === 0) {
            return Response.json({ success: true, count: 0 }, { headers: corsHeaders });
          }

          const cacheAudioDir = resolve("./data/cache/audio");
          const cacheThumbsDir = resolve("./data/cache/thumbs");
          const preReadAudioFiles = existsSync(cacheAudioDir) ? readdirSync(cacheAudioDir) : [];
          const pendingSegmentDeletions: { segmentId: string; trackId: string }[] = [];
          const pendingTrackDeletions: string[] = [];

          for (const trackId of ids) {
            await cancelDownloadIfActive(trackId, preReadAudioFiles);
            const track = getTrack(trackId);
            if (track) {
              if (track.file_path) {
                await cancelWaveformForFile(track.file_path);
                const resolvedAudio = resolve(track.file_path);
                if (isSubdirectoryOf(cacheAudioDir, resolvedAudio) && existsSync(resolvedAudio)) {
                  await unlinkWithRetry(resolvedAudio);
                }
              }
              for (const ext of [".jpg", ".png", ".webp"]) {
                const thumbPath = resolve(cacheThumbsDir, `${track.id}${ext}`);
                if (isSubdirectoryOf(cacheThumbsDir, thumbPath) && existsSync(thumbPath)) {
                  await unlinkWithRetry(thumbPath);
                }
              }
              const segmentsToDelete = listSegmentsByTrack(trackId);
              for (const seg of segmentsToDelete) {
                pendingSegmentDeletions.push({ segmentId: seg.id, trackId });
              }
              pendingTrackDeletions.push(trackId);
            }
          }

          const deletedCount = deleteTracksBatch(ids);

          for (const item of pendingSegmentDeletions) {
            serverEvents.emit("segment_deleted", item);
          }
          for (const trackId of pendingTrackDeletions) {
            serverEvents.emit("track_deleted", { trackId });
          }
          serverEvents.emit("playlist_items_changed", {});

          return Response.json({ success: true, count: deletedCount }, { headers: corsHeaders });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          return Response.json({ error: msg }, { status: 500, headers: corsHeaders });
        }
      }

      // Track detail & delete
      const trackMatch = url.pathname.match(/^\/api\/tracks\/([^/]+)$/);
      if (trackMatch) {
        let trackId = trackMatch[1];
        try {
          trackId = decodeURIComponent(trackId);
        } catch {
          return Response.json({ error: "Malformed URI component" }, { status: 400, headers: corsHeaders });
        }
        if (req.method === "GET") {
          const track = getTrack(trackId);
          if (!track) return Response.json({ error: "Track not found" }, { status: 404, headers: corsHeaders });
          return Response.json(track, { headers: corsHeaders });
        }
        if (req.method === "PUT" || req.method === "PATCH") {
          try {
            const body = await parseJsonBody<Partial<Track>>(req);
            if (body.volume !== undefined) {
              if (!validateVolume(body.volume)) {
                return Response.json(
                  { error: "Volume must be a finite number between 0.0 and 1.0" },
                  { status: 400, headers: corsHeaders }
                );
              }
            }
            const updated = updateTrack(trackId, body);
            if (!updated) {
              return Response.json({ error: "Track not found" }, { status: 404, headers: corsHeaders });
            }
            const allowedTrackKeys: (keyof Track)[] = [
              "title", "artist", "duration", "thumbnail_url",
              "file_path", "peaks_json", "status", "error_message", "volume"
            ];
            const modifiedKeys = Object.keys(body).filter(
              (k) => (body as any)[k] !== undefined && allowedTrackKeys.includes(k as keyof Track)
            );
            const isVolumeOnly = modifiedKeys.length === 1 && modifiedKeys[0] === "volume";
            serverEvents.emit("track_updated", {
              trackId,
              track: updated,
              reason: isVolumeOnly ? "volume" : "general"
            });
            return Response.json(updated, { headers: corsHeaders });
          } catch (err: unknown) {
            const isClientErr =
              err instanceof SyntaxError ||
              err instanceof TypeError ||
              (err instanceof Error && err.message.toLowerCase().includes("constraint"));
            const msg = err instanceof Error ? err.message : String(err);
            return Response.json({ error: msg }, { status: isClientErr ? 400 : 500, headers: corsHeaders });
          }
        }
        if (req.method === "DELETE") {
          await cancelDownloadIfActive(trackId);
          const track = getTrack(trackId);
          if (!track) {
            return Response.json({ error: "Track not found" }, { status: 404, headers: corsHeaders });
          }
          if (track.file_path) {
            await cancelWaveformForFile(track.file_path);
          }

          // ONLY unlink audio file if it is cached strictly within ./data/cache/audio/ (e.g. YouTube download or uploaded local file)
          if (track.file_path) {
            const cacheAudioDir = resolve("./data/cache/audio");
            const resolvedAudio = resolve(track.file_path);
            if (isSubdirectoryOf(cacheAudioDir, resolvedAudio) && existsSync(resolvedAudio)) {
              await unlinkWithRetry(resolvedAudio);
            }
          }
          // Unlink thumbnail if local cache
          const cacheThumbsDir = resolve("./data/cache/thumbs");
          for (const ext of [".jpg", ".png", ".webp"]) {
            const thumbPath = resolve(cacheThumbsDir, `${track.id}${ext}`);
            if (isSubdirectoryOf(cacheThumbsDir, thumbPath) && existsSync(thumbPath)) {
              await unlinkWithRetry(thumbPath);
            }
          }

          const segmentsToDelete = listSegmentsByTrack(trackId);
          const ok = deleteTrack(trackId);
          if (!ok) {
            return Response.json({ error: "Could not delete track from database" }, { status: 500, headers: corsHeaders });
          }
          serverEvents.emit("track_deleted", { trackId });
          for (const seg of segmentsToDelete) {
            serverEvents.emit("segment_deleted", { segmentId: seg.id, trackId });
          }
          serverEvents.emit("playlist_items_changed", {});

          return Response.json({ success: true }, { headers: corsHeaders });
        }
      }

      // Retry all error tracks or batch retry
      if (url.pathname === "/api/tracks/retry-all" && req.method === "POST") {
        let trackIds: string[] | undefined = undefined;
        const rawLen = req.headers.get("content-length");
        const hasBody = rawLen && Number(rawLen) > 0;
        if (hasBody) {
          try {
            const body = await parseJsonBody<{ track_ids?: unknown }>(req, 65536);
            if ("track_ids" in body) {
              if (Array.isArray(body.track_ids)) {
                trackIds = body.track_ids.filter((id: unknown): id is string => typeof id === "string" && id.trim().length > 0);
              } else {
                return Response.json({ error: "track_ids must be an array" }, { status: 400, headers: corsHeaders });
              }
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            const status = msg.includes("Payload too large") ? 413 : 400;
            return Response.json({ error: msg }, { status, headers: corsHeaders });
          }
        }
        const result = requeueErrorTracks(trackIds);
        return Response.json({ success: true, requeued: result.requeued }, { status: 200, headers: corsHeaders });
      }

      // Track retry
      const retryMatch = url.pathname.match(/^\/api\/tracks\/([^/]+)\/retry$/);
      if (retryMatch && req.method === "POST") {
        let trackId: string;
        try {
          trackId = decodeURIComponent(retryMatch[1]);
        } catch {
          return Response.json({ error: "Malformed URI component" }, { status: 400, headers: corsHeaders });
        }
        const track = getTrack(trackId);
        if (!track) {
          return Response.json({ error: "Track not found" }, { status: 404, headers: corsHeaders });
        }
        if (track.source_type === "youtube") {
          resetCookiesStatus();
          const res = await ingestYouTubeUrl(track.source_uri, req.signal);
          if (!res.success) {
            updateTrack(trackId, { status: "error", error_message: res.message || "Tải lại thất bại" });
            serverEvents.emit("track_updated", { trackId });
          }
          return Response.json(res, { status: res.success ? 200 : 400, headers: corsHeaders });
        } else if (track.source_type === "local") {
          const res = await ingestLocalFile(track.source_uri);
          if (!res.success) {
            updateTrack(trackId, { status: "error", error_message: res.message || "Tải lại thất bại" });
            serverEvents.emit("track_updated", { trackId });
          }
          return Response.json(res, { status: res.success ? 200 : 400, headers: corsHeaders });
        } else {
          return Response.json({ error: "Unsupported source type" }, { status: 400, headers: corsHeaders });
        }
      }

      // 2. Audio Stream API (HTTP 206 Partial Content handled natively by Bun)
      const streamMatch = url.pathname.match(/^\/api\/tracks\/([^/]+)\/stream$/);
      if (streamMatch && (req.method === "GET" || req.method === "HEAD")) {
        let trackId: string;
        try {
          trackId = decodeURIComponent(streamMatch[1]);
        } catch {
          return new Response("Malformed URI component", { status: 400, headers: corsHeaders });
        }
        const track = getTrack(trackId);
        if (!track || !track.file_path) {
          return new Response("Audio file not available or not downloaded yet", { status: 404, headers: corsHeaders });
        }

        let targetFilePath = track.file_path;
        let audioFile = bunFile(targetFilePath);
        if (!(await audioFile.exists())) {
          const localCandidate = resolve(join("./data/cache/audio", getCrossPlatformBasename(targetFilePath)));
          if (existsSync(localCandidate)) {
            updateTrack(track.id, { file_path: localCandidate });
            targetFilePath = localCandidate;
            audioFile = bunFile(targetFilePath);
          } else {
            return new Response("Audio file missing on disk", { status: 404, headers: corsHeaders });
          }
        }

        const ext = extname(targetFilePath).toLowerCase();
        const contentType = mimeTypes[ext] || "application/octet-stream";

        if (req.method === "HEAD") {
          return new Response(null, {
            status: 200,
            headers: {
              ...corsHeaders,
              "Content-Type": contentType,
              "Content-Length": String(audioFile.size),
              "Accept-Ranges": "bytes",
            },
          });
        }

        // HTTP 206 Partial Content support for byte-range seeking
        const range = req.headers.get("range");
        if (range) {
          const match = range.match(/bytes=(\d*)-(\d*)/);
          if (match) {
            let start = match[1] ? parseInt(match[1], 10) : NaN;
            let end = match[2] ? parseInt(match[2], 10) : NaN;

            if (Number.isNaN(start) && Number.isNaN(end)) {
              return new Response("Invalid Range", { status: 416, headers: { ...corsHeaders, "Content-Range": `bytes */${audioFile.size}` } });
            }

            if (Number.isNaN(start)) {
              start = Math.max(0, audioFile.size - end);
              end = audioFile.size - 1;
            } else if (Number.isNaN(end)) {
              end = audioFile.size - 1;
            }

            if (start >= audioFile.size || start > end) {
              return new Response("Range Not Satisfiable", {
                status: 416,
                headers: {
                  ...corsHeaders,
                  "Content-Range": `bytes */${audioFile.size}`,
                  "Accept-Ranges": "bytes",
                },
              });
            }

            end = Math.min(end, audioFile.size - 1);

            return new Response(audioFile.slice(start, end + 1), {
              status: 206,
              headers: {
                ...corsHeaders,
                "Content-Type": contentType,
                "Content-Length": String(end - start + 1),
                "Content-Range": `bytes ${start}-${end}/${audioFile.size}`,
                "Accept-Ranges": "bytes",
              },
            });
          } else {
            return new Response("Range Not Satisfiable", {
              status: 416,
              headers: {
                ...corsHeaders,
                "Content-Range": `bytes */${audioFile.size}`,
                "Accept-Ranges": "bytes",
              },
            });
          }
        }

        return new Response(audioFile, {
          headers: {
            ...corsHeaders,
            "Content-Type": contentType,
            "Content-Length": String(audioFile.size),
            "Accept-Ranges": "bytes",
          },
        });
      }

      // 3. Local Thumbnail API (Sanitized against directory traversal)
      const thumbMatch = url.pathname.match(/^\/api\/thumbs\/([a-zA-Z0-9_-]+)(?:\.[a-zA-Z0-9]+)?$/);
      if (thumbMatch && (req.method === "GET" || req.method === "HEAD")) {
        const thumbId = thumbMatch[1];
        const allowedThumbsDir = resolve("./data/cache/thumbs");
        for (const ext of [".jpg", ".png", ".webp"]) {
          const thumbPath = resolve(allowedThumbsDir, `${thumbId}${ext}`);
          if (isSubdirectoryOf(allowedThumbsDir, thumbPath) && existsSync(thumbPath)) {
            const ct = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
            const stat = statSync(thumbPath);
            const etag = `"${stat.size.toString(16)}-${stat.mtimeMs.toString(16)}"`;
            const headers = {
              ...corsHeaders,
              "Content-Type": ct,
              "Content-Length": String(stat.size),
              "ETag": etag,
              "Cache-Control": "public, max-age=86400",
            };
            if (req.headers.get("if-none-match") === etag) {
              return new Response(null, { status: 304, headers });
            }
            if (req.method === "HEAD") {
              return new Response(null, { headers });
            }
            return new Response(bunFile(thumbPath), { headers });
          }
        }
        return new Response("Thumbnail not found", { status: 404, headers: corsHeaders });
      }

      // 4. Segments API
      const trackSegmentsMatch = url.pathname.match(/^\/api\/tracks\/([^/]+)\/segments$/);
      if (trackSegmentsMatch) {
        let trackId: string;
        try {
          trackId = decodeURIComponent(trackSegmentsMatch[1]);
        } catch {
          return Response.json({ error: "Malformed URI component" }, { status: 400, headers: corsHeaders });
        }
        if (req.method === "GET") {
          const segments = listSegmentsByTrack(trackId);
          return Response.json(segments, { headers: corsHeaders });
        }
        if (req.method === "POST") {
          try {
            const body = await parseJsonBody<Partial<Segment>>(req);
            if (!body.name || body.start_time === undefined || body.end_time === undefined) {
              return Response.json({ error: "Missing segment fields" }, { status: 400, headers: corsHeaders });
            }
            const startTime = Number(Number(body.start_time).toFixed(2));
            let endTime = Number(Number(body.end_time).toFixed(2));
            const track = getTrack(trackId);
            if (!track) {
              return Response.json({ error: "Track not found" }, { status: 404, headers: corsHeaders });
            }
            if (track.status !== "ready" || track.duration <= 0) {
              return Response.json({ error: "Track audio is still downloading or processing" }, { status: 400, headers: corsHeaders });
            }
            if (track.duration > 0 && endTime > track.duration && endTime <= track.duration + 0.5) {
              endTime = track.duration;
            }
            if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || startTime < 0 || endTime - startTime < 0.5) {
              return Response.json({ error: "start_time phải >= 0 và thời lượng tối thiểu 0.5s" }, { status: 400, headers: corsHeaders });
            }
            if (endTime > 1800 || (track.duration > 0 && (endTime > track.duration + 0.1 || startTime >= track.duration))) {
              return Response.json({ error: `end_time (${endTime}s) vượt quá thời lượng bài hát hoặc giới hạn 30 phút` }, { status: 400, headers: corsHeaders });
            }
            const rawName = String(body.name || "").trim().slice(0, 100);
            if (!rawName) {
              return Response.json({ error: "Tên đoạn không được để trống" }, { status: 400, headers: corsHeaders });
            }
            const hexColor = typeof body.color === "string" && /^#[0-9a-fA-F]{6}$/.test(body.color) ? body.color : "#4385BE";
            const sortOrder = Number.isInteger(body.sort_order) && Number(body.sort_order) >= 0 && Number(body.sort_order) <= 100000 ? Number(body.sort_order) : 0;
            const created = createSegment({
              id: `seg_${crypto.randomUUID()}`,
              track_id: trackId,
              name: rawName,
              start_time: startTime,
              end_time: endTime,
              color: hexColor,
              sort_order: sortOrder,
            });
            serverEvents.emit("track_updated", { trackId });
            return Response.json(created, { headers: corsHeaders });
          } catch (e: any) {
            const isClientErr = e instanceof SyntaxError || e instanceof TypeError;
            return Response.json({ error: e.message || "Failed to create segment" }, { status: isClientErr ? 400 : 500, headers: corsHeaders });
          }
        }
      }

      // Individual segment update / delete
      const segmentDetailMatch = url.pathname.match(/^\/api\/segments\/([^/]+)$/);
      if (segmentDetailMatch) {
        const segId = segmentDetailMatch[1];
        if (req.method === "PUT") {
          try {
            const body = await parseJsonBody<Partial<Segment>>(req);
            const existingSeg = getSegment(segId);
            if (!existingSeg) return Response.json({ error: "Segment not found" }, { status: 404, headers: corsHeaders });

            const newStart = body.start_time !== undefined && body.start_time !== null ? Number(Number(body.start_time).toFixed(2)) : existingSeg.start_time;
            let newEnd = body.end_time !== undefined && body.end_time !== null ? Number(Number(body.end_time).toFixed(2)) : existingSeg.end_time;

            const track = getTrack(existingSeg.track_id);
            if (!track) {
              return Response.json({ error: "Associated track not found" }, { status: 404, headers: corsHeaders });
            }
            if (track.status !== "ready" || track.duration <= 0) {
              return Response.json({ error: "Bài hát chưa sẵn sàng để chỉnh sửa đoạn" }, { status: 400, headers: corsHeaders });
            }
            if (track.duration > 0 && newEnd > track.duration && newEnd <= track.duration + 0.5) {
              newEnd = track.duration;
            }

            if (!Number.isFinite(newStart) || !Number.isFinite(newEnd) || newStart < 0 || newEnd - newStart < 0.5) {
              return Response.json({ error: "start_time phải >= 0 và thời lượng tối thiểu 0.5s" }, { status: 400, headers: corsHeaders });
            }

            if (newEnd > 1800 || (track.duration > 0 && (newEnd > track.duration + 0.1 || newStart >= track.duration))) {
              return Response.json(
                { error: `start_time hoặc end_time vượt quá thời lượng bài hát hoặc giới hạn 30 phút` },
                { status: 400, headers: corsHeaders }
              );
            }

            const rawName = body.name !== undefined ? String(body.name).trim().slice(0, 100) : existingSeg.name;
            const hexColor = typeof body.color === "string" && /^#[0-9a-fA-F]{6}$/.test(body.color) ? body.color : existingSeg.color;
            let newSortOrder = existingSeg.sort_order;
            if (body.sort_order !== undefined && body.sort_order !== null) {
              const parsedOrder = Number(body.sort_order);
              if (Number.isInteger(parsedOrder) && parsedOrder >= 0 && parsedOrder < 100000) {
                newSortOrder = parsedOrder;
              }
            }

            const updated = updateSegment(segId, {
              name: rawName || existingSeg.name,
              color: hexColor,
              start_time: newStart,
              end_time: newEnd,
              sort_order: newSortOrder,
            });

            serverEvents.emit("segment_updated", { segmentId: segId, trackId: existingSeg.track_id });
            serverEvents.emit("track_updated", { trackId: existingSeg.track_id });
            return Response.json(updated, { headers: corsHeaders });
          } catch (e: any) {
            const isClientErr = e instanceof SyntaxError || e instanceof TypeError;
            return Response.json({ error: e.message || "Failed to update segment" }, { status: isClientErr ? 400 : 500, headers: corsHeaders });
          }
        }
        if (req.method === "DELETE") {
          const existingSeg = getSegment(segId);
          if (!existingSeg) {
            return Response.json({ error: "Segment not found" }, { status: 404, headers: corsHeaders });
          }
          const ok = deleteSegment(segId);
          if (!ok) {
            return Response.json({ error: "Could not delete segment" }, { status: 500, headers: corsHeaders });
          }
          serverEvents.emit("segment_deleted", { segmentId: segId, trackId: existingSeg.track_id });
          serverEvents.emit("track_updated", { trackId: existingSeg.track_id });
          serverEvents.emit("playlist_items_changed", {});
          return Response.json({ success: true }, { headers: corsHeaders });
        }
      }

      // Batch delete segments: /api/segments/batch-delete
      if (url.pathname === "/api/segments/batch-delete" && req.method === "POST") {
        try {
          const body = await parseJsonBody<{ ids?: string[] }>(req, MAX_BATCH_PAYLOAD_BYTES);
          if (!body || !Array.isArray(body.ids)) {
            return Response.json({ error: "ids array is required" }, { status: 400, headers: corsHeaders });
          }
          const validIds = Array.from(new Set(body.ids.filter((id) => typeof id === "string" && id.trim().length > 0)));
          if (validIds.length > MAX_BATCH_LIMIT) {
            return Response.json({ error: `Batch size limit exceeded (max ${MAX_BATCH_LIMIT})` }, { status: 400, headers: corsHeaders });
          }
          if (validIds.length === 0) {
            return Response.json({ success: true, deletedCount: 0 }, { headers: corsHeaders });
          }

          const affectedTrackIds = new Set<string>();
          const segmentTrackMap = new Map<string, string>();
          for (const sid of validIds) {
            const seg = getSegment(sid);
            if (seg) {
              affectedTrackIds.add(seg.track_id);
              segmentTrackMap.set(sid, seg.track_id);
            }
          }

          const deletedCount = deleteSegmentsBatch(validIds);

          for (const sid of validIds) {
            serverEvents.emit("segment_deleted", { segmentId: sid, trackId: segmentTrackMap.get(sid) });
          }
          for (const tid of affectedTrackIds) {
            serverEvents.emit("track_updated", { trackId: tid });
          }
          serverEvents.emit("playlist_items_changed", {});

          return Response.json({ success: true, deletedCount }, { headers: corsHeaders });
        } catch (e: any) {
          const isClientErr = e instanceof SyntaxError || e instanceof TypeError;
          return Response.json({ error: e.message || "Failed to batch delete segments" }, { status: isClientErr ? 400 : 500, headers: corsHeaders });
        }
      }

      // All segments for global shuffle queue
      if (url.pathname === "/api/segments" && req.method === "GET") {
        const segments = listAllSegments();
        return Response.json(segments, { headers: corsHeaders });
      }

      // --- PLAYLIST API ROUTES ---

      // 0. Get playlist memberships for track/segment: /api/playlist-memberships?track_id=...&segment_id=...
      if (url.pathname === "/api/playlist-memberships" && req.method === "GET") {
        const trackId = url.searchParams.get("track_id");
        if (!trackId) {
          return Response.json({ error: "track_id là bắt buộc" }, { status: 400, headers: corsHeaders });
        }
        const segmentId = url.searchParams.get("segment_id");
        try {
          const memberships = getPlaylistMemberships(trackId, segmentId);
          return Response.json(memberships, { headers: corsHeaders });
        } catch (e: any) {
          return Response.json({ error: e.message || "Không thể tải danh sách phát của bài hát" }, { status: 500, headers: corsHeaders });
        }
      }

      // 1. List all playlists
      if (url.pathname === "/api/playlists" && req.method === "GET") {
        try {
          const playlists = listPlaylists();
          return Response.json(playlists, { headers: corsHeaders });
        } catch (e: any) {
          return Response.json({ error: e.message || "Không thể tải danh sách phát" }, { status: 500, headers: corsHeaders });
        }
      }

      // 2. Create playlist
      if (url.pathname === "/api/playlists" && req.method === "POST") {
        try {
          const body = await parseJsonBody<{ name: string }>(req);
          if (typeof body.name !== "string") {
            return Response.json({ error: "Tên danh sách phát phải là chuỗi" }, { status: 400, headers: corsHeaders });
          }
          const rawName = body.name.replace(/[\r\n\t\x00-\x1F\x7F]/g, " ").trim().slice(0, 100);
          if (!rawName) {
            return Response.json({ error: "Tên danh sách phát không được để trống" }, { status: 400, headers: corsHeaders });
          }
          const playlist = createPlaylist(rawName);
          serverEvents.emit("playlist_created", { playlist });
          return Response.json(playlist, { status: 201, headers: corsHeaders });
        } catch (e: any) {
          const isClientErr = e instanceof SyntaxError || e instanceof TypeError;
          return Response.json({ error: e.message || "Không thể tạo danh sách phát" }, { status: isClientErr ? 400 : 500, headers: corsHeaders });
        }
      }

      // 3. Reorder items in playlist: /api/playlists/:id/reorder
      const playlistReorderMatch = url.pathname.match(/^\/api\/playlists\/([^/]+)\/reorder$/);
      if (playlistReorderMatch && req.method === "PUT") {
        let plId: string;
        try {
          plId = decodeURIComponent(playlistReorderMatch[1]);
        } catch {
          return Response.json({ error: "Malformed URI component" }, { status: 400, headers: corsHeaders });
        }
        try {
          const pl = getPlaylist(plId);
          if (!pl) {
            return Response.json({ error: "Playlist không tồn tại" }, { status: 404, headers: corsHeaders });
          }
          const body = await parseJsonBody<{ itemIds: string[] }>(req, MAX_BATCH_PAYLOAD_BYTES);
          if (!Array.isArray(body.itemIds) || !body.itemIds.every((id) => typeof id === "string")) {
            return Response.json({ error: "itemIds phải là mảng string" }, { status: 400, headers: corsHeaders });
          }
          if (body.itemIds.length > MAX_BATCH_LIMIT) {
            return Response.json({ error: `Batch size limit exceeded (max ${MAX_BATCH_LIMIT})` }, { status: 400, headers: corsHeaders });
          }
          if (new Set(body.itemIds).size !== body.itemIds.length) {
            return Response.json({ error: "itemIds không được chứa ID trùng lặp" }, { status: 400, headers: corsHeaders });
          }
          const ok = reorderPlaylistItems(plId, body.itemIds);
          if (!ok) {
            return Response.json({ error: "Không thể cập nhật thứ tự mục hoặc danh sách ID không hợp lệ" }, { status: 400, headers: corsHeaders });
          }
          serverEvents.emit("playlist_items_changed", { playlistId: plId });
          return Response.json({ success: true }, { headers: corsHeaders });
        } catch (e: any) {
          const isClientErr = e instanceof SyntaxError || e instanceof TypeError;
          return Response.json({ error: e.message || "Không thể sắp xếp lại mục" }, { status: isClientErr ? 400 : 500, headers: corsHeaders });
        }
      }

      // 4. Delete item from playlist: /api/playlists/:id/items/:itemId
      const playlistItemDeleteMatch = url.pathname.match(/^\/api\/playlists\/([^/]+)\/items\/([^/]+)$/);
      if (playlistItemDeleteMatch && req.method === "DELETE") {
        let plId: string;
        let itemId: string;
        try {
          plId = decodeURIComponent(playlistItemDeleteMatch[1]);
          itemId = decodeURIComponent(playlistItemDeleteMatch[2]);
        } catch {
          return Response.json({ error: "Malformed URI component" }, { status: 400, headers: corsHeaders });
        }
        const ok = removePlaylistItem(plId, itemId);
        if (!ok) {
          return Response.json({ error: "Mục không tồn tại trong playlist" }, { status: 404, headers: corsHeaders });
        }
        serverEvents.emit("playlist_items_changed", { playlistId: plId });
        return Response.json({ success: true }, { headers: corsHeaders });
      }

      // 5b. Batch add items to playlist: /api/playlists/:id/items/batch
      const playlistBatchItemsMatch = url.pathname.match(/^\/api\/playlists\/([^/]+)\/items\/batch$/);
      if (playlistBatchItemsMatch && req.method === "POST") {
        let plId: string;
        try {
          plId = decodeURIComponent(playlistBatchItemsMatch[1]);
        } catch {
          return Response.json({ error: "Malformed URI component" }, { status: 400, headers: corsHeaders });
        }
        try {
          const body = await parseJsonBody<{ trackIds?: string[]; items?: { track_id: string; segment_id?: string | null }[] }>(req, MAX_BATCH_PAYLOAD_BYTES);
          const pl = getPlaylist(plId);
          if (!pl) {
            return Response.json({ error: "Playlist không tồn tại" }, { status: 404, headers: corsHeaders });
          }

          let itemsToAdd: { trackId: string; segmentId?: string | null }[] = [];
          if (Array.isArray(body.trackIds)) {
            itemsToAdd = body.trackIds
              .filter((id) => typeof id === "string" && id.trim().length > 0)
              .map((id) => ({ trackId: id.trim(), segmentId: null }));
          } else if (Array.isArray(body.items)) {
            itemsToAdd = body.items
              .filter((item) => item && typeof item.track_id === "string" && item.track_id.trim().length > 0)
              .map((item) => ({ trackId: item.track_id.trim(), segmentId: item.segment_id || null }));
          } else {
            return Response.json({ error: "trackIds hoặc items là bắt buộc" }, { status: 400, headers: corsHeaders });
          }

          if (itemsToAdd.length > MAX_BATCH_LIMIT) {
            return Response.json({ error: `Batch size limit exceeded (max ${MAX_BATCH_LIMIT})` }, { status: 400, headers: corsHeaders });
          }

          const added = addPlaylistItemsBatch(plId, itemsToAdd);
          serverEvents.emit("playlist_items_changed", { playlistId: plId });
          return Response.json({ success: true, count: added.length, items: added }, { status: 200, headers: corsHeaders });
        } catch (e: any) {
          const isClientErr = e instanceof SyntaxError || e instanceof TypeError;
          const status = isClientErr ? 400 : 500;
          return Response.json({ error: e.message || "Không thể thêm các mục vào playlist" }, { status, headers: corsHeaders });
        }
      }

      // 5c. Batch remove items from playlist: /api/playlists/:id/items/batch-delete
      const playlistBatchDeleteMatch = url.pathname.match(/^\/api\/playlists\/([^/]+)\/items\/batch-delete$/);
      if (playlistBatchDeleteMatch && req.method === "POST") {
        let plId: string;
        try {
          plId = decodeURIComponent(playlistBatchDeleteMatch[1]);
        } catch {
          return Response.json({ error: "Malformed URI component" }, { status: 400, headers: corsHeaders });
        }
        try {
          const pl = getPlaylist(plId);
          if (!pl) {
            return Response.json({ error: "Playlist không tồn tại" }, { status: 404, headers: corsHeaders });
          }
          const body = await parseJsonBody<{ itemIds?: string[] }>(req, MAX_BATCH_PAYLOAD_BYTES);
          if (!body || !Array.isArray(body.itemIds)) {
            return Response.json({ error: "itemIds array is required" }, { status: 400, headers: corsHeaders });
          }
          const validIds = Array.from(new Set(body.itemIds.filter((id) => typeof id === "string" && id.trim().length > 0)));
          if (validIds.length > MAX_BATCH_LIMIT) {
            return Response.json({ error: `Batch size limit exceeded (max ${MAX_BATCH_LIMIT})` }, { status: 400, headers: corsHeaders });
          }
          const deletedCount = removePlaylistItemsBatch(plId, validIds);
          serverEvents.emit("playlist_items_changed", { playlistId: plId });
          return Response.json({ success: true, deletedCount }, { headers: corsHeaders });
        } catch (e: any) {
          const isClientErr = e instanceof SyntaxError || e instanceof TypeError;
          return Response.json({ error: e.message || "Không thể xóa các mục khỏi playlist" }, { status: isClientErr ? 400 : 500, headers: corsHeaders });
        }
      }

      // 5. Add item to playlist: /api/playlists/:id/items
      const playlistItemsMatch = url.pathname.match(/^\/api\/playlists\/([^/]+)\/items$/);
      if (playlistItemsMatch && req.method === "POST") {
        let plId: string;
        try {
          plId = decodeURIComponent(playlistItemsMatch[1]);
        } catch {
          return Response.json({ error: "Malformed URI component" }, { status: 400, headers: corsHeaders });
        }
        try {
          const body = await parseJsonBody<{ track_id: string; segment_id?: string | null }>(req);
          if (!body.track_id || typeof body.track_id !== "string" || !body.track_id.trim()) {
            return Response.json({ error: "track_id là bắt buộc" }, { status: 400, headers: corsHeaders });
          }
          const cleanTrackId = body.track_id.trim();
          const pl = getPlaylist(plId);
          if (!pl) {
            return Response.json({ error: "Playlist không tồn tại" }, { status: 404, headers: corsHeaders });
          }
          const track = getTrack(cleanTrackId);
          if (!track) {
            return Response.json({ error: "Bài hát không tồn tại" }, { status: 404, headers: corsHeaders });
          }
          if (body.segment_id !== undefined && body.segment_id !== null && typeof body.segment_id !== "string") {
            return Response.json({ error: "segment_id phải là chuỗi hoặc null" }, { status: 400, headers: corsHeaders });
          }
          const cleanSegId = typeof body.segment_id === "string" && body.segment_id.trim() ? body.segment_id.trim() : null;
          if (cleanSegId) {
            const seg = getSegment(cleanSegId);
            if (!seg || seg.track_id !== cleanTrackId) {
              return Response.json({ error: "Lát cắt không tồn tại hoặc không thuộc bài hát này" }, { status: 400, headers: corsHeaders });
            }
          }
          const item = addPlaylistItem(plId, cleanTrackId, cleanSegId);
          serverEvents.emit("playlist_items_changed", { playlistId: plId });
          return Response.json(item, { status: 201, headers: corsHeaders });
        } catch (e: any) {
          const isClientErr = e instanceof SyntaxError || e instanceof TypeError || (e instanceof Error && (e.message.includes("not found") || e.message.includes("does not belong") || e.message.toLowerCase().includes("constraint")));
          const status = e.message?.includes("not found") ? 404 : isClientErr ? 400 : 500;
          return Response.json({ error: e.message || "Không thể thêm mục vào playlist" }, { status, headers: corsHeaders });
        }
      }

      // 6. Individual playlist details, update, delete: /api/playlists/:id
      const playlistDetailMatch = url.pathname.match(/^\/api\/playlists\/([^/]+)$/);
      if (playlistDetailMatch) {
        let plId: string;
        try {
          plId = decodeURIComponent(playlistDetailMatch[1]);
        } catch {
          return Response.json({ error: "Malformed URI component" }, { status: 400, headers: corsHeaders });
        }
        if (req.method === "GET") {
          try {
            const pl = getPlaylist(plId);
            if (!pl) return Response.json({ error: "Playlist không tồn tại" }, { status: 404, headers: corsHeaders });
            const items = getPlaylistItems(plId);
            return Response.json({ ...pl, items }, { headers: corsHeaders });
          } catch (e: any) {
            return Response.json({ error: e.message || "Lỗi tải playlist" }, { status: 500, headers: corsHeaders });
          }
        }
        if (req.method === "PATCH") {
          try {
            const body = await parseJsonBody<{ name: string }>(req);
            if (typeof body.name !== "string") {
              return Response.json({ error: "Tên danh sách phát phải là chuỗi" }, { status: 400, headers: corsHeaders });
            }
            const rawName = body.name.replace(/[\r\n\t\x00-\x1F\x7F]/g, " ").trim().slice(0, 100);
            if (!rawName) {
              return Response.json({ error: "Tên danh sách phát không được để trống" }, { status: 400, headers: corsHeaders });
            }
            const updated = updatePlaylist(plId, rawName);
            if (!updated) return Response.json({ error: "Playlist không tồn tại" }, { status: 404, headers: corsHeaders });
            serverEvents.emit("playlist_updated", { playlistId: updated.id, playlist: updated });
            return Response.json(updated, { headers: corsHeaders });
          } catch (e: any) {
            const isClientErr = e instanceof SyntaxError || e instanceof TypeError || (e instanceof Error && e.message.includes("cannot be empty"));
            return Response.json({ error: e.message || "Không thể đổi tên danh sách phát" }, { status: isClientErr ? 400 : 500, headers: corsHeaders });
          }
        }
        if (req.method === "DELETE") {
          try {
            const ok = deletePlaylist(plId);
            if (!ok) {
              return Response.json({ error: "Playlist không tồn tại" }, { status: 404, headers: corsHeaders });
            }
            serverEvents.emit("playlist_deleted", { playlistId: plId });
            return Response.json({ success: true }, { headers: corsHeaders });
          } catch (e: any) {
            return Response.json({ error: e.message || "Lỗi xóa playlist" }, { status: 500, headers: corsHeaders });
          }
        }
      }

      // 7. System Logs API: /api/logs
      if (url.pathname === "/api/logs") {
        if (req.method === "GET") {
          const limit = Number(url.searchParams.get("limit")) || 100;
          return Response.json(getRecentLogs(limit), { headers: corsHeaders });
        }
        if (req.method === "DELETE") {
          clearServerLogs();
          serverEvents.emit("logs_cleared");
          return Response.json({ success: true }, { headers: corsHeaders });
        }
      }

      // 8. Library Export & Import API
      if (url.pathname === "/api/library/export" && req.method === "GET") {
        try {
          const archiveBytes = await exportLibraryArchive();
          const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
          return new Response(archiveBytes as unknown as BodyInit, {
            status: 200,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/gzip",
              "Content-Disposition": `attachment; filename="slice-player-backup-${timestamp}.tar.gz"`,
              "Content-Length": String(archiveBytes.length),
            },
          });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          return Response.json({ error: `Lỗi xuất dữ liệu thư viện: ${msg}` }, { status: 500, headers: corsHeaders });
        }
      }

      if (url.pathname === "/api/library/import" && req.method === "POST") {
        try {
          let archiveBytes: Uint8Array | null = null;
          const contentType = req.headers.get("content-type") || "";

          if (contentType.includes("multipart/form-data")) {
            const formData = await req.formData();
            const file = formData.get("file") || formData.get("backup");
            if (file && file instanceof Blob) {
              archiveBytes = new Uint8Array(await file.arrayBuffer());
            }
          } else {
            archiveBytes = new Uint8Array(await req.arrayBuffer());
          }

          if (!archiveBytes || archiveBytes.length < 50) {
            return Response.json({ error: "File backup không hợp lệ hoặc bị rỗng" }, { status: 400, headers: corsHeaders });
          }

          const res = await importLibraryArchive(archiveBytes);
          return Response.json(res, { status: 200, headers: corsHeaders });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          return Response.json({ error: msg }, { status: 400, headers: corsHeaders });
        }
      }

      return Response.json({ error: "API endpoint not found" }, { status: 404, headers: corsHeaders });
    }

    // --- STATIC FRONTEND ASSETS ---
    // Protected against path traversal with separator verification and case normalization on Windows
    const distDir = resolve("./dist");
    const securityHeaders = {
      "Content-Security-Policy": corsHeaders["Content-Security-Policy"],
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
    };

    let rawRel = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    let relativePath: string;
    try {
      relativePath = decodeURIComponent(rawRel);
    } catch {
      return new Response("Bad Request", {
        status: 400,
        headers: { ...securityHeaders, "Content-Type": "text/plain; charset=utf-8" },
      });
    }
    const safePath = resolve(distDir, relativePath);
    const isInside = process.platform === "win32"
      ? safePath.toLowerCase() === distDir.toLowerCase() || safePath.toLowerCase().startsWith(distDir.toLowerCase() + sep)
      : safePath === distDir || safePath.startsWith(distDir + sep);

    try {
      if (isInside && existsSync(safePath) && statSync(safePath).isFile()) {
        const ext = extname(safePath).toLowerCase();
        const ct = mimeTypes[ext] || "application/octet-stream";
        const isAsset = safePath.includes(`${sep}assets${sep}`);
        const cacheControl = isAsset ? "public, max-age=31536000, immutable" : "no-cache";
        return new Response(bunFile(safePath), {
          headers: {
            ...securityHeaders,
            "Content-Type": ct,
            "Cache-Control": cacheControl,
          },
        });
      }
    } catch {}

    // Fallback to dist/index.html ONLY for navigation requests (HTML/routes)
    const isNavRequest = !extname(url.pathname) || req.headers.get("accept")?.includes("text/html");
    const fallbackIndex = join(distDir, "index.html");
    if (isNavRequest && existsSync(fallbackIndex)) {
      return new Response(bunFile(fallbackIndex), {
        headers: {
          ...securityHeaders,
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-cache",
        },
      });
    }

    if (!isNavRequest) {
      return new Response("Not Found", {
        status: 404,
        headers: { ...securityHeaders, "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    return new Response("Slice Player Backend Running. Frontend is being built...", {
      headers: { ...securityHeaders, "Content-Type": "text/plain; charset=utf-8" },
    });
  },

  websocket: {
    idleTimeout: 30,
    open(ws) {
      activeSockets.add(ws);
      hasHadInitialConnection = true;
      if (shutdownTimer) {
        clearTimeout(shutdownTimer);
        shutdownTimer = null;
      }
      ws.send(JSON.stringify({ type: "connected" }));
    },
    message(ws, message) {
      // heartbeat ping/pong
      if (message === "ping") {
        ws.send("pong");
      }
    },
    close(ws) {
      activeSockets.delete(ws);
      checkIdleShutdown();
    },
  },
});

function checkIdleShutdown() {
  if (process.env.NODE_ENV !== "production") return;
  if (!hasHadInitialConnection) return;
  for (const ws of activeSockets) {
    if (ws.readyState !== 1) {
      activeSockets.delete(ws);
    }
  }
  if (activeSockets.size === 0 && !shutdownTimer) {
    shutdownTimer = setTimeout(() => {
      for (const ws of activeSockets) {
        if (ws.readyState !== 1) {
          activeSockets.delete(ws);
        }
      }
      if (activeSockets.size === 0 && !isIngestBusy()) {
        gracefulShutdown();
      } else {
        shutdownTimer = null;
        checkIdleShutdown();
      }
    }, 60000);
  }
}

export function broadcastWs(msg: object) {
  let payload: string;
  try {
    payload = JSON.stringify(msg);
  } catch {
    try {
      const seen = new WeakSet();
      payload = JSON.stringify(msg, (_k, v) => {
        if (typeof v === "object" && v !== null) {
          if (seen.has(v)) return "[Circular]";
          seen.add(v);
        }
        if (typeof v === "bigint") return v.toString();
        return v;
      });
    } catch {
      return;
    }
  }
  for (const ws of [...activeSockets]) {
    try {
      if (ws.readyState === 1) {
        ws.send(payload);
      } else {
        activeSockets.delete(ws);
      }
    } catch {
      activeSockets.delete(ws);
    }
  }
  checkIdleShutdown();
}

serverEvents.on("track_updated", (payload) => {
  broadcastWs({ type: "track_updated", ...payload });
});
serverEvents.on("track_created", (payload) => {
  broadcastWs({ type: "track_created", ...payload });
});
serverEvents.on("track_deleted", (payload) => {
  broadcastWs({ type: "track_deleted", ...payload });
});
serverEvents.on("segment_deleted", (payload) => {
  broadcastWs({ type: "segment_deleted", ...payload });
});
serverEvents.on("segment_updated", (payload) => {
  broadcastWs({ type: "segment_updated", ...payload });
});
serverEvents.on("playlist_created", (payload) => {
  broadcastWs({ type: "playlist_created", ...payload });
});
serverEvents.on("playlist_updated", (payload) => {
  broadcastWs({ type: "playlist_updated", ...payload });
});
serverEvents.on("playlist_deleted", (payload) => {
  broadcastWs({ type: "playlist_deleted", ...payload });
});
serverEvents.on("playlist_items_changed", (payload) => {
  broadcastWs({ type: "playlist_items_changed", ...payload });
});
serverEvents.on("app_log", (payload) => {
  broadcastWs({ type: "app_log", ...payload });
});
serverEvents.on("logs_cleared", () => {
  broadcastWs({ type: "logs_cleared" });
});
serverEvents.on("library_restored", (payload) => {
  broadcastWs({ type: "library_restored", ...payload });
});

export { server };

