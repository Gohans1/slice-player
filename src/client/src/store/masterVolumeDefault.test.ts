import { describe, it, expect, afterEach, mock } from "bun:test";
import { GlobalWindow } from "happy-dom";

class FakeAudio extends EventTarget {
  static last: FakeAudio | null = null;
  crossOrigin = "";
  preload = "";
  currentTime = 0;
  paused = true;
  src = "";
  volume = 1;
  constructor() {
    super();
    FakeAudio.last = this;
  }
  pause() {}
  play() {
    return Promise.resolve();
  }
  load() {
    this.dispatchEvent(new Event("canplay"));
  }
  removeAttribute(attr: string) {
    if (attr === "src") this.src = "";
  }
}

// First run: nothing saved yet.
Object.assign(globalThis, { Audio: FakeAudio, window: new GlobalWindow({ url: "http://localhost/" }) });

const { usePlayerStore } = await import("./usePlayerStore");
const { volumeToGain } = await import("../lib/audio");
import type { Track, Segment } from "@/server/types";

describe("Global master volume on first run", () => {
  afterEach(() => {
    mock.restore();
  });

  it("starts in the middle (50%) so it can go either way", async () => {
    const track: Track = {
      id: "trk_default",
      source_type: "local",
      source_uri: "local://default.mp3",
      title: "Default",
      duration: 120,
      status: "ready",
      volume: 0.8,
    };
    const seg: Segment = { id: "seg_default", track_id: track.id, name: "S", start_time: 0, end_time: 30 };

    await usePlayerStore.getState().playSegment(seg, track, 0);

    expect(usePlayerStore.getState().masterVolume).toBe(0.5);
    expect(FakeAudio.last!.volume).toBeCloseTo(volumeToGain(0.8) * volumeToGain(0.5), 6);
  });
});
