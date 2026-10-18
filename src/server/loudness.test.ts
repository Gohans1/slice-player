import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initDatabase, closeDatabase, createTrack, getTrack, updateTrack } from "./db";
import { serverEvents } from "./events";
import { measureLoudness, measureMissingLoudness } from "./loudness";

const SANDBOX = mkdtempSync(join(tmpdir(), "slice-player-loudness-"));

// A 1kHz tone at the given amplitude, as a lossy file like the library's downloads
async function tone(name: string, amplitude: number): Promise<string> {
  const path = join(SANDBOX, `${name}.opus`);
  const proc = Bun.spawn([
    "ffmpeg", "-v", "error", "-y",
    "-f", "lavfi", "-i", `aevalsrc=${amplitude}*sin(2*PI*1000*t):d=4`,
    "-c:a", "libopus", path,
  ]);
  await proc.exited;
  return path;
}

let loudTone: string;
let quietTone: string;

beforeAll(async () => {
  initDatabase(join(SANDBOX, "music.db"));
  [loudTone, quietTone] = await Promise.all([tone("loud", 0.5), tone("quiet", 0.25)]);
});

afterAll(() => {
  closeDatabase();
  rmSync(SANDBOX, { recursive: true, force: true });
});

function readySong(id: string, filePath: string) {
  return createTrack({ id, source_type: "local", source_uri: filePath, title: id, duration: 4, file_path: filePath, status: "ready" });
}

describe("Sound Check loudness", () => {
  it("measures a song's loudness and true peak", async () => {
    const [loud, quiet] = await Promise.all([measureLoudness(loudTone), measureLoudness(quietTone)]);

    // Half the amplitude is 6 dB quieter, in loudness and in peak
    expect(loud!.loudness - quiet!.loudness).toBeCloseTo(6, 0);
    expect(loud!.true_peak).toBeCloseTo(-6, 0);
    expect(quiet!.true_peak).toBeCloseTo(-12, 0);
  });

  it("gives no measurement for a file it can't read", async () => {
    expect(await measureLoudness(join(SANDBOX, "missing.opus"))).toBeNull();
  });

  it("measures the ready songs not measured yet, and tells clients once they are", async () => {
    readySong("trk_unmeasured", loudTone);
    const events: unknown[] = [];
    const listener = (payload: unknown) => events.push(payload);
    serverEvents.on("track_updated", listener);

    await measureMissingLoudness();
    serverEvents.off("track_updated", listener);

    expect(getTrack("trk_unmeasured")?.loudness).toBeNumber();
    expect(getTrack("trk_unmeasured")?.true_peak).toBeCloseTo(-6, 0);
    expect(events).toEqual([{ reason: "loudness" }]);
  });

  it("measures a song again when its file is replaced", async () => {
    readySong("trk_replaced", loudTone);
    await measureMissingLoudness();

    updateTrack("trk_replaced", { file_path: quietTone });
    expect(getTrack("trk_replaced")?.loudness).toBeNull();
    await measureMissingLoudness();

    expect(getTrack("trk_replaced")?.true_peak).toBeCloseTo(-12, 0);
  });
});
