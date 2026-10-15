import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";

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
    play() { return Promise.resolve(); }
    load() {}
    removeAttribute(attr: string) {
      if (attr === "src") this.src = "";
    }
  };
}

const { usePlayerStore, resetEtagCache } = await import("./usePlayerStore");
import type { Track, Segment } from "@/server/types";
const { audioEngine } = await import("../lib/audio");

describe("Client ETag 304 Caching in usePlayerStore", () => {
  const origFetch = globalThis.fetch;
  const mockFetch = (handler: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>) => {
    globalThis.fetch = Object.assign(handler, { preconnect: origFetch.preconnect });
  };

  const track1: Track = {
    id: "trk_etag_1",
    source_type: "local",
    source_uri: "local://track1.mp3",
    title: "Track 1",
    duration: 180,
    status: "ready",
    volume: 0.5,
  };

  const segment1: Segment = {
    id: "seg_etag_1",
    track_id: track1.id,
    name: "Segment 1",
    start_time: 10,
    end_time: 40,
  };

  beforeEach(() => {
    resetEtagCache?.();
    usePlayerStore.setState({
      tracks: [],
      queue: [],
      queuesByMode: { mixed: [], slices_only: [], original_only: [] },
      playbackMode: "mixed",
      activeTrack: null,
      activeSegment: null,
      queueIndex: -1,
      isPlaying: false,
    });
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it("should send If-None-Match on subsequent fetchTracks calls and preserve state on 304", async () => {
    let callCount = 0;
    let lastIfNoneMatch: string | null = null;

    globalThis.fetch = (mock(async (input: any, init?: any) => {
      const url = typeof input === "string" ? input : input.url;
      if (url === "/api/tracks") {
        callCount++;
        const headers = init?.headers || {};
        lastIfNoneMatch = headers["If-None-Match"] || headers["if-none-match"] || null;

        if (callCount === 1) {
          return new Response(JSON.stringify([track1]), {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "ETag": 'W/"tracks_tag_v1"',
            },
          });
        }

        if (callCount === 2 && lastIfNoneMatch === 'W/"tracks_tag_v1"') {
          return new Response(null, {
            status: 304,
            headers: {
              "ETag": 'W/"tracks_tag_v1"',
            },
          });
        }
      }

      if (url === "/api/segments") {
        return new Response(JSON.stringify([segment1]), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "ETag": 'W/"segments_tag_v1"',
          },
        });
      }

      return new Response("Not found", { status: 404 });
    }) as any);

    // 1st fetch: should receive 200 and store tracks
    await usePlayerStore.getState().fetchTracks(true);
    expect(callCount).toBe(1);
    expect(lastIfNoneMatch).toBeNull();
    const tracksAfterFirst = usePlayerStore.getState().tracks;
    expect(tracksAfterFirst.length).toBe(1);
    expect(tracksAfterFirst[0].id).toBe("trk_etag_1");

    // 2nd fetch: should send If-None-Match and receive 304
    await usePlayerStore.getState().fetchTracks(false);
    expect(callCount).toBe(2);
    expect(lastIfNoneMatch as string | null).toBe('W/"tracks_tag_v1"');

    // Reference identity must be preserved on 304
    const tracksAfterSecond = usePlayerStore.getState().tracks;
    expect(tracksAfterSecond).toBe(tracksAfterFirst);
  });

  it("should cache segments ETag and handle 304 in reconcileSegments without wiping queue", async () => {
    let segCallCount = 0;
    let lastSegIfNoneMatch: string | null = null;

    globalThis.fetch = (mock(async (input: any, init?: any) => {
      const url = typeof input === "string" ? input : input.url;
      if (url === "/api/tracks") {
        return new Response(JSON.stringify([track1]), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "ETag": 'W/"tracks_tag_v1"',
          },
        });
      }

      if (url === "/api/segments") {
        segCallCount++;
        const headers = init?.headers || {};
        lastSegIfNoneMatch = headers["If-None-Match"] || headers["if-none-match"] || null;

        if (segCallCount === 1) {
          return new Response(JSON.stringify([segment1]), {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "ETag": 'W/"segments_tag_v1"',
            },
          });
        }

        if (segCallCount === 2 && lastSegIfNoneMatch === 'W/"segments_tag_v1"') {
          return new Response(null, {
            status: 304,
            headers: {
              "ETag": 'W/"segments_tag_v1"',
            },
          });
        }
      }

      return new Response("Not found", { status: 404 });
    }) as any);

    // 1st reconcile: fetches tracks and segments (200 OK)
    await usePlayerStore.getState().fetchTracks(true);
    expect(segCallCount).toBe(1);
    expect(lastSegIfNoneMatch).toBeNull();

    // 2nd reconcile: sends ETag for both, receives 304 for segments
    await usePlayerStore.getState().fetchTracks(true);
    expect(segCallCount).toBe(2);
    expect(lastSegIfNoneMatch as string | null).toBe('W/"segments_tag_v1"');
  });

  it("should invalidate cachedSegmentsEtag when deleteSegmentsBatch succeeds", async () => {
    let lastSegIfNoneMatch: string | null = null;
    let segCalls = 0;

    globalThis.fetch = (mock(async (input: any, init?: any) => {
      const url = typeof input === "string" ? input : input.url;
      if (url === "/api/tracks") {
        return new Response(JSON.stringify([track1]), {
          status: 200,
          headers: { "Content-Type": "application/json", "ETag": 'W/"tracks_tag"' },
        });
      }
      if (url === "/api/segments") {
        segCalls++;
        const headers = init?.headers || {};
        lastSegIfNoneMatch = headers["If-None-Match"] || headers["if-none-match"] || null;
        return new Response(JSON.stringify([segment1]), {
          status: 200,
          headers: { "Content-Type": "application/json", "ETag": 'W/"segments_tag_v1"' },
        });
      }
      if (url === "/api/segments/batch-delete") {
        return new Response(JSON.stringify({ success: true, count: 1 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("Not found", { status: 404 });
    }) as any);

    // Populate cache
    await usePlayerStore.getState().fetchTracks(true);
    expect(segCalls).toBe(1);

    // deleteSegmentsBatch resets cachedSegmentsEtag and internally calls fetchTracks(true)
    await usePlayerStore.getState().deleteSegmentsBatch([segment1.id]);

    // The fetchTracks call within deleteSegmentsBatch must have received null If-None-Match
    expect(segCalls).toBe(2);
    expect(lastSegIfNoneMatch).toBeNull();
  });

  it("should trigger full segment reconciliation when fetchTracks(false) detects newly ready track", async () => {
    let segCalls = 0;
    const queuedTrack: Track = { ...track1, status: "queued" };
    const readyTrack: Track = { ...track1, status: "ready" };

    usePlayerStore.setState({ tracks: [queuedTrack] });

    mockFetch(async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const validator = new Headers(init?.headers).get("If-None-Match");
      if (url === "/api/tracks") {
        if (validator === 'W/"tracks_ready"') return new Response(null, { status: 304 });
        return new Response(JSON.stringify([readyTrack]), {
          status: 200,
          headers: { "Content-Type": "application/json", "ETag": 'W/"tracks_ready"' },
        });
      }
      if (url === "/api/segments") {
        segCalls++;
        if (validator === 'W/"segments_tag"') return new Response(null, { status: 304 });
        return new Response(JSON.stringify([segment1]), {
          status: 200,
          headers: { "Content-Type": "application/json", "ETag": 'W/"segments_tag"' },
        });
      }
      return new Response("Not found", { status: 404 });
    });

    // Call with reconcileSegments = false
    await usePlayerStore.getState().fetchTracks(false);

    // Because track transitioned from queued to ready, it MUST escalate and fetch segments!
    expect(segCalls).toBe(1);
    expect(usePlayerStore.getState().tracks[0].status).toBe("ready");
    await usePlayerStore.getState().fetchTracks(true);
    expect(usePlayerStore.getState().tracks[0].status).toBe("ready");
  });

  it("retries a track payload when its segment reconciliation failed before committing it", async () => {
    const queuedTrack: Track = { ...track1, status: "queued" };
    usePlayerStore.setState({ tracks: [queuedTrack] });
    let segmentsAvailable = false;
    mockFetch(async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const validator = new Headers(init?.headers).get("If-None-Match");
      if (url === "/api/tracks") {
        if (validator === 'W/"ready"') return new Response(null, { status: 304 });
        return Response.json([track1], { headers: { ETag: 'W/"ready"' } });
      }
      if (url === "/api/segments") {
        return segmentsAvailable ? Response.json([segment1]) : new Response(null, { status: 503 });
      }
      return new Response(null, { status: 404 });
    });
    await usePlayerStore.getState().fetchTracks(true);
    segmentsAvailable = true;
    await usePlayerStore.getState().fetchTracks(true);
    expect(usePlayerStore.getState().tracks[0].status).toBe("ready");
  });

  it("keeps newer playback and Studio selections when a segment refresh completes", async () => {
    const a: Track = { ...track1, id: "refresh-a", title: "A" };
    const b: Track = { ...track1, id: "refresh-b", title: "B" };
    const sa: Segment = { ...segment1, id: "refresh-sa", track_id: a.id };
    const sb: Segment = { ...segment1, id: "refresh-sb", track_id: b.id };
    const queue = [{ track: a, segment: sa }, { track: b, segment: sb }];
    usePlayerStore.setState({ tracks: [a, b], queue, queuesByMode: { mixed: queue, slices_only: [], original_only: [] },
      queueIndex: 0, activeTrack: a, activeSegment: sa, sliceStudioTrack: a, activePlaylistPlayingId: null, isPlaying: true });
    let finishSegments!: (response: Response) => void;
    let enteredSegments!: () => void;
    const waiting = new Promise<void>((fulfill) => { enteredSegments = fulfill; });
    mockFetch(async (input) => {
      if (String(input) === "/api/tracks") return Response.json([{ ...a, title: "A fresh" }, { ...b, title: "B fresh" }]);
      enteredSegments();
      return new Promise<Response>((fulfill) => { finishSegments = fulfill; });
    });
    const play = spyOn(audioEngine, "playSegment").mockResolvedValue(undefined);
    try {
      const refreshing = usePlayerStore.getState().fetchTracks(true);
      await waiting;
      await usePlayerStore.getState().playSegment(sb, b, 1);
      usePlayerStore.setState({ sliceStudioTrack: b });
      finishSegments(Response.json([sa, sb]));
      await refreshing;
      const state = usePlayerStore.getState();
      expect(state.activeTrack?.id).toBe(b.id);
      expect(state.activeSegment?.id).toBe(sb.id);
      expect(state.queue[state.queueIndex].track.id).toBe(b.id);
      expect(state.sliceStudioTrack?.id).toBe(b.id);
    } finally {
      play.mockRestore();
    }
  });

  it("does not let a lightweight poll discard pending full segment reconciliation", async () => {
    const queued = [{ track: track1, segment: { ...segment1, id: "fallback_" + track1.id, start_time: 0, end_time: track1.duration } }];
    usePlayerStore.setState({ tracks: [track1], queue: queued, queuesByMode: { mixed: queued, slices_only: [], original_only: [] } });
    let releaseSegments!: (response: Response) => void;
    let reachedSegments!: () => void;
    const reached = new Promise<void>((fulfill) => { reachedSegments = fulfill; });
    let holdFirstSegmentRequest = true;
    mockFetch(async (input) => {
      if (String(input) === "/api/tracks") return Response.json([{ ...track1, segment_count: 1 }]);
      if (holdFirstSegmentRequest) {
        holdFirstSegmentRequest = false;
        reachedSegments();
        return new Promise<Response>((fulfill) => { releaseSegments = fulfill; });
      }
      return Response.json([segment1]);
    });
    const fullRefresh = usePlayerStore.getState().fetchTracks(true);
    await reached;
    await usePlayerStore.getState().fetchTracks(false);
    releaseSegments(Response.json([segment1]));
    await fullRefresh;
    expect(usePlayerStore.getState().queuesByMode.mixed.some((item) => item.segment.id === segment1.id)).toBe(true);
  });

  it("should NOT cache ETag if tracks response is not an array or fails JSON parsing", async () => {
    // Attempt 1: Server returns 200 with invalid json/non-array, but provides an ETag
    globalThis.fetch = (mock(async (input: any) => {
      const url = typeof input === "string" ? input : input.url;
      if (url === "/api/tracks") {
        return new Response(JSON.stringify({ error: "malformed" }), {
          status: 200,
          headers: { "Content-Type": "application/json", "ETag": 'W/"bad_tag"' },
        });
      }
      return new Response("Not found", { status: 404 });
    }) as any);

    await usePlayerStore.getState().fetchTracks(false);

    // Attempt 2: Next request should NOT send If-None-Match: W/"bad_tag" on its first fetch
    const capturedHeaders: (string | null)[] = [];
    globalThis.fetch = (mock(async (input: any, init: any) => {
      const url = typeof input === "string" ? input : input.url;
      if (url === "/api/tracks") {
        capturedHeaders.push(init?.headers?.["If-None-Match"] ?? null);
        return new Response(JSON.stringify([track1]), {
          status: 200,
          headers: { "Content-Type": "application/json", "ETag": 'W/"good_tag"' },
        });
      }
      if (url === "/api/segments") {
        return new Response(JSON.stringify([segment1]), {
          status: 200,
          headers: { "Content-Type": "application/json", "ETag": 'W/"good_seg_tag"' },
        });
      }
      return new Response("Not found", { status: 404 });
    }) as any);

    await usePlayerStore.getState().fetchTracks(false);
    expect(capturedHeaders[0]).toBeNull();
  });

  it("should NOT cache segments ETag if segments response is not an array or fails JSON parsing", async () => {
    // Attempt 1: Server returns 200 with non-array json, but includes an ETag
    globalThis.fetch = (mock(async (input: any) => {
      const url = typeof input === "string" ? input : input.url;
      if (url === "/api/tracks") {
        return new Response(JSON.stringify([track1]), {
          status: 200,
          headers: { "Content-Type": "application/json", "ETag": 'W/"tracks_ok"' },
        });
      }
      if (url === "/api/segments") {
        return new Response(JSON.stringify({ error: "bad segments payload" }), {
          status: 200,
          headers: { "Content-Type": "application/json", "ETag": 'W/"bad_seg_tag"' },
        });
      }
      return new Response("Not found", { status: 404 });
    }) as any);

    // Call fetchTracks(true) which calls fetchAllSegmentsWithEtag()
    await usePlayerStore.getState().fetchTracks(true);

    // Attempt 2: Next segments request should NOT send If-None-Match: W/"bad_seg_tag"
    let capturedSegHeader: string | null = null;
    globalThis.fetch = (mock(async (input: any, init: any) => {
      const url = typeof input === "string" ? input : input.url;
      if (url === "/api/tracks") {
        return new Response(JSON.stringify([track1]), {
          status: 200,
          headers: { "Content-Type": "application/json", "ETag": 'W/"tracks_ok"' },
        });
      }
      if (url === "/api/segments") {
        capturedSegHeader = init?.headers?.["If-None-Match"] ?? null;
        return new Response(JSON.stringify([segment1]), {
          status: 200,
          headers: { "Content-Type": "application/json", "ETag": 'W/"good_seg_tag"' },
        });
      }
      return new Response("Not found", { status: 404 });
    }) as any);

    await usePlayerStore.getState().fetchTracks(true);
    expect(capturedSegHeader).toBeNull();
  });
});

