import { describe, it, expect, beforeEach } from "bun:test";

if (typeof globalThis.Audio === "undefined" || !(globalThis.Audio.prototype as any)?.pause) {
  (globalThis as any).Audio = class {
    crossOrigin = "";
    preload = "";
    currentTime = 0;
    src = "";
    addEventListener() {}
    removeEventListener() {}
    pause() {}
    play() { return Promise.resolve(); }
    load() {}
    removeAttribute(attr: string) {
      if (attr === "src") this.src = "";
    }
  };
}

const { usePlayerStore } = await import("./usePlayerStore");
import type { Track, Segment } from "@/server/types";

describe("usePlayerStore batchQueueRemoval", () => {
  const trackA: Track = { id: "trkA", title: "A", duration: 100, source_type: "local", source_uri: "a", status: "ready" };
  const trackB: Track = { id: "trkB", title: "B", duration: 100, source_type: "local", source_uri: "b", status: "ready" };
  const trackC: Track = { id: "trkC", title: "C", duration: 100, source_type: "local", source_uri: "c", status: "ready" };

  const segA: Segment = { id: "segA", track_id: "trkA", name: "SA", start_time: 0, end_time: 10 };
  const segB: Segment = { id: "segB", track_id: "trkB", name: "SB", start_time: 0, end_time: 10 };
  const segC: Segment = { id: "segC", track_id: "trkC", name: "SC", start_time: 0, end_time: 10 };

  beforeEach(() => {
    usePlayerStore.setState({
      activePlaylistPlayingId: null,
      activePlaylistId: null,
      queue: [
        { segment: segA, track: trackA },
        { segment: segB, track: trackB },
        { segment: segC, track: trackC },
      ],
      queuesByMode: { mixed: [], slices_only: [], original_only: [] },
      queueIndex: 2, // trackC active
      activeTrack: trackC,
      activeSegment: segC,
      isPlaying: false,
    });
  });

  it("should batch remove multiple tracks from queue in a single atomic update", () => {
    const store = usePlayerStore.getState();
    expect(typeof (store as any).removeTracksBatchFromQueue).toBe("function");

    (store as any).removeTracksBatchFromQueue(["trkA", "trkB"]);

    const state = usePlayerStore.getState();
    expect(state.queue.length).toBe(1);
    expect(state.queue[0].track.id).toBe("trkC");
    expect(state.queueIndex).toBe(0); // Adjusted down since 2 items before it were removed
  });

  it("should batch remove multiple segments from queue in a single atomic update", () => {
    const store = usePlayerStore.getState();
    expect(typeof (store as any).removeSegmentsBatchFromQueue).toBe("function");

    (store as any).removeSegmentsBatchFromQueue(["segA", "segB"]);

    const state = usePlayerStore.getState();
    expect(state.queue.length).toBe(1);
    expect(state.queue[0].segment.id).toBe("segC");
    expect(state.queueIndex).toBe(0);
  });
});
