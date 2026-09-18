import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readdirSync, unlinkSync, copyFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { getDb, initDatabase, closeDatabase, healTrackFilePaths } from "./db";
import { abortIngestProcesses } from "./ingest";
import { abortWaveformProcesses } from "./waveform";
import { serverEvents } from "./events";
import { logEvent } from "./logger";

export interface BackupPaths {
  dbPath?: string;
  audioCacheDir?: string;
  thumbCacheDir?: string;
  cookiePath?: string;
}

export interface LibraryManifest {
  version: number;
  app: string;
  exportedAt: string;
  trackCount: number;
  segmentCount: number;
  playlistCount: number;
}

let isRestoring = false;

/**
 * Returns true if a library restore operation is currently in progress.
 */
export function isLibraryRestoring(): boolean {
  return isRestoring;
}

const INVALID_WINDOWS_NAMES = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i;

/**
 * Security check: Prevents Zip-slip / Tar-slip directory traversal,
 * NTFS alternate data streams, and DOS device names.
 */
export function isSafeArchiveFilename(fileName: string): boolean {
  if (!fileName || typeof fileName !== "string") return false;
  if (fileName.includes("/") || fileName.includes("\\") || fileName.includes("..")) return false;
  if (fileName === "." || fileName === "..") return false;
  if (fileName.includes(":")) return false;
  if (INVALID_WINDOWS_NAMES.test(fileName)) return false;
  if (/[\x00-\x1f\x7f]/.test(fileName)) return false;
  return true;
}

/**
 * Export the entire library (music.db, audio cache, thumbs, cookies.txt, manifest) into a gzipped tar archive.
 */
export async function exportLibraryArchive(paths: BackupPaths = {}): Promise<Uint8Array> {
  const dbPath = resolve(paths.dbPath || "./data/music.db");
  const audioCacheDir = resolve(paths.audioCacheDir || "./data/cache/audio");
  const thumbCacheDir = resolve(paths.thumbCacheDir || "./data/cache/thumbs");
  const cookiePath = resolve(paths.cookiePath || "./data/cookies.txt");

  const db = getDb();
  // Checkpoint SQLite WAL to truncate write-ahead log into main database file
  try {
    db.run("PRAGMA wal_checkpoint(TRUNCATE);");
  } catch {}

  const dbFile = Bun.file(dbPath);
  if (!(await dbFile.exists())) {
    throw new Error(`Database file not found at: ${dbPath}`);
  }

  const trackCount = (db.query("SELECT COUNT(*) as count FROM tracks").get() as any)?.count ?? 0;
  const segmentCount = (db.query("SELECT COUNT(*) as count FROM segments").get() as any)?.count ?? 0;
  const playlistCount = (db.query("SELECT COUNT(*) as count FROM playlists").get() as any)?.count ?? 0;

  const manifest: LibraryManifest = {
    version: 1,
    app: "slice-player",
    exportedAt: new Date().toISOString(),
    trackCount,
    segmentCount,
    playlistCount,
  };

  const archiveFiles: Record<string, Uint8Array | string> = {};
  archiveFiles["manifest.json"] = JSON.stringify(manifest, null, 2);
  archiveFiles["music.db"] = await dbFile.bytes();

  if (existsSync(cookiePath)) {
    try {
      const cookieFile = Bun.file(cookiePath);
      if (await cookieFile.exists()) {
        archiveFiles["cookies.txt"] = await cookieFile.bytes();
      }
    } catch {}
  }

  // Add cached audio files
  if (existsSync(audioCacheDir)) {
    const audioFiles = readdirSync(audioCacheDir);
    for (const f of audioFiles) {
      if (f.endsWith(".part") || f.endsWith(".ytdl")) continue;
      if (!isSafeArchiveFilename(f)) continue;
      const fPath = join(audioCacheDir, f);
      try {
        const fileObj = Bun.file(fPath);
        if (await fileObj.exists()) {
          archiveFiles[`cache/audio/${f}`] = await fileObj.bytes();
        }
      } catch {}
    }
  }

  // Add cached thumbnail files
  if (existsSync(thumbCacheDir)) {
    const thumbFiles = readdirSync(thumbCacheDir);
    for (const f of thumbFiles) {
      if (!isSafeArchiveFilename(f)) continue;
      const fPath = join(thumbCacheDir, f);
      try {
        const fileObj = Bun.file(fPath);
        if (await fileObj.exists()) {
          archiveFiles[`cache/thumbs/${f}`] = await fileObj.bytes();
        }
      } catch {}
    }
  }

  const archive = new (Bun as any).Archive(archiveFiles, { compress: "gzip" });
  const tempDir = resolve("./data");
  mkdirSync(tempDir, { recursive: true });
  const tempPath = join(tempDir, `temp_export_${Date.now()}_${Math.random().toString(36).slice(2)}.tar.gz`);

  let bytes: Uint8Array;
  try {
    await Bun.write(tempPath, archive);
    bytes = await Bun.file(tempPath).bytes();
  } finally {
    if (existsSync(tempPath)) {
      try { unlinkSync(tempPath); } catch {}
    }
  }

  logEvent("info", "system", `Xuất thư viện thành công: ${trackCount} bài, ${segmentCount} lát cắt, ${playlistCount} playlist`);
  return bytes;
}

