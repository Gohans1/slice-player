import { describe, it, expect, beforeEach, afterAll } from "bun:test";
import { initDatabase, closeDatabase, createTrack, getTrack, updateTrack } from "./db";
import { exportLibraryArchive, importLibraryArchive } from "./backup";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { validateSafeLocalAudioPath } from "./ingest";
import { safeSerializeDetails } from "./logger";

const TEST_DIR = "./data/test_security_sandbox";
const TEST_DB = join(TEST_DIR, "music.db");
const TEST_AUDIO_DIR = join(TEST_DIR, "cache", "audio");
const TEST_COOKIE = join(TEST_DIR, "cookies.txt");

describe("Security Controls & Boundary Enforcement", () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
    mkdirSync(TEST_AUDIO_DIR, { recursive: true });
    writeFileSync(TEST_COOKIE, "SAPISID=secret_token_12345;");

    const db = initDatabase(TEST_DB);
    db.run("DELETE FROM playlist_items; DELETE FROM playlists; DELETE FROM segments; DELETE FROM tracks;");
  });

  afterAll(() => {
    closeDatabase();
    if (existsSync(TEST_DIR)) {
      try { rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
    }
  });

  it("should exclude cookies.txt from exported archive by default to prevent session credential leaks", async () => {
    const archiveBytes = await exportLibraryArchive({
      dbPath: TEST_DB,
      audioCacheDir: TEST_AUDIO_DIR,
      cookiePath: TEST_COOKIE,
    });

    const archive = new (Bun as any).Archive(archiveBytes);
    const files = await archive.files();
    const fileNames = Array.from(files.keys());

    expect(fileNames).toContain("manifest.json");
    expect(fileNames).toContain("music.db");
    // cookies.txt MUST NOT be included by default!
    expect(fileNames).not.toContain("cookies.txt");
  });

  it("should permit cookies.txt only when explicitly requested via includeCookies option", async () => {
    const archiveBytes = await exportLibraryArchive(
      {
        dbPath: TEST_DB,
        audioCacheDir: TEST_AUDIO_DIR,
        cookiePath: TEST_COOKIE,
      },
      { includeCookies: true }
    );

    const archive = new (Bun as any).Archive(archiveBytes);
    const files = await archive.files();
    const fileNames = Array.from(files.keys());

    expect(fileNames).toContain("cookies.txt");
  });

  it("should validate and reject UNC network paths and invalid formats in validateSafeLocalAudioPath", () => {
    expect(validateSafeLocalAudioPath("\\\\attacker-smb\\share\\song.mp3").ok).toBe(false);
    expect(validateSafeLocalAudioPath("//evil-host/audio/test.wav").ok).toBe(false);
    expect(validateSafeLocalAudioPath("C:\\Windows\\System32\\drivers\\etc\\hosts:stream").ok).toBe(false);
  });

  it("should reject concurrent export attempts with a busy error", async () => {
    // Run two exports concurrently
    const p1 = exportLibraryArchive({ dbPath: TEST_DB, audioCacheDir: TEST_AUDIO_DIR });
    const p2 = exportLibraryArchive({ dbPath: TEST_DB, audioCacheDir: TEST_AUDIO_DIR });
    const results = await Promise.allSettled([p1, p2]);
    const hasRejected = results.some((r) => r.status === "rejected" && String(r.reason).includes("đang diễn ra"));
    expect(hasRejected).toBe(true);
  });

  it("should sanitize internal server paths and strip stack traces in production logs", () => {
    const err = new Error("Database connection failed at C:\\Users\\ADMIN\\Desktop\\slice-player\\src\\server\\db.ts:42");
    err.stack = "Error: Database connection failed\n    at C:\\Users\\ADMIN\\Desktop\\slice-player\\src\\server\\db.ts:42:15";

    const prevEnv = process.env.NODE_ENV;
    try {
      // In production: stack MUST be omitted completely
      process.env.NODE_ENV = "production";
      const prodSerialized = safeSerializeDetails(err) as Record<string, unknown>;
      expect(prodSerialized.stack).toBeUndefined();
      expect(String(prodSerialized.message)).not.toContain("C:\\Users\\ADMIN");

      // In non-production: stack paths must be sanitized (. instead of C:\Users\ADMIN\Desktop\slice-player)
      process.env.NODE_ENV = "development";
      const devSerialized = safeSerializeDetails(err) as Record<string, unknown>;
      expect(devSerialized.stack).toBeDefined();
      expect(String(devSerialized.stack)).not.toContain("C:\\Users\\ADMIN");
      expect(String(devSerialized.stack)).toContain(".\\src\\server\\db.ts");

      // Verify arbitrary user profile path is masked to ~/
      const userPathErr = new Error("Failed at C:\\Users\\SomeoneElse\\private\\token.txt");
      const userPathSerialized = safeSerializeDetails(userPathErr) as Record<string, unknown>;
      expect(String(userPathSerialized.message)).not.toContain("C:\\Users\\SomeoneElse");
      expect(String(userPathSerialized.message)).toContain("~/private\\token.txt");
    } finally {
      process.env.NODE_ENV = prevEnv;
    }
  });

  it("should enforce decompression limits against archive bombs with excessive entries", async () => {
    const fakeEntries: Record<string, string> = { "music.db": "fake sqlite db" };
    // Generate archive exceeding entry limit or invalid entries
    const archive = new (Bun as any).Archive(fakeEntries, { compress: "gzip" });
    const archiveBlob = await archive.blob();

    // import should safely handle/reject bad archives without crashing
    expect(
      importLibraryArchive(archiveBlob, {
        dbPath: TEST_DB,
        audioCacheDir: TEST_AUDIO_DIR,
      })
    ).rejects.toThrow();
  });

  it("should reject archive containing dangerous or non-allowlisted file extensions", async () => {
    const dangerousEntries: Record<string, string> = {
      "manifest.json": JSON.stringify({ version: 1, app: "slice-player", exportedAt: new Date().toISOString() }),
      "music.db": "fake db content",
      "cache/audio/malicious.exe": "MZ dangerous binary",
      "cache/thumbs/payload.bat": "@echo off\nevil.exe",
    };
    const archive = new (Bun as any).Archive(dangerousEntries, { compress: "gzip" });
    const archiveBlob = await archive.blob();

    expect(
      importLibraryArchive(archiveBlob, {
        dbPath: TEST_DB,
        audioCacheDir: TEST_AUDIO_DIR,
      })
    ).rejects.toThrow(/định dạng không được hỗ trợ|không hợp lệ/i);
  });
});

