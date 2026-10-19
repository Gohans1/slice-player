import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { openLibraryPage } from "../mock-library";

// Writes a valid 2-second 44.1kHz stereo 16-bit PCM WAV file (440Hz sine wave)
function writeStereoSineWav(filePath: string, durationSec = 2): void {
  const sampleRate = 44100;
  const channels = 2;
  const bitsPerSample = 16;
  const numFrames = Math.floor(sampleRate * durationSec);
  const dataBytes = numFrames * channels * (bitsPerSample / 8);
  const buf = Buffer.alloc(44 + dataBytes);

  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * channels * (bitsPerSample / 8), 28);
  buf.writeUInt16LE(channels * (bitsPerSample / 8), 32);
  buf.writeUInt16LE(bitsPerSample, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataBytes, 40);

  let offset = 44;
  for (let i = 0; i < numFrames; i++) {
    const sample = Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 16384);
    buf.writeInt16LE(sample, offset);
    buf.writeInt16LE(sample, offset + 2);
    offset += 4;
  }

  writeFileSync(filePath, buf);
}

test("real Rust backend: /ws live updates, local ingest + waveform + 206 stream, segment/playlist/mix/sub-playlist CRUD, and export/import round-trip", async ({
  page,
  request,
}) => {
  const fixtureDir = mkdtempSync(join(tmpdir(), "slice-rust-fixture-"));
  const wavPath = join(fixtureDir, "rust-e2e-tone.wav");
  writeStereoSineWav(wavPath, 2);

  const wsMessages: string[] = [];
  page.on("websocket", (ws) => {
    ws.on("framereceived", (frame) => {
      if (typeof frame.payload === "string") {
        wsMessages.push(frame.payload);
      }
    });
  });

  try {
    // 1. Open app and verify real /ws connection receives {"type":"connected"}
    await page.goto("/");
    await expect
      .poll(() => wsMessages.some((m) => m.includes('"type":"connected"')), { timeout: 10_000 })
      .toBe(true);

    // 2. Ingest local WAV fixture via real POST /api/tracks/ingest-local
    const ingestRes = await request.post("/api/tracks/ingest-local", {
      data: { path: wavPath },
    });
    expect(ingestRes.status()).toBe(200);
    const ingestJson: {
      success: boolean;
      tracks: { id: string; title: string; status: string; peaks_json?: string | null }[];
    } = await ingestRes.json();
    expect(ingestJson.success).toBe(true);
    expect(ingestJson.tracks.length).toBe(1);
    expect(ingestJson.tracks[0].status).toBe("ready");
    const trackId = ingestJson.tracks[0].id;

    // Fetch full track details (including 1,000 waveform peaks) and wait for loudness worker
    let peaksJson = "";
    await expect
      .poll(
        async () => {
          const r = await request.get(`/api/tracks/${trackId}`);
          const detail: {
            id: string;
            peaks_json?: string | null;
            loudness?: number | null;
            true_peak?: number | null;
          } = await r.json();
          if (
            typeof detail.peaks_json === "string" &&
            detail.peaks_json.length > 0 &&
            typeof detail.loudness === "number" &&
            typeof detail.true_peak === "number"
          ) {
            peaksJson = detail.peaks_json;
            return true;
          }
          return false;
        },
        { timeout: 10_000 },
      )
      .toBe(true);

    const peaks: number[] = JSON.parse(peaksJson);
    expect(peaks.length).toBe(1000);
    expect(peaks.some((p) => p > 0.2)).toBe(true);

    // Verify byte-range audio streaming answers 206 Partial Content
    const streamRes = await request.get(`/api/tracks/${trackId}/stream`, {
      headers: { Range: "bytes=0-1023" },
    });
    expect(streamRes.status()).toBe(206);
    expect(streamRes.headers()["accept-ranges"]).toBe("bytes");
    expect(streamRes.headers()["content-range"]).toMatch(/^bytes 0-1023\/\d+$/);
    expect((await streamRes.body()).byteLength).toBe(1024);

    // Navigate to Tracks in UI and verify ingested track is rendered
    await openLibraryPage(page, "Tracks");
    await expect(page.getByText("rust-e2e-tone").first()).toBeVisible();

    // Update track title via PATCH /api/tracks/:id and verify live WebSocket `track_updated` updates UI without reload
    const patchRes = await request.patch(`/api/tracks/${trackId}`, {
      data: { title: "Rust Engine Live Track" },
    });
    expect(patchRes.status()).toBe(200);
    await expect(page.getByText("Rust Engine Live Track").first()).toBeVisible();
    expect(wsMessages.some((m) => m.includes('"type":"track_updated"'))).toBe(true);

    // 3. Segment + Playlist + Sub-Playlist + Mix Playlist CRUD
    const segRes = await request.post(`/api/tracks/${trackId}/segments`, {
      data: { name: "Rust Hook Slice", start_time: 0.2, end_time: 1.4 },
    });
    expect(segRes.status()).toBe(201);
    const segment: { id: string; name: string } = await segRes.json();
    expect(segment.name).toBe("Rust Hook Slice");

    await openLibraryPage(page, "Slices");
    await expect(page.getByText("Rust Hook Slice").first()).toBeVisible();

    // Create Parent Playlist, Child Sub-Playlist, Second Source Playlist, and Mix Playlist
    const parentPlRes = await request.post("/api/playlists", {
      data: { name: "Rust Parent Playlist" },
    });
    expect(parentPlRes.status()).toBe(201);
    const parentPl: { id: string; name: string } = await parentPlRes.json();

    const childPlRes = await request.post("/api/playlists", {
      data: { name: "Rust Sub Playlist", parent_id: parentPl.id },
    });
    expect(childPlRes.status()).toBe(201);
    const childPl: { id: string; name: string; parent_id: string } = await childPlRes.json();
    expect(childPl.parent_id).toBe(parentPl.id);

    // Adding an item to the child sub-playlist auto-bubbles it into the parent playlist
    const addItemRes = await request.post(`/api/playlists/${childPl.id}/items`, {
      data: { track_id: trackId, segment_id: segment.id },
    });
    expect(addItemRes.status()).toBe(201);

    const parentDetailRes = await request.get(`/api/playlists/${parentPl.id}`);
    const parentDetail: { items: { track_id: string; segment_id: string }[] } =
      await parentDetailRes.json();
    expect(parentDetail.items.length).toBe(1);
    expect(parentDetail.items[0].track_id).toBe(trackId);
    expect(parentDetail.items[0].segment_id).toBe(segment.id);

    const secondPlRes = await request.post("/api/playlists", {
      data: { name: "Rust Second Source" },
    });
    expect(secondPlRes.status()).toBe(201);
    const secondPl: { id: string } = await secondPlRes.json();

    const mixPlRes = await request.post("/api/playlists/mix", {
      data: { name: "Rust Live Mix", source_ids: [parentPl.id, secondPl.id] },
    });
    expect(mixPlRes.status()).toBe(201);
    const mixPl: { id: string; is_mix: boolean } = await mixPlRes.json();
    expect(mixPl.is_mix).toBe(true);

    // Reload UI so sidebar playlists reflect created playlists and open Mix playlist
    await page.reload();
    await expect(page.getByText("Rust Parent Playlist").first()).toBeVisible();
    await expect(page.getByText("Rust Live Mix").first()).toBeVisible();

    // 4. Library Export -> Delete -> Import (.tar.gz round-trip + library_restored WebSocket event)
    const exportRes = await request.get("/api/library/export");
    expect(exportRes.status()).toBe(200);
    expect(exportRes.headers()["content-type"]).toBe("application/gzip");
    const archiveBytes = await exportRes.body();
    expect(archiveBytes.byteLength).toBeGreaterThan(200);

    // Wipe the library before importing the backup
    expect((await request.delete(`/api/tracks/${trackId}`)).status()).toBe(200);
    expect((await request.delete(`/api/playlists/${mixPl.id}`)).status()).toBe(200);
    expect((await request.delete(`/api/playlists/${parentPl.id}`)).status()).toBe(200);
    expect((await request.delete(`/api/playlists/${secondPl.id}`)).status()).toBe(200);

    const tracksAfterWipe: unknown[] = await (await request.get("/api/tracks")).json();
    expect(tracksAfterWipe.length).toBe(0);

    // Import the exported .tar.gz archive via POST /api/library/import
    const importRes = await request.post("/api/library/import", {
      headers: { "Content-Type": "application/gzip" },
      data: archiveBytes,
    });
    expect(importRes.status()).toBe(200);
    const importJson: {
      success: boolean;
      manifest: { trackCount: number; segmentCount: number; playlistCount: number };
    } = await importRes.json();
    expect(importJson.success).toBe(true);
    expect(importJson.manifest.trackCount).toBe(1);
    expect(importJson.manifest.segmentCount).toBe(1);
    expect(importJson.manifest.playlistCount).toBe(4);

    // Verify `library_restored` WS event fired and tracks/segments/playlists are restored in both API and UI
    await expect
      .poll(() => wsMessages.some((m) => m.includes('"type":"library_restored"')), { timeout: 10_000 })
      .toBe(true);

    const restoredTracks: { id: string; title: string }[] = await (
      await request.get("/api/tracks")
    ).json();
    expect(restoredTracks.map((t) => t.title)).toEqual(["Rust Engine Live Track"]);

    const restoredPlaylists: { name: string }[] = await (
      await request.get("/api/playlists")
    ).json();
    expect(restoredPlaylists.map((p) => p.name).sort()).toEqual(
      ["Rust Live Mix", "Rust Parent Playlist", "Rust Second Source", "Rust Sub Playlist"].sort(),
    );

    await openLibraryPage(page, "Tracks");
    await expect(page.getByText("Rust Engine Live Track").first()).toBeVisible();
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
});