/**
 * Import and restore library from a gzipped tar archive with path self-healing,
 * atomic database swap, rollback safeguard on corruption/failure, and traversal protection.
 */
export async function importLibraryArchive(
  archiveBytes: Uint8Array,
  paths: BackupPaths = {}
): Promise<{ success: boolean; manifest?: LibraryManifest; message: string }> {
  if (isRestoring) {
    throw new Error("Một tiến trình khôi phục thư viện đang diễn ra. Vui lòng đợi trong giây lát.");
  }

  if (!archiveBytes || archiveBytes.length < 50) {
    throw new Error("Dữ liệu file backup không hợp lệ hoặc quá nhỏ.");
  }

  isRestoring = true;

  const targetDbPath = resolve(paths.dbPath || "./data/music.db");
  const targetAudioCacheDir = resolve(paths.audioCacheDir || "./data/cache/audio");
  const targetThumbCacheDir = resolve(paths.thumbCacheDir || "./data/cache/thumbs");
  const targetCookiePath = resolve(paths.cookiePath || "./data/cookies.txt");

  const incomingTmpPath = `${targetDbPath}.incoming.tmp`;
  const rollbackBakPath = `${targetDbPath}.rollback.bak`;
  const rollbackWalPath = `${targetDbPath}-wal.rollback.bak`;
  const rollbackShmPath = `${targetDbPath}-shm.rollback.bak`;

  try {
    let archive: any;
    let files: Map<string, any>;
    try {
      archive = new (Bun as any).Archive(archiveBytes);
      files = await archive.files();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Không thể giải nén file backup: ${msg}`);
    }

    if (!files.has("music.db")) {
      throw new Error("File backup không hợp lệ: thiếu file music.db cơ sở dữ liệu.");
    }

    let manifest: LibraryManifest | undefined;
    if (files.has("manifest.json")) {
      try {
        manifest = JSON.parse(await files.get("manifest.json").text());
      } catch {}
    }

    // Stage incoming database to temporary file and strictly validate integrity BEFORE touching active database
    mkdirSync(dirname(targetDbPath), { recursive: true });
    const dbFile = files.get("music.db");
    const dbBytes = await dbFile.bytes();
    await Bun.write(incomingTmpPath, dbBytes);

    let tempDb: Database | null = null;
    try {
      tempDb = new Database(incomingTmpPath, { readonly: true });
      const checkRow = tempDb.query("PRAGMA quick_check;").get() as { quick_check: string } | null;
      if (!checkRow || checkRow.quick_check !== "ok") {
        throw new Error(`File cơ sở dữ liệu bị lỗi hỏng (quick_check: ${checkRow?.quick_check || "failed"})`);
      }
      const tables = tempDb.query("SELECT name FROM sqlite_master WHERE type='table';").all() as { name: string }[];
      const tableNames = new Set(tables.map((t) => t.name));
      if (!tableNames.has("tracks") || !tableNames.has("segments")) {
        throw new Error("File cơ sở dữ liệu không hợp lệ: thiếu cấu trúc bảng của Slice Player.");
      }
    } finally {
      if (tempDb) {
        try { tempDb.close(true); } catch {}
      }
    }

    // Abort active background ingest/waveform operations and close database connection
    try { await abortIngestProcesses(); } catch {}
    try { await abortWaveformProcesses(); } catch {}
    closeDatabase();

    // Create rollback backup of current active database if it exists
    let hasBackup = false;
    if (existsSync(targetDbPath)) {
      try {
        copyFileSync(targetDbPath, rollbackBakPath);
        if (existsSync(`${targetDbPath}-wal`)) copyFileSync(`${targetDbPath}-wal`, rollbackWalPath);
        if (existsSync(`${targetDbPath}-shm`)) copyFileSync(`${targetDbPath}-shm`, rollbackShmPath);
        hasBackup = true;
      } catch (backupErr) {
        console.warn("[backup] Không thể sao lưu dự phòng trước khi ghi đè:", backupErr);
      }
    }

    // Ensure target directories exist
    mkdirSync(targetAudioCacheDir, { recursive: true });
    mkdirSync(targetThumbCacheDir, { recursive: true });

    try {
      // Atomic swap: Copy validated incoming database over target database
      copyFileSync(incomingTmpPath, targetDbPath);
      try { unlinkSync(incomingTmpPath); } catch {}
      try { unlinkSync(`${targetDbPath}-wal`); } catch {}
      try { unlinkSync(`${targetDbPath}-shm`); } catch {}

      // Write cookies.txt if present
      if (files.has("cookies.txt")) {
        try {
          const cookieFile = files.get("cookies.txt");
          const cookieBytes = await cookieFile.bytes();
          await Bun.write(targetCookiePath, cookieBytes);
        } catch {}
      }

      // Write audio and thumbnail files with traversal protection
      for (const [archivePath, file] of files) {
        if (archivePath.startsWith("cache/audio/")) {
          const fileName = archivePath.slice("cache/audio/".length);
          if (isSafeArchiveFilename(fileName)) {
            const dest = join(targetAudioCacheDir, fileName);
            await Bun.write(dest, await file.bytes());
          }
        } else if (archivePath.startsWith("cache/thumbs/")) {
          const fileName = archivePath.slice("cache/thumbs/".length);
          if (isSafeArchiveFilename(fileName)) {
            const dest = join(targetThumbCacheDir, fileName);
            await Bun.write(dest, await file.bytes());
          }
        }
      }

      // Re-initialize database with self-healing paths
      initDatabase(targetDbPath);
      healTrackFilePaths(targetAudioCacheDir);

      // On successful restore, remove rollback backups
      if (hasBackup) {
        try { unlinkSync(rollbackBakPath); } catch {}
        try { unlinkSync(rollbackWalPath); } catch {}
        try { unlinkSync(rollbackShmPath); } catch {}
      }
    } catch (stageErr) {
      // Rollback to original database on any failure
      console.error("[backup] Lỗi trong quá trình khôi phục, tiến hành rollback về DB cũ:", stageErr);
      if (hasBackup && existsSync(rollbackBakPath)) {
        try {
          copyFileSync(rollbackBakPath, targetDbPath);
          if (existsSync(rollbackWalPath)) copyFileSync(rollbackWalPath, `${targetDbPath}-wal`);
          if (existsSync(rollbackShmPath)) copyFileSync(rollbackShmPath, `${targetDbPath}-shm`);
          try { unlinkSync(rollbackBakPath); } catch {}
          try { unlinkSync(rollbackWalPath); } catch {}
          try { unlinkSync(rollbackShmPath); } catch {}
          initDatabase(targetDbPath);
          console.log("[backup] Đã rollback về DB cũ an toàn.");
        } catch (rbErr) {
          console.error("[backup] Rollback thất bại nghiêm trọng:", rbErr);
        }
      }
      throw stageErr;
    }

    // Notify connected clients
    serverEvents.emit("library_restored", { timestamp: Date.now() });
    serverEvents.emit("playlist_items_changed", {});

    const msg = manifest
      ? `Khôi phục thư viện thành công: ${manifest.trackCount} bài, ${manifest.segmentCount} lát cắt, ${manifest.playlistCount} playlist.`
      : "Khôi phục thư viện thành công.";

    logEvent("info", "system", msg);
    return { success: true, manifest, message: msg };
  } finally {
    isRestoring = false;
    if (existsSync(incomingTmpPath)) {
      try { unlinkSync(incomingTmpPath); } catch {}
    }
  }
}
