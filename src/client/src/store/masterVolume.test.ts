import { describe, it, expect, beforeEach, afterEach, spyOn, mock } from "bun:test";
import { GlobalWindow } from "happy-dom";

// Capture the <audio> element the engine creates so we can read the gain it actually outputs.
// Without an AudioContext (headless), the engine writes the final gain to audioEl.volume.
class FakeAudio {
  static last: FakeAudio | null = null;
  crossOrigin = "";
  preload = "";
  currentTime = 0;
  src = "";
  volume = 1;
  constructor() {
    FakeAudio.last = this;
  }
  addEventListener() {}
  removeEventListener() {}
  pause() {}
  play() {
    return Promise.resolve();
  }
  load() {}
  removeAttribute(attr: string) {
    if (attr === "src") this.src = "";
  }
}
// A previous session left the master volume at 60%.
const happyWindow = new GlobalWindow();
happyWindow.localStorage.setItem("slice_player_master_volume", "0.6");
Object.assign(globalThis, { Audio: FakeAudio, window: happyWindow });

const { usePlayerStore } = await import("./usePlayerStore");
const { audioEngine, volumeToGain } = await import("../lib/audio");
import type { Track, Segment } from "@/server/types";

const outputGain = () => FakeAudio.last!.volume;

// Captured before any test mutates the store, so the restore test is order-independent.
const masterAtStartup = usePlayerStore.getState().masterVolume;
const trackVolumeAtStartup = audioEngine.getVolume();
const gainAtStartup = outputGain();

describe("Global master volume", () => {
  const trackA: Track = {
    id: "trk_master_a",
    source_type: "local",
    source_uri: "local://a.mp3",
    title: "Track A",
    duration: 180,
    status: "ready",
    volume: 0.7,
  };
  const trackB: Track = {
    id: "trk_master_b",
    source_type: "local",
    source_uri: "local://b.mp3",
    title: "Track B",
    duration: 200,
    status: "ready",
    volume: 0.5,
  };
  const segA: Segment = { id: "seg_master_a", track_id: trackA.id, name: "A", start_time: 0, end_time: 60 };
  const segB: Segment = { id: "seg_master_b", track_id: trackB.id, name: "B", start_time: 0, end_time: 60 };

  beforeEach(() => {
    spyOn(audioEngine, "playSegment").mockResolvedValue();
    spyOn(globalThis, "fetch").mockResolvedValue(new Response()); // only res.ok is read (volume PATCH)

    usePlayerStore.setState({
      tracks: [trackA, trackB],
      activeTrack: null,
      activeSegment: null,
      isPlaying: false,
      queue: [
        { track: trackA, segment: segA },
        { track: trackB, segment: segB },
      ],
      queueIndex: -1,
      playbackMode: "mixed",
      queuesByMode: {
        mixed: [
          { track: trackA, segment: segA },
          { track: trackB, segment: segB },
        ],
        slices_only: [],
        original_only: [],
      },
      sliceStudioTrack: null,
    });
  });

  afterEach(() => {
    mock.restore();
  });

  it("restores the master volume saved by the previous session", () => {
    expect(masterAtStartup).toBe(0.6);
    expect(gainAtStartup).toBeCloseTo(volumeToGain(trackVolumeAtStartup) * volumeToGain(0.6), 6);
  });

  it("scales the playing track's output without changing the track's own volume", async () => {
    await usePlayerStore.getState().playSegment(segA, trackA, 0);

    usePlayerStore.getState().setMasterVolume(0.3);

    const state = usePlayerStore.getState();
    expect(state.masterVolume).toBe(0.3);
    expect(state.activeTrack?.volume).toBe(0.7);
    expect(audioEngine.getVolume()).toBeCloseTo(0.7, 6);
    expect(outputGain()).toBeCloseTo(volumeToGain(0.7) * volumeToGain(0.3), 6);
  });

  it("keeps applying across track switches and per-track volume edits", async () => {
    usePlayerStore.getState().setMasterVolume(0.5);

    await usePlayerStore.getState().playSegment(segA, trackA, 0);
    await usePlayerStore.getState().playSegment(segB, trackB, 1);
    expect(outputGain()).toBeCloseTo(volumeToGain(0.5) * volumeToGain(0.5), 6);

    await usePlayerStore.getState().setTrackVolume(trackB.id, 0.9);
    expect(outputGain()).toBeCloseTo(volumeToGain(0.9) * volumeToGain(0.5), 6);
  });

  it("silences everything at 0 and restores full track volume at 100%", async () => {
    await usePlayerStore.getState().playSegment(segA, trackA, 0);

    usePlayerStore.getState().setMasterVolume(0);
    expect(outputGain()).toBe(0);

    usePlayerStore.getState().setMasterVolume(1);
    expect(outputGain()).toBeCloseTo(volumeToGain(0.7), 6);
  });

  it("persists the master volume for the next session", () => {
    usePlayerStore.getState().setMasterVolume(0.42);

    expect(happyWindow.localStorage.getItem("slice_player_master_volume")).toBe("0.42");
  });

  it("clamps out-of-range and invalid values", () => {
    usePlayerStore.getState().setMasterVolume(1.7);
    expect(usePlayerStore.getState().masterVolume).toBe(1);

    usePlayerStore.getState().setMasterVolume(-0.4);
    expect(usePlayerStore.getState().masterVolume).toBe(0);

    usePlayerStore.getState().setMasterVolume(Number.NaN);
    expect(usePlayerStore.getState().masterVolume).toBe(0.5);
  });
});
