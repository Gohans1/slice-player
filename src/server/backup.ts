import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync, renameSync, lstatSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { writeArchive, type ArchiveEntry } from "./archiveWriter";
import { MAX_COOKIE_FILE_BYTES, MAX_TOTAL_EXTRACTED_BYTES, MAX_ARCHIVE_ENTRIES, MAX_AUDIO_FILE_BYTES, MAX_THUMB_FILE_BYTES, MAX_DB_FILE_BYTES, MAX_BACKUP_REQUEST_BYTES, assertExportFitsRestore } from "./backupLimits";
export { MAX_COOKIE_FILE_BYTES, MAX_TOTAL_EXTRACTED_BYTES, MAX_ARCHIVE_ENTRIES, MAX_AUDIO_FILE_BYTES, MAX_THUMB_FILE_BYTES, MAX_DB_FILE_BYTES } from "./backupLimits";
import { join, resolve, dirname, extname } from "node:path";
import { initDatabase, closeDatabase, healTrackFilePaths, getCrossPlatformBasename } from "./db";
import { abortIngestProcesses, pauseIngestOperations, SUPPORTED_AUDIO_EXTENSIONS } from "./ingest";
import { abortWaveformProcesses } from "./waveform";
import { pauseMeasuringLoudness } from "./loudness";
import { serverEvents } from "./events";
import { pauseLibraryMutations, drainLibraryMutations } from "./libraryRequests";
import { logEvent } from "./logger";

export const ALLOWED_THUMB_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"] as const;

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


function readLibrarySnapshot(dbPath: string, audioCacheDir: string) {
  const snapshotDir = mkdtempSync(join(tmpdir(), "slice-export-"));
  let source: Database | undefined;
  let snapshot: Database | undefined;
  try {
    source = new Database(dbPath, { readonly: true });
    const snapshotPath = join(snapshotDir, "music.db");
    // VACUUM INTO includes committed WAL frames even when another reader blocks checkpointing.
    source.query("VACUUM INTO ?").run(snapshotPath);
    snapshot = new Database(snapshotPath);
    const audioFiles = new Map<string, string>();
    if (existsSync(audioCacheDir)) {
      for (const name of readdirSync(audioCacheDir)) {
        const path = join(audioCacheDir, name);
        if (isSafeArchiveFilename(name) && (SUPPORTED_AUDIO_EXTENSIONS as readonly string[]).includes(extname(name).toLowerCase()) && statSync(path).isFile()) {
          audioFiles.set(name, path);
        }
      }
    }
    const tracks = snapshot.query<{ id: string; file_path: string; status: string }, []>(
      "SELECT id, file_path, status FROM tracks WHERE file_path IS NOT NULL"
    ).all();
    const updatePath = snapshot.prepare("UPDATE tracks SET file_path = ? WHERE id = ?");
    snapshot.transaction(() => {
      for (const track of tracks) {
        const originalName = getCrossPlatformBasename(track.file_path);
        const cachedPath = join(audioCacheDir, originalName);
        let sourcePath = resolve(track.file_path);
        if (!existsSync(sourcePath) || !statSync(sourcePath).isFile()) sourcePath = cachedPath;
        if (!existsSync(sourcePath) || !statSync(sourcePath).isFile()) {
          if (track.status === "ready") throw new Error(`Cannot back up missing audio for track: ${track.id}`);
          continue;
        }
        let name = originalName;
        if (sourcePath !== cachedPath || !audioFiles.has(name)) {
          const ext = extname(sourcePath).toLowerCase();
          if (!(SUPPORTED_AUDIO_EXTENSIONS as readonly string[]).includes(ext)) {
            throw new Error(`Unsupported backup audio format for track: ${track.id}`);
          }
          const hash = createHash("sha256").update(track.id).digest("hex");
          name = `local_${hash}${ext}`;
          let suffix = 1;
          while (audioFiles.has(name)) name = `local_${hash}_${suffix++}${ext}`;
          audioFiles.set(name, sourcePath);
        }
        updatePath.run(`cache/audio/${name}`, track.id);
      }
    })();
    const counts = {
      trackCount: snapshot.query<{ count: number }, []>("SELECT COUNT(*) as count FROM tracks").get()!.count,
      segmentCount: snapshot.query<{ count: number }, []>("SELECT COUNT(*) as count FROM segments").get()!.count,
      playlistCount: snapshot.query<{ count: number }, []>("SELECT COUNT(*) as count FROM playlists").get()!.count,
    };
    snapshot.close();
    snapshot = undefined;
    return { bytes: readFileSync(snapshotPath), ...counts, audioFiles };
  } finally {
    snapshot?.close();
    source?.close();
    rmSync(snapshotDir, { recursive: true, force: true });
  }
}

/**
 * Export the entire library (music.db, audio cache, thumbs, cookies.txt, manifest) into a gzipped tar archive.
 */
