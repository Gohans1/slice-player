import { describe, it, expect, beforeEach } from "bun:test";

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

const {
  usePlayerStore,
  reconcileSingleModeQueue,
  generateModeQueueItems,
  clearDismissedSegments,
  dismissedSegmentIdsByMode,
  dismissedTrackIdsByMode,
  clearShuffleHistory,
} = await import("./usePlayerStore");
const { audioEngine } = await import("../lib/audio");
const { createDefaultFullSegment } = await import("../lib/utils");
import type { Track, Segment } from "@/server/types";
import type { QueueItem } from "./usePlayerStore";

describe("usePlayerStore playbackModeQueue isolation", () => {
  const track1: Track = {
    id: "trk_1",
    title: "Track A",
    duration: 100,
    source_type: "youtube",
    source_uri: "abc",
    status: "ready",
  };

  const track2: Track = {
    id: "trk_2",
    title: "Track B",
    duration: 120,
    source_type: "youtube",
    source_uri: "def",
    status: "ready",
  };

  const segment1: Segment = {
    id: "seg_1",
    track_id: "trk_1",
    name: "Slice 1",
    start_time: 10,
    end_time: 25,
  };

  const segment2: Segment = {
    id: "seg_2",
    track_id: "trk_2",
    name: "Slice 2",
    start_time: 30,
    end_time: 45,
  };

  const tracks = [track1, track2];
  const segments = [segment1, segment2];

  beforeEach(() => {
    clearDismissedSegments();
    usePlayerStore.setState({
      tracks,
      playbackMode: "mixed",
      queuesByMode: {
        mixed: [],
        slices_only: [],
        original_only: [],
      },
      shuffleByMode: {
        mixed: false,
        slices_only: false,
        original_only: false,
      },
      queue: [],
      queueIndex: -1,
      isShuffle: false,
      activeTrack: null,
      activeSegment: null,
    });
  });

  it("should preserve independent queue orders when switching between playback modes without reshuffling", async () => {
    // Build initial queues for all modes
    usePlayerStore.getState().buildShuffleQueue(segments, tracks, "mixed", false);
    usePlayerStore.getState().buildShuffleQueue(segments, tracks, "slices_only", false);
    usePlayerStore.getState().buildShuffleQueue(segments, tracks, "original_only", false);

    const initialMixed = usePlayerStore.getState().queuesByMode.mixed.map((it) => it.segment.id);
    const initialSlices = usePlayerStore.getState().queuesByMode.slices_only.map((it) => it.segment.id);
    const initialOriginal = usePlayerStore.getState().queuesByMode.original_only.map((it) => it.segment.id);

    expect(initialSlices.length).toBe(2);
    expect(initialOriginal.length).toBe(2);
    expect(initialMixed.length).toBe(4);

    // Switch to slices_only
    await usePlayerStore.getState().setPlaybackMode("slices_only");
    expect(usePlayerStore.getState().playbackMode).toBe("slices_only");
    expect(usePlayerStore.getState().queue.map((it) => it.segment.id)).toEqual(initialSlices);

    // Switch to original_only
    await usePlayerStore.getState().setPlaybackMode("original_only");
    expect(usePlayerStore.getState().playbackMode).toBe("original_only");
    expect(usePlayerStore.getState().queue.map((it) => it.segment.id)).toEqual(initialOriginal);

    // Switch back to mixed
    await usePlayerStore.getState().setPlaybackMode("mixed");
    expect(usePlayerStore.getState().playbackMode).toBe("mixed");
    expect(usePlayerStore.getState().queue.map((it) => it.segment.id)).toEqual(initialMixed);

    // Switch back to slices_only - order MUST be 100% identical
    await usePlayerStore.getState().setPlaybackMode("slices_only");
    expect(usePlayerStore.getState().queue.map((it) => it.segment.id)).toEqual(initialSlices);
  });

  it("should only shuffle the current playback mode without affecting other tabs", async () => {
    // Populate queues
    usePlayerStore.getState().buildShuffleQueue(segments, tracks, "mixed", false);
    usePlayerStore.getState().buildShuffleQueue(segments, tracks, "slices_only", false);
    usePlayerStore.getState().buildShuffleQueue(segments, tracks, "original_only", false);

    const originalMixed = [...usePlayerStore.getState().queuesByMode.mixed.map((it) => it.segment.id)];
    const originalSlices = [...usePlayerStore.getState().queuesByMode.slices_only.map((it) => it.segment.id)];

    // We are on original_only
    await usePlayerStore.getState().setPlaybackMode("original_only");
    expect(usePlayerStore.getState().isShuffle).toBe(false);

    // Reshuffle original_only
    usePlayerStore.getState().buildShuffleQueue(segments, tracks, "original_only", true);

    expect(usePlayerStore.getState().shuffleByMode.original_only).toBe(true);
    expect(usePlayerStore.getState().isShuffle).toBe(true);

    // other tabs MUST NOT be shuffled
    expect(usePlayerStore.getState().shuffleByMode.mixed).toBe(false);
    expect(usePlayerStore.getState().shuffleByMode.slices_only).toBe(false);
    expect(usePlayerStore.getState().queuesByMode.mixed.map((it) => it.segment.id)).toEqual(originalMixed);
    expect(usePlayerStore.getState().queuesByMode.slices_only.map((it) => it.segment.id)).toEqual(originalSlices);

    // Switch to mixed: isShuffle should be false (since mixed is not shuffled)
    await usePlayerStore.getState().setPlaybackMode("mixed");
    expect(usePlayerStore.getState().isShuffle).toBe(false);
    expect(usePlayerStore.getState().queue.map((it) => it.segment.id)).toEqual(originalMixed);
  });

  it("should purge removed track from all 3 modes", () => {
    usePlayerStore.getState().buildShuffleQueue(segments, tracks, "mixed", false);
    usePlayerStore.getState().buildShuffleQueue(segments, tracks, "slices_only", false);
    usePlayerStore.getState().buildShuffleQueue(segments, tracks, "original_only", false);

    usePlayerStore.getState().removeTrackFromQueue("trk_1");

    const state = usePlayerStore.getState();
    expect(state.queuesByMode.mixed.some((it) => it.track.id === "trk_1")).toBe(false);
    expect(state.queuesByMode.slices_only.some((it) => it.track.id === "trk_1")).toBe(false);
    expect(state.queuesByMode.original_only.some((it) => it.track.id === "trk_1")).toBe(false);
  });

  it("should maintain valid queueIndex by track fallback when switching from slices_only to original_only", async () => {
    // Populate queues
    usePlayerStore.getState().buildShuffleQueue(segments, tracks, "mixed", false);
    usePlayerStore.getState().buildShuffleQueue(segments, tracks, "slices_only", false);
    usePlayerStore.getState().buildShuffleQueue(segments, tracks, "original_only", false);

    // Currently playing slice 2 (trk_2) on slices_only
    usePlayerStore.setState({
      playbackMode: "slices_only",
      activeSegment: segment2,
      activeTrack: track2,
      queue: usePlayerStore.getState().queuesByMode.slices_only,
      queueIndex: 1,
    });

    // Switch to original_only where segment2 does not exist (only fallback_trk_1 and fallback_trk_2 exist)
    await usePlayerStore.getState().setPlaybackMode("original_only");

    const state = usePlayerStore.getState();
    expect(state.playbackMode).toBe("original_only");
    // queueIndex must NOT be -1! It must point to track2's original segment in target queue
    expect(state.queueIndex).toBeGreaterThanOrEqual(0);
    const activeItemInQueue = state.queue[state.queueIndex];
    expect(activeItemInQueue.track.id).toBe("trk_2");
  });

  it("should remove item only from active mode queue without blacklisting it across other modes", () => {
    usePlayerStore.getState().buildShuffleQueue(segments, tracks, "mixed", false);
    usePlayerStore.getState().buildShuffleQueue(segments, tracks, "slices_only", false);
    usePlayerStore.getState().buildShuffleQueue(segments, tracks, "original_only", false);

    const initialSlicesCount = usePlayerStore.getState().queuesByMode.slices_only.length;

    // Remove first item in mixed mode
    usePlayerStore.setState({ playbackMode: "mixed", queue: usePlayerStore.getState().queuesByMode.mixed });
    usePlayerStore.getState().removeQueueItemAtIndex(0);

    const mixedQueue = usePlayerStore.getState().queuesByMode.mixed;
    expect(mixedQueue.length).toBe(3); // 4 - 1

    // Slices mode queue must remain untouched
    const slicesQueue = usePlayerStore.getState().queuesByMode.slices_only;
    expect(slicesQueue.length).toBe(initialSlicesCount);
  });

  it("reconcileSingleModeQueue should properly append newly ready tracks to both active and inactive modes", () => {
    const track3: Track = {
      id: "trk_3",
      title: "Track C",
      duration: 90,
      source_type: "youtube",
      source_uri: "ghi",
      status: "ready",
    };
    const segment3: Segment = {
      id: "seg_3",
      track_id: "trk_3",
      name: "Slice 3",
      start_time: 5,
      end_time: 15,
    };

    const allTracks = [...tracks, track3];
    const allSegments = [...segments, segment3];
    const trackMap = new Map(allTracks.map((t) => [t.id, t]));
    const segmentMap = new Set(allSegments.map((s) => s.id));
    const segmentObjMap = new Map(allSegments.map((s) => [s.id, s]));

    // Given existing queues for slices_only and original_only (simulating inactive modes)
    const existingSlicesQueue = [
      { segment: segment1, track: track1 },
      { segment: segment2, track: track2 },
    ];
    const existingOriginalQueue = [
      { segment: { id: "fallback_trk_1", track_id: "trk_1", name: "Full", start_time: 0, end_time: 100 }, track: track1 },
      { segment: { id: "fallback_trk_2", track_id: "trk_2", name: "Full", start_time: 0, end_time: 120 }, track: track2 },
    ];

    // Reconcile inactive slices_only mode with newly ready track3
    const reconciledSlices = reconcileSingleModeQueue(
      "slices_only",
      existingSlicesQueue,
      allSegments,
      allTracks,
      trackMap,
      segmentMap,
      segmentObjMap,
      null,
      [track3],
      false
    );

    // Slices mode should now include slice 3 from track 3!
    expect(reconciledSlices.some((it) => it.segment.id === "seg_3")).toBe(true);
    expect(reconciledSlices.length).toBe(3);

    // Reconcile inactive original_only mode with newly ready track3
    const reconciledOriginal = reconcileSingleModeQueue(
      "original_only",
      existingOriginalQueue,
      allSegments,
      allTracks,
      trackMap,
      segmentMap,
      segmentObjMap,
      null,
      [track3],
      false
    );

    // Original mode should now include track 3's full track!
    expect(reconciledOriginal.some((it) => it.track.id === "trk_3")).toBe(true);
    expect(reconciledOriginal.length).toBe(3);
  });

  it("should NOT resurrect removed items during subsequent queue reconciliation (zombie prevention)", () => {
    usePlayerStore.getState().buildShuffleQueue(segments, tracks, "mixed", false);

    // Initial queue has 4 items in mixed mode (2 slices + 2 full tracks)
    const initialQueue = usePlayerStore.getState().queuesByMode.mixed;
    expect(initialQueue.length).toBe(4);

    const removedItem = initialQueue[0];
    usePlayerStore.setState({ playbackMode: "mixed", queue: initialQueue });
    usePlayerStore.getState().removeQueueItemAtIndex(0);

    const currentQueue = usePlayerStore.getState().queuesByMode.mixed;
    expect(currentQueue.length).toBe(3);
    expect(currentQueue.some((it) => it.segment.id === removedItem.segment.id)).toBe(false);

    // Run reconciliation on mixed mode
    const trackMap = new Map(tracks.map((t) => [t.id, t]));
    const segmentMap = new Set(segments.map((s) => s.id));
    const segmentObjMap = new Map(segments.map((s) => [s.id, s]));

    const reconciled = reconcileSingleModeQueue(
      "mixed",
      currentQueue,
      segments,
      tracks,
      trackMap,
      segmentMap,
      segmentObjMap,
      null,
      [],
      false
    );

    // Removed item MUST NOT be resurrected!
    expect(reconciled.some((it) => it.segment.id === removedItem.segment.id)).toBe(false);
    expect(reconciled.length).toBe(3);
  });

  it("should safely remove item when idle without activating audio or setting activeTrack", () => {
    usePlayerStore.getState().buildShuffleQueue(segments, tracks, "mixed", false);
    const queue = usePlayerStore.getState().queuesByMode.mixed;

    // Set store to idle state with queueIndex = 0
    usePlayerStore.setState({
      playbackMode: "mixed",
      queue,
      queueIndex: 0,
      activeTrack: null,
      activeSegment: null,
      isPlaying: false,
    });

    // Remove first item while idle
    usePlayerStore.getState().removeQueueItemAtIndex(0);

    const state = usePlayerStore.getState();
    // activeTrack and activeSegment must remain null!
    expect(state.activeTrack).toBeNull();
    expect(state.activeSegment).toBeNull();
    expect(state.isPlaying).toBe(false);
    expect(state.queue.length).toBe(queue.length - 1);
  });

  it("should not resurrect items when entire queue in a mode is emptied and reconciled", () => {
    usePlayerStore.getState().buildShuffleQueue(segments, tracks, "slices_only", false);
    const initialQueue = usePlayerStore.getState().queuesByMode.slices_only;
    expect(initialQueue.length).toBe(2);

    usePlayerStore.setState({ playbackMode: "slices_only", queue: initialQueue });

    // Dismiss both items
    usePlayerStore.getState().removeQueueItemAtIndex(0);
    usePlayerStore.getState().removeQueueItemAtIndex(0);

    const emptyQueue = usePlayerStore.getState().queuesByMode.slices_only;
    expect(emptyQueue.length).toBe(0);

    // Reconcile on empty queue
    const trackMap = new Map(tracks.map((t) => [t.id, t]));
    const segmentMap = new Set(segments.map((s) => s.id));
    const segmentObjMap = new Map(segments.map((s) => [s.id, s]));

    const reconciled = reconcileSingleModeQueue(
      "slices_only",
      emptyQueue,
      segments,
      tracks,
      trackMap,
      segmentMap,
      segmentObjMap,
      null,
      [],
      false
    );

    // Should stay empty because all slices were dismissed and custom slices exist in library
    expect(reconciled.length).toBe(0);
  });

  it("should preserve queueIndex -1 when toggling shuffle while player is idle", () => {
    usePlayerStore.getState().buildShuffleQueue(segments, tracks, "mixed", false);
    const queue = usePlayerStore.getState().queuesByMode.mixed;

    usePlayerStore.setState({
      playbackMode: "mixed",
      queue,
      queueIndex: -1,
      activeTrack: null,
      activeSegment: null,
      isPlaying: false,
      shuffleByMode: { mixed: false, slices_only: false, original_only: false },
    });

    usePlayerStore.getState().toggleShuffle();

    const state = usePlayerStore.getState();
    expect(state.isShuffle).toBe(true);
    expect(state.queueIndex).toBe(-1);
    expect(state.activeTrack).toBeNull();
    expect(state.activeSegment).toBeNull();
  });

  it("should not leak items from another mode when toggling shuffle on an empty queue", () => {
    usePlayerStore.getState().buildShuffleQueue(segments, tracks, "mixed", false);
    const mixedQueue = usePlayerStore.getState().queuesByMode.mixed;

    usePlayerStore.setState({
      playbackMode: "slices_only",
      queue: mixedQueue, // Old active queue from mixed
      queuesByMode: {
        mixed: mixedQueue,
        slices_only: [], // empty
        original_only: [],
      },
      queueIndex: -1,
      shuffleByMode: { mixed: false, slices_only: false, original_only: false },
    });

    usePlayerStore.getState().toggleShuffle();

    const state = usePlayerStore.getState();
    expect(state.shuffleByMode.slices_only).toBe(true);
    // slices_only queue must NOT inherit mixed items!
    expect(state.queuesByMode.slices_only.length).toBe(0);
  });

  it("should propagate dismissed segments to uninitialized modes when removing track from queue", () => {
    usePlayerStore.getState().buildShuffleQueue(segments, tracks, "mixed", false);

    // Ensure slices_only queue is not initialized yet
    usePlayerStore.setState({
      playbackMode: "mixed",
      queuesByMode: {
        mixed: usePlayerStore.getState().queuesByMode.mixed,
        slices_only: [],
        original_only: [],
      },
    });

    // Remove track 1
    usePlayerStore.getState().removeTrackFromQueue("trk_1");

    // Check using reconcileSingleModeQueue
    const trackMap = new Map(tracks.map((t) => [t.id, t]));
    const segmentMap = new Set(segments.map((s) => s.id));
    const segmentObjMap = new Map(segments.map((s) => [s.id, s]));

    const reconciledSlices = reconcileSingleModeQueue(
      "slices_only",
      [],
      segments,
      tracks,
      trackMap,
      segmentMap,
      segmentObjMap,
      null,
      [],
      false
    );

    // trk_1 slices should NOT appear in slices_only because trk_1 was dismissed!
    expect(reconciledSlices.some((it) => it.track.id === "trk_1")).toBe(false);
    expect(reconciledSlices.some((it) => it.track.id === "trk_2")).toBe(true);
  });

  it("should purge track custom slices from uninitialized slices_only mode when removed from original_only mode", async () => {
    // Only original_only is initialized
    usePlayerStore.getState().buildShuffleQueue(segments, tracks, "original_only", false);

    usePlayerStore.setState({
      playbackMode: "original_only",
      queuesByMode: {
        mixed: [],
        slices_only: [],
        original_only: usePlayerStore.getState().queuesByMode.original_only,
      },
      initializedModes: {
        mixed: false,
        slices_only: false,
        original_only: true,
      },
    });

    // Remove track 1 while on original_only (where only fallback_trk_1 was present)
    usePlayerStore.getState().removeTrackFromQueue("trk_1");

    // Switch to slices_only which was never initialized
    // Mock global fetch for /api/segments
    const origFetch = globalThis.fetch;
    globalThis.fetch = ((url: string) => {
      if (url === "/api/segments") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(segments),
        });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve([]) });
    }) as any;

    try {
      await usePlayerStore.getState().setPlaybackMode("slices_only");
      const slicesQueue = usePlayerStore.getState().queue;

      // trk_1 custom slices MUST NOT appear in slices_only!
      expect(slicesQueue.some((it) => it.track.id === "trk_1")).toBe(false);
      expect(slicesQueue.some((it) => it.track.id === "trk_2")).toBe(true);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("should maintain empty queue and not resurrect items when switching between tabs after queue was emptied", async () => {
    usePlayerStore.getState().buildShuffleQueue(segments, tracks, "slices_only", false);
    usePlayerStore.getState().buildShuffleQueue(segments, tracks, "mixed", false);

    // Switch to slices_only and empty it
    await usePlayerStore.getState().setPlaybackMode("slices_only");
    while (usePlayerStore.getState().queue.length > 0) {
      usePlayerStore.getState().removeQueueItemAtIndex(0);
    }
    expect(usePlayerStore.getState().queue.length).toBe(0);

    // Switch away to mixed
    await usePlayerStore.getState().setPlaybackMode("mixed");
    expect(usePlayerStore.getState().queue.length).toBeGreaterThan(0);

    // Switch back to slices_only
    await usePlayerStore.getState().setPlaybackMode("slices_only");
    // slices_only queue MUST remain empty and not resurrect!
    expect(usePlayerStore.getState().queue.length).toBe(0);
    expect(usePlayerStore.getState().queuesByMode.slices_only.length).toBe(0);
  });

  it("should keep queueIndex -1 in toggleShuffle if activeSegment is absent from target queue", () => {
    usePlayerStore.getState().buildShuffleQueue(segments, tracks, "slices_only", false);
    const slicesQueue = usePlayerStore.getState().queuesByMode.slices_only;

    // Simulate an active segment from another track not present in slicesQueue
    const foreignSegment: Segment = {
      id: "foreign_seg",
      track_id: "foreign_trk",
      name: "Foreign",
      start_time: 0,
      end_time: 10,
    };

    usePlayerStore.setState({
      playbackMode: "slices_only",
      queue: slicesQueue,
      queueIndex: 0,
      activeSegment: foreignSegment,
      activeTrack: { id: "foreign_trk", title: "Foreign", duration: 10, source_type: "local", source_uri: "f", status: "ready" },
      isPlaying: true,
      shuffleByMode: { mixed: false, slices_only: false, original_only: false },
    });

    usePlayerStore.getState().toggleShuffle();

    const state = usePlayerStore.getState();
    // newIndex should be -1 because foreignSegment and foreignTrack do not exist in slicesQueue
    expect(state.queueIndex).toBe(-1);
  });

  it("should sync audioEngine volume when removing active track while player is paused", () => {
    const tA: Track = { ...track1, volume: 0.4 };
    const tB: Track = { ...track2, volume: 0.9 };
    const segA: Segment = { id: "seg_A", track_id: tA.id, name: "Slice A", start_time: 0, end_time: 10 };
    const segB: Segment = { id: "seg_B", track_id: tB.id, name: "Slice B", start_time: 0, end_time: 10 };

    usePlayerStore.setState({
      volume: 0.8,
      isPlaying: false,
      activeTrack: tA,
      activeSegment: segA,
      queue: [
        { track: tA, segment: segA },
        { track: tB, segment: segB },
      ],
      queueIndex: 0,
      playbackMode: "mixed",
      queuesByMode: {
        mixed: [{ track: tA, segment: segA }, { track: tB, segment: segB }],
        slices_only: [],
        original_only: [],
      },
    });

    // Remove active track A while paused
    usePlayerStore.getState().removeTrackFromQueue(tA.id);

    const state = usePlayerStore.getState();
    expect(state.activeTrack?.id).toBe(tB.id);
    // Next track volume (0.9) directly
    expect(audioEngine.getVolume()).toBeCloseTo(0.9, 4);
  });

  it("should sync audioEngine volume when removing active segment via removeQueueItemAtIndex while paused", () => {
    const tA: Track = { ...track1, volume: 0.3 };
    const tB: Track = { ...track2, volume: 0.7 };
    const segA: Segment = { id: "seg_A2", track_id: tA.id, name: "Slice A2", start_time: 0, end_time: 10 };
    const segB: Segment = { id: "seg_B2", track_id: tB.id, name: "Slice B2", start_time: 0, end_time: 10 };

    usePlayerStore.setState({
      volume: 1.0,
      isPlaying: false,
      activeTrack: tA,
      activeSegment: segA,
      queue: [
        { track: tA, segment: segA },
        { track: tB, segment: segB },
      ],
      queueIndex: 0,
      playbackMode: "mixed",
      queuesByMode: {
        mixed: [{ track: tA, segment: segA }, { track: tB, segment: segB }],
        slices_only: [],
        original_only: [],
      },
    });

    usePlayerStore.getState().removeQueueItemAtIndex(0);

    const state = usePlayerStore.getState();
    expect(state.activeTrack?.id).toBe(tB.id);
    // Next track volume (0.7) applied directly (per-track volume isolation)
    expect(audioEngine.getVolume()).toBeCloseTo(0.7, 4);
  });

  it("reshuffleCurrentQueue should reshuffle current mode queue and auto-select/play first track at index 0", () => {
    usePlayerStore.getState().buildShuffleQueue(segments, tracks, "mixed", false);
    const initialMixedQueue = [...usePlayerStore.getState().queuesByMode.mixed];
    const initialOriginalQueue = [...usePlayerStore.getState().queuesByMode.original_only];

    const activeItem = initialMixedQueue[1];
    usePlayerStore.setState({
      playbackMode: "mixed",
      queue: initialMixedQueue,
      queueIndex: 1,
      activeSegment: activeItem.segment,
      activeTrack: activeItem.track,
      isShuffle: false,
    });

    usePlayerStore.getState().reshuffleCurrentQueue();

    const state = usePlayerStore.getState();
    expect(state.isShuffle).toBe(true);
    expect(state.shuffleByMode.mixed).toBe(true);
    expect(state.queue.length).toBe(initialMixedQueue.length);
    // Active item must now be auto-selected at index 0 after shuffle
    expect(state.queueIndex).toBe(0);
    expect(state.activeSegment?.id).toBe(state.queue[0].segment.id);
    expect(state.activeTrack?.id).toBe(state.queue[0].track.id);
    // Other mode must NOT be modified
    expect(state.queuesByMode.original_only).toEqual(initialOriginalQueue);
  });

  it("reconcileSingleModeQueue should NOT append fallback tracks to slices_only mode when library has no custom slices", () => {
    const freshTrack3: Track = {
      id: "trk_3",
      title: "Track C",
      duration: 80,
      source_type: "youtube",
      source_uri: "ghi",
      status: "ready",
    };

    // Library has NO custom segments at all
    const emptySegments: Segment[] = [];
    const trackMap = new Map<string, Track>([
      [track1.id, track1],
      [freshTrack3.id, freshTrack3],
    ]);

    // slices_only currently has stale fallback for track1
    const existingQueue = [
      {
        segment: {
          id: `fallback_${track1.id}`,
          track_id: track1.id,
          name: track1.title,
          start_time: 0,
          end_time: track1.duration,
        },
        track: track1,
      },
    ];

    const reconciled = reconcileSingleModeQueue(
      "slices_only",
      existingQueue,
      emptySegments,
      [track1, freshTrack3],
      trackMap,
      new Set(),
      new Map(),
      null,
      [freshTrack3],
      false
    );

    // Slices_only strictly contains ONLY slices; fallbacks are rejected
    expect(reconciled.length).toBe(0);
  });

  it("should un-dismiss previously dismissed track when it is re-downloaded as newlyReadyTracks", () => {
    // Dismiss track2
    usePlayerStore.getState().buildShuffleQueue(segments, tracks, "mixed", false);
    usePlayerStore.getState().removeTrackFromQueue(track2.id);

    const trackMap = new Map<string, Track>([
      [track1.id, track1],
      [track2.id, track2],
    ]);
    const segmentMap = new Set(segments.map((s) => s.id));
    const segmentObjMap = new Map(segments.map((s) => [s.id, s]));

    const existingQueue = [{ segment: segment1, track: track1 }];

    // Re-download track2 (passes into newlyReadyTracks)
    const reconciled = reconcileSingleModeQueue(
      "mixed",
      existingQueue,
      segments,
      tracks,
      trackMap,
      segmentMap,
      segmentObjMap,
      null,
      [track2],
      false
    );

    // Track 2 must be admitted back into the queue
    expect(reconciled.some((it) => it.track.id === track2.id)).toBe(true);
  });

  it("should abort segment reconciliation on /api/segments failure without wiping queues or stopping playback", async () => {
    usePlayerStore.getState().buildShuffleQueue(segments, tracks, "mixed", false);
    const initialQueueLength = usePlayerStore.getState().queue.length;
    expect(initialQueueLength).toBeGreaterThan(0);

    const origFetch = globalThis.fetch;
    try {
      globalThis.fetch = ((url: string) => {
        if (url === "/api/tracks") {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(tracks),
          } as any);
        }
        if (url === "/api/segments") {
          // Network failure!
          return Promise.resolve({
            ok: false,
            status: 500,
            json: () => Promise.reject(new Error("500 Internal Server Error")),
          } as any);
        }
        return origFetch(url);
      }) as any;

      await usePlayerStore.getState().fetchTracks(true);

      // Queue must NOT be wiped!
      expect(usePlayerStore.getState().queue.length).toBe(initialQueueLength);
      expect(usePlayerStore.getState().queuesByMode.mixed.length).toBe(initialQueueLength);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("nextSegment should play current queueIndex item when activeSegment was a foreign transitional slice", () => {
    const item0 = { segment: segment1, track: track1 };
    const item1 = { segment: segment2, track: track2 };

    const foreignSlice: Segment = {
      id: "foreign_slice",
      track_id: track2.id,
      name: "Foreign Slice",
      start_time: 0,
      end_time: 5,
    };

    usePlayerStore.setState({
      queue: [item0, item1],
      queueIndex: 1, // Pointing to item1 (track2)
      activeTrack: track2,
      activeSegment: foreignSlice, // Foreign slice currently ending
      isPlaying: true,
    });

    let playedSegmentId = "";
    const origPlaySegment = usePlayerStore.getState().playSegment;
    usePlayerStore.setState({
      playSegment: ((seg: Segment) => {
        playedSegmentId = seg.id;
        return Promise.resolve();
      }) as any,
    });

    try {
      usePlayerStore.getState().nextSegment();
      // Must play item1 (segment2) instead of skipping to item0!
      expect(playedSegmentId).toBe(segment2.id);
      expect(usePlayerStore.getState().queueIndex).toBe(1);
    } finally {
      usePlayerStore.setState({ playSegment: origPlaySegment });
    }
  });

  it("setPlaybackMode to original_only smoothly retargets activeSegment to full track fallback", async () => {
    usePlayerStore.getState().buildShuffleQueue(segments, tracks, "slices_only", false);
    usePlayerStore.getState().buildShuffleQueue(segments, tracks, "original_only", false);

    usePlayerStore.setState({
      playbackMode: "slices_only",
      activeTrack: track1,
      activeSegment: segment1, // Slice 1 of track 1
      isPlaying: true,
    });

    await usePlayerStore.getState().setPlaybackMode("original_only");

    const state = usePlayerStore.getState();
    expect(state.playbackMode).toBe("original_only");
    // activeSegment should now be the fallback full track of track 1
    expect(state.activeSegment?.id).toBe(`fallback_${track1.id}`);
    expect(state.queue[state.queueIndex].segment.id).toBe(`fallback_${track1.id}`);
  });

  it("reconcileSingleModeQueue restores custom slices of newly ready tracks after re-download", () => {
    // Dismiss track 1 previously
    const dismissedSegs = new Set<string>([segment1.id, `fallback_${track1.id}`]);
    const dismissedTracks = new Set<string>([track1.id]);

    const trackMap = new Map<string, Track>([[track1.id, track1], [track2.id, track2]]);
    const segMap = new Set<string>([segment1.id, segment2.id]);
    const segObjMap = new Map<string, Segment>([[segment1.id, segment1], [segment2.id, segment2]]);

    // Existing queue only has track 2
    const existingQueue: QueueItem[] = [{ track: track2, segment: segment2 }];

    // Track 1 transitions to ready
    const newlyReady = [track1];

    const reconciled = reconcileSingleModeQueue(
      "slices_only",
      existingQueue,
      [segment1, segment2],
      [track1, track2],
      trackMap,
      segMap,
      segObjMap,
      segment2,
      newlyReady,
      false,
      dismissedSegs,
      dismissedTracks
    );

    // Reconciled queue must now contain segment1 for track1!
    expect(reconciled.some((it) => it.segment.id === segment1.id)).toBe(true);
    expect(dismissedSegs.has(segment1.id)).toBe(false);
    expect(dismissedTracks.has(track1.id)).toBe(false);
  });

  it("reconcileSingleModeQueue does NOT resurrect fallback tracks in slices_only when user dismisses all slices but library has slices", () => {
    // User dismissed segment1 and segment2
    const dismissedSegs = new Set<string>([segment1.id, segment2.id]);
    const dismissedTracks = new Set<string>();

    const trackMap = new Map<string, Track>([[track1.id, track1], [track2.id, track2]]);
    const segMap = new Set<string>([segment1.id, segment2.id]);
    const segObjMap = new Map<string, Segment>([[segment1.id, segment1], [segment2.id, segment2]]);

    // Existing queue had segment1 and segment2 which are now dismissed
    const existingQueue: QueueItem[] = [
      { track: track1, segment: segment1 },
      { track: track2, segment: segment2 },
    ];

    const reconciled = reconcileSingleModeQueue(
      "slices_only",
      existingQueue,
      [segment1, segment2],
      [track1, track2],
      trackMap,
      segMap,
      segObjMap,
      null,
      [],
      false,
      dismissedSegs,
      dismissedTracks
    );

    // Queue must be empty, NOT resurrected with fallback full tracks!
    expect(reconciled.length).toBe(0);
  });

  it("setPlaybackMode aborts queue generation if /api/segments fetch fails", async () => {
    const origFetch = global.fetch;
    (global as any).fetch = () => Promise.reject(new Error("Network failure"));

    try {
      usePlayerStore.setState({
        playbackMode: "mixed",
        initializedModes: { mixed: true, slices_only: false, original_only: false },
        queuesByMode: { mixed: [{ track: track1, segment: segment1 }], slices_only: [], original_only: [] },
      });

      await usePlayerStore.getState().setPlaybackMode("slices_only");

      // Because network failed, slices_only should not be initialized with dummy fallback queue
      const state = usePlayerStore.getState();
      expect(state.initializedModes.slices_only).toBe(false);
      expect(state.queuesByMode.slices_only.length).toBe(0);
    } finally {
      global.fetch = origFetch;
    }
  });

  it("prevSegment retargets smoothly when activeSegment is an out-of-mode transitional segment", () => {
    const item0: QueueItem = { track: track1, segment: segment1 };
    const item1: QueueItem = { track: track2, segment: segment2 };

    const transitionalSegment: Segment = {
      id: "fallback_foreign",
      track_id: "foreign_trk",
      name: "Transitional Foreign",
      start_time: 0,
      end_time: 10,
    };

    let playedSegmentId: string | null = null;
    const origPlaySegment = usePlayerStore.getState().playSegment;

    usePlayerStore.setState({
      queue: [item0, item1],
      queueIndex: 1, // Target index mapped during mode switch
      activeSegment: transitionalSegment,
      activeTrack: { id: "foreign_trk", title: "Foreign", duration: 10, source_type: "local", source_uri: "f", status: "ready" },
      currentTime: 0,
      playSegment: ((seg: Segment, trk: Track, idx?: number) => {
        playedSegmentId = seg.id;
        usePlayerStore.setState({ activeSegment: seg, activeTrack: trk, queueIndex: idx ?? 0 });
        return Promise.resolve();
      }) as any,
    });

    try {
      usePlayerStore.getState().prevSegment();
      // Because activeSegment does not match queue[1], prevSegment should play queue[1] (item1)
      expect(playedSegmentId as any).toBe(segment2.id);
      expect(usePlayerStore.getState().queueIndex).toBe(1);
    } finally {
      usePlayerStore.setState({ playSegment: origPlaySegment });
    }
  });

  it("playSegment marks initializedModes[playbackMode] as true", async () => {
    const origPlay = audioEngine.playSegment;
    audioEngine.playSegment = (() => Promise.resolve()) as any;
    try {
      usePlayerStore.setState({
        playbackMode: "slices_only",
        initializedModes: { mixed: true, slices_only: false, original_only: false },
      });

      await usePlayerStore.getState().playSegment(segment1, track1);

      expect(usePlayerStore.getState().initializedModes.slices_only).toBe(true);
    } finally {
      audioEngine.playSegment = origPlay;
    }
  });

  it("syncUpdatedSegment preserves queue reference when segment is not in queue", () => {
    const originalMixedQueue = [{ track: track1, segment: segment1 }];
    usePlayerStore.setState({
      playbackMode: "mixed",
      queuesByMode: {
        mixed: originalMixedQueue,
        slices_only: [],
        original_only: [],
      },
    });

    const unrelatedSegment: Segment = {
      id: "unrelated_seg",
      track_id: "other_trk",
      name: "Other",
      start_time: 0,
      end_time: 5,
    };

    usePlayerStore.getState().syncUpdatedSegment(unrelatedSegment);

    // Reference should be preserved because unrelatedSegment was not in mixed queue
    expect(usePlayerStore.getState().queuesByMode.mixed).toBe(originalMixedQueue);
  });

  it("removeQueueItemAtIndex does not interrupt playback when removing staged item while transitional segment is active", () => {
    const item0 = { segment: segment1, track: track1 };
    const item1 = { segment: segment2, track: track2 };
    const transitionalSeg: Segment = { id: "trans_seg", track_id: "trk_trans", name: "Trans", start_time: 0, end_time: 10 };

    usePlayerStore.setState({
      queue: [item0, item1],
      queueIndex: 0,
      activeSegment: transitionalSeg,
      activeTrack: { id: "trk_trans", title: "Trans", duration: 10, source_type: "youtube", source_uri: "x", status: "ready" },
      isPlaying: true,
      playbackMode: "slices_only",
      queuesByMode: { mixed: [], slices_only: [item0, item1], original_only: [] },
    });

    usePlayerStore.getState().removeQueueItemAtIndex(0);

    const state = usePlayerStore.getState();
    expect(state.isPlaying).toBe(true);
    expect(state.activeSegment?.id).toBe("trans_seg");
    expect(state.queue.length).toBe(1);
    expect(state.queue[0].segment.id).toBe(segment2.id);
  });

  it("prevSegment targets current queueIndex immediately when activeSegment is transitional even if currentTime > restartThreshold", () => {
    const item0 = { segment: segment1, track: track1 };
    const transitionalSeg: Segment = { id: "trans_seg", track_id: "trk_trans", name: "Trans", start_time: 0, end_time: 100 };

    let playedSegId: string | null = null;
    const origPlaySegment = usePlayerStore.getState().playSegment;

    usePlayerStore.setState({
      queue: [item0],
      queueIndex: 0,
      activeSegment: transitionalSeg,
      activeTrack: { id: "trk_trans", title: "Trans", duration: 100, source_type: "youtube", source_uri: "x", status: "ready" },
      currentTime: 25, // Well beyond restartThreshold
      isPlaying: true,
      playSegment: ((seg: Segment, trk: Track, idx?: number) => {
        playedSegId = seg.id;
        return Promise.resolve();
      }) as any,
    });

    try {
      usePlayerStore.getState().prevSegment();
      expect(playedSegId as any).toBe(segment1.id);
    } finally {
      usePlayerStore.setState({ playSegment: origPlaySegment });
    }
  });

  it("fetchTracks(false) drops tracks with status === error or duration <= 0 from queue", async () => {
    const readyTrack = track1;
    const errorTrack: Track = { ...track2, id: "trk_err", status: "error", error_message: "Download failed" };
    const errorSeg: Segment = { id: "seg_err", track_id: "trk_err", name: "Err Slice", start_time: 0, end_time: 10 };

    usePlayerStore.setState({
      tracks: [readyTrack, errorTrack],
      queue: [{ segment: segment1, track: readyTrack }, { segment: errorSeg, track: errorTrack }],
      queuesByMode: {
        mixed: [{ segment: segment1, track: readyTrack }, { segment: errorSeg, track: errorTrack }],
        slices_only: [],
        original_only: [],
      },
      playbackMode: "mixed",
      queueIndex: 0,
    });

    const origFetch = global.fetch;
    (global as any).fetch = (url: string) => {
      if (url === "/api/tracks") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([readyTrack, errorTrack]),
        });
      }
      return Promise.reject(new Error("Unexpected url"));
    };

    try {
      await usePlayerStore.getState().fetchTracks(false);
      const state = usePlayerStore.getState();
      expect(state.queue.some((it) => it.track.id === "trk_err")).toBe(false);
      expect(state.queuesByMode.mixed.some((it) => it.track.id === "trk_err")).toBe(false);
    } finally {
      global.fetch = origFetch;
    }
  });

  it("reshuffleCurrentQueue preserves valid queueIndex when player is idle", () => {
    usePlayerStore.setState({
      queue: [{ segment: segment1, track: track1 }, { segment: segment2, track: track2 }],
      queueIndex: 1,
      activeSegment: null,
      activeTrack: null,
      isPlaying: false,
      playbackMode: "mixed",
      queuesByMode: {
        mixed: [{ segment: segment1, track: track1 }, { segment: segment2, track: track2 }],
        slices_only: [],
        original_only: [],
      },
      shuffleByMode: { mixed: false, slices_only: false, original_only: false },
    });

    usePlayerStore.getState().reshuffleCurrentQueue();
    const state = usePlayerStore.getState();
    expect(state.queueIndex).toBeGreaterThanOrEqual(0);
    expect(state.queueIndex).toBeLessThan(state.queue.length);
  });

  it("reconcileSingleModeQueue preserves referential stability for fallback segments", () => {
    const fallbackItem: QueueItem = {
      segment: createDefaultFullSegment(track1),
      track: track1,
    };
    const trackMap = new Map<string, Track>([[track1.id, track1]]);
    const segMap = new Set<string>();
    const segObjMap = new Map<string, Segment>();

    const reconciled = reconcileSingleModeQueue(
      "original_only",
      [fallbackItem],
      [],
      [track1],
      trackMap,
      segMap,
      segObjMap,
      fallbackItem.segment,
      [],
      false
    );

    expect(reconciled.length).toBe(1);
    // Object reference MUST be preserved so that fetchTracks isIdentical evaluates to true!
    expect(reconciled[0].segment).toBe(fallbackItem.segment);
    expect(reconciled[0].track).toBe(track1);
  });

  it("togglePlay recovers and plays staged item if audioEngine.resume returns false after paused deletion", async () => {
    const { audioEngine } = await import("../lib/audio");
    const origAudioPlay = (audioEngine as any).audioEl.play;
    (audioEngine as any).audioEl.play = () => Promise.reject(new Error("No src"));

    const item0 = { segment: segment1, track: track1 };
    const item1 = { segment: segment2, track: track2 };

    let playSegmentCalled = false;
    let playedSegId: string | null = null;
    const origPlaySegment = usePlayerStore.getState().playSegment;

    usePlayerStore.setState({
      queue: [item0, item1],
      queueIndex: 0,
      activeSegment: item0.segment,
      activeTrack: item0.track,
      isPlaying: false,
      playbackMode: "mixed",
      queuesByMode: { mixed: [item0, item1], slices_only: [], original_only: [] },
      playSegment: ((seg: Segment, trk: Track, idx?: number) => {
        playSegmentCalled = true;
        playedSegId = seg.id;
        usePlayerStore.setState({ activeSegment: seg, activeTrack: trk, isPlaying: true, queueIndex: idx ?? 0 });
        return Promise.resolve();
      }) as any,
    });

    try {
      // Remove active item while paused -> transitionActiveItemOnRemoval unloads audio and stages item1
      usePlayerStore.getState().removeQueueItemAtIndex(0);

      const stateAfterRemove = usePlayerStore.getState();
      expect(stateAfterRemove.activeSegment?.id).toBe(segment2.id);
      expect(stateAfterRemove.isPlaying).toBe(false);

      // Now user clicks Play in PlayerBar (which calls togglePlay)
      await usePlayerStore.getState().togglePlay();

      expect(playSegmentCalled).toBe(true);
      expect(playedSegId as any).toBe(segment2.id);
      expect(usePlayerStore.getState().isPlaying).toBe(true);
    } finally {
      (audioEngine as any).audioEl.play = origAudioPlay;
      usePlayerStore.setState({ playSegment: origPlaySegment });
    }
  });

  it("setPlaybackMode to original_only succeeds even if /api/segments fails", async () => {
    const origFetch = global.fetch;
    (global as any).fetch = (url: string) => {
      if (url === "/api/segments") {
        return Promise.reject(new Error("Segments service down"));
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    };

    try {
      usePlayerStore.setState({
        tracks: [track1, track2],
        playbackMode: "slices_only",
        initializedModes: { mixed: true, slices_only: true, original_only: false },
        queuesByMode: {
          mixed: [{ track: track1, segment: segment1 }],
          slices_only: [{ track: track1, segment: segment1 }],
          original_only: [],
        },
      });

      await usePlayerStore.getState().setPlaybackMode("original_only");

      const state = usePlayerStore.getState();
      expect(state.playbackMode).toBe("original_only");
      expect(state.initializedModes.original_only).toBe(true);
      expect(state.queue.length).toBe(2);
      expect(state.queue[0].segment.id).toBe(`fallback_${track1.id}`);
    } finally {
      global.fetch = origFetch;
    }
  });

  it("buildShuffleQueue preserves valid queueIndex when player is idle", () => {
    usePlayerStore.setState({
      queue: [{ segment: segment1, track: track1 }, { segment: segment2, track: track2 }],
      queueIndex: 1,
      activeSegment: null,
      activeTrack: null,
      isPlaying: false,
      playbackMode: "mixed",
      queuesByMode: {
        mixed: [{ segment: segment1, track: track1 }, { segment: segment2, track: track2 }],
        slices_only: [],
        original_only: [],
      },
      shuffleByMode: { mixed: false, slices_only: false, original_only: false },
    });

    usePlayerStore.getState().buildShuffleQueue([segment1, segment2], [track1, track2], "mixed", false);
    const state = usePlayerStore.getState();
    expect(state.queueIndex).toBeGreaterThanOrEqual(0);
    expect(state.queueIndex).toBeLessThan(state.queue.length);
  });

  it("reconcileSingleModeQueue un-dismisses track and slices when newlyReadyTracks is provided even if existingQueue is empty", () => {
    clearDismissedSegments();
    dismissedTrackIdsByMode.mixed.add("trk_1");
    dismissedSegmentIdsByMode.mixed.add("fallback_trk_1");
    dismissedSegmentIdsByMode.mixed.add("seg_1");

    const trackMap = new Map<string, Track>([["trk_1", track1]]);
    const segMap = new Set<string>(["seg_1"]);
    const segObjMap = new Map<string, Segment>([["seg_1", segment1]]);

    const result = reconcileSingleModeQueue(
      "mixed",
      [],
      [segment1],
      [track1],
      trackMap,
      segMap,
      segObjMap,
      null,
      [track1],
      false,
      dismissedSegmentIdsByMode.mixed,
      dismissedTrackIdsByMode.mixed
    );

    expect(dismissedTrackIdsByMode.mixed.has("trk_1")).toBe(false);
    expect(dismissedSegmentIdsByMode.mixed.has("fallback_trk_1")).toBe(false);
    expect(dismissedSegmentIdsByMode.mixed.has("seg_1")).toBe(false);
    expect(result.length).toBe(2);
    expect(result.some((i) => i.segment.id === "seg_1")).toBe(true);
    expect(result.some((i) => i.segment.id === "fallback_trk_1")).toBe(true);
  });

  it("generateModeQueueItems does not generate fallback tracks in slices_only even when library has orphan slices", () => {
    const orphanSlice: Segment = {
      id: "seg_orphan",
      track_id: "trk_nonexistent",
      name: "Orphan Slice",
      start_time: 0,
      end_time: 10,
    };

    // track1 has no slices in library, but orphanSlice belongs to non-existent track
    const items = generateModeQueueItems(
      "slices_only",
      [orphanSlice],
      [track1],
      new Set(),
      new Set()
    );

    // Slices_only strictly contains ONLY real slices; never fallback tracks
    expect(items.length).toBe(0);
  });

  it("setTrackVolume preserves queue references when track is not present in mode queues", async () => {
    const origFetch = global.fetch;
    global.fetch = (() => Promise.resolve(new Response(JSON.stringify({ success: true })))) as any;

    try {
      const slicesQueue = [{ segment: segment1, track: track1 }];
      usePlayerStore.setState({
        tracks: [track1, track2],
        queuesByMode: {
          mixed: [{ segment: segment1, track: track1 }, { segment: segment2, track: track2 }],
          slices_only: slicesQueue,
          original_only: [],
        },
      });

      // Update volume for track2 which is NOT in slices_only
      await usePlayerStore.getState().setTrackVolume("trk_2", 0.5);

      const state = usePlayerStore.getState();
      // slices_only queue reference should be preserved (referential equality)
      expect(state.queuesByMode.slices_only).toBe(slicesQueue);
    } finally {
      global.fetch = origFetch;
    }
  });

  it("quickShufflePlay selects and plays a random item without scrambling the queue in any tab", async () => {
    clearShuffleHistory();
    const origEnginePlay = audioEngine.playSegment;
    audioEngine.playSegment = (() => Promise.resolve()) as any;

    try {
      const items = [
        { segment: segment1, track: track1 },
        { segment: segment2, track: track2 },
      ];
      const initialOrderIds = items.map((it) => it.segment.id);

      usePlayerStore.setState({
        tracks: [track1, track2],
        playbackMode: "slices_only",
        queuesByMode: {
          mixed: [{ segment: segment1, track: track1 }, { segment: segment2, track: track2 }],
          slices_only: [...items],
          original_only: [],
        },
        queue: [...items],
        queueIndex: -1,
        isPlaying: false,
      });

      // Execute quickShufflePlay
      await usePlayerStore.getState().quickShufflePlay();

      const state = usePlayerStore.getState();
      // 1. A segment is playing
      expect(state.isPlaying).toBe(true);
      expect(state.activeSegment).not.toBeNull();
      // 2. queueIndex points directly to the active segment in current queue
      expect(state.queueIndex).toBeGreaterThanOrEqual(0);
      expect(state.queue[state.queueIndex].segment.id).toBe(state.activeSegment!.id);
      // 3. Queue order in slices_only is NOT scrambled
      const currentOrderIds = state.queuesByMode.slices_only.map((it) => it.segment.id);
      expect(currentOrderIds).toEqual(initialOrderIds);
      // 4. Mixed queue order is also completely untouched
      const mixedOrderIds = state.queuesByMode.mixed.map((it) => it.segment.id);
      expect(mixedOrderIds).toEqual(initialOrderIds);
    } finally {
      audioEngine.playSegment = origEnginePlay;
    }
  });

  it("quickShufflePlay penalizes recently played items avoiding immediate repetition", async () => {
    clearShuffleHistory();
    const origEnginePlay = audioEngine.playSegment;
    const origRandom = Math.random;
    audioEngine.playSegment = (() => Promise.resolve()) as any;

    try {
      const items = [
        { segment: segment1, track: track1 },
        { segment: segment2, track: track2 },
      ];

      usePlayerStore.setState({
        tracks: [track1, track2],
        playbackMode: "slices_only",
        queuesByMode: {
          mixed: [],
          slices_only: [...items],
          original_only: [],
        },
        queue: [...items],
        queueIndex: -1,
        isPlaying: false,
      });

      // First pick with median random
      Math.random = () => 0.4;
      await usePlayerStore.getState().quickShufflePlay();
      const firstPickedId = usePlayerStore.getState().activeSegment?.id;

      // Second pick: first item now has weight 0.02, second has weight 1.0
      Math.random = () => 0.5;
      await usePlayerStore.getState().quickShufflePlay();
      const secondPickedId = usePlayerStore.getState().activeSegment?.id;

      expect(firstPickedId).not.toBeNull();
      expect(secondPickedId).not.toBeNull();
      expect(secondPickedId).not.toBe(firstPickedId);
    } finally {
      audioEngine.playSegment = origEnginePlay;
      Math.random = origRandom;
    }
  });

  it("quickShufflePlay penalizes currently active segment even if started manually", async () => {
    clearShuffleHistory();
    const origEnginePlay = audioEngine.playSegment;
    const origRandom = Math.random;
    audioEngine.playSegment = (() => Promise.resolve()) as any;

    try {
      const items = [
        { segment: segment1, track: track1 },
        { segment: segment2, track: track2 },
      ];

      // Simulate segment1 started manually (e.g. from TrackCard or user click)
      usePlayerStore.setState({
        tracks: [track1, track2],
        playbackMode: "slices_only",
        activeTrack: track1,
        activeSegment: segment1,
        queuesByMode: {
          mixed: [],
          slices_only: [...items],
          original_only: [],
        },
        queue: [...items],
        queueIndex: 0,
        isPlaying: true,
      });

      // quickShufflePlay should register active segment1 and pick segment2
      Math.random = () => 0.5;
      await usePlayerStore.getState().quickShufflePlay();
      const pickedSegment = usePlayerStore.getState().activeSegment;

      expect(pickedSegment?.id).toBe(segment2.id);
    } finally {
      audioEngine.playSegment = origEnginePlay;
      Math.random = origRandom;
    }
  });

  it("quickShufflePlay works in original_only mode without scrambling queues", async () => {
    clearShuffleHistory();
    const origEnginePlay = audioEngine.playSegment;
    audioEngine.playSegment = (() => Promise.resolve()) as any;

    try {
      const origQueue = [
        { segment: { id: `fallback_${track1.id}`, track_id: track1.id, name: track1.title, start_time: 0, end_time: track1.duration }, track: track1 },
        { segment: { id: `fallback_${track2.id}`, track_id: track2.id, name: track2.title, start_time: 0, end_time: track2.duration }, track: track2 },
      ];

      usePlayerStore.setState({
        tracks: [track1, track2],
        playbackMode: "original_only",
        queuesByMode: {
          mixed: [],
          slices_only: [],
          original_only: [...origQueue],
        },
        queue: [...origQueue],
        queueIndex: -1,
        isPlaying: false,
      });

      await usePlayerStore.getState().quickShufflePlay();
      const state = usePlayerStore.getState();
      expect(state.isPlaying).toBe(true);
      expect(state.activeSegment?.id.startsWith("fallback_")).toBe(true);
      expect(state.queuesByMode.original_only.map((i) => i.segment.id)).toEqual(origQueue.map((i) => i.segment.id));
    } finally {
      audioEngine.playSegment = origEnginePlay;
    }
  });

  it("quickShufflePlay falls back to mixed queue if slices_only queue is empty", async () => {
    clearShuffleHistory();
    const origEnginePlay = audioEngine.playSegment;
    audioEngine.playSegment = (() => Promise.resolve()) as any;

    try {
      usePlayerStore.setState({
        tracks: [track1, track2],
        playbackMode: "slices_only",
        queuesByMode: {
          mixed: [{ segment: segment1, track: track1 }],
          slices_only: [],
          original_only: [],
        },
        queue: [],
        queueIndex: -1,
        isPlaying: false,
      });

      await usePlayerStore.getState().quickShufflePlay([]);
      const state = usePlayerStore.getState();
      expect(state.isPlaying).toBe(true);
      expect(state.activeSegment?.id).toBe(segment1.id);
    } finally {
      audioEngine.playSegment = origEnginePlay;
    }
  });

  it("reorderQueue with modeOverride reorders target mode without altering active playback or active queue", () => {
    const originalItems = [
      { segment: { id: "fallback_trk_1", track_id: "trk_1", name: "Full A", start_time: 0, end_time: 100 }, track: track1 },
      { segment: { id: "fallback_trk_2", track_id: "trk_2", name: "Full B", start_time: 0, end_time: 120 }, track: track2 },
    ];
    const slicesItems = [
      { segment: segment1, track: track1 },
      { segment: segment2, track: track1 },
    ];

    usePlayerStore.setState({
      playbackMode: "slices_only",
      queue: [...slicesItems],
      queueIndex: 0,
      activeTrack: track1,
      activeSegment: segment1,
      queuesByMode: {
        slices_only: [...slicesItems],
        original_only: [...originalItems],
        mixed: [],
      },
    });

    // Reorder original_only while active mode is slices_only
    usePlayerStore.getState().reorderQueue(0, 1, "original_only");

    const state = usePlayerStore.getState();
    // Active queue & index MUST NOT change
    expect(state.playbackMode).toBe("slices_only");
    expect(state.queue[0].segment.id).toBe(segment1.id);
    expect(state.queueIndex).toBe(0);

    // Target mode in queuesByMode must be reordered
    expect(state.queuesByMode.original_only[0].segment.id).toBe("fallback_trk_2");
    expect(state.queuesByMode.original_only[1].segment.id).toBe("fallback_trk_1");
  });

  it("removeQueueItemAtIndex with modeOverride removes item from target mode without affecting active playback", () => {
    const originalItems = [
      { segment: { id: "fallback_trk_1", track_id: "trk_1", name: "Full A", start_time: 0, end_time: 100 }, track: track1 },
      { segment: { id: "fallback_trk_2", track_id: "trk_2", name: "Full B", start_time: 0, end_time: 120 }, track: track2 },
    ];
    const slicesItems = [
      { segment: segment1, track: track1 },
      { segment: segment2, track: track1 },
    ];

    usePlayerStore.setState({
      playbackMode: "slices_only",
      queue: [...slicesItems],
      queueIndex: 0,
      activeTrack: track1,
      activeSegment: segment1,
      queuesByMode: {
        slices_only: [...slicesItems],
        original_only: [...originalItems],
        mixed: [],
      },
    });

    // Remove from original_only while playing slices_only
    usePlayerStore.getState().removeQueueItemAtIndex(0, "original_only");

    const state = usePlayerStore.getState();
    expect(state.playbackMode).toBe("slices_only");
    expect(state.queue.length).toBe(2);
    expect(state.queuesByMode.original_only.length).toBe(1);
    expect(state.queuesByMode.original_only[0].segment.id).toBe("fallback_trk_2");
  });

  it("reshuffleCurrentQueue with modeOverride reshuffles target mode without affecting active queue", () => {
    const originalItems = [
      { segment: { id: "fallback_trk_1", track_id: "trk_1", name: "Full A", start_time: 0, end_time: 100 }, track: track1 },
      { segment: { id: "fallback_trk_2", track_id: "trk_2", name: "Full B", start_time: 0, end_time: 120 }, track: track2 },
      { segment: { id: "fallback_trk_3", track_id: "trk_3", name: "Full C", start_time: 0, end_time: 130 }, track: track1 },
    ];
    const slicesItems = [
      { segment: segment1, track: track1 },
      { segment: segment2, track: track1 },
    ];

    usePlayerStore.setState({
      playbackMode: "slices_only",
      queue: [...slicesItems],
      queueIndex: 0,
      isShuffle: false,
      queuesByMode: {
        slices_only: [...slicesItems],
        original_only: [...originalItems],
        mixed: [],
      },
      shuffleByMode: {
        slices_only: false,
        original_only: false,
        mixed: false,
      },
    });

    usePlayerStore.getState().reshuffleCurrentQueue("original_only");

    const state = usePlayerStore.getState();
    expect(state.isShuffle).toBe(false);
    expect(state.playbackMode).toBe("slices_only");
    expect(state.queue).toEqual(slicesItems);
    expect(state.shuffleByMode.original_only).toBe(true);
    expect(state.queuesByMode.original_only.length).toBe(3);
  });

  it("switching mode via setPlaybackMode and playing clicked item plays that item and auto-advances within that tab's playlist", async () => {
    const origEnginePlay = audioEngine.playSegment;
    audioEngine.playSegment = (() => Promise.resolve()) as any;

    try {
      const originalItems = [
        { segment: { id: "fallback_trk_1", track_id: "trk_1", name: "Full A", start_time: 0, end_time: 100 }, track: track1 },
        { segment: { id: "fallback_trk_2", track_id: "trk_2", name: "Full B", start_time: 0, end_time: 120 }, track: track2 },
      ];
      const slicesItems = [
        { segment: segment1, track: track1 },
        { segment: segment2, track: track1 },
      ];

      usePlayerStore.setState({
        playbackMode: "original_only",
        queue: [...originalItems],
        queueIndex: 0,
        activeTrack: track1,
        activeSegment: originalItems[0].segment,
        queuesByMode: {
          original_only: [...originalItems],
          slices_only: [...slicesItems],
          mixed: [],
        },
        initializedModes: {
          original_only: true,
          slices_only: true,
          mixed: false,
        },
      });

      // User in original_only tab clicks segment2 in slices_only tab
      await usePlayerStore.getState().setPlaybackMode("slices_only");
      await usePlayerStore.getState().playSegment(segment2, track1, 1);

      let state = usePlayerStore.getState();
      expect(state.playbackMode).toBe("slices_only");
      expect(state.activeSegment?.id).toBe(segment2.id);
      expect(state.queueIndex).toBe(1);

      // Auto-advance (nextSegment) advances in slices_only playlist (with isLoopQueue enabled)
      usePlayerStore.setState({ isLoopQueue: true });
      usePlayerStore.getState().nextSegment();
      state = usePlayerStore.getState();
      expect(state.queueIndex).toBe(0); // Loops back to index 0 of slices_only
      expect(state.activeSegment?.id).toBe(segment1.id);
      usePlayerStore.setState({ isLoopQueue: false });
    } finally {
      audioEngine.playSegment = origEnginePlay;
    }
  });

  it("playing a custom slice while in original_only does not contaminate original_only queue", async () => {
    const origEnginePlay = audioEngine.playSegment;
    audioEngine.playSegment = (() => Promise.resolve()) as any;

    try {
      const originalItems = [
        { segment: { id: "fallback_trk_1", track_id: "trk_1", name: "Full A", start_time: 0, end_time: 100 }, track: track1 },
      ];
      usePlayerStore.setState({
        playbackMode: "original_only",
        queue: [...originalItems],
        queueIndex: 0,
        activeTrack: track1,
        activeSegment: originalItems[0].segment,
        queuesByMode: {
          original_only: [...originalItems],
          slices_only: [],
          mixed: [],
        },
        initializedModes: {
          original_only: true,
          slices_only: false,
          mixed: false,
        },
      });

      // Play a custom slice (not in original_only queue)
      await usePlayerStore.getState().playSegment(segment1, track1);

      const state = usePlayerStore.getState();
      expect(state.playbackMode).toBe("original_only");
      expect(state.activeSegment?.id).toBe(segment1.id);
      // original_only queue MUST NOT have been polluted with segment1!
      expect(state.queuesByMode.original_only.length).toBe(1);
      expect(state.queuesByMode.original_only[0].segment.id).toBe("fallback_trk_1");
      expect(state.queue.length).toBe(1);
    } finally {
      audioEngine.playSegment = origEnginePlay;
    }
  });

  it("removeQueueItemAtIndex to 0 items marks initializedModes as true and does not resurrect on tab switch", async () => {
    const originalItems = [
      { segment: { id: "fallback_trk_1", track_id: "trk_1", name: "Full A", start_time: 0, end_time: 100 }, track: track1 },
    ];
    usePlayerStore.setState({
      playbackMode: "original_only",
      queue: [...originalItems],
      queueIndex: 0,
      activeTrack: track1,
      activeSegment: originalItems[0].segment,
      tracks: [track1],
      queuesByMode: {
        original_only: [...originalItems],
        slices_only: [],
        mixed: [],
      },
      initializedModes: {
        original_only: true,
        slices_only: false,
        mixed: false,
      },
    });

    // Remove the only item in original_only
    usePlayerStore.getState().removeQueueItemAtIndex(0, "original_only");

    let state = usePlayerStore.getState();
    expect(state.queuesByMode.original_only.length).toBe(0);
    expect(state.initializedModes.original_only).toBe(true);

    // Switch away to mixed, then back to original_only
    await usePlayerStore.getState().setPlaybackMode("mixed");
    await usePlayerStore.getState().setPlaybackMode("original_only");

    state = usePlayerStore.getState();
    // original_only must REMAIN empty and not resurrect the deleted item
    expect(state.queuesByMode.original_only.length).toBe(0);
  });

  it("setPlaybackMode returns true on success and false on abort", async () => {
    usePlayerStore.setState({
      playbackMode: "original_only",
      queuesByMode: {
        original_only: [],
        slices_only: [],
        mixed: [],
      },
      initializedModes: {
        original_only: true,
        slices_only: true,
        mixed: true,
      },
    });

    const res1 = await usePlayerStore.getState().setPlaybackMode("original_only");
    expect(res1).toBe(true);

    const res2 = await usePlayerStore.getState().setPlaybackMode("mixed");
    expect(res2).toBe(true);
    expect(usePlayerStore.getState().playbackMode).toBe("mixed");
  });

  it("playSegment does not un-dismiss fallback_${track.id} in mixed mode when playing a custom slice", async () => {
    const origEnginePlay = audioEngine.playSegment;
    audioEngine.playSegment = (() => Promise.resolve()) as any;

    try {
      // Setup mixed queue with a slice and a fallback for track1
      const fallbackItem = { segment: { id: `fallback_${track1.id}`, track_id: track1.id, name: "Full A", start_time: 0, end_time: 100 }, track: track1 };
      const sliceItem = { segment: segment1, track: track1 };

      usePlayerStore.setState({
        playbackMode: "mixed",
        queue: [sliceItem, fallbackItem],
        queueIndex: 0,
        activeTrack: track1,
        activeSegment: segment1,
        tracks: [track1],
        queuesByMode: {
          mixed: [sliceItem, fallbackItem],
          slices_only: [],
          original_only: [],
        },
        initializedModes: {
          mixed: true,
          slices_only: false,
          original_only: false,
        },
      });

      // User dismisses fallbackItem (index 1) in mixed queue
      usePlayerStore.getState().removeQueueItemAtIndex(1, "mixed");
      expect(usePlayerStore.getState().queuesByMode.mixed.length).toBe(1);

      // Now user plays sliceItem
      await usePlayerStore.getState().playSegment(segment1, track1, 0);

      // Reconcile or verify fallback is still dismissed
      const reconciled = reconcileSingleModeQueue(
        "mixed",
        usePlayerStore.getState().queuesByMode.mixed,
        [segment1],
        [track1],
        new Map([[track1.id, track1]]),
        new Set([segment1.id]),
        new Map([[segment1.id, segment1]]),
        segment1,
        [],
        false
      );

      // Fallback MUST NOT be resurrected into mixed queue!
      expect(reconciled.some((it) => it.segment.id === `fallback_${track1.id}`)).toBe(false);
      expect(reconciled.length).toBe(1);
    } finally {
      audioEngine.playSegment = origEnginePlay;
    }
  });

  it("ensureModeQueue lazily populates uninitialized mode queue without disturbing active queue", async () => {
    usePlayerStore.setState({
      playbackMode: "mixed",
      queue: [{ segment: segment1, track: track1 }],
      queueIndex: 0,
      activeTrack: track1,
      activeSegment: segment1,
      tracks: [track1, track2],
      queuesByMode: {
        mixed: [{ segment: segment1, track: track1 }],
        slices_only: [],
        original_only: [],
      },
      initializedModes: {
        mixed: true,
        slices_only: false,
        original_only: false,
      },
    });

    // Call ensureModeQueue for original_only
    await usePlayerStore.getState().ensureModeQueue("original_only");

    const state = usePlayerStore.getState();
    // original_only must be populated now
    expect(state.initializedModes.original_only).toBe(true);
    expect(state.queuesByMode.original_only.length).toBe(2);
    // Active playback and active queue must NOT be changed!
    expect(state.playbackMode).toBe("mixed");
    expect(state.queue.length).toBe(1);
    expect(state.queue[0].segment.id).toBe(segment1.id);
  });

  it("ensureModeQueue aborts and does NOT mark initializedModes as true if /api/segments fails", async () => {
    const origFetch = global.fetch;
    (global as any).fetch = (url: string) => {
      if (url === "/api/segments") {
        return Promise.reject(new Error("Network offline"));
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    };

    try {
      usePlayerStore.setState({
        playbackMode: "original_only",
        tracks: [track1, track2],
        queuesByMode: {
          mixed: [],
          slices_only: [],
          original_only: [{ segment: segment1, track: track1 }],
        },
        initializedModes: {
          mixed: false,
          slices_only: false,
          original_only: true,
        },
      });

      await usePlayerStore.getState().ensureModeQueue("slices_only");

      const state = usePlayerStore.getState();
      // slices_only must NOT be marked as initialized because fetch failed!
      expect(state.initializedModes.slices_only).toBe(false);
      expect(state.queuesByMode.slices_only.length).toBe(0);
    } finally {
      global.fetch = origFetch;
    }
  });

  it("ensureModeQueue synchronizes active queue when mode === playbackMode", async () => {
    const origFetch = global.fetch;
    (global as any).fetch = (url: string) => {
      return Promise.resolve({ ok: true, json: () => Promise.resolve([segment1]) });
    };

    try {
      usePlayerStore.setState({
        playbackMode: "slices_only",
        queue: [],
        queueIndex: -1,
        tracks: [track1],
        queuesByMode: {
          mixed: [],
          slices_only: [],
          original_only: [],
        },
        initializedModes: {
          mixed: false,
          slices_only: false,
          original_only: false,
        },
      });

      await usePlayerStore.getState().ensureModeQueue("slices_only");

      const state = usePlayerStore.getState();
      expect(state.initializedModes.slices_only).toBe(true);
      expect(state.queuesByMode.slices_only.length).toBe(1);
      // Both queuesByMode and active queue must be updated!
      expect(state.queue.length).toBe(1);
      expect(state.queue[0].segment.id).toBe(segment1.id);
    } finally {
      global.fetch = origFetch;
    }
  });

  it("fetchTracks full reconciliation does not leak currentActiveSegment dismissal immunity to inactive modes", async () => {
    const origFetch = global.fetch;
    (global as any).fetch = (url: string) => {
      if (url === "/api/tracks") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([track1]) });
      }
      if (url === "/api/segments") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([segment1]) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    };

    try {
      // User is currently playing segment1 in slices_only
      // BUT has dismissed segment1 in mixed mode!
      dismissedSegmentIdsByMode.mixed.add(segment1.id);
      dismissedSegmentIdsByMode.slices_only.delete(segment1.id);

      usePlayerStore.setState({
        playbackMode: "slices_only",
        activeTrack: track1,
        activeSegment: segment1,
        isPlaying: true,
        queue: [{ segment: segment1, track: track1 }],
        queueIndex: 0,
        tracks: [track1],
        queuesByMode: {
          slices_only: [{ segment: segment1, track: track1 }],
          mixed: [], // empty because segment1 was dismissed
          original_only: [],
        },
        initializedModes: {
          slices_only: true,
          mixed: true,
          original_only: true,
        },
      });

      // Run full reconciliation
      await usePlayerStore.getState().fetchTracks(true);

      const state = usePlayerStore.getState();
      // In slices_only: segment1 remains because it's actively playing and not dismissed
      expect(state.queuesByMode.slices_only.length).toBe(1);
      // In mixed: segment1 MUST NOT be resurrected because it was dismissed in mixed!
      expect(state.queuesByMode.mixed.some((it) => it.segment.id === segment1.id)).toBe(false);
    } finally {
      global.fetch = origFetch;
      dismissedSegmentIdsByMode.mixed.delete(segment1.id);
    }
  });

  it("ensureModeQueue synchronizes queueIndex to match activeSegment when mode === playbackMode", async () => {
    const origFetch = global.fetch;
    (global as any).fetch = (url: string) => {
      return Promise.resolve({ ok: true, json: () => Promise.resolve([segment2, segment1]) });
    };

    try {
      usePlayerStore.setState({
        playbackMode: "slices_only",
        activeTrack: track1,
        activeSegment: segment1,
        queue: [],
        queueIndex: -1,
        tracks: [track1, track2],
        queuesByMode: {
          slices_only: [],
          original_only: [],
          mixed: [],
        },
        initializedModes: {
          slices_only: false,
          original_only: false,
          mixed: false,
        },
      });

      await usePlayerStore.getState().ensureModeQueue("slices_only");

      const state = usePlayerStore.getState();
      expect(state.initializedModes.slices_only).toBe(true);
      expect(state.queue.length).toBe(2);
      // targetQueue is sorted by title and start_time -> segment1 is index 0
      const expectedIdx = state.queue.findIndex((it) => it.segment.id === segment1.id);
      expect(expectedIdx).toBeGreaterThanOrEqual(0);
      expect(state.queueIndex).toBe(expectedIdx);
    } finally {
      global.fetch = origFetch;
    }
  });

  it("playSegment with stale overrideIndex falls back to true segment index", async () => {
    const origAudioPlay = audioEngine.playSegment;
    audioEngine.playSegment = () => Promise.resolve();

    try {
      const item0 = { segment: segment1, track: track1 };
      const item1 = { segment: segment2, track: track2 };

      usePlayerStore.setState({
        playbackMode: "mixed",
        queue: [item0, item1],
        queueIndex: 0,
        activeSegment: segment1,
        activeTrack: track1,
        isPlaying: true,
        queuesByMode: {
          mixed: [item0, item1],
          slices_only: [],
          original_only: [],
        },
        initializedModes: {
          mixed: true,
          slices_only: true,
          original_only: true,
        },
      });

      // Caller passes stale overrideIndex: 0, but is requesting to play segment2 (which is at index 1)!
      await usePlayerStore.getState().playSegment(segment2, track2, 0);

      const state = usePlayerStore.getState();
      expect(state.activeSegment?.id).toBe(segment2.id);
      // queueIndex MUST NOT be assigned stale 0, it must resolve to true index 1!
      expect(state.queueIndex).toBe(1);
    } finally {
      audioEngine.playSegment = origAudioPlay;
    }
  });
});


