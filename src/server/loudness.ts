import { listTracksToMeasure, setTrackLoudness } from "./db";
import { serverEvents } from "./events";

// Sound Check measures each song once, as ReplayGain 2.0 does: integrated loudness by ITU BS.1770 (EBU R128) and the
// true peak, which tells the player how far it can raise a quiet song. ffmpeg's ebur128 filter does both
export interface Loudness {
  loudness: number;
  true_peak: number;
}

let measuring: ReturnType<typeof Bun.spawn> | null = null;

export async function measureLoudness(filePath: string): Promise<Loudness | null> {
  const proc = Bun.spawn(
    ["ffmpeg", "-nostats", "-hide_banner", "-i", filePath, "-map", "0:a:0", "-af", "ebur128=peak=true:framelog=quiet", "-f", "null", "-"],
    { stdout: "ignore", stderr: "pipe", timeout: 60_000 }
  );
  measuring = proc;
  try {
    const [output, exitCode] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
    if (exitCode !== 0) return null;
    // The summary closes the output: "Integrated loudness: I: -12.4 LUFS" ... "True peak: Peak: 0.4 dBFS"
    const summary = output.slice(output.lastIndexOf("Summary:"));
    const loudness = Number(/I:\s+(\S+) LUFS/.exec(summary)?.[1]);
    const truePeak = Number(/Peak:\s+(\S+) dBFS/.exec(summary)?.[1]);
    // Silence has no loudness to match and a peak of -inf
    return Number.isFinite(loudness) && Number.isFinite(truePeak) ? { loudness, true_peak: truePeak } : null;
  } finally {
    if (measuring === proc) measuring = null;
  }
}

let run: Promise<void> | null = null;
let isRunAgain = false;
let pauseDepth = 0;
// Songs ffmpeg couldn't measure are tried again on the next start, not over and over
const unmeasurable = new Set<string>();

// Measures the ready songs not measured yet, newest first, one at a time. Called again while measuring, it takes in
// songs added since. Clients are told every so often while a backlog is measured, and once it's done
export function measureMissingLoudness(): Promise<void> {
  if (pauseDepth > 0) return Promise.resolve();
  if (run) {
    isRunAgain = true;
    return run;
  }
  run = (async () => {
    let unannounced = 0;
    let announcedAt = Date.now();
    const announce = () => {
      serverEvents.emit("track_updated", { reason: "loudness" });
      unannounced = 0;
      announcedAt = Date.now();
    };
    try {
      do {
        isRunAgain = false;
        for (;;) {
          const next = listTracksToMeasure().find((t) => !unmeasurable.has(t.id));
          if (!next || pauseDepth > 0) break;
          const measured = await measureLoudness(next.file_path);
          if (pauseDepth > 0) break;
          if (!measured) {
            unmeasurable.add(next.id);
            continue;
          }
          setTrackLoudness(next.id, measured.loudness, measured.true_peak);
          unannounced++;
          if (Date.now() - announcedAt > 10_000) announce();
        }
      } while (isRunAgain && pauseDepth === 0);
    } catch (err) {
      console.warn("[Loudness] Measuring stopped:", err);
    } finally {
      run = null;
    }
    if (unannounced > 0 && pauseDepth === 0) announce();
  })();
  return run;
}

// A restore swaps the library's files and database: measuring stops, and starts over once the new library is in
export function pauseMeasuringLoudness(): () => void {
  pauseDepth++;
  unmeasurable.clear();
  measuring?.kill();
  return () => {
    if (--pauseDepth === 0) void measureMissingLoudness();
  };
}