export async function exportLibraryArchive(
  paths: BackupPaths = {},
  options: { includeCookies?: boolean } = {}
): Promise<ReadableStream<Uint8Array>> {
  if (isExporting || isRestoring) {
    throw new Error("Một tiến trình xuất hoặc khôi phục thư viện đang diễn ra. Vui lòng đợi trong giây lát.");
  }
  isExporting = true;
  let handedOff = false;
  try {
    const dbPath = resolve(paths.dbPath || "./data/music.db");
    const audioCacheDir = resolve(paths.audioCacheDir || "./data/cache/audio");
    const thumbCacheDir = resolve(paths.thumbCacheDir || "./data/cache/thumbs");
    const cookiePath = resolve(paths.cookiePath || "./data/cookies.txt");

    const { bytes: dbBytes, trackCount, segmentCount, playlistCount, audioFiles } = readLibrarySnapshot(dbPath, audioCacheDir);

    const manifest: LibraryManifest = {
      version: 1,
      app: "slice-player",
      exportedAt: new Date().toISOString(),
      trackCount,
      segmentCount,
      playlistCount,
    };

    const entries: ArchiveEntry[] = [
      { name: "manifest.json", data: JSON.stringify(manifest, null, 2) },
      { name: "music.db", data: dbBytes },
    ];
    if (options.includeCookies && existsSync(cookiePath)) entries.push({ name: "cookies.txt", source: cookiePath });
    for (const [name, sourcePath] of audioFiles) {
      entries.push({ name: `cache/audio/${name}`, source: sourcePath });
    }
    if (existsSync(thumbCacheDir)) {
      for (const name of readdirSync(thumbCacheDir)) {
        const path = join(thumbCacheDir, name);
        if (isSafeArchiveFilename(name) && (ALLOWED_THUMB_EXTENSIONS as readonly string[]).includes(extname(name).toLowerCase()) && statSync(path).isFile()) {
          entries.push({ name: `cache/thumbs/${name}`, source: path });
        }
      }
    }

    assertExportFitsRestore(entries.map((entry) => ({
      name: entry.name,
      size: "source" in entry ? statSync(entry.source).size : Buffer.byteLength(entry.data),
    })));

    const stream = writeArchive(entries, (completed) => {
      isExporting = false;
      if (completed) {
        logEvent("info", "system", `Xuất thư viện thành công: ${trackCount} bài, ${segmentCount} lát cắt, ${playlistCount} playlist`);
      }
    });
    handedOff = true;
    return stream;
  } finally {
    if (!handedOff) isExporting = false;
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
  if (isRestoring || isExporting) {
    throw new Error("Một tiến trình xuất hoặc khôi phục thư viện đang diễn ra. Vui lòng đợi trong giây lát.");
  }

  const inputSize = archiveInput instanceof Blob ? archiveInput.size : archiveInput?.byteLength ?? 0;
  if (!archiveInput || inputSize < 50) {
    throw new Error("Dữ liệu file backup không hợp lệ hoặc quá nhỏ.");
  }

  if (inputSize > MAX_BACKUP_REQUEST_BYTES) throw new Error("Backup exceeds the 2GB restore upload limit.");

  isRestoring = true;
  const resumeIngest = pauseIngestOperations();
  const resumeMutations = pauseLibraryMutations();
  const resumeLoudness = pauseMeasuringLoudness();

  const targetDbPath = resolve(paths.dbPath || "./data/music.db");
  const targetAudioCacheDir = resolve(paths.audioCacheDir || "./data/cache/audio");
  const targetThumbCacheDir = resolve(paths.thumbCacheDir || "./data/cache/thumbs");
  const targetCookiePath = resolve(paths.cookiePath || "./data/cookies.txt");

  const stageDirs = new Map<string, string>();
  const staged: { target: string; incoming?: string; previous: string; moved: boolean; installed: boolean }[] = [];
  let keepRecoveryFiles = false;
  let fileIndex = 0;

  function prepareFile(target: string): (typeof staged)[number] {
    const parent = dirname(target);
    let stageDir = stageDirs.get(parent);
    if (!stageDir) {
      mkdirSync(parent, { recursive: true });
      stageDir = mkdtempSync(join(parent, ".slice-restore-"));
      stageDirs.set(parent, stageDir);
    }
    return { target, previous: join(stageDir, `${fileIndex++}.previous`), incoming: undefined, moved: false, installed: false };
  }

  async function stageFile(target: string, bytes: Uint8Array) {
    const entry = prepareFile(target);
    entry.incoming = `${entry.previous}.incoming`;
    await Bun.write(entry.incoming, bytes);
    staged.push(entry);
    return entry.incoming;
  }

  try {
    let archive: any;
    let files: Map<string, any>;
    try {
      archive = new (Bun as any).Archive(archiveInput);
      files = await archive.files();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Không thể giải nén file backup: ${msg}`, { cause: err });
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
    const incomingTmpPath = await stageFile(targetDbPath, dbBytes);

    let tempDb: Database | null = null;
    try {
      tempDb = new Database(incomingTmpPath);
      const checkRow = tempDb.query("PRAGMA quick_check;").get() as { quick_check: string } | null;
      if (!checkRow || checkRow.quick_check !== "ok") {
        throw new Error(`File cơ sở dữ liệu bị lỗi hỏng (quick_check: ${checkRow?.quick_check || "failed"})`);
      }
      const tables = tempDb.query("SELECT name FROM sqlite_master WHERE type='table';").all() as { name: string }[];
      const tableNames = new Set(tables.map((t) => t.name));
      if (!tableNames.has("tracks") || !tableNames.has("segments")) {
        throw new Error("File cơ sở dữ liệu không hợp lệ: thiếu cấu trúc bảng của Slice Player.");
      }
      // Prefer the packaged copy, even if an old absolute path still exists on this machine.
      const tracks = tempDb.query<{ id: string; file_path: string }, []>(
        "SELECT id, file_path FROM tracks WHERE file_path IS NOT NULL"
      ).all();
      const updatePath = tempDb.prepare("UPDATE tracks SET file_path = ? WHERE id = ?");
      tempDb.transaction(() => {
        for (const track of tracks) {
          const name = getCrossPlatformBasename(track.file_path);
          if (isSafeArchiveFilename(name) && files.has(`cache/audio/${name}`)) {
            updatePath.run(join(targetAudioCacheDir, name), track.id);
          }
        }
      })();
    } finally {
      if (tempDb) {
        try { tempDb.close(true); } catch {}
      }
    }

    // Validate and stage EVERY payload before replacing live files, one at a time to bound memory.
    for (const [archivePath, file] of files) {
      let target: string;
      let limit: number;
      if (archivePath === "cookies.txt") {
        target = targetCookiePath;
        limit = MAX_COOKIE_FILE_BYTES;
      } else if (archivePath.startsWith("cache/audio/")) {
        target = join(targetAudioCacheDir, archivePath.slice("cache/audio/".length));
        limit = MAX_AUDIO_FILE_BYTES;
      } else if (archivePath.startsWith("cache/thumbs/")) {
        target = join(targetThumbCacheDir, archivePath.slice("cache/thumbs/".length));
        limit = MAX_THUMB_FILE_BYTES;
      } else {
        continue;
      }
      if (file.size > limit) {
        throw new Error(`File ${archivePath} vượt quá giới hạn cho phép.`);
      }
      const bytes = await file.bytes();
      totalExtractedBytes += bytes.length;
      if (bytes.length > limit || totalExtractedBytes > MAX_TOTAL_EXTRACTED_BYTES) {
        throw new Error(`File ${archivePath} hoặc tổng dung lượng giải nén vượt quá giới hạn cho phép.`);
      }
      await stageFile(target, bytes);
    }

    await abortIngestProcesses();
    await drainLibraryMutations();
    await abortWaveformProcesses();
    closeDatabase();

    // Keep sidecars together with the original DB, including when checkpointing is blocked.
    for (const suffix of ["-wal", "-shm"]) {
      const target = `${targetDbPath}${suffix}`;
      if (existsSync(target)) staged.unshift(prepareFile(target));
    }
    const databaseEntry = staged.find((entry) => entry.target === targetDbPath)!;
    try {
      // Synchronous renames keep the commit free of event-loop interleaving. Originals stay
      // beside their destination (same filesystem) until the new DB has initialized.
      for (const entry of staged) {
        if (existsSync(entry.target)) {
          if (!lstatSync(entry.target).isFile()) {
            throw new Error(`Restore destination is not a regular file: ${entry.target}`);
          }
          renameSync(entry.target, entry.previous);
          entry.moved = true;
        }
        if (entry.incoming) {
          renameSync(entry.incoming, entry.target);
          entry.installed = true;
        }
      }
      initDatabase(targetDbPath);
      healTrackFilePaths(targetAudioCacheDir);
    } catch (restoreError) {
      closeDatabase();
      const rollbackErrors: unknown[] = [];
      if (databaseEntry.installed) {
        for (const suffix of ["-wal", "-shm"]) {
          try { rmSync(`${targetDbPath}${suffix}`, { force: true }); } catch (error) { rollbackErrors.push(error); }
        }
      }
      for (const entry of [...staged].reverse()) {
        try {
          if (entry.installed) unlinkSync(entry.target);
          if (entry.moved) renameSync(entry.previous, entry.target);
        } catch (error) {
          rollbackErrors.push(error);
        }
      }
      try {
        if (existsSync(targetDbPath)) initDatabase(targetDbPath);
      } catch (error) {
        rollbackErrors.push(error);
      }
      if (rollbackErrors.length) {
        keepRecoveryFiles = true;
        throw new AggregateError([restoreError, ...rollbackErrors],
          `Restore rollback failed; recovery files retained in: ${[...stageDirs.values()].join(", ")}`, { cause: restoreError });
      }
      throw restoreError;
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
    resumeIngest();
    resumeMutations();
    resumeLoudness();
    if (!keepRecoveryFiles) {
      for (const stageDir of stageDirs.values()) {
        try { rmSync(stageDir, { recursive: true, force: true }); } catch (error) {
          console.warn("[backup] Could not clean staging directory:", stageDir, error);
        }
      }
    }
  }
}
