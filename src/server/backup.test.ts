import { describe, it, expect, beforeEach, afterAll } from "bun:test";
import { initDatabase, closeDatabase, createTrack, getTrack, createPlaylist, createSegment } from "./db";
import { exportLibraryArchive, importLibraryArchive } from "./backup";
import { existsSync, mkdirSync, writeFileSync, unlinkSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";

const TEST_DIR = "./data/test_backup_sandbox";
const TEST_DB = join(TEST_DIR, "music.db");
const TEST_AUDIO_DIR = join(TEST_DIR, "cache", "audio");
const TEST_THUMB_DIR = join(TEST_DIR, "cache", "thumbs");
const TEST_COOKIE = join(TEST_DIR, "cookies.txt");

describe("Library Backup & Restore (Export / Import)", () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
    mkdirSync(TEST_AUDIO_DIR, { recursive: true });
    mkdirSync(TEST_THUMB_DIR, { recursive: true });

    writeFileSync(TEST_COOKIE, "# YouTube cookies mock");

    const db = initDatabase(TEST_DB);
    db.run("DELETE FROM playlist_items; DELETE FROM playlists; DELETE FROM segments; DELETE FROM tracks;");
  });

  afterAll(() => {
    closeDatabase();
    if (existsSync(TEST_DIR)) {
      try { rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
    }
  });

  it("should export library to a valid gzipped tar archive with manifest, db, audio, and cookies", async () => {
    const audioFile = join(TEST_AUDIO_DIR, "yt_test123.opus");
    writeFileSync(audioFile, "test audio data 12345");

    const thumbFile = join(TEST_THUMB_DIR, "yt_test123.jpg");
    writeFileSync(thumbFile, "fake jpeg header bytes");

    createTrack({
      id: "yt_test123",
      source_type: "youtube",
      source_uri: "https://youtube.com/watch?v=test123",
      title: "Export Song",
      artist: "Export Artist",
      duration: 180,
      file_path: resolve(audioFile),
      thumbnail_url: "/api/thumbs/yt_test123.jpg",
      status: "ready",
    });

    createSegment({
      id: "seg_123",
      track_id: "yt_test123",
      name: "Cool Hook",
      start_time: 10,
      end_time: 30,
    });

    createPlaylist("My Favorite Playlist");

    const archiveBytes = await exportLibraryArchive({
      dbPath: TEST_DB,
      audioCacheDir: TEST_AUDIO_DIR,
      thumbCacheDir: TEST_THUMB_DIR,
      cookiePath: TEST_COOKIE,
    });

    expect(archiveBytes).toBeInstanceOf(Uint8Array);
    expect(archiveBytes.length).toBeGreaterThan(100);

    const archive = new (Bun as any).Archive(archiveBytes);
    const files = await archive.files();
    const fileNames = Array.from(files.keys());

    expect(fileNames).toContain("manifest.json");
    expect(fileNames).toContain("music.db");
    expect(fileNames).toContain("cookies.txt");
    expect(fileNames).toContain("cache/audio/yt_test123.opus");
    expect(fileNames).toContain("cache/thumbs/yt_test123.jpg");

    const manifestFile = files.get("manifest.json");
    const manifest = JSON.parse(await manifestFile.text());
    expect(manifest.version).toBe(1);
    expect(manifest.trackCount).toBe(1);
    expect(manifest.segmentCount).toBe(1);
    expect(manifest.playlistCount).toBe(1);
  });

  it("should reject corrupted or invalid archives on import", async () => {
    const invalidBytes = new Uint8Array([0, 1, 2, 3, 4, 5]);
    expect(
      importLibraryArchive(invalidBytes, {
        dbPath: TEST_DB,
        audioCacheDir: TEST_AUDIO_DIR,
        thumbCacheDir: TEST_THUMB_DIR,
        cookiePath: TEST_COOKIE,
      })
    ).rejects.toThrow();
  });

  it("should successfully import and restore library with self-healing paths", async () => {
    // 1. Create source data in source sandbox
    const audioFile = join(TEST_AUDIO_DIR, "yt_imported.opus");
    writeFileSync(audioFile, "audio binary content");

    createTrack({
      id: "yt_imported",
      source_type: "youtube",
      source_uri: "https://youtube.com/watch?v=imported",
      title: "Imported Song",
      artist: "Imported Artist",
      duration: 200,
      file_path: "C:\\DifferentMachine\\path\\yt_imported.opus",
      status: "ready",
    });

    const archiveBytes = await exportLibraryArchive({
      dbPath: TEST_DB,
      audioCacheDir: TEST_AUDIO_DIR,
      thumbCacheDir: TEST_THUMB_DIR,
      cookiePath: TEST_COOKIE,
    });

    // 2. Wipe test sandbox completely
    closeDatabase();
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DIR, { recursive: true });

    // 3. Import archive
    const result = await importLibraryArchive(archiveBytes, {
      dbPath: TEST_DB,
      audioCacheDir: TEST_AUDIO_DIR,
      thumbCacheDir: TEST_THUMB_DIR,
      cookiePath: TEST_COOKIE,
    });

    expect(result.success).toBe(true);
    expect(existsSync(TEST_DB)).toBe(true);
    expect(existsSync(join(TEST_AUDIO_DIR, "yt_imported.opus"))).toBe(true);

    const track = getTrack("yt_imported");
    expect(track).not.toBeNull();
    expect(track?.title).toBe("Imported Song");
    expect(track?.file_path).toBe(resolve(join(TEST_AUDIO_DIR, "yt_imported.opus")));
  });

  it("should validate archive filenames against tar-slip and dangerous names", () => {
    const { isSafeArchiveFilename } = require("./backup");
    expect(isSafeArchiveFilename("normal_track.opus")).toBe(true);
    expect(isSafeArchiveFilename("image_123.jpg")).toBe(true);
    expect(isSafeArchiveFilename("../evil.mp3")).toBe(false);
    expect(isSafeArchiveFilename("..\\evil.mp3")).toBe(false);
    expect(isSafeArchiveFilename("folder/nested.mp3")).toBe(false);
    expect(isSafeArchiveFilename(".")).toBe(false);
    expect(isSafeArchiveFilename("..")).toBe(false);
    expect(isSafeArchiveFilename("CON")).toBe(false);
    expect(isSafeArchiveFilename("PRN.txt")).toBe(false);
    expect(isSafeArchiveFilename("AUX")).toBe(false);
    expect(isSafeArchiveFilename("track.mp3:stream")).toBe(false);
  });

  it("should preserve existing database when incoming archive has a corrupted or non-sqlite db", async () => {
    // 1. Existing valid track in DB
    createTrack({
      id: "safe_existing_track",
      source_type: "youtube",
      source_uri: "https://youtube.com/watch?v=safe123",
      title: "I Must Survive",
      artist: "Survivor",
      duration: 120,
      status: "ready",
    });

    const beforeTrack = getTrack("safe_existing_track");
    expect(beforeTrack).not.toBeNull();

    // 2. Create malicious/corrupted archive with fake music.db
    const badFiles: Record<string, Uint8Array | string> = {
      "manifest.json": JSON.stringify({ version: 1 }),
      "music.db": "THIS IS NOT A VALID SQLITE DATABASE FILE",
    };
    const badArchive = new (Bun as any).Archive(badFiles, { compress: "gzip" });
    const tempBadPath = join(TEST_DIR, "corrupt_test.tar.gz");
    await Bun.write(tempBadPath, badArchive);
    const badBytes = await Bun.file(tempBadPath).bytes();
    try { unlinkSync(tempBadPath); } catch {}

    // 3. Attempt import and verify it rejects
    await expect(
      importLibraryArchive(badBytes, {
        dbPath: TEST_DB,
        audioCacheDir: TEST_AUDIO_DIR,
        thumbCacheDir: TEST_THUMB_DIR,
        cookiePath: TEST_COOKIE,
      })
    ).rejects.toThrow();

    // 4. Verify existing track is STILL intact and database is fully functional
    initDatabase(TEST_DB);
    const afterTrack = getTrack("safe_existing_track");
    expect(afterTrack).not.toBeNull();
    expect(afterTrack?.title).toBe("I Must Survive");
  });
});
