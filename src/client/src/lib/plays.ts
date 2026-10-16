import type { PlayRecord } from "@/server/types";

// Last.fm's rule: a song longer than 30 seconds counts once half of it, or 4 minutes of it, has been heard
export function playThreshold(lengthSeconds: number): number | null {
  return lengthSeconds > 30 ? Math.min(lengthSeconds / 2, 240) : null;
}

// Times are where playback is, in seconds, and when, in ms on a monotonic clock
export interface ListenCounter {
  // Playback reports where it is as it plays. True once: when the time heard first reaches the threshold
  tick: (time: number, at: number) => boolean;
  // Playback carries on from here after a pause; wherever it was moved to meanwhile wasn't heard
  resumeFrom: (time: number, at: number) => void;
}

/*
  Adds up the time heard. Each report adds as far as playback moved on, but no more than the clock did: a seek while
  playing adds no more than the moment it took, and a stall waiting for the stream adds nothing. A pause has no reports
  at all, so resuming sets off from where playback is then.
*/
export function createListenCounter(lengthSeconds: number, startTime: number, startedAt: number): ListenCounter {
  const threshold = playThreshold(lengthSeconds);
  let heard = 0;
  let last = { time: startTime, at: startedAt };
  let counted = false;
  return {
    tick: (time, at) => {
      const step = Math.min(time - last.time, (at - last.at) / 1000);
      last = { time, at };
      if (step > 0) heard += step;
      if (counted || threshold === null || heard < threshold) return false;
      counted = true;
      return true;
    },
    resumeFrom: (time, at) => {
      last = { time, at };
    },
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
