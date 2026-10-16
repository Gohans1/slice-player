import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { createQueueItem, resetEtagCache, usePlayerStore, type QueueItem } from "./usePlayerStore";
import { audioEngine } from "../lib/audio";
import { createDefaultFullSegment } from "../lib/utils";
import type { PlaylistItemWithDetails, Track } from "@/server/types";

const track = (id: string): Track => ({ id, title: id, duration: 100, source_type: "youtube", source_uri: id, status: "ready" });
const queueItemOf = (t: Track) => createQueueItem(createDefaultFullSegment(t), t, t.id);
const trackIds = (items: QueueItem[]) => items.map((item) => item.track.id);

const [a, b, c, x, y] = ["a", "b", "c", "x", "y"].map(track);
const fetchReturning = (respond: (url: string) => Response): typeof fetch =>
  Object.assign(async (input: RequestInfo | URL) => respond(input instanceof Request ? input.url : input.toString()), {
    preconnect: () => {},
  });
const added = [x, y].map(queueItemOf);

describe("Play Next and Play Later", () => {
  let playAudio: ReturnType<typeof spyOn>;

  beforeEach(() => {
    resetEtagCache();
    playAudio = spyOn(audioEngine, "playSegment").mockResolvedValue(undefined);
    const queue = [a, b, c].map(queueItemOf);
    // Playing b from the Tracks page
    usePlayerStore.setState({
      tracks: [a, b, c, x, y],
      queue,
      queueIndex: 1,
      activeTrack: b,
      activeSegment: queue[1].segment,
      playbackMode: "original_only",
      activePlaylistPlayingId: null,
      queuesByMode: { mixed: [], slices_only: [], original_only: queue },
    });
  });

  afterEach(() => {
    playAudio.mockRestore();
  });

  it("Play Next puts the songs right after the current one", () => {
    usePlayerStore.getState().enqueue(added, "next");

    const state = usePlayerStore.getState();
    expect(trackIds(state.queue)).toEqual(["a", "b", "x", "y", "c"]);
    expect(state.queueIndex).toBe(1);
  });

  it("Play Later puts them after the rest of the queue", () => {
    usePlayerStore.getState().enqueue(added, "later");

    expect(trackIds(usePlayerStore.getState().queue)).toEqual(["a", "b", "c", "x", "y"]);
  });

  // Queue rows are told apart by their id, and the same song can be queued again
  it("gives each queued song its own queue entry", () => {
    usePlayerStore.getState().enqueue([queueItemOf(b)], "next");

    const ids = usePlayerStore.getState().queue.map((item) => item.queueItemId);
    expect(new Set(ids).size).toBe(4);
  });

  // While a library page plays, a refresh rebuilds the queue from that page's mode
  it("keeps the songs when the library refreshes", async () => {
    usePlayerStore.getState().enqueue(added, "later");
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(fetchReturning(() => Response.json([a, b, c, x, y])));

    try {
      await usePlayerStore.getState().fetchTracks(false);
    } finally {
      fetchSpy.mockRestore();
    }

    expect(trackIds(usePlayerStore.getState().queue)).toEqual(["a", "b", "c", "x", "y"]);
  });

  // A refresh that reloads the slices too rebuilds each page's queue; what was queued isn't the page's to drop
  describe("through a full library refresh", () => {
    const chorus = { id: "seg_x_chorus", track_id: "x", name: "Chorus", start_time: 10, end_time: 20, created_at: 1 };
    const refresh = async () => {
      const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
        fetchReturning((url) => Response.json(url === "/api/segments" ? [chorus] : [a, b, c, x, y]))
      );
      try {
        await usePlayerStore.getState().fetchTracks(true);
      } finally {
        fetchSpy.mockRestore();
      }
    };

    it("keeps a slice queued while Tracks plays, and a song queued twice", async () => {
      usePlayerStore.getState().enqueue([createQueueItem(chorus, x)], "next");
      usePlayerStore.getState().enqueue([queueItemOf(a)], "later");
      const queuedAgain = usePlayerStore.getState().queue[4].segment;

      await refresh();

      const state = usePlayerStore.getState();
      expect(state.queue.map((item) => item.segment.id)).toEqual(["fallback_a", "fallback_b", "seg_x_chorus", "fallback_c", "fallback_a"]);
      expect(state.queueIndex).toBe(1);
      // Unchanged, so the same segment: the queue doesn't re-render for nothing
      expect(state.queue[4].segment === queuedAgain).toBe(true);
    });

    // Removing an entry removes that entry: the page's own copy of the song stays
    it("keeps the page's own entry of a song whose queued copy was removed", async () => {
      usePlayerStore.getState().enqueue([queueItemOf(c)], "next");
      usePlayerStore.getState().removeQueueItemAtIndex(2);

      await refresh();

      expect(usePlayerStore.getState().queue.map((item) => item.segment.id)).toEqual(["fallback_a", "fallback_b", "fallback_c"]);
    });

    it("stays on the copy of a repeated song that is playing", async () => {
      usePlayerStore.getState().enqueue([queueItemOf(b)], "later");
      const copy = usePlayerStore.getState().queue[3];
      usePlayerStore.setState({ queueIndex: 3 });

      await refresh();

      const state = usePlayerStore.getState();
      expect(state.queue[state.queueIndex]?.queueItemId).toBe(copy.queueItemId);
    });
  });

  // A refresh of the tracks alone that drops another song from the queue
  it("stays on the playing copy of a repeated song when another song leaves the library", async () => {
    usePlayerStore.getState().enqueue([queueItemOf(b)], "later");
    const copy = usePlayerStore.getState().queue[3];
    usePlayerStore.setState({ queueIndex: 3 });
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(fetchReturning(() => Response.json([a, b, x, y])));

    try {
      await usePlayerStore.getState().fetchTracks(false);
    } finally {
      fetchSpy.mockRestore();
    }

    const state = usePlayerStore.getState();
    expect(trackIds(state.queue)).toEqual(["a", "b", "b"]);
    expect(state.queue[state.queueIndex]?.queueItemId).toBe(copy.queueItemId);
  });

  // Shuffling moves songs around; the one playing must stay the copy that was playing
  it("keeps playing the same copy of a repeated song when shuffle turns on", () => {
    usePlayerStore.getState().enqueue([queueItemOf(b)], "later");
    const copy = usePlayerStore.getState().queue[3];
    usePlayerStore.setState({ queueIndex: 3, isShuffle: false, shuffleByMode: { mixed: false, slices_only: false, original_only: false } });

    usePlayerStore.getState().toggleShuffle();

    const state = usePlayerStore.getState();
    expect(state.queue[state.queueIndex]?.queueItemId).toBe(copy.queueItemId);
  });

  it("leaves an empty queue to the caller, which plays the songs instead", () => {
    usePlayerStore.setState({ queue: [], queueIndex: -1, activeTrack: null, activeSegment: null });

    expect(usePlayerStore.getState().enqueue(added, "next")).toBe(false);
    expect(usePlayerStore.getState().queue).toEqual([]);
  });

  describe("a playlist", () => {
    const playlistItems: PlaylistItemWithDetails[] = [x, y].map((t, i) => ({
      id: `item_${t.id}`,
      playlist_id: "pl_2",
      track_id: t.id,
      segment_id: null,
      sort_order: i,
      added_at: i,
      track: t,
    }));
    let fetchSpy: ReturnType<typeof spyOn>;

    beforeEach(() => {
      // Listed oldest first, so the songs keep the order they were added in
      usePlayerStore.setState({ playlistSortMode: "oldest" });
      fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
        fetchReturning((url) => (url === "/api/playlists/pl_2" ? Response.json({ items: playlistItems }) : new Response(null, { status: 404 })))
      );
    });

    afterEach(() => {
      fetchSpy.mockRestore();
    });

    it("plays next after the current song", async () => {
      await usePlayerStore.getState().queuePlaylist("pl_2", "next");

      expect(trackIds(usePlayerStore.getState().queue)).toEqual(["a", "b", "x", "y", "c"]);
      expect(usePlayerStore.getState().activePlaylistPlayingId === null).toBe(true);
    });

    // The menus fire and forget, so a failed load must not escape as an unhandled rejection
    it("leaves the queue as it was when the playlist can't be loaded", async () => {
      fetchSpy.mockImplementation(async () => {
        throw new TypeError("Failed to fetch");
      });
      const logged = spyOn(console, "error").mockImplementation(() => {});

      try {
        await usePlayerStore.getState().queuePlaylist("pl_2", "next");
      } finally {
        logged.mockRestore();
      }

      expect(trackIds(usePlayerStore.getState().queue)).toEqual(["a", "b", "c"]);
    });

    it("plays from the start when nothing is queued", async () => {
      usePlayerStore.setState({ queue: [], queueIndex: -1, activeTrack: null, activeSegment: null });

      await usePlayerStore.getState().queuePlaylist("pl_2", "later");

      const state = usePlayerStore.getState();
      expect(trackIds(state.queue)).toEqual(["x", "y"]);
      expect(state.activePlaylistPlayingId).toBe("pl_2");
      expect(state.activeTrack?.id).toBe("x");
    });
  });
});
