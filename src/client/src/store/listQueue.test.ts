import { afterEach, beforeEach, expect, it, spyOn } from "bun:test";
import { createQueueItem, resetEtagCache, usePlayerStore, type QueueOrigin } from "./usePlayerStore";
import { audioEngine } from "../lib/audio";
import { createDefaultFullSegment } from "../lib/utils";
import type { Playlist, PlaySource, Segment, Track } from "@/server/types";

const track = (id: string, status: Track["status"] = "ready"): Track => ({ id, title: id, duration: 100, source_type: "youtube", source_uri: id, status });
const itemOf = (t: Track) => createQueueItem(createDefaultFullSegment(t), t, t.id);
const [heavy, later, queued] = ["heavy", "later", "queued"].map((id) => track(id));
const downloading = track("download", "downloading");
const fromRoad: PlaySource = { source_type: "playlist", playlist_id: "road", via_home: false };
const slice = (id: string, t: Track): Segment => ({ id, track_id: t.id, name: id, start_time: 10, end_time: 40 });
const [heavyChorus, laterIntro] = [slice("heavy-chorus", heavy), slice("later-intro", later)];

// Lists that play as they were when played: what the library gains belongs to the library pages
const lists: [string, QueueOrigin][] = [
  ["Home's Heavy Rotation", { type: "home", shelf: "heavy_rotation", mode: "original_only", fromHome: true }],
  ["a search on the Tracks page", { type: "search", query: "heavy later", count: 2, mode: "original_only" }],
];

let playAudio: ReturnType<typeof spyOn>;

beforeEach(() => {
  resetEtagCache();
  playAudio = spyOn(audioEngine, "playSegment").mockResolvedValue(undefined);
});

afterEach(() => {
  playAudio.mockRestore();
});

// Plays `queue` in its mode, started from `origin`, while a song downloads
function playing(queue: ReturnType<typeof itemOf>[], origin: QueueOrigin, mode: "original_only" | "slices_only" = "original_only") {
  usePlayerStore.setState({
    tracks: [heavy, later, queued, downloading],
    queue,
    queueIndex: 0,
    activeTrack: queue[0].track,
    activeSegment: queue[0].segment,
    playbackMode: mode,
    activePlaylistPlayingId: null,
    queueOrigin: origin,
    queuesByMode: { mixed: [], slices_only: [], original_only: [], [mode]: queue },
  });
}

// The library refreshes, with its slices, once the download is ready
async function refresh(segments: Segment[] = []) {
  const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (input: RequestInfo | URL) =>
        Response.json((input instanceof Request ? input.url : input.toString()) === "/api/segments" ? segments : [heavy, later, queued, { ...downloading, status: "ready" }]),
      { preconnect: () => {} }
    )
  );
  try {
    await usePlayerStore.getState().fetchTracks(true);
  } finally {
    fetchSpy.mockRestore();
  }
}

for (const [list, origin] of lists) {
  it(`keeps a queue played from ${list} to its songs, and what was queued onto it, when a download finishes`, async () => {
    playing([heavy, later].map(itemOf), origin);
    usePlayerStore.getState().enqueue([itemOf(queued)], "later", fromRoad);
    await refresh();

    expect(usePlayerStore.getState().queue.map((item) => item.track.id)).toEqual(["heavy", "later", "queued"]);
  });

  it(`still adds the download to the queues kept for the library pages, while ${list} plays`, async () => {
    playing([heavy, later].map(itemOf), origin);
    usePlayerStore.setState((state) => ({ queuesByMode: { ...state.queuesByMode, mixed: [heavy, later].map(itemOf) } }));
    await refresh();

    expect(usePlayerStore.getState().queuesByMode.mixed.map((item) => item.track.id)).toEqual(["heavy", "later", "download"]);
  });
}

// A playlist's queue is its own; the playing mode's queue is then the one kept for that library page
it("still adds the download to the library page's queue while a search in a playlist plays", async () => {
  const pageQueue = [heavy, later].map(itemOf);
  playing([itemOf(heavy)], { type: "search", query: "heavy", count: 1, playlistId: "road" });
  usePlayerStore.setState({ activePlaylistPlayingId: "road", queuesByMode: { mixed: [], slices_only: [], original_only: pageQueue } });
  await refresh();

  expect(usePlayerStore.getState().queuesByMode.original_only.map((item) => item.track.id)).toEqual(["heavy", "later", "download"]);
});

const road: Playlist & { item_count: number } = { id: "road", name: "Road", created_at: 1, updated_at: 1, item_count: 1 };
const addingLater = [
  ["a song is", () => usePlayerStore.getState().addToPlaylist("road", "later")],
  ["songs are", () => usePlayerStore.getState().addItemsToPlaylistBatch("road", ["later"])],
] as const;

for (const [what, add] of addingLater) {
  it(`keeps a search in a playlist to its matches when ${what} added to the playlist`, async () => {
    const queue = [createQueueItem(createDefaultFullSegment(heavy), heavy, "road-heavy")];
    playing(queue, { type: "search", query: "heavy", count: 1, playlistId: "road" });
    usePlayerStore.setState({ activePlaylistPlayingId: "road", activePlaylistOriginalQueue: queue, activePlaylistId: null, playlists: [road] });
    const added = { id: "road-later", playlist_id: "road", track_id: "later", segment_id: null, added_at: 2, track: later };
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        async (input: RequestInfo | URL) => {
          const url = input instanceof Request ? input.url : input.toString();
          if (url.endsWith("/items")) return Response.json(added);
          if (url.endsWith("/items/batch")) return Response.json({ items: [added] });
          return Response.json(url === "/api/playlists" ? [road] : []);
        },
        { preconnect: () => {} }
      )
    );
    try {
      expect(await add()).toBe(true);
    } finally {
      fetchSpy.mockRestore();
    }

    expect(usePlayerStore.getState().queue.map((item) => item.track.id)).toEqual(["heavy"]);
  });
}

// As after cutting a slice: no song became ready, the slices reload
it("keeps a search on the Slices page to its matches when the library's slices reload, even a new slice that matches", async () => {
  playing([createQueueItem(heavyChorus, heavy, "heavy-chorus")], { type: "search", query: "chorus", count: 1, mode: "slices_only" }, "slices_only");
  usePlayerStore.setState({ tracks: [heavy, later, queued, { ...downloading, status: "ready" }] });
  await refresh([heavyChorus, laterIntro, slice("later-chorus", later)]);

  expect(usePlayerStore.getState().queue.map((item) => item.segment.id)).toEqual(["heavy-chorus"]);
});
