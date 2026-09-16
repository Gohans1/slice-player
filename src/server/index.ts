import { serve, file as bunFile } from "bun";
import { existsSync, statSync, unlinkSync } from "node:fs";
import { resolve, join, extname, sep } from "node:path";
import { initDatabase, closeDatabase, getTrack, listTracks, deleteTrack, getSegment, createSegment, updateSegment, deleteSegment, listSegmentsByTrack, listAllSegments } from "./db";
import { ingestYouTubeUrl, ingestLocalFile, abortIngestProcesses, cancelDownloadIfActive, unlinkWithRetry } from "./ingest";
import { abortWaveformProcesses, cancelWaveformForFile } from "./waveform";
import { serverEvents } from "./events";
import type { Segment } from "./types";

const PORT = Number(process.env.PORT) || 3000;

// Initialize SQLite database
initDatabase("./data/music.db");

console.log(`[Server] Starting Slice Player on http://127.0.0.1:${PORT}`);

const activeSockets = new Set<any>();
let shutdownTimer: Timer | null = process.env.NODE_ENV === "production" ? setTimeout(() => {
  if (activeSockets.size === 0) {
    console.log("[Server] No client connected within 60s of startup. Exiting.");
    gracefulShutdown();
  }
}, 60000) : null;

async function gracefulShutdown() {
  console.log("[Server] Shutting down cleanly: closing DB and stopping workers.");
  server.stop(true);
  await abortIngestProcesses();
  await abortWaveformProcesses();
  closeDatabase();
  process.exit(0);
}

process.on("SIGINT", () => { gracefulShutdown(); });
process.on("SIGTERM", () => { gracefulShutdown(); });

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

async function parseJsonBody<T = Record<string, any>>(req: Request): Promise<T> {
  const parsed = await req.json();
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError("Invalid JSON: expected an object");
  }
  return parsed as T;
}

