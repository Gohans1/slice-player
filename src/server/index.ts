import { serve, file as bunFile } from "bun";
import { existsSync, statSync, unlinkSync } from "node:fs";
import { resolve, join, extname, sep } from "node:path";
import { initDatabase, closeDatabase, getTrack, listTracks, deleteTrack, getSegment, createSegment, updateSegment, deleteSegment, listSegmentsByTrack, listAllSegments } from "./db";
import { ingestYouTubeUrl, ingestLocalFile, abortIngestProcesses, cancelDownloadIfActive } from "./ingest";
import { serverEvents } from "./events";
import type { Segment } from "./types";

const PORT = Number(process.env.PORT) || 3000;
const SESSION_TOKEN = crypto.randomUUID();

// Initialize SQLite database
initDatabase("./data/music.db");

console.log(`[Server] Starting Slice Player on http://127.0.0.1:${PORT}`);
console.log(`[Server] Session Token: ${SESSION_TOKEN}`);

const activeSockets = new Set<any>();
let shutdownTimer: Timer | null = null;

async function gracefulShutdown() {
  console.log("[Server] Shutting down cleanly: closing DB and stopping workers.");
  await abortIngestProcesses();
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
};

const server = serve({
  hostname: "127.0.0.1",
  port: PORT,
  async fetch(req, server) {
    const url = new URL(req.url);

    // Prevent cross-site subresource leakage
    const secFetchSite = req.headers.get("sec-fetch-site");
    if (secFetchSite === "cross-site") {
      return new Response("Forbidden: Cross-site requests rejected", { status: 403 });
    }

    // Host header validation to prevent DNS rebinding attacks
    const host = req.headers.get("host");
    const allowedHosts = [
      `127.0.0.1:${PORT}`,
      `localhost:${PORT}`,
      `[::1]:${PORT}`,
      "127.0.0.1:5173",
      "localhost:5173",
      "[::1]:5173",
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
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "http://[::1]:5173",
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
    };

    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // --- API ROUTES ---
    if (url.pathname.startsWith("/api/")) {
      // 1. Tracks API
      if (url.pathname === "/api/tracks" && req.method === "GET") {
        const tracks = listTracks();
        return Response.json(tracks, { headers: corsHeaders });
      }

      if (url.pathname === "/api/tracks/ingest-youtube" && req.method === "POST") {
        try {
          const body = (await req.json()) as { url?: string };
          if (!body.url) return Response.json({ error: "Missing YouTube URL" }, { status: 400, headers: corsHeaders });
          const res = await ingestYouTubeUrl(body.url);
          return Response.json(res, { status: res.success ? 200 : 400, headers: corsHeaders });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          return Response.json({ error: msg }, { status: 500, headers: corsHeaders });
        }
      }

      if (url.pathname === "/api/tracks/ingest-local" && req.method === "POST") {
        try {
          const body = (await req.json()) as { path?: string };
          if (!body.path) return Response.json({ error: "Missing file path" }, { status: 400, headers: corsHeaders });
          const res = await ingestLocalFile(body.path);
          return Response.json(res, { status: res.success ? 200 : 400, headers: corsHeaders });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          return Response.json({ error: msg }, { status: 500, headers: corsHeaders });
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
          cancelDownloadIfActive(trackId);
          const track = getTrack(trackId);
          if (track) {
            // ONLY unlink audio file if it is a cached YouTube download strictly within ./data/cache/audio/
            if (track.source_type === "youtube" && track.file_path) {
              const cacheAudioDir = resolve("./data/cache/audio");
              const resolvedAudio = resolve(track.file_path);
              if (resolvedAudio.startsWith(cacheAudioDir + sep) && existsSync(resolvedAudio)) {
                try { unlinkSync(resolvedAudio); } catch {}
              }
            }
            // Unlink thumbnail if local cache
            const cacheThumbsDir = resolve("./data/cache/thumbs");
            const thumbPath = resolve(cacheThumbsDir, `${track.id}.jpg`);
            if (thumbPath.startsWith(cacheThumbsDir + sep) && existsSync(thumbPath)) {
              try { unlinkSync(thumbPath); } catch {}
            }
          }
          const ok = deleteTrack(trackId);
          return Response.json({ success: ok }, { headers: corsHeaders });
        }
      }

      // 2. Audio Stream API (HTTP 206 Partial Content handled natively by Bun)
      const streamMatch = url.pathname.match(/^\/api\/tracks\/([^/]+)\/stream$/);
      if (streamMatch && req.method === "GET") {
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
            "Accept-Ranges": "bytes",
          },
        });
      }

      // 3. Local Thumbnail API (Sanitized against directory traversal)
      const thumbMatch = url.pathname.match(/^\/api\/thumbs\/([a-zA-Z0-9_-]+)$/);
      if (thumbMatch && req.method === "GET") {
        const thumbId = thumbMatch[1];
        const allowedThumbsDir = resolve("./data/cache/thumbs");
        const thumbPath = resolve(allowedThumbsDir, `${thumbId}.jpg`);
        if (thumbPath.startsWith(allowedThumbsDir + sep) && existsSync(thumbPath)) {
          return new Response(bunFile(thumbPath), {
            headers: { ...corsHeaders, "Content-Type": "image/jpeg" },
          });
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
            const body = (await req.json()) as Partial<Segment>;
            if (!body.name || body.start_time === undefined || body.end_time === undefined) {
              return Response.json({ error: "Missing segment fields" }, { status: 400, headers: corsHeaders });
            }
            const startTime = Number(body.start_time);
            const endTime = Number(body.end_time);
            const track = getTrack(trackId);
            if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || startTime < 0 || endTime - startTime < 0.5) {
              return Response.json({ error: "start_time phải >= 0 và thời lượng tối thiểu 0.5s" }, { status: 400, headers: corsHeaders });
            }
            if (track && track.duration > 0 && endTime > track.duration + 0.1) {
              return Response.json({ error: `end_time (${endTime}s) exceeds track duration (${track.duration}s)` }, { status: 400, headers: corsHeaders });
            }
            const created = createSegment({
              id: `seg_${crypto.randomUUID().slice(0, 8)}`,
              track_id: trackId,
              name: body.name,
              start_time: startTime,
              end_time: endTime,
              color: body.color || "#4385BE",
            });
            serverEvents.emit("track_updated", { trackId });
            return Response.json(created, { headers: corsHeaders });
          } catch (e: any) {
            return Response.json({ error: e.message || "Failed to create segment" }, { status: 400, headers: corsHeaders });
          }
        }
      }

      // Individual segment update / delete
      const segmentDetailMatch = url.pathname.match(/^\/api\/segments\/([^/]+)$/);
      if (segmentDetailMatch) {
        const segId = segmentDetailMatch[1];
        if (req.method === "PUT") {
          try {
            const body = (await req.json()) as Partial<Segment>;
            const existingSeg = getSegment(segId);
            if (!existingSeg) return Response.json({ error: "Segment not found" }, { status: 404, headers: corsHeaders });

            const newStart = body.start_time !== undefined ? Number(body.start_time) : existingSeg.start_time;
            const newEnd = body.end_time !== undefined ? Number(body.end_time) : existingSeg.end_time;

            if (!Number.isFinite(newStart) || !Number.isFinite(newEnd) || newStart < 0 || newEnd - newStart < 0.5) {
              return Response.json({ error: "start_time phải >= 0 và thời lượng tối thiểu 0.5s" }, { status: 400, headers: corsHeaders });
            }

            const track = getTrack(existingSeg.track_id);
            if (track && track.duration > 0 && newEnd > track.duration + 0.1) {
              return Response.json(
                { error: `end_time (${newEnd}s) vượt quá thời lượng bài hát (${track.duration}s)` },
                { status: 400, headers: corsHeaders }
              );
            }

            const updated = updateSegment(segId, {
              ...body,
              start_time: newStart,
              end_time: newEnd,
            });
            serverEvents.emit("track_updated", { trackId: existingSeg.track_id });
            return Response.json(updated, { headers: corsHeaders });
          } catch (e: any) {
            return Response.json({ error: e.message || "Failed to update segment" }, { status: 400, headers: corsHeaders });
          }
        }
        if (req.method === "DELETE") {
          const existingSeg = getSegment(segId);
          const ok = deleteSegment(segId);
          if (existingSeg) {
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
    // Protected against path traversal with separator verification
    const distDir = resolve("./dist");
    let relativePath = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const safePath = resolve(distDir, relativePath);
    const isInside = safePath === distDir || safePath.startsWith(distDir + sep);

    if (isInside && existsSync(safePath) && statSync(safePath).isFile()) {
      const ext = extname(safePath).toLowerCase();
      const ct = mimeTypes[ext] || "application/octet-stream";
      return new Response(bunFile(safePath), {
        headers: { "Content-Type": ct },
      });
    }

    // Fallback to dist/index.html for SPA routing if dist exists
    const fallbackIndex = join(distDir, "index.html");
    if (existsSync(fallbackIndex)) {
      return new Response(bunFile(fallbackIndex), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
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
      ws.send(JSON.stringify({ type: "connected", token: SESSION_TOKEN }));
    },
    message(ws, message) {
      // heartbeat ping/pong
      if (message === "ping") {
        ws.send("pong");
      }
    },
    close(ws) {
      activeSockets.delete(ws);
      if (activeSockets.size === 0) {
        // Shutdown after 10s of no active clients
        shutdownTimer = setTimeout(() => {
          gracefulShutdown();
        }, 10000);
      }
    },
  },
});

export function broadcastWs(msg: object) {
  const payload = JSON.stringify(msg);
  for (const ws of activeSockets) {
    try {
      ws.send(payload);
    } catch {}
  }
}

serverEvents.on("track_updated", (payload) => {
  broadcastWs({ type: "track_updated", ...payload });
});
serverEvents.on("track_created", (payload) => {
  broadcastWs({ type: "track_created", ...payload });
});

export { server };
