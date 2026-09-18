import { describe, it, expect, beforeEach } from "bun:test";

// Mock Audio for headless test environment
if (typeof globalThis.Audio === "undefined") {
  Object.defineProperty(globalThis, "Audio", {
    value: class {
      crossOrigin = "";
      preload = "";
      addEventListener() {}
      removeEventListener() {}
    },
    writable: true,
  });
}

const { usePlayerStore } = await import("./usePlayerStore");
import type { Track, Segment } from "@/server/types";

describe("usePlayerStore reorderQueue", () => {
  beforeEach(() => {
    usePlayerStore.setState({
      activePlaylistPlayingId: null,
      activePlaylistId: null,
    });
  });
  const dummyTrack: Track = {
    id: "trk_1",
    title: "Track 1",
    duration: 100,
    source_type: "youtube",
    source_uri: "abc",
    status: "ready",
  };

  const dummySegments: Segment[] = [
    { id: "seg_0", track_id: "trk_1", name: "Segment 0", start_time: 0, end_time: 10 },
    { id: "seg_1", track_id: "trk_1", name: "Segment 1", start_time: 10, end_time: 20 },
    { id: "seg_2", track_id: "trk_1", name: "Segment 2", start_time: 20, end_time: 30 },
    { id: "seg_3", track_id: "trk_1", name: "Segment 3", start_time: 30, end_time: 40 },
  ];

  it("should reorder queue items and update queueIndex when active item is moved", () => {
    usePlayerStore.setState({
      queue: dummySegments.map((s) => ({ segment: s, track: dummyTrack })),
      queueIndex: 1, // seg_1 is active
    });

    // Move seg_1 (index 1) to index 3
    usePlayerStore.getState().reorderQueue(1, 3);

    const currentQueue = usePlayerStore.getState().queue;
    expect(currentQueue.map((item) => item.segment.id)).toEqual([
      "seg_0",
      "seg_2",
      "seg_3",
      "seg_1",
    ]);
    expect(usePlayerStore.getState().queueIndex).toBe(3);
  });

  it("should update queueIndex when other items are moved around the active item", () => {
    usePlayerStore.setState({
      queue: dummySegments.map((s) => ({ segment: s, track: dummyTrack })),
      queueIndex: 1, // seg_1 is active
    });

    // Move seg_3 (index 3) to index 0 (before seg_1): active index shifts from 1 to 2
    usePlayerStore.getState().reorderQueue(3, 0);

    let currentQueue = usePlayerStore.getState().queue;
    expect(currentQueue.map((item) => item.segment.id)).toEqual([
      "seg_3",
      "seg_0",
      "seg_1",
      "seg_2",
    ]);
    expect(usePlayerStore.getState().queueIndex).toBe(2);

    // Move seg_3 (index 0, before active index 2) to index 3 (after active index 2):
    // active index shifts from 2 to 1
    usePlayerStore.getState().reorderQueue(0, 3);
    currentQueue = usePlayerStore.getState().queue;
    expect(currentQueue.map((item) => item.segment.id)).toEqual([
      "seg_0",
      "seg_1",
      "seg_2",
      "seg_3",
    ]);
    expect(usePlayerStore.getState().queueIndex).toBe(1);

    // Move bystanders entirely after active item (index 2 to 3 when active is 1): active index unchanged
    usePlayerStore.getState().reorderQueue(2, 3);
    expect(usePlayerStore.getState().queueIndex).toBe(1);

    // Move bystanders entirely before active item (when active is 2, move 0 to 1): active index unchanged
    usePlayerStore.setState({ queueIndex: 2 });
    usePlayerStore.getState().reorderQueue(0, 1);
    expect(usePlayerStore.getState().queueIndex).toBe(2);

    // Move item directly onto active index from before (move 0 to 2 when active is 2 -> active index becomes 1)
    usePlayerStore.setState({
      queue: dummySegments.map((s) => ({ segment: s, track: dummyTrack })),
      queueIndex: 2,
    });
    usePlayerStore.getState().reorderQueue(0, 2);
    expect(usePlayerStore.getState().queueIndex).toBe(1);

    // Move item directly onto active index from after (move 3 to 1 when active is 1 -> active index becomes 2)
    usePlayerStore.setState({
      queue: dummySegments.map((s) => ({ segment: s, track: dummyTrack })),
      queueIndex: 1,
    });
    usePlayerStore.getState().reorderQueue(3, 1);
    expect(usePlayerStore.getState().queueIndex).toBe(2);

    // 2-item adjacent swaps
    const twoItems = dummySegments.slice(0, 2).map((s) => ({ segment: s, track: dummyTrack }));
    usePlayerStore.setState({ queue: [...twoItems], queueIndex: 0 });
    usePlayerStore.getState().reorderQueue(0, 1);
    expect(usePlayerStore.getState().queueIndex).toBe(1);
    expect(usePlayerStore.getState().queue.map((item) => item.segment.id)).toEqual(["seg_1", "seg_0"]);

    usePlayerStore.getState().reorderQueue(1, 0);
    expect(usePlayerStore.getState().queueIndex).toBe(0);
    expect(usePlayerStore.getState().queue.map((item) => item.segment.id)).toEqual(["seg_0", "seg_1"]);
  });

  it("should ignore invalid indices or no-op moves", () => {
    usePlayerStore.setState({
      queue: dummySegments.map((s) => ({ segment: s, track: dummyTrack })),
      queueIndex: 0,
    });

    usePlayerStore.getState().reorderQueue(0, 0);
    expect(usePlayerStore.getState().queue.map((item) => item.segment.id)).toEqual([
      "seg_0",
      "seg_1",
      "seg_2",
      "seg_3",
    ]);

    usePlayerStore.getState().reorderQueue(-1, 2);
    usePlayerStore.getState().reorderQueue(1, 99);
    usePlayerStore.getState().reorderQueue(NaN, 1);
    usePlayerStore.getState().reorderQueue(1, NaN);
    usePlayerStore.getState().reorderQueue(1.5, 2.5);
    expect(usePlayerStore.getState().queue.length).toBe(4);

    // Empty queue safety
    usePlayerStore.setState({ queue: [], queueIndex: -1 });
    usePlayerStore.getState().reorderQueue(0, 1);
    expect(usePlayerStore.getState().queue.length).toBe(0);
    expect(usePlayerStore.getState().queueIndex).toBe(-1);
  });

  it("should update queueIndex correctly when active item is moved upward", () => {
    usePlayerStore.setState({
      queue: dummySegments.map((s) => ({ segment: s, track: dummyTrack })),
      queueIndex: 2, // seg_2 is active
    });

    // Move seg_2 (index 2) upward to index 0
    usePlayerStore.getState().reorderQueue(2, 0);

    const currentQueue = usePlayerStore.getState().queue;
    expect(currentQueue.map((item) => item.segment.id)).toEqual([
      "seg_2",
      "seg_0",
      "seg_1",
      "seg_3",
    ]);
    expect(usePlayerStore.getState().queueIndex).toBe(0);
  });

  it("should synchronize queuesByMode for active mode without mutating other mode queues across all 3 modes", () => {
    const queueItems = dummySegments.map((s) => ({ segment: s, track: dummyTrack }));
    usePlayerStore.setState({
      playbackMode: "slices_only",
      queue: [...queueItems],
      queueIndex: 0,
      queuesByMode: {
        mixed: [...queueItems],
        slices_only: [...queueItems],
        original_only: [...queueItems],
      },
    });

    // Reorder slices_only
    usePlayerStore.getState().reorderQueue(0, 2);

    let state = usePlayerStore.getState();
    expect(state.queue.map((item) => item.segment.id)).toEqual(["seg_1", "seg_2", "seg_0", "seg_3"]);
    expect(state.queuesByMode.slices_only.map((item) => item.segment.id)).toEqual(["seg_1", "seg_2", "seg_0", "seg_3"]);
    expect(state.queuesByMode.mixed.map((item) => item.segment.id)).toEqual(["seg_0", "seg_1", "seg_2", "seg_3"]);
    expect(state.queuesByMode.original_only.map((item) => item.segment.id)).toEqual(["seg_0", "seg_1", "seg_2", "seg_3"]);

    // Now test mixed mode
    usePlayerStore.setState({
      playbackMode: "mixed",
      queue: [...queueItems],
      queueIndex: 1,
    });
    usePlayerStore.getState().reorderQueue(1, 3);
    state = usePlayerStore.getState();
    expect(state.queuesByMode.mixed.map((item) => item.segment.id)).toEqual(["seg_0", "seg_2", "seg_3", "seg_1"]);
    // slices_only order is still preserved
    expect(state.queuesByMode.slices_only.map((item) => item.segment.id)).toEqual(["seg_1", "seg_2", "seg_0", "seg_3"]);

    // Now test original_only mode
    usePlayerStore.setState({
      playbackMode: "original_only",
      queue: [...queueItems],
      queueIndex: 0,
    });
    usePlayerStore.getState().reorderQueue(3, 0);
    state = usePlayerStore.getState();
    expect(state.queuesByMode.original_only.map((item) => item.segment.id)).toEqual(["seg_3", "seg_0", "seg_1", "seg_2"]);
  });

  it("should preserve queueIndex === -1 when reordering while idle", () => {
    usePlayerStore.setState({
      queue: dummySegments.map((s) => ({ segment: s, track: dummyTrack })),
      queueIndex: -1,
    });

    usePlayerStore.getState().reorderQueue(0, 2);
    expect(usePlayerStore.getState().queueIndex).toBe(-1);
    expect(usePlayerStore.getState().queue.map((item) => item.segment.id)).toEqual([
      "seg_1",
      "seg_2",
      "seg_0",
      "seg_3",
    ]);

    // Backward move while idle
    usePlayerStore.getState().reorderQueue(2, 0);
    expect(usePlayerStore.getState().queueIndex).toBe(-1);
    expect(usePlayerStore.getState().queue.map((item) => item.segment.id)).toEqual([
      "seg_0",
      "seg_1",
      "seg_2",
      "seg_3",
    ]);
  });

  it("should preserve custom reordered queue when switching tabs back and forth via setPlaybackMode", async () => {
    const queueItems = dummySegments.map((s) => ({ segment: s, track: dummyTrack }));
    usePlayerStore.setState({
      playbackMode: "mixed",
      queue: [...queueItems],
      queueIndex: 0,
      initializedModes: {
        mixed: false,
        slices_only: false,
        original_only: false,
      },
      queuesByMode: {
        mixed: [...queueItems],
        slices_only: [...queueItems],
        original_only: [...queueItems],
      },
    });

    // Reorder in mixed mode
    usePlayerStore.getState().reorderQueue(0, 3);
    const reorderedIds = usePlayerStore.getState().queue.map((item) => item.segment.id);
    expect(reorderedIds).toEqual(["seg_1", "seg_2", "seg_3", "seg_0"]);
    expect(usePlayerStore.getState().initializedModes.mixed).toBe(true);

    // Switch to slices_only
    await usePlayerStore.getState().setPlaybackMode("slices_only");
    expect(usePlayerStore.getState().playbackMode).toBe("slices_only");

    // Switch back to mixed
    await usePlayerStore.getState().setPlaybackMode("mixed");
    expect(usePlayerStore.getState().playbackMode).toBe("mixed");
    expect(usePlayerStore.getState().queue.map((item) => item.segment.id)).toEqual(["seg_1", "seg_2", "seg_3", "seg_0"]);
    expect(usePlayerStore.getState().queuesByMode.mixed.map((item) => item.segment.id)).toEqual(["seg_1", "seg_2", "seg_3", "seg_0"]);
  });

  it("should maintain correct order and update queueIndex when removing an item from a reordered queue", () => {
    const queueItems = dummySegments.map((s) => ({ segment: s, track: dummyTrack }));
    usePlayerStore.setState({
      playbackMode: "mixed",
      queue: [...queueItems],
      queueIndex: 2, // seg_2 is active
      queuesByMode: {
        mixed: [...queueItems],
        slices_only: [...queueItems],
        original_only: [...queueItems],
      },
    });

    // Reorder: move seg_3 to index 0
    usePlayerStore.getState().reorderQueue(3, 0);
    // Queue: ["seg_3", "seg_0", "seg_1", "seg_2"], queueIndex should be 3
    expect(usePlayerStore.getState().queue.map((item) => item.segment.id)).toEqual(["seg_3", "seg_0", "seg_1", "seg_2"]);
    expect(usePlayerStore.getState().queueIndex).toBe(3);

    // Remove seg_0 (index 1)
    usePlayerStore.getState().removeQueueItemAtIndex(1);
    // Queue: ["seg_3", "seg_1", "seg_2"], queueIndex should adjust to 2
    expect(usePlayerStore.getState().queue.map((item) => item.segment.id)).toEqual(["seg_3", "seg_1", "seg_2"]);
    expect(usePlayerStore.getState().queueIndex).toBe(2);
  });
});
