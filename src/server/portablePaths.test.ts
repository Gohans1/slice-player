import { describe, it, expect, beforeEach, afterAll } from "bun:test";
import { initDatabase, closeDatabase, createTrack, getTrack, healTrackFilePaths } from "./db";
import { existsSync, mkdirSync, writeFileSync, unlinkSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";

const TEST_DB = "./data/test_portable.db";
const TEST_AUDIO_DIR = "./data/test_portable_audio";

describe("Self-healing and portable track paths", () => {
  beforeEach(() => {
    if (existsSync(TEST_AUDIO_DIR)) {
      rmSync(TEST_AUDIO_DIR, { recursive: true, force: true });
    }
    mkdirSync(TEST_AUDIO_DIR, { recursive: true });

    const db = initDatabase(TEST_DB);
    db.run("DELETE FROM playlist_items; DELETE FROM playlists; DELETE FROM segments; DELETE FROM tracks;");
  });

  afterAll(() => {
    closeDatabase();
    for (const f of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) {
      if (existsSync(f)) {
        try { unlinkSync(f); } catch {}
      }
    }
    if (existsSync(TEST_AUDIO_DIR)) {
      try { rmSync(TEST_AUDIO_DIR, { recursive: true, force: true }); } catch {}
    }
  });

  it("should heal an outdated or cross-machine file_path to the local cache dir if the physical file exists", () => {
    const fakeOldMachinePath = "C:\\OtherUser\\OldFolder\\data\\cache\\audio\\yt_abc123.opus";
    const actualLocalFile = join(TEST_AUDIO_DIR, "yt_abc123.opus");
    writeFileSync(actualLocalFile, "dummy audio bytes");

    createTrack({
      id: "track_test_heal",
      source_type: "youtube",
      source_uri: "https://youtube.com/watch?v=abc123",
      title: "Cross Machine Song",
      artist: "Test",
      duration: 120,
      file_path: fakeOldMachinePath,
      status: "ready",
    });

    const before = getTrack("track_test_heal");
    expect(before?.file_path).toBe(fakeOldMachinePath);

    const healedCount = healTrackFilePaths(TEST_AUDIO_DIR);
    expect(healedCount).toBe(1);

    const after = getTrack("track_test_heal");
    expect(after?.file_path).toBe(resolve(actualLocalFile));
    expect(existsSync(after!.file_path!)).toBe(true);
  });

  it("should not alter paths that already exist on disk", () => {
    const validLocalFile = join(TEST_AUDIO_DIR, "valid_existing.mp3");
    writeFileSync(validLocalFile, "audio");

    createTrack({
      id: "track_valid",
      source_type: "local",
      source_uri: validLocalFile,
      title: "Valid Song",
      artist: "Test",
      duration: 60,
      file_path: resolve(validLocalFile),
      status: "ready",
    });

    const healedCount = healTrackFilePaths(TEST_AUDIO_DIR);
    expect(healedCount).toBe(0);

    const track = getTrack("track_valid");
    expect(track?.file_path).toBe(resolve(validLocalFile));
  });

  it("should preserve cached audio file when basename matches track even if path in DB was stale", () => {
    const stalePath = "D:\\SomeOtherMachine\\slice-player\\data\\cache\\audio\\my_awesome_track.opus";
    const localCachedFile = join(TEST_AUDIO_DIR, "my_awesome_track.opus");
    writeFileSync(localCachedFile, "audio content");

    createTrack({
      id: "track_preserve",
      source_type: "youtube",
      source_uri: "https://youtube.com/watch?v=preserve123",
      title: "Preserve Me",
      artist: "Test",
      duration: 150,
      file_path: stalePath,
      status: "ready",
    });

    // Run heal
    healTrackFilePaths(TEST_AUDIO_DIR);

    // Verify file still exists and was healed
    expect(existsSync(localCachedFile)).toBe(true);
    const track = getTrack("track_preserve");
    expect(track?.file_path).toBe(resolve(localCachedFile));
  });

  it("should extract cross-platform basenames correctly across Windows and POSIX separators", () => {
    const { getCrossPlatformBasename } = require("./db");
    expect(getCrossPlatformBasename("C:\\Users\\admin\\song.mp3")).toBe("song.mp3");
    expect(getCrossPlatformBasename("/home/user/music/song.opus")).toBe("song.opus");
    expect(getCrossPlatformBasename("C:/Users/admin\\mixed/path\\song.wav")).toBe("song.wav");
    expect(getCrossPlatformBasename("direct_song.flac")).toBe("direct_song.flac");
    expect(getCrossPlatformBasename("")).toBe("");
  });
});
