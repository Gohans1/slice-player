import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
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

test("real Rust backend: /ws live updates, UI local ingest -> waveform rendered -> 206 stream, UI segment/playlist/mix/sub-playlist CRUD, and UI export/import round-trip", async ({
  page,
  request,
}) => {
  const fixtureDir = mkdtempSync(join(tmpdir(), "slice-rust-fixture-"));
  const wavPath = join(fixtureDir, "rust-e2e-tone.wav");
  const backupPath = join(fixtureDir, "exported-library.tar.gz");
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

    // 2. Ingest local WAV fixture through the browser UI:
    // First upload via #local-audio-file-input (POST /api/tracks/upload), then inside the opened
    // Local Audio Modal also exercise the manual path fallback (POST /api/tracks/ingest-local)
    // so both endpoints are verified with real browser Origin / Sec-Fetch-Site headers.
    const scanWavPath = join(fixtureDir, "rust-e2e-scan.wav");
    writeStereoSineWav(scanWavPath, 2);

    const uploadDonePromise = page.waitForResponse(
      (res) => res.url().includes("/api/tracks/upload") && res.request().method() === "POST",
    );
    await page.locator("#local-audio-file-input").setInputFiles(wavPath);
    const uploadRes = await uploadDonePromise;
    expect(uploadRes.status()).toBe(200);

    const localDialog = page.getByRole("dialog");
    await expect(localDialog).toBeVisible();

    await localDialog.getByRole("button", { name: /Or scan directory path/i }).click();
    const ingestLocalPromise = page.waitForResponse(
      (res) => res.url().includes("/api/tracks/ingest-local") && res.request().method() === "POST",
    );
    await localDialog.locator("#local-path-fallback-input").fill(scanWavPath);
    await localDialog.getByRole("button", { name: /Scan Path/i }).click();
    const ingestLocalRes = await ingestLocalPromise;
    expect(ingestLocalRes.status()).toBe(200);

    // Close the Local Audio Modal
    await localDialog.getByRole("button", { name: "Close" }).first().click();
    await expect(localDialog).toHaveCount(0);

    // Navigate to Tracks in UI and verify both ingested tracks are rendered
    await openLibraryPage(page, "Tracks");
    await expect(page.getByText("rust-e2e-tone").first()).toBeVisible();
    await expect(page.getByText("rust-e2e-scan").first()).toBeVisible();

    // Wait for loudness worker to finish measuring rust-e2e-tone and verify 1,000 waveform peaks
    let trackId = "";
    let scanTrackId = "";
    let peaksJson = "";
    await expect
      .poll(
        async () => {
          const listRes = await request.get("/api/tracks");
          const tracks: { id: string; title: string }[] = await listRes.json();
          const tone = tracks.find((t) => t.title === "rust-e2e-tone");
          const scan = tracks.find((t) => t.title === "rust-e2e-scan");
          if (!tone || !scan) return false;
          trackId = tone.id;
          scanTrackId = scan.id;
          const detailRes = await request.get(`/api/tracks/${trackId}`);
          const detail: {
            id: string;
            peaks_json?: string | null;
            loudness?: number | null;
            true_peak?: number | null;
          } = await detailRes.json();
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

    // 3. Open Slice Studio in the browser UI via RowActionsMenu -> verify waveform renders and browser <audio>/Range stream returns 206
    const streamResponsePromise = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/tracks/${trackId}/stream`) &&
        (res.status() === 206 || res.status() === 200),
    );
    await page.getByRole("button", { name: "More options for rust-e2e-tone" }).click();
    await page.getByRole("menuitem", { name: "Open Slice Studio" }).click();

    const studioDialog = page.getByRole("dialog");
    await expect(studioDialog).toBeVisible();
    await expect(studioDialog.locator('[data-slot="studio-waveform"]')).toBeVisible();
    await expect(studioDialog.getByText(/Loading.*waveform/i)).toHaveCount(0);

    const browserStreamRes = await streamResponsePromise;
    expect(browserStreamRes.headers()["accept-ranges"]).toBe("bytes");

    // Also verify a browser-initiated Range request returns 206 Partial Content with exact byte range
    const rangeCheck = await page.evaluate(async (id: string) => {
      const r = await fetch(`/api/tracks/${id}/stream`, {
        headers: { Range: "bytes=0-1023" },
      });
      const buf = await r.arrayBuffer();
      return {
        status: r.status,
        acceptRanges: r.headers.get("accept-ranges"),
        contentRange: r.headers.get("content-range"),
        byteLength: buf.byteLength,
      };
    }, trackId);
    expect(rangeCheck.status).toBe(206);
    expect(rangeCheck.acceptRanges).toBe("bytes");
    expect(rangeCheck.contentRange).toMatch(/^bytes 0-1023\/\d+$/);
    expect(rangeCheck.byteLength).toBe(1024);

    // 4. Create and rename a Slice inside Slice Studio UI
    const createSegPromise = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/tracks/${trackId}/segments`) && res.request().method() === "POST",
    );
    await studioDialog.getByRole("button", { name: "New Slice" }).first().click();
    expect((await createSegPromise).status()).toBe(201);

    const renameSegPromise = page.waitForResponse(
      (res) => res.url().includes("/api/segments/") && res.request().method() === "PUT",
    );
    const sliceNameInput = studioDialog.getByRole("textbox", { name: "Slice name" });
    await sliceNameInput.fill("Rust Hook Slice");
    expect((await renameSegPromise).status()).toBe(200);

    await studioDialog.getByRole("button", { name: "Done" }).click();
    await expect(studioDialog).toHaveCount(0);

    // Verify the slice is visible on the Slices page
    await openLibraryPage(page, "Slices");
    await expect(page.getByText("Rust Hook Slice").first()).toBeVisible();

    // 5. Verify live WebSocket `track_updated` updates UI without page.reload()
    const patchRes = await request.patch(`/api/tracks/${trackId}`, {
      data: { title: "Rust Engine Live Track" },
    });
    expect(patchRes.status()).toBe(200);
    await openLibraryPage(page, "Tracks");
    await expect(page.getByText("Rust Engine Live Track").first()).toBeVisible();
    expect(wsMessages.some((m) => m.includes('"type":"track_updated"'))).toBe(true);

    // 6. Create Parent Playlist, Child Sub-Playlist, Second Source Playlist, and Mix Playlist through the UI
    // Parent Playlist
    const newMenuBtn = page.getByRole("button", { name: "New Playlist or Mix" });
    await newMenuBtn.click();
    await page.getByRole("menuitem", { name: "New Playlist" }).click();
    const createPlDialog = page.getByRole("dialog");
    await createPlDialog.locator("#create-playlist-name").fill("Rust Parent Playlist");
    await createPlDialog.locator('button[type="submit"]').click();
    await expect(createPlDialog).toHaveCount(0);
    await expect(page.getByText("Rust Parent Playlist").first()).toBeVisible();

    // Child Sub-Playlist under Rust Parent Playlist
    await newMenuBtn.click();
    await page.getByRole("menuitem", { name: "New Playlist" }).click();
    await expect(createPlDialog).toBeVisible();
    await createPlDialog.locator("#create-playlist-name").fill("Rust Sub Playlist");
    await createPlDialog.locator("#create-playlist-parent").click();
    await page.getByRole("option", { name: "Rust Parent Playlist" }).click();
    await createPlDialog.locator('button[type="submit"]').click();
    await expect(createPlDialog).toHaveCount(0);
    await expect(page.getByText("Rust Sub Playlist").first()).toBeVisible();

    // Add "Rust Hook Slice" to "Rust Sub Playlist" via UI RowActionsMenu and verify auto-bubbling to Parent
    await openLibraryPage(page, "Slices");
    await page.getByRole("button", { name: "More options for Rust Hook Slice" }).click();
    await page.getByRole("menuitem", { name: "Add to Playlist" }).hover();
    const addItemPromise = page.waitForResponse(
      (res) => res.url().includes("/api/playlists/") && res.url().endsWith("/items") && res.request().method() === "POST",
    );
    await page.getByRole("menuitemcheckbox", { name: "Rust Sub Playlist" }).click();
    expect((await addItemPromise).status()).toBe(201);
    await page.keyboard.press("Escape");

    // Open "Rust Parent Playlist" in sidebar and verify "Rust Hook Slice" auto-bubbled into it
    await page.getByRole("button", { name: "Rust Parent Playlist", exact: true }).click();
    await expect(page.getByText("Rust Hook Slice").first()).toBeVisible();

    // Create Second Source Playlist via UI
    await newMenuBtn.click();
    await page.getByRole("menuitem", { name: /New Playlist/i }).click();
    await expect(createPlDialog).toBeVisible();
    await createPlDialog.locator("#create-playlist-name").fill("Rust Second Source");
    await createPlDialog.locator('button[type="submit"]').click();
    await expect(createPlDialog).toHaveCount(0);
    await expect(page.getByText("Rust Second Source").first()).toBeVisible();

    // Create Mix Playlist via UI MixPlaylistModal
    await newMenuBtn.click();
    await page.getByRole("menuitem", { name: /New Mix/i }).click();
    const mixDialog = page.getByRole("dialog");
    await expect(mixDialog).toBeVisible();
    await mixDialog.getByRole("combobox", { name: "Playlist 1" }).click();
    await page.getByRole("option", { name: "Rust Parent Playlist" }).click();
    await mixDialog.getByRole("combobox", { name: "Playlist 2" }).click();
    await page.getByRole("option", { name: "Rust Second Source" }).click();
    await mixDialog.getByRole("button", { name: "Create Mix" }).click();
    await expect(mixDialog).toHaveCount(0);

    const mixName = "Rust Parent Playlist + Rust Second Source";
    await expect(page.getByText(mixName).first()).toBeVisible();

    // Verify live WebSocket `playlist_created` updates sidebar without page.reload() when created externally
    const extPlRes = await request.post("/api/playlists", {
      data: { name: "Rust WS Live Playlist" },
    });
    expect(extPlRes.status()).toBe(201);
    await expect(page.getByText("Rust WS Live Playlist").first()).toBeVisible();
    expect(wsMessages.some((m) => m.includes('"type":"playlist_created"'))).toBe(true);

    // 7. Library Export -> Wipe (verify empty UI) -> Import via BackupModal UI (multipart/form-data)
    await page.getByRole("button", { name: "Backup / Transfer" }).click();
    const backupDialog = page.getByRole("dialog");
    await expect(backupDialog).toBeVisible();

    const downloadPromise = page.waitForEvent("download");
    await backupDialog.getByRole("button", { name: /Download Backup/i }).click();
    const download = await downloadPromise;
    await download.saveAs(backupPath);
    expect(statSync(backupPath).size).toBeGreaterThan(200);

    await backupDialog.getByRole("button", { name: "Close" }).first().click();
    await expect(backupDialog).toHaveCount(0);

    // Wipe all tracks and playlists, and verify UI updates to empty BEFORE importing
    const playlistsBeforeWipe: { id: string; parent_id?: string | null; is_mix?: boolean }[] = await (
      await request.get("/api/playlists")
    ).json();
    expect((await request.delete(`/api/tracks/${trackId}`)).status()).toBe(200);
    expect((await request.delete(`/api/tracks/${scanTrackId}`)).status()).toBe(200);
    // Delete mixes and root playlists so all playlists are removed
    for (const pl of playlistsBeforeWipe.filter((p) => p.is_mix || !p.parent_id)) {
      await request.delete(`/api/playlists/${pl.id}`);
    }

    await openLibraryPage(page, "Tracks");
    await expect(page.getByText("Rust Engine Live Track")).toHaveCount(0);
    await expect(page.getByText("rust-e2e-scan")).toHaveCount(0);
    await expect(page.getByText("Rust Parent Playlist")).toHaveCount(0);

    // Open BackupModal -> Import / Restore tab -> upload backup.tar.gz via multipart/form-data
    await page.getByRole("button", { name: "Backup / Transfer" }).click();
    await expect(backupDialog).toBeVisible();
    await backupDialog.getByRole("tab", { name: /Import|Restore/i }).click();
    await backupDialog.locator('input[type="file"]').setInputFiles(backupPath);
    await expect(backupDialog.getByText(/Selected file:/i)).toBeVisible();

    const importRespPromise = page.waitForResponse(
      (res) => res.url().includes("/api/library/import") && res.request().method() === "POST",
    );
    await backupDialog.getByRole("button", { name: /Start Restore/i }).click();
    const importResp = await importRespPromise;
    expect(importResp.status()).toBe(200);

    await expect
      .poll(() => wsMessages.some((m) => m.includes('"type":"library_restored"')), { timeout: 10_000 })
      .toBe(true);

    await backupDialog.getByRole("button", { name: "Close" }).first().click();
    await expect(backupDialog).toHaveCount(0);

    // Verify tracks, slices, and playlists are restored in the UI without page.reload()
    await openLibraryPage(page, "Tracks");
    await expect(page.getByText("Rust Engine Live Track").first()).toBeVisible();
    await expect(page.getByText("rust-e2e-scan").first()).toBeVisible();
    await expect(page.getByText("Rust Parent Playlist").first()).toBeVisible();
    await expect(page.getByText(mixName).first()).toBeVisible();
    await openLibraryPage(page, "Slices");
    await expect(page.getByText("Rust Hook Slice").first()).toBeVisible();
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
});
