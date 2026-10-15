export const MAX_BACKUP_REQUEST_BYTES = 2 * 1024 * 1024 * 1024;
// The app uploads one FormData file; reserve ample room for its multipart framing.
export const MAX_EXPORTED_BACKUP_BYTES = MAX_BACKUP_REQUEST_BYTES - 1024 * 1024;
export const MAX_COOKIE_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_TOTAL_EXTRACTED_BYTES = 5 * 1024 * 1024 * 1024;
export const MAX_ARCHIVE_ENTRIES = 10_000;
export const MAX_AUDIO_FILE_BYTES = 350 * 1024 * 1024;
export const MAX_THUMB_FILE_BYTES = 15 * 1024 * 1024;
export const MAX_DB_FILE_BYTES = 500 * 1024 * 1024;

export function assertExportFitsRestore(entries: readonly { name: string; size: number }[]): void {
  if (entries.length > MAX_ARCHIVE_ENTRIES) throw new Error("Backup entry count exceeds restore limits.");
  let totalBytes = 0;
  let tarBytes = 1024; // end-of-archive records
  for (const entry of entries) {
    let limit = MAX_THUMB_FILE_BYTES;
    if (entry.name === "music.db") limit = MAX_DB_FILE_BYTES;
    else if (entry.name === "cookies.txt") limit = MAX_COOKIE_FILE_BYTES;
    else if (entry.name.startsWith("cache/audio/")) limit = MAX_AUDIO_FILE_BYTES;
    totalBytes += entry.size;
    // Reserve padded content, headers and PAX path metadata (including long UTF-8 names).
    tarBytes += Math.ceil(entry.size / 512) * 512 + 4096 + Buffer.byteLength(entry.name);
    if (entry.size > limit || totalBytes > MAX_TOTAL_EXTRACTED_BYTES) {
      throw new Error(`Backup file or total size exceeds restore limits: ${entry.name}`);
    }
  }
  // zlib default-parameter deflateBound with an 18-byte gzip wrapper.
  // https://github.com/madler/zlib/blob/develop/deflate.c (no intermediate flushes).
  const gzipBound = tarBytes + Math.floor(tarBytes / 4096) + Math.floor(tarBytes / 16384)
    + Math.floor(tarBytes / 33554432) + 25;
  if (gzipBound > MAX_EXPORTED_BACKUP_BYTES) {
    throw new Error("Backup exceeds the 2GB restore upload limit, including archive and multipart overhead.");
  }
}
