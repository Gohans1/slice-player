import type { PlayRecord } from "@/server/types";

// Last.fm's rule: a song longer than 30 seconds counts once half of it, or 4 minutes of it, has been heard
export function playThreshold(lengthSeconds: number): number | null {
  return lengthSeconds > 30 ? Math.min(lengthSeconds / 2, 240) : null;
}

// Playback reports its position about every 100ms; a longer step is a seek, which isn't listening
const MAX_LISTEN_STEP = 2;

// Adds up the time heard from the positions playback reports. True once: when that first reaches the threshold
export function createListenCounter(lengthSeconds: number, startTime: number): (time: number) => boolean {
  const threshold = playThreshold(lengthSeconds);
  let heard = 0;
  let last = startTime;
  let counted = false;
  return (time) => {
    const step = time - last;
    last = time;
    if (step > 0 && step <= MAX_LISTEN_STEP) heard += step;
    if (counted || threshold === null || heard < threshold) return false;
    counted = true;
    return true;
  };
}

export async function postPlay(play: PlayRecord): Promise<void> {
  try {
    const res = await fetch("/api/plays", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(play),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (e) {
    console.error("[Plays] Failed to record a play:", e);
  }
}
