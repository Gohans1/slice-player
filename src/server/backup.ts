import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readdirSync, unlinkSync, copyFileSync } from "node:fs";
import { join, resolve, dirname, extname } from "node:path";
import { getDb, initDatabase, closeDatabase, healTrackFilePaths } from "./db";
import { abortIngestProcesses, SUPPORTED_AUDIO_EXTENSIONS } from "./ingest";
import { abortWaveformProcesses } from "./waveform";
import { serverEvents } from "./events";
import { logEvent } from "./logger";

export const ALLOWED_THUMB_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"] as const;
export const MAX_COOKIE_FILE_BYTES = 5 * 1024 * 1024; // 5 MB

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
let isExporting = false;

/**
 * Returns true if a library restore operation is currently in progress.
 */
export function isLibraryRestoring(): boolean {
  return isRestoring;
}

/**
 * Returns true if a library export operation is currently in progress.
 */
export function isLibraryExporting(): boolean {
  return isExporting;
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

export const MAX_TOTAL_EXTRACTED_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB
export const MAX_ARCHIVE_ENTRIES = 10_000;
export const MAX_AUDIO_FILE_BYTES = 350 * 1024 * 1024; // 350 MB
export const MAX_THUMB_FILE_BYTES = 15 * 1024 * 1024; // 15 MB
export const MAX_DB_FILE_BYTES = 500 * 1024 * 1024; // 500 MB

/**
 * Export the entire library (music.db, audio cache, thumbs, cookies.txt, manifest) into a gzipped tar archive.
 */
export async function exportLibraryArchive(
  paths: BackupPaths = {},
  options: { includeCookies?: boolean } = {}
): Promise<Blob> {
  if (isExporting) {
    throw new Error("Một tiến trình xuất thư viện đang diễn ra. Vui lòng đợi trong giây lát.");
  }
  isExporting = true;
  try {
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

    const archiveFiles: Record<string, any> = {};
    archiveFiles["manifest.json"] = JSON.stringify(manifest, null, 2);
    archiveFiles["music.db"] = await dbFile.bytes();

    // Only include cookies if explicitly requested (prevents session token leaks)
    if (options.includeCookies && existsSync(cookiePath)) {
      try {
        const cookieFile = Bun.file(cookiePath);
        if (await cookieFile.exists()) {
          archiveFiles["cookies.txt"] = cookieFile;
        }
      } catch {}
    }

    // Add cached audio files as lazy file handles to prevent unbounded heap memory buffering
    if (existsSync(audioCacheDir)) {
      const audioFiles = readdirSync(audioCacheDir);
      for (const f of audioFiles) {
        if (f.endsWith(".part") || f.endsWith(".ytdl")) continue;
        if (!isSafeArchiveFilename(f)) continue;
        const fPath = join(audioCacheDir, f);
        try {
          const fileObj = Bun.file(fPath);
          if (await fileObj.exists()) {
            archiveFiles[`cache/audio/${f}`] = fileObj;
          }
        } catch {}
      }
    }

    // Add cached thumbnail files as lazy file handles
    if (existsSync(thumbCacheDir)) {
      const thumbFiles = readdirSync(thumbCacheDir);
      for (const f of thumbFiles) {
        if (!isSafeArchiveFilename(f)) continue;
        const fPath = join(thumbCacheDir, f);
        try {
          const fileObj = Bun.file(fPath);
          if (await fileObj.exists()) {
            archiveFiles[`cache/thumbs/${f}`] = fileObj;
          }
        } catch {}
      }
    }

    const archive = new (Bun as any).Archive(archiveFiles, { compress: "gzip" });
    const blob: Blob = await archive.blob();

    logEvent("info", "system", `Xuất thư viện thành công: ${trackCount} bài, ${segmentCount} lát cắt, ${playlistCount} playlist`);
    return blob;
  } finally {
    isExporting = false;
  }
}

/**
 * Import and restore library from a gzipped tar archive with path self-healing,
 * atomic database swap, rollback safeguard on corruption/failure, and traversal protection.
 */
export async function importLibraryArchive(
  archiveInput: Uint8Array | Blob,
  paths: BackupPaths = {}
): Promise<{ success: boolean; manifest?: LibraryManifest; message: string }> {
  if (isRestoring) {
    throw new Error("Một tiến trình khôi phục thư viện đang diễn ra. Vui lòng đợi trong giây lát.");
  }

  const inputSize = archiveInput instanceof Blob ? archiveInput.size : archiveInput?.byteLength ?? 0;
  if (!archiveInput || inputSize < 50) {
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
      archive = new (Bun as any).Archive(archiveInput);
      files = await archive.files();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Không thể giải nén file backup: ${msg}`);
    }

    if (!files.has("music.db")) {
      throw new Error("File backup không hợp lệ: thiếu file music.db cơ sở dữ liệu.");
    }

    if (files.size > MAX_ARCHIVE_ENTRIES) {
      throw new Error(`File backup vượt quá giới hạn số lượng file cho phép (${files.size} > ${MAX_ARCHIVE_ENTRIES}).`);
    }

    // Validate all file paths and extensions upfront to reject malicious archives early
    for (const archivePath of files.keys()) {
      if (archivePath === "manifest.json" || archivePath === "music.db" || archivePath === "cookies.txt") {
        continue;
      }
      if (archivePath.startsWith("cache/audio/")) {
        const fileName = archivePath.slice("cache/audio/".length);
        const ext = extname(fileName).toLowerCase();
        if (!isSafeArchiveFilename(fileName) || !(SUPPORTED_AUDIO_EXTENSIONS as readonly string[]).includes(ext)) {
          throw new Error(`File âm thanh không hợp lệ hoặc định dạng không được hỗ trợ: ${fileName}`);
        }
      } else if (archivePath.startsWith("cache/thumbs/")) {
        const fileName = archivePath.slice("cache/thumbs/".length);
        const ext = extname(fileName).toLowerCase();
        if (!isSafeArchiveFilename(fileName) || !(ALLOWED_THUMB_EXTENSIONS as readonly string[]).includes(ext)) {
          throw new Error(`File ảnh bìa không hợp lệ hoặc định dạng không được hỗ trợ: ${fileName}`);
        }
      } else {
        throw new Error(`File không hợp lệ trong gói lưu trữ: ${archivePath}`);
      }
    }

    let totalExtractedBytes = 0;

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
    if (dbBytes.length > MAX_DB_FILE_BYTES) {
      throw new Error(`File cơ sở dữ liệu vượt quá giới hạn cho phép (${(dbBytes.length / (1024 * 1024)).toFixed(1)}MB > 500MB).`);
    }
    totalExtractedBytes += dbBytes.length;
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
          if (cookieBytes.length > MAX_COOKIE_FILE_BYTES) {
            throw new Error(`File cookies.txt vượt quá giới hạn cho phép (${(cookieBytes.length / (1024 * 1024)).toFixed(1)}MB > 5MB).`);
          }
          totalExtractedBytes += cookieBytes.length;
          if (totalExtractedBytes > MAX_TOTAL_EXTRACTED_BYTES) {
            throw new Error("Tổng dung lượng giải nén vượt quá giới hạn an toàn 5GB.");
          }
          await Bun.write(targetCookiePath, cookieBytes);
        } catch (cookieErr: any) {
          if (cookieErr?.message?.includes("vượt quá giới hạn")) throw cookieErr;
        }
      }

      // Write audio and thumbnail files with traversal and decompression limits protection
      for (const [archivePath, file] of files) {
        if (archivePath.startsWith("cache/audio/")) {
          const fileName = archivePath.slice("cache/audio/".length);
          if (isSafeArchiveFilename(fileName)) {
            const fileBytes = await file.bytes();
            if (fileBytes.length > MAX_AUDIO_FILE_BYTES) {
              throw new Error(`File âm thanh ${fileName} vượt quá giới hạn cho phép (${(fileBytes.length / (1024 * 1024)).toFixed(1)}MB > 350MB).`);
            }
            totalExtractedBytes += fileBytes.length;
            if (totalExtractedBytes > MAX_TOTAL_EXTRACTED_BYTES) {
              throw new Error("Tổng dung lượng giải nén vượt quá giới hạn an toàn 5GB.");
            }
            const dest = join(targetAudioCacheDir, fileName);
            await Bun.write(dest, fileBytes);
          }
        } else if (archivePath.startsWith("cache/thumbs/")) {
          const fileName = archivePath.slice("cache/thumbs/".length);
          if (isSafeArchiveFilename(fileName)) {
            const fileBytes = await file.bytes();
            if (fileBytes.length > MAX_THUMB_FILE_BYTES) {
              throw new Error(`File ảnh bìa ${fileName} vượt quá giới hạn cho phép (${(fileBytes.length / (1024 * 1024)).toFixed(1)}MB > 15MB).`);
            }
            totalExtractedBytes += fileBytes.length;
            if (totalExtractedBytes > MAX_TOTAL_EXTRACTED_BYTES) {
              throw new Error("Tổng dung lượng giải nén vượt quá giới hạn an toàn 5GB.");
            }
            const dest = join(targetThumbCacheDir, fileName);
            await Bun.write(dest, fileBytes);
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
