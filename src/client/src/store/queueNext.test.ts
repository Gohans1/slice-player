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
