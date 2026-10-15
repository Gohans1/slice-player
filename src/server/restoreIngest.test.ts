import { afterAll, beforeAll, expect, it, mock } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setImmediate } from "node:timers/promises";
import { initDatabase, closeDatabase, createTrack, createSegment, getTrack, listSegmentsByTrack } from "./db";

// Only the long-running waveform boundary is controlled; ingestion, SQLite, archive IO
// and restore all run for real, entirely outside the user's library.
let entered: () => void;
let release: () => void;
let draining: () => void;
let peaks: Promise<number[]>;
mock.module("./waveform", () => ({
  generatePeaks: () => { entered(); return peaks; },
  isWaveformBusy: () => false,
  abortWaveformProcesses: async () => { draining(); },
  cancelWaveformForFile: async () => {},
}));
const { ingestLocalFile } = await import("./ingest");
const { exportLibraryArchive, importLibraryArchive } = await import("./backup");
const cwd = process.cwd();
const sandbox = mkdtempSync(join(tmpdir(), "slice-restore-ingest-"));
let input: string;

beforeAll(async () => {
  process.chdir(sandbox);
  mkdirSync("fixtures");
  input = resolve("fixtures/one-second.wav");
  const proc = Bun.spawn(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "sine=duration=1", input], { stderr: "pipe" });
  expect(await proc.exited).toBe(0);
});
afterAll(() => {
  closeDatabase();
  process.chdir(cwd);
  rmSync(sandbox, { recursive: true, force: true });
});

it("waits for an in-flight ingest before installing restored durations and slices", async () => {
  const dbPath = resolve("data/test.db");
  initDatabase(dbPath);
  const normalized = process.platform === "win32" ? input.toLowerCase() : input;
  const trackId = "loc_" + createHash("md5").update(normalized).digest("hex").slice(0, 12);
  createTrack({ id: trackId, source_type: "local", source_uri: input, title: "Restored", duration: 60, status: "ready", file_path: input });
  createSegment({ id: "restored-slice", track_id: trackId, name: "Keep", start_time: 45, end_time: 50 });
  const paths = { dbPath };
  const archive = await exportLibraryArchive(paths);
  const reachedPeaks = new Promise<void>((fulfill) => { entered = fulfill; });
  const reachedDrain = new Promise<void>((fulfill) => { draining = fulfill; });
  peaks = new Promise<number[]>((fulfill) => { release = () => fulfill([0.1]); });
  const ingesting = ingestLocalFile(input);
  await reachedPeaks;
  const restoring = importLibraryArchive(archive, paths);
  try {
    await reachedDrain;
    // After staging, restore has no pending IO before commit except draining ingest.
    // Yield one event-loop turn: the old implementation finishes restoring here.
    await setImmediate();
  } finally {
    release();
  }
  await Promise.all([ingesting, restoring]);
  expect(getTrack(trackId)?.duration).toBe(60);
  expect(listSegmentsByTrack(trackId).map((segment) => segment.id)).toEqual(["restored-slice"]);
});

it("rejects new ingestion for the entire restore, including archive staging", async () => {
  const paths = { dbPath: resolve("data/test.db") };
  const archive = await exportLibraryArchive(paths);
  peaks = Promise.resolve([0.1]);
  const restoring = importLibraryArchive(archive, paths);
  const result = await ingestLocalFile(input);
  await restoring;
  expect(result.success).toBe(false);
});