const server = serve({
  hostname: "127.0.0.1",
  port: PORT,
  async fetch(req, server) {
    const url = new URL(req.url);

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
      ...(isDev ? ["127.0.0.1:5173", "localhost:5173", "[::1]:5173"] : []),
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
      const upgraded = server.upgrade(req);
      if (upgraded) return undefined;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    const corsHeaders = {
      "Access-Control-Allow-Origin": origin || `http://127.0.0.1:${PORT}`,
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges",
      "Content-Security-Policy": "default-src 'self'; media-src 'self' blob:; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self' blob:; worker-src blob:;",
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
        if (!rawLen) {
          return Response.json(
            { error: "Content-Length header is required for mutating requests" },
            { status: 411, headers: corsHeaders }
          );
        }
        const contentLength = Number(rawLen);
        if (!Number.isFinite(contentLength) || contentLength <= 0 || contentLength > 65536) {
          return Response.json(
            { error: "Payload too large or invalid length (max 64KB)" },
            { status: 413, headers: corsHeaders }
          );
        }
      }

      // 1. Tracks API
      if (url.pathname === "/api/tracks" && req.method === "GET") {
        const tracks = listTracks();
        return Response.json(tracks, { headers: corsHeaders });
      }

      if (url.pathname === "/api/tracks/ingest-youtube" && req.method === "POST") {
        try {
          const body = await parseJsonBody<{ url?: string }>(req);
          if (!body.url) return Response.json({ error: "Missing YouTube URL" }, { status: 400, headers: corsHeaders });
          const res = await ingestYouTubeUrl(body.url);
          return Response.json(res, { status: res.success ? 200 : 400, headers: corsHeaders });
        } catch (err: unknown) {
          const isClientErr = err instanceof SyntaxError || err instanceof TypeError;
          const msg = err instanceof Error ? err.message : String(err);
          return Response.json({ error: msg }, { status: isClientErr ? 400 : 500, headers: corsHeaders });
        }
      }

      if (url.pathname === "/api/tracks/ingest-local" && req.method === "POST") {
        try {
          const body = await parseJsonBody<{ path?: string }>(req);
          if (!body.path) return Response.json({ error: "Missing file path" }, { status: 400, headers: corsHeaders });
          const res = await ingestLocalFile(body.path);
          return Response.json(res, { status: res.success ? 200 : 400, headers: corsHeaders });
        } catch (err: unknown) {
          const isClientErr = err instanceof SyntaxError || err instanceof TypeError;
          const msg = err instanceof Error ? err.message : String(err);
          return Response.json({ error: msg }, { status: isClientErr ? 400 : 500, headers: corsHeaders });
        }
      }

      // Track detail & delete
      const trackMatch = url.pathname.match(/^\/api\/tracks\/([^/]+)$/);
      if (trackMatch) {
        const trackId = trackMatch[1];
        if (req.method === "GET") {
          const track = getTrack(trackId);
          if (!track) return Response.json({ error: "Track not found" }, { status: 404, headers: corsHeaders });
          return Response.json(track, { headers: corsHeaders });
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
          const ok = deleteTrack(trackId);
          if (!ok) {
            return Response.json({ error: "Could not delete track from database" }, { status: 500, headers: corsHeaders });
          }
          serverEvents.emit("track_deleted", { trackId });

          // ONLY unlink audio file if it is a cached YouTube download strictly within ./data/cache/audio/
          if (track.source_type === "youtube" && track.file_path) {
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
          return Response.json({ success: true }, { headers: corsHeaders });
        }
      }

      // 2. Audio Stream API (HTTP 206 Partial Content handled natively by Bun)
      const streamMatch = url.pathname.match(/^\/api\/tracks\/([^/]+)\/stream$/);
      if (streamMatch && (req.method === "GET" || req.method === "HEAD")) {
        const trackId = streamMatch[1];
        const track = getTrack(trackId);
        if (!track || !track.file_path) {
          return new Response("Audio file not available or not downloaded yet", { status: 404, headers: corsHeaders });
        }

        const audioFile = bunFile(track.file_path);
        if (!(await audioFile.exists())) {
          return new Response("Audio file missing on disk", { status: 404, headers: corsHeaders });
        }

        const ext = extname(track.file_path).toLowerCase();
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
      const thumbMatch = url.pathname.match(/^\/api\/thumbs\/([a-zA-Z0-9_-]+)$/);
      if (thumbMatch && req.method === "GET") {
        const thumbId = thumbMatch[1];
        const allowedThumbsDir = resolve("./data/cache/thumbs");
        for (const ext of [".jpg", ".png", ".webp"]) {
          const thumbPath = resolve(allowedThumbsDir, `${thumbId}${ext}`);
          if (isSubdirectoryOf(allowedThumbsDir, thumbPath) && existsSync(thumbPath)) {
            const ct = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
            return new Response(bunFile(thumbPath), {
              headers: { ...corsHeaders, "Content-Type": ct },
            });
          }
        }
        return new Response("Thumbnail not found", { status: 404, headers: corsHeaders });
      }

      // 4. Segments API
      const trackSegmentsMatch = url.pathname.match(/^\/api\/tracks\/([^/]+)\/segments$/);
      if (trackSegmentsMatch) {
        const trackId = trackSegmentsMatch[1];
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
            const startTime = Number(body.start_time);
            let endTime = Number(body.end_time);
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
            if (endTime > 1800 || (track.duration > 0 && endTime > track.duration + 0.1)) {
              return Response.json({ error: `end_time (${endTime}s) vượt quá thời lượng bài hát hoặc giới hạn 30 phút` }, { status: 400, headers: corsHeaders });
            }
            const rawName = String(body.name || "").trim().slice(0, 100);
            if (!rawName) {
              return Response.json({ error: "Tên đoạn không được để trống" }, { status: 400, headers: corsHeaders });
            }
            const hexColor = typeof body.color === "string" && /^#[0-9a-fA-F]{6}$/.test(body.color) ? body.color : "#4385BE";
            const created = createSegment({
              id: `seg_${crypto.randomUUID()}`,
              track_id: trackId,
              name: rawName,
              start_time: startTime,
              end_time: endTime,
              color: hexColor,
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

            const newStart = body.start_time !== undefined ? Number(body.start_time) : existingSeg.start_time;
            let newEnd = body.end_time !== undefined ? Number(body.end_time) : existingSeg.end_time;

            const track = getTrack(existingSeg.track_id);
            if (!track) {
              return Response.json({ error: "Associated track not found" }, { status: 404, headers: corsHeaders });
            }
            if (track.duration > 0 && newEnd > track.duration && newEnd <= track.duration + 0.5) {
              newEnd = track.duration;
            }

            if (!Number.isFinite(newStart) || !Number.isFinite(newEnd) || newStart < 0 || newEnd - newStart < 0.5) {
              return Response.json({ error: "start_time phải >= 0 và thời lượng tối thiểu 0.5s" }, { status: 400, headers: corsHeaders });
            }

            if (newEnd > 1800 || (track.duration > 0 && newEnd > track.duration + 0.1)) {
              return Response.json(
                { error: `end_time (${newEnd}s) vượt quá thời lượng bài hát hoặc giới hạn 30 phút` },
                { status: 400, headers: corsHeaders }
              );
            }

            const rawName = body.name !== undefined ? String(body.name).trim().slice(0, 100) : existingSeg.name;
            const hexColor = typeof body.color === "string" && /^#[0-9a-fA-F]{6}$/.test(body.color) ? body.color : existingSeg.color;

            const updated = updateSegment(segId, {
              ...body,
              name: rawName || existingSeg.name,
              color: hexColor,
              start_time: newStart,
              end_time: newEnd,
            });

            serverEvents.emit("track_updated", { trackId: existingSeg.track_id });
            return Response.json(updated, { headers: corsHeaders });
          } catch (e: any) {
            const isClientErr = e instanceof SyntaxError || e instanceof TypeError;
            return Response.json({ error: e.message || "Failed to update segment" }, { status: isClientErr ? 400 : 500, headers: corsHeaders });
          }
        }
        if (req.method === "DELETE") {
          const existingSeg = getSegment(segId);
          const ok = deleteSegment(segId);
          if (existingSeg) {
            serverEvents.emit("segment_deleted", { segmentId: segId, trackId: existingSeg.track_id });
            serverEvents.emit("track_updated", { trackId: existingSeg.track_id });
          }
          return Response.json({ success: ok }, { headers: corsHeaders });
        }
      }

      // All segments for global shuffle queue
      if (url.pathname === "/api/segments" && req.method === "GET") {
        const segments = listAllSegments();
        return Response.json(segments, { headers: corsHeaders });
      }

      return Response.json({ error: "API endpoint not found" }, { status: 404, headers: corsHeaders });
    }

    // --- STATIC FRONTEND ASSETS ---
    // Protected against path traversal with separator verification and case normalization on Windows
    const distDir = resolve("./dist");
    let rawRel = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    let relativePath: string;
    try {
      relativePath = decodeURIComponent(rawRel);
    } catch {
      return new Response("Bad Request", { status: 400 });
    }
    const safePath = resolve(distDir, relativePath);
    const isInside = process.platform === "win32"
      ? safePath.toLowerCase() === distDir.toLowerCase() || safePath.toLowerCase().startsWith(distDir.toLowerCase() + sep)
      : safePath === distDir || safePath.startsWith(distDir + sep);

    try {
      if (isInside && existsSync(safePath) && statSync(safePath).isFile()) {
        const ext = extname(safePath).toLowerCase();
        const ct = mimeTypes[ext] || "application/octet-stream";
        return new Response(bunFile(safePath), {
          headers: { "Content-Type": ct },
        });
      }
    } catch {}

    // Fallback to dist/index.html ONLY for navigation requests (HTML/routes)
    const isNavRequest = !extname(url.pathname) || req.headers.get("accept")?.includes("text/html");
    const fallbackIndex = join(distDir, "index.html");
    if (isNavRequest && existsSync(fallbackIndex)) {
      return new Response(bunFile(fallbackIndex), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    if (!isNavRequest) {
      return new Response("Not Found", { status: 404 });
    }

    return new Response("Slice Player Backend Running. Frontend is being built...", {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  },

  websocket: {
    idleTimeout: 255,
    open(ws) {
      activeSockets.add(ws);
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
  if (activeSockets.size === 0 && !shutdownTimer) {
    shutdownTimer = setTimeout(async () => {
      const { isIngestBusy } = await import("./ingest");
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
  const payload = JSON.stringify(msg);
  for (const ws of activeSockets) {
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

export { server };
