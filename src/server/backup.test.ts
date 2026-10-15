import { describe, it, expect, beforeEach, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { initDatabase, closeDatabase, createTrack, getTrack, createPlaylist, createSegment, getDb } from "./db";
import { exportLibraryArchive, importLibraryArchive, MAX_THUMB_FILE_BYTES } from "./backup";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync, readFileSync, unlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";

const TEST_DIR = mkdtempSync(join(tmpdir(), "slice-backup-test-"));
const TEST_DB = join(TEST_DIR, "music.db");
const TEST_AUDIO_DIR = join(TEST_DIR, "cache", "audio");
const TEST_THUMB_DIR = join(TEST_DIR, "cache", "thumbs");
const TEST_COOKIE = join(TEST_DIR, "cookies.txt");

describe("Library Backup & Restore (Export / Import)", () => {
  beforeEach(() => {
    closeDatabase();
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
    }, { includeCookies: true });

    expect(archiveBytes).toBeInstanceOf(Blob);
    expect(archiveBytes.size).toBeGreaterThan(100);

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

  it("exports committed WAL rows even when an older reader blocks checkpointing", async () => {
    createTrack({ id: "before", source_type: "local", source_uri: "before.opus", title: "Before", duration: 10, status: "ready" });
    const db = getDb();
    db.run("PRAGMA wal_checkpoint(TRUNCATE)");
    const reader = new Database(TEST_DB, { readonly: true });
    reader.run("BEGIN");
    reader.query("SELECT id FROM tracks").all();
    db.run("PRAGMA busy_timeout = 1");

    try {
      createTrack({ id: "after", source_type: "local", source_uri: "after.opus", title: "After", duration: 10, status: "ready" });
      const archive = await exportLibraryArchive({
        dbPath: TEST_DB, audioCacheDir: TEST_AUDIO_DIR, thumbCacheDir: TEST_THUMB_DIR, cookiePath: TEST_COOKIE,
      });
      const files = await new Bun.Archive(archive).files();
      const snapshotPath = join(TEST_DIR, "exported.db");
      await Bun.write(snapshotPath, await files.get("music.db")!.bytes());
      const snapshot = new Database(snapshotPath, { readonly: true });
      try {
        expect(snapshot.query("SELECT id FROM tracks ORDER BY id").all()).toEqual([{ id: "after" }, { id: "before" }]);
        const manifest = JSON.parse(await files.get("manifest.json")!.text());
        expect(manifest.trackCount).toBe(2);
        expect(snapshot.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
      } finally {
        snapshot.close();
      }
    } finally {
      reader.close();
    }
  });

  it("rejects a late oversized entry without changing the existing library or assets", async () => {
    const audio = join(TEST_AUDIO_DIR, "existing.opus");
    const thumb = join(TEST_THUMB_DIR, "existing.jpg");
    writeFileSync(audio, "original audio");
    writeFileSync(thumb, "original thumbnail");
    const archive = await exportLibraryArchive({
      dbPath: TEST_DB, audioCacheDir: TEST_AUDIO_DIR, thumbCacheDir: TEST_THUMB_DIR, cookiePath: TEST_COOKIE,
    });
    const files = await new Bun.Archive(archive).files();
    createTrack({ id: "survivor", source_type: "local", source_uri: "existing.opus", title: "Survivor", duration: 10, status: "ready" });
    const incoming = new Bun.Archive({
      "music.db": await files.get("music.db")!.bytes(),
      "cookies.txt": "replacement cookies",
      "cache/audio/existing.opus": "replacement audio",
      "cache/thumbs/existing.jpg": "replacement thumbnail",
      "cache/thumbs/new.jpg": "new thumbnail",
      "cache/thumbs/oversized.jpg": new Uint8Array(MAX_THUMB_FILE_BYTES + 1),
    }, { compress: "gzip" });

    await expect(importLibraryArchive(await incoming.blob(), {
      dbPath: TEST_DB, audioCacheDir: TEST_AUDIO_DIR, thumbCacheDir: TEST_THUMB_DIR, cookiePath: TEST_COOKIE,
    })).rejects.toThrow("vượt quá giới hạn");
    expect(getTrack("survivor")?.title).toBe("Survivor");
    expect(readFileSync(audio, "utf8")).toBe("original audio");
    expect(readFileSync(thumb, "utf8")).toBe("original thumbnail");
    expect(readFileSync(TEST_COOKIE, "utf8")).toBe("# YouTube cookies mock");
    expect(existsSync(join(TEST_THUMB_DIR, "new.jpg"))).toBe(false);
  });

  it("rolls back the database, overwritten assets and newly installed files on a commit failure", async () => {
    const audio = join(TEST_AUDIO_DIR, "existing.opus");
    const thumb = join(TEST_THUMB_DIR, "existing.jpg");
    const blocked = join(TEST_THUMB_DIR, "blocked.jpg");
    writeFileSync(audio, "original audio");
    writeFileSync(thumb, "original thumbnail");
    mkdirSync(blocked);
    writeFileSync(join(blocked, "sentinel"), "keep this directory");
    const archive = await exportLibraryArchive({
      dbPath: TEST_DB, audioCacheDir: TEST_AUDIO_DIR, thumbCacheDir: TEST_THUMB_DIR, cookiePath: TEST_COOKIE,
    });
    const files = await new Bun.Archive(archive).files();
    createTrack({ id: "survivor", source_type: "local", source_uri: "existing.opus", title: "Survivor", duration: 10, status: "ready" });
    const incoming = new Bun.Archive({
      "music.db": await files.get("music.db")!.bytes(),
      "cookies.txt": "replacement cookies",
      "cache/audio/existing.opus": "replacement audio",
      "cache/thumbs/existing.jpg": "replacement thumbnail",
      "cache/thumbs/new.jpg": "new thumbnail",
      "cache/thumbs/blocked.jpg": "cannot replace a directory",
    }, { compress: "gzip" });

    await expect(importLibraryArchive(await incoming.blob(), {
      dbPath: TEST_DB, audioCacheDir: TEST_AUDIO_DIR, thumbCacheDir: TEST_THUMB_DIR, cookiePath: TEST_COOKIE,
    })).rejects.toThrow();
    expect(getTrack("survivor")?.title).toBe("Survivor");
    expect(readFileSync(audio, "utf8")).toBe("original audio");
    expect(readFileSync(thumb, "utf8")).toBe("original thumbnail");
    expect(readFileSync(TEST_COOKIE, "utf8")).toBe("# YouTube cookies mock");
    expect(existsSync(join(TEST_THUMB_DIR, "new.jpg"))).toBe(false);
    expect(readFileSync(join(blocked, "sentinel"), "utf8")).toBe("keep this directory");
    expect(getDb().query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  });

  it("does not start a restore while an export still owns the library files", async () => {
    const paths = { dbPath: TEST_DB, audioCacheDir: TEST_AUDIO_DIR, thumbCacheDir: TEST_THUMB_DIR, cookiePath: TEST_COOKIE };
    const archive = await exportLibraryArchive(paths);
    const exporting = exportLibraryArchive(paths);
    try {
      await expect(importLibraryArchive(archive, paths)).rejects.toThrow();
    } finally {
      await exporting;
    }
  });

  it("does not export partially staged restore data", async () => {
    const paths = { dbPath: TEST_DB, audioCacheDir: TEST_AUDIO_DIR, thumbCacheDir: TEST_THUMB_DIR, cookiePath: TEST_COOKIE };
    const archive = await exportLibraryArchive(paths);
    const restoring = importLibraryArchive(archive, paths);
    try {
      await expect(exportLibraryArchive(paths)).rejects.toThrow();
    } finally {
      await restoring;
    }
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
