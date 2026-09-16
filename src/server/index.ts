import { serve, file as bunFile } from "bun";
import { existsSync, statSync, unlinkSync } from "node:fs";
import { resolve, join, extname, sep } from "node:path";
import { initDatabase, closeDatabase, getDb, getTrack, listTracks, deleteTrack, createSegment, updateSegment, deleteSegment, listSegmentsByTrack, listAllSegments } from "./db";
import { ingestYouTubeUrl, ingestLocalFile, abortIngestProcesses } from "./ingest";
import type { Segment } from "./types";

const PORT = Number(process.env.PORT) || 3000;
const SESSION_TOKEN = crypto.randomUUID();

// Initialize SQLite database
initDatabase("./data/music.db");

console.log(`[Server] Starting Slice Player on http://127.0.0.1:${PORT}`);
console.log(`[Server] Session Token: ${SESSION_TOKEN}`);

// Client connection tracking for auto-shutdown when window closes
let connectedClients = 0;
let shutdownTimer: Timer | null = null;

function gracefulShutdown() {
  console.log("[Server] Shutting down cleanly: closing DB and stopping workers.");
  abortIngestProcesses();
  closeDatabase();
  process.exit(0);
}

process.on("SIGINT", gracefulShutdown);
process.on("SIGTERM", gracefulShutdown);

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

    // WebSocket upgrade
    if (url.pathname === "/ws") {
      const upgraded = server.upgrade(req);
      if (upgraded) return undefined;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    // CORS & Origin validation (strict loopback only)
    const origin = req.headers.get("origin");
    const allowedOrigins = [
      `http://127.0.0.1:${PORT}`,
      `http://localhost:${PORT}`,
      "http://localhost:5173",
      "http://127.0.0.1:5173",
    ];

    if (origin && !allowedOrigins.includes(origin)) {
      return new Response("Forbidden: Cross-origin request not allowed", { status: 403 });
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

        // Returning Bun.file() automatically parses the Range header and serves HTTP 206 Partial Content
        const response = new Response(audioFile, {
          headers: {
            ...corsHeaders,
            "Content-Type": contentType,
            "Accept-Ranges": "bytes",
          },
        });
        return response;
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
            if (Number.isNaN(startTime) || Number.isNaN(endTime) || startTime < 0 || startTime >= endTime) {
              return Response.json({ error: "start_time must be >= 0 and < end_time" }, { status: 400, headers: corsHeaders });
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
            const existingSeg = getDb().query("SELECT * FROM segments WHERE id = $id").get({ $id: segId }) as Segment | null;
            if (!existingSeg) return Response.json({ error: "Segment not found" }, { status: 404, headers: corsHeaders });

            const newStart = body.start_time !== undefined ? Number(body.start_time) : existingSeg.start_time;
            const newEnd = body.end_time !== undefined ? Number(body.end_time) : existingSeg.end_time;

            if (Number.isNaN(newStart) || Number.isNaN(newEnd) || newStart < 0 || newStart >= newEnd) {
              return Response.json({ error: "start_time must be >= 0 and < end_time" }, { status: 400, headers: corsHeaders });
            }

            const updated = updateSegment(segId, {
              ...body,
              start_time: newStart,
              end_time: newEnd,
            });
            return Response.json(updated, { headers: corsHeaders });
          } catch (e: any) {
            return Response.json({ error: e.message || "Failed to update segment" }, { status: 400, headers: corsHeaders });
          }
        }
        if (req.method === "DELETE") {
          const ok = deleteSegment(segId);
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
    open(ws) {
      connectedClients++;
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
    close() {
      connectedClients--;
      if (connectedClients <= 0) {
        // Shutdown after 10s of no active clients
        shutdownTimer = setTimeout(() => {
          gracefulShutdown();
        }, 10000);
      }
    },
  },
});

export { server };
