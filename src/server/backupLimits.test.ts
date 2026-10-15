import { expect, it } from "bun:test";
import { assertExportFitsRestore, MAX_EXPORTED_BACKUP_BYTES } from "./backupLimits";

const CHUNK = 256 * 1024 * 1024;
const files = (count: number) => Array.from({ length: count }, (_, i) => ({ name: `cache/audio/${i}.opus`, size: CHUNK }));

it("rejects a 3 GiB library even though it fits the extracted-size and individual-file limits", () => {
  expect(() => assertExportFitsRestore(files(12))).toThrow();
});

it("includes tar, gzip and multipart overhead instead of accepting payload bytes right up to the upload cap", () => {
  const entries = [...files(7), { name: "cache/audio/last.opus", size: MAX_EXPORTED_BACKUP_BYTES - 7 * CHUNK - 512 }];
  expect(() => assertExportFitsRestore(entries)).toThrow();
});

it("allows a normal library well within the shared upload budget", () => {
  expect(() => assertExportFitsRestore(files(2))).not.toThrow();
});
