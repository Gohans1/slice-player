import { expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initDatabase, closeDatabase, createTrack, getTrack } from "./db";
import { resolveAudioSource } from "./audioSource";

it("serves a cached fallback without persisting a stale read's path into SQLite", async () => {
  const dir = mkdtempSync(join(tmpdir(), "slice-stream-source-"));
  try {
    initDatabase(join(dir, "test.db"));
    const missing = join(dir, "old-machine", "song.wav");
    const cache = join(dir, "cache");
    mkdirSync(cache);
    writeFileSync(join(cache, "song.wav"), "cached audio");
    const track = createTrack({ id: "track", source_type: "local", source_uri: missing, title: "Track", duration: 60, status: "ready", file_path: missing });
    const source = await resolveAudioSource(missing, cache);
    expect("error" in source).toBe(false);
    if ("error" in source) throw new Error(source.error);
    expect(await source.file.text()).toBe("cached audio");
    expect(getTrack(track.id)?.file_path).toBe(missing);
  } finally {
    closeDatabase();
    rmSync(dir, { recursive: true, force: true });
  }
});
