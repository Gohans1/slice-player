import { describe, it, expect, beforeEach, afterEach } from "bun:test";

// Mock Audio for headless test environment
if (typeof globalThis.Audio === "undefined" || !(globalThis.Audio.prototype as any)?.removeAttribute) {
  (globalThis as any).Audio = class {
    crossOrigin = "";
    preload = "";
    currentTime = 0;
    src = "";
    addEventListener() {}
    removeEventListener() {}
    pause() {}
    play() {
      if (!this.src) return Promise.reject(new Error("No src"));
      return Promise.resolve();
    }
    load() {}
    removeAttribute(attr: string) {
      if (attr === "src") this.src = "";
    }
  };
}

const { usePlayerStore, normalizeTrackVolume, flushTrackVolume } = await import("./usePlayerStore");
const { audioEngine, volumeToGain } = await import("../lib/audio");
import type { Track, Segment } from "@/server/types";

describe("Per-track volume isolation and synchronization", () => {
  const trackA: Track = {
    id: "trk_vol_a",
    source_type: "local",
    source_uri: "local://track-a.mp3",
    title: "Track A",
    duration: 180,
    status: "ready",
    volume: 0.7,
  };

  const trackB: Track = {
    id: "trk_vol_b",
    source_type: "local",
    source_uri: "local://track-b.mp3",
    title: "Track B",
    duration: 200,
    status: "ready",
    // No volume explicitly set -> should default to 0.5
  };

  const segA: Segment = {
    id: "seg_vol_a",
    track_id: trackA.id,
    name: "Segment A",
    start_time: 0,
    end_time: 60,
  };

  const segB: Segment = {
    id: "seg_vol_b",
    track_id: trackB.id,
    name: "Segment B",
    start_time: 0,
    end_time: 60,
  };

  let origFetch: typeof global.fetch;
  let origPlaySegment: typeof audioEngine.playSegment;

  beforeEach(() => {
    origFetch = global.fetch;
    origPlaySegment = audioEngine.playSegment;
    audioEngine.playSegment = (() => Promise.resolve()) as any;
    global.fetch = ((input: any, init: any) => {
      const url = typeof input === "string" ? input : input?.url || "";
      if (url.includes("/api/tracks")) {
        return Promise.resolve(new Response(JSON.stringify({ success: true })));
      }
      return origFetch ? origFetch(input, init) : Promise.resolve(new Response(JSON.stringify({ success: true })));
    }) as any;

    usePlayerStore.setState({
      tracks: [trackA, trackB],
      activeTrack: null,
      activeSegment: null,
      isPlaying: false,
      volume: 0.5,
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
    global.fetch = origFetch;
    audioEngine.playSegment = origPlaySegment;
  });

  it("should play Track A with its own volume (0.7) and not multiply with master volume", async () => {
    await usePlayerStore.getState().playSegment(segA, trackA, 0);

    const state = usePlayerStore.getState();
    expect(state.activeTrack?.id).toBe(trackA.id);
    expect(state.volume).toBe(0.7);
    expect(audioEngine.getVolume()).toBeCloseTo(0.7, 4);
  });

  it("should switch to Track B and default its volume to 0.5 (50%) when unset", async () => {
    await usePlayerStore.getState().playSegment(segA, trackA, 0);
    expect(audioEngine.getVolume()).toBeCloseTo(0.7, 4);

    // Switch to Track B
    await usePlayerStore.getState().playSegment(segB, trackB, 1);

    const state = usePlayerStore.getState();
    expect(state.activeTrack?.id).toBe(trackB.id);
    expect(state.volume).toBe(0.5);
    expect(audioEngine.getVolume()).toBeCloseTo(0.5, 4);
  });

  it("setTrackVolume should independently update Track B without affecting Track A", async () => {
    await usePlayerStore.getState().playSegment(segB, trackB, 1);
    expect(audioEngine.getVolume()).toBeCloseTo(0.5, 4);

    // User adjusts Track B to 85%
    await usePlayerStore.getState().setTrackVolume(trackB.id, 0.85);

    let state = usePlayerStore.getState();
    expect(state.activeTrack?.volume).toBe(0.85);
    expect(state.volume).toBe(0.85);
    expect(audioEngine.getVolume()).toBeCloseTo(0.85, 4);

    // Verify Track A in tracks list still has 0.7
    const currentTrackA = state.tracks.find((t) => t.id === trackA.id);
    expect(currentTrackA?.volume).toBe(0.7);

    // Switch back to Track A: volume should be 0.7
    await usePlayerStore.getState().playSegment(segA, trackA, 0);
    state = usePlayerStore.getState();
    expect(state.activeTrack?.volume).toBe(0.7);
    expect(state.volume).toBe(0.7);
    expect(audioEngine.getVolume()).toBeCloseTo(0.7, 4);
  });

  it("setTrackVolume should synchronize sliceStudioTrack volume when studio is open", async () => {
    usePlayerStore.setState({
      sliceStudioTrack: trackA,
    });

    await usePlayerStore.getState().setTrackVolume(trackA.id, 0.42);

    const state = usePlayerStore.getState();
    expect(state.sliceStudioTrack?.volume).toBe(0.42);
    const updatedTrack = state.tracks.find((t) => t.id === trackA.id);
    expect(updatedTrack?.volume).toBe(0.42);
  });

  it("normalizeTrackVolume correctly bounds, handles NaN, and defaults values", () => {
    expect(normalizeTrackVolume(0.5)).toBe(0.5);
    expect(normalizeTrackVolume(0)).toBe(0);
    expect(normalizeTrackVolume(1)).toBe(1);
    expect(normalizeTrackVolume(-0.2)).toBe(0);
    expect(normalizeTrackVolume(1.8)).toBe(1);
    expect(normalizeTrackVolume(NaN)).toBe(0.5);
    expect(normalizeTrackVolume(Infinity)).toBe(0.5);
    expect(normalizeTrackVolume(null)).toBe(0.5);
    expect(normalizeTrackVolume(undefined)).toBe(0.5);
    expect(normalizeTrackVolume("0.8")).toBe(0.5);
    expect(normalizeTrackVolume(undefined, 0.8)).toBe(0.8);
  });

  it("volumeToGain correctly computes quadratic curve and bounds input", () => {
    expect(volumeToGain(0)).toBe(0);
    expect(volumeToGain(1)).toBe(1);
    expect(volumeToGain(0.5)).toBe(0.25);
    expect(volumeToGain(0.8)).toBeCloseTo(0.64, 4);
    expect(volumeToGain(-0.2)).toBe(0);
    expect(volumeToGain(1.5)).toBe(1);
    expect(volumeToGain(NaN)).toBe(0.25);
  });

  it("rapid setTrackVolume updates resolve cleanly and flushTrackVolume flushes without error", async () => {
    // Rapid updates
    const p1 = usePlayerStore.getState().setTrackVolume(trackA.id, 0.1);
    const p2 = usePlayerStore.getState().setTrackVolume(trackA.id, 0.2);
    const p3 = usePlayerStore.getState().setTrackVolume(trackA.id, 0.3);
    await Promise.all([p1, p2, p3]);

    expect(usePlayerStore.getState().tracks.find((t) => t.id === trackA.id)?.volume).toBe(0.3);

    // Test flush
    await flushTrackVolume(trackA.id);
  });

  it("fetchTracks should not clobber optimistic track volume while debounce timer is active", async () => {
    // Set track A volume without awaiting so debounce timer is active
    const volumePromise = usePlayerStore.getState().setTrackVolume(trackA.id, 0.95);
    expect(usePlayerStore.getState().tracks.find((t) => t.id === trackA.id)?.volume).toBe(0.95);

    // Mock fetch returning older volume from server
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = url.toString();
      if (urlStr.includes("/api/tracks")) {
        return {
          ok: true,
          json: async () => [{ ...trackA, volume: 0.5 }],
        };
      }
      return originalFetch(url as any, init);
    }) as any;

    try {
      await usePlayerStore.getState().fetchTracks(false);
      // Volume should still be optimistic 0.95
      expect(usePlayerStore.getState().tracks.find((t) => t.id === trackA.id)?.volume).toBe(0.95);
    } finally {
      globalThis.fetch = originalFetch;
      await volumePromise;
    }
  });
});
