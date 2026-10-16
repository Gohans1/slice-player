import type { PlayRecord } from "@/server/types";

// Last.fm's rule: a song longer than 30 seconds counts once half of it, or 4 minutes of it, has been heard
export function playThreshold(lengthSeconds: number): number | null {
  return lengthSeconds > 30 ? Math.min(lengthSeconds / 2, 240) : null;
}

/*
  Adds up the time heard, from where playback reports it is (seconds) and when (a monotonic clock, ms). Each report adds
  as far as playback moved on, but no more than the clock did: a seek of any size adds no more than the moment it took,
  and a pause adds nothing. True once: when the time heard first reaches the threshold.
*/
export function createListenCounter(lengthSeconds: number, startTime: number, startedAt: number): (time: number, at: number) => boolean {
  const threshold = playThreshold(lengthSeconds);
  let heard = 0;
  let last = { time: startTime, at: startedAt };
  let counted = false;
  return (time, at) => {
    const step = Math.min(time - last.time, (at - last.at) / 1000);
    last = { time, at };
    if (step > 0) heard += step;
    if (counted || threshold === null || heard < threshold) return false;
    counted = true;
    return true;
  };
}

// True once recorded
export async function postPlay(play: PlayRecord): Promise<boolean> {
  try {
    const res = await fetch("/api/plays", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(play),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return true;
  } catch (e) {
    console.error("[Plays] Failed to record a play:", e);
    return false;
  }
}
