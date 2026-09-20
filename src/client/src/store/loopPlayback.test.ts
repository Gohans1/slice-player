import { describe, it, expect, beforeEach, afterEach } from "bun:test";

// Mock Audio for headless test environment
if (typeof globalThis.Audio === "undefined") {
  Object.defineProperty(globalThis, "Audio", {
    value: class {
      crossOrigin = "";
      preload = "";
      addEventListener() {}
      removeEventListener() {}
      pause() {}
      play() { return Promise.resolve(); }
    },
    writable: true,
  });
}

const { usePlayerStore } = await import("./usePlayerStore");
const { audioEngine } = await import("../lib/audio");
import type { Track, Segment } from "@/server/types";

describe("Loop Playback Features", () => {
  const dummyTrack: Track = {
    id: "trk_loop_1",
    title: "Loop Track 1",
    duration: 120,
    source_type: "youtube",
    source_uri: "abc",
    status: "ready",
  };

  const dummySegments: Segment[] = [
    { id: "seg_loop_0", track_id: "trk_loop_1", name: "Segment 0", start_time: 0, end_time: 30 },
    { id: "seg_loop_1", track_id: "trk_loop_1", name: "Segment 1", start_time: 30, end_time: 60 },
    { id: "seg_loop_2", track_id: "trk_loop_1", name: "Segment 2", start_time: 60, end_time: 90 },
  ];

  let origPlaySegment: typeof audioEngine.playSegment;

  beforeEach(() => {
    origPlaySegment = audioEngine.playSegment;
    audioEngine.playSegment = (() => Promise.resolve()) as any;

    usePlayerStore.setState({
      queue: dummySegments.map((s) => ({ segment: s, track: dummyTrack })),
      queueIndex: 0,
      activeTrack: dummyTrack,
      activeSegment: dummySegments[0],
      isPlaying: true,
      currentTime: 10,
      isLoopQueue: false,
      isLoopTrack: false,
      activePlaylistPlayingId: null,
      activePlaylistId: null,
    });
  });

  afterEach(() => {
    audioEngine.playSegment = origPlaySegment;
    usePlayerStore.setState({
      isLoopQueue: false,
      isLoopTrack: false,
      isPlaying: false,
    });
  });

  it("toggleLoopQueue toggles isLoopQueue correctly", () => {
    expect(usePlayerStore.getState().isLoopQueue).toBe(false);
    usePlayerStore.getState().toggleLoopQueue();
    expect(usePlayerStore.getState().isLoopQueue).toBe(true);
    usePlayerStore.getState().toggleLoopQueue();
    expect(usePlayerStore.getState().isLoopQueue).toBe(false);
  });

  it("toggleLoopTrack toggles isLoopTrack correctly", () => {
    expect(usePlayerStore.getState().isLoopTrack).toBe(false);
    usePlayerStore.getState().toggleLoopTrack();
    expect(usePlayerStore.getState().isLoopTrack).toBe(true);
    usePlayerStore.getState().toggleLoopTrack();
    expect(usePlayerStore.getState().isLoopTrack).toBe(false);
  });

  it("nextSegment advances sequentially when in the middle of the queue", () => {
    usePlayerStore.setState({ queueIndex: 0 });
    usePlayerStore.getState().nextSegment();

    const state = usePlayerStore.getState();
    expect(state.queueIndex).toBe(1);
    expect(state.activeSegment?.id).toBe("seg_loop_1");
  });

  it("nextSegment stops playback at the end of queue when isLoopQueue is false", () => {
    usePlayerStore.setState({
      queueIndex: 2, // Last item
      activeSegment: dummySegments[2],
      isLoopQueue: false,
      isPlaying: true,
    });

    usePlayerStore.getState().nextSegment(true);

    const state = usePlayerStore.getState();
    expect(state.isPlaying).toBe(false);
    // Queue index remains at the end
    expect(state.queueIndex).toBe(2);
  });

  it("nextSegment loops back to index 0 at the end of queue when isLoopQueue is true", () => {
    usePlayerStore.setState({
      queueIndex: 2, // Last item
      activeSegment: dummySegments[2],
      isLoopQueue: true,
      isPlaying: true,
    });

    usePlayerStore.getState().nextSegment(true);

    const state = usePlayerStore.getState();
    expect(state.queueIndex).toBe(0);
    expect(state.activeSegment?.id).toBe("seg_loop_0");
  });

  it("auto-advance with isLoopTrack repeats the current track instead of advancing", () => {
    let playedSegmentId = "";
    const origStorePlaySegment = usePlayerStore.getState().playSegment;
    usePlayerStore.setState({
      queueIndex: 1,
      activeSegment: dummySegments[1],
      isLoopTrack: true,
      isPlaying: true,
      playSegment: ((seg: Segment) => {
        playedSegmentId = seg.id;
        return Promise.resolve();
      }) as any,
    });

    try {
      // Auto-advance event (isAutoAdvance = true)
      usePlayerStore.getState().nextSegment(true);

      expect(playedSegmentId).toBe("seg_loop_1");
      expect(usePlayerStore.getState().queueIndex).toBe(1);
    } finally {
      usePlayerStore.setState({ playSegment: origStorePlaySegment });
    }
  });

  it("manual nextSegment with isLoopTrack advances to next track (user explicit skip)", () => {
    usePlayerStore.setState({
      queueIndex: 1,
      activeSegment: dummySegments[1],
      isLoopTrack: true,
      isPlaying: true,
    });

    // Manual skip (isAutoAdvance = false / default)
    usePlayerStore.getState().nextSegment(false);

    const state = usePlayerStore.getState();
    expect(state.queueIndex).toBe(2);
    expect(state.activeSegment?.id).toBe("seg_loop_2");
    // isLoopTrack stays active for the next track
    expect(state.isLoopTrack).toBe(true);
  });

  it("prevSegment restarts track when currentTime is above threshold", () => {
    let seekTarget = -1;
    const origSeek = usePlayerStore.getState().seek;
    usePlayerStore.setState({
      queueIndex: 1,
      activeSegment: dummySegments[1],
      currentTime: 50, // 20s into 30s segment (start: 30, end: 60)
      seek: ((target: number) => { seekTarget = target; }) as any,
    });

    try {
      usePlayerStore.getState().prevSegment();
      expect(seekTarget).toBe(dummySegments[1].start_time);
    } finally {
      usePlayerStore.setState({ seek: origSeek });
    }
  });

  it("prevSegment at start of playlist seeks to 0 when isLoopQueue is false", () => {
    let seekTarget = -1;
    const origSeek = usePlayerStore.getState().seek;
    usePlayerStore.setState({
      queueIndex: 0,
      activeSegment: dummySegments[0],
      currentTime: 0.1, // Near start
      isLoopQueue: false,
      seek: ((target: number) => { seekTarget = target; }) as any,
    });

    try {
      usePlayerStore.getState().prevSegment();
      expect(seekTarget).toBe(dummySegments[0].start_time);
      expect(usePlayerStore.getState().queueIndex).toBe(0);
    } finally {
      usePlayerStore.setState({ seek: origSeek });
    }
  });

  it("prevSegment at start of playlist wraps to last item when isLoopQueue is true", () => {
    usePlayerStore.setState({
      queueIndex: 0,
      activeSegment: dummySegments[0],
      currentTime: 0.1, // Near start
      isLoopQueue: true,
    });

    usePlayerStore.getState().prevSegment();

    const state = usePlayerStore.getState();
    expect(state.queueIndex).toBe(2);
    expect(state.activeSegment?.id).toBe("seg_loop_2");
  });

  it("at last track with isLoopQueue: false and isLoopTrack: true, manual nextSegment stops and does not wrap to index 0", () => {
    usePlayerStore.setState({
      queueIndex: 2, // Last item
      activeSegment: dummySegments[2],
      isLoopQueue: false,
      isLoopTrack: true,
      isPlaying: true,
    });

    // Manual user skip
    usePlayerStore.getState().nextSegment(false);

    const state = usePlayerStore.getState();
    expect(state.isPlaying).toBe(false);
    expect(state.queueIndex).toBe(2); // Stays at last item, does NOT wrap to 0
  });

  it("at last track with isLoopQueue: false and isLoopTrack: true, auto-advance replays the last track", () => {
    let playedSegmentId = "";
    const origStorePlaySegment = usePlayerStore.getState().playSegment;
    usePlayerStore.setState({
      queueIndex: 2, // Last item
      activeSegment: dummySegments[2],
      isLoopQueue: false,
      isLoopTrack: true,
      isPlaying: true,
      playSegment: ((seg: Segment) => {
        playedSegmentId = seg.id;
        return Promise.resolve();
      }) as any,
    });

    try {
      // Natural track end (auto advance)
      usePlayerStore.getState().nextSegment(true);

      expect(playedSegmentId).toBe("seg_loop_2");
      expect(usePlayerStore.getState().queueIndex).toBe(2);
    } finally {
      usePlayerStore.setState({ playSegment: origStorePlaySegment });
    }
  });

  it("togglePlay when paused at end of segment restarts from start_time instead of getting stuck", async () => {
    let playedStartTime: number | undefined;
    let playedSegmentId = "";
    const origStorePlaySegment = usePlayerStore.getState().playSegment;

    usePlayerStore.setState({
      queueIndex: 0,
      activeTrack: dummyTrack,
      activeSegment: dummySegments[0], // start_time: 0, end_time: 30
      currentTime: 30, // at the very end
      isPlaying: false,
      playSegment: ((seg: Segment, _track: Track, _overrideIdx?: number, seekTime?: number) => {
        playedSegmentId = seg.id;
        playedStartTime = seekTime;
        return Promise.resolve();
      }) as any,
    });

    try {
      await usePlayerStore.getState().togglePlay();

      expect(playedSegmentId).toBe("seg_loop_0");
      // Must restart from beginning (no offset or start_time)
      expect(playedStartTime).toBeUndefined();
    } finally {
      usePlayerStore.setState({ playSegment: origStorePlaySegment });
    }
  });

  it("resume when paused at end of segment restarts from start_time", async () => {
    let playedSegmentId = "";
    const origStorePlaySegment = usePlayerStore.getState().playSegment;

    usePlayerStore.setState({
      queueIndex: 1,
      activeTrack: dummyTrack,
      activeSegment: dummySegments[1], // start_time: 30, end_time: 60
      currentTime: 60, // at the end
      isPlaying: false,
      playSegment: ((seg: Segment) => {
        playedSegmentId = seg.id;
        return Promise.resolve();
      }) as any,
    });

    try {
      await usePlayerStore.getState().resume();

      expect(playedSegmentId).toBe("seg_loop_1");
    } finally {
      usePlayerStore.setState({ playSegment: origStorePlaySegment });
    }
  });

  it("seeking re-arms audioEngine bounds and onEnd callback", () => {
    let boundsCalledWith: [number, number] | null = null;
    let endCbSet = false;
    const origBounds = audioEngine.updateCurrentSegmentBounds;
    const origSetEnd = audioEngine.setOnSegmentEnd;

    audioEngine.updateCurrentSegmentBounds = ((start: number, end: number) => {
      boundsCalledWith = [start, end];
    }) as any;
    audioEngine.setOnSegmentEnd = ((cb: any) => {
      endCbSet = cb !== null;
    }) as any;

    try {
      usePlayerStore.setState({
        queueIndex: 0,
        activeSegment: dummySegments[0], // 0 to 30
        currentTime: 30,
        isPlaying: false,
      });

      usePlayerStore.getState().seek(15);

      expect(usePlayerStore.getState().currentTime).toBe(15);
      expect(boundsCalledWith as any).toEqual([0, 30]);
      expect(endCbSet).toBe(true);
    } finally {
      audioEngine.updateCurrentSegmentBounds = origBounds;
      audioEngine.setOnSegmentEnd = origSetEnd;
    }
  });
});
