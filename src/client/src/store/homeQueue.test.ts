import { afterEach, beforeEach, expect, it, spyOn } from "bun:test";
import { createQueueItem, resetEtagCache, usePlayerStore } from "./usePlayerStore";
import { audioEngine } from "../lib/audio";
import { createDefaultFullSegment } from "../lib/utils";
import type { PlaySource, Track } from "@/server/types";

const track = (id: string, status: Track["status"] = "ready"): Track => ({ id, title: id, duration: 100, source_type: "youtube", source_uri: id, status });
const itemOf = (t: Track) => createQueueItem(createDefaultFullSegment(t), t, t.id);
const [heavy, later, queued] = ["heavy", "later", "queued"].map((id) => track(id));
const downloading = track("download", "downloading");
const fromRoad: PlaySource = { source_type: "playlist", playlist_id: "road", via_home: false };

let playAudio: ReturnType<typeof spyOn>;

beforeEach(() => {
  resetEtagCache();
  playAudio = spyOn(audioEngine, "playSegment").mockResolvedValue(undefined);
  const queue = [heavy, later].map(itemOf);
  // Playing Heavy Rotation from Home while a song downloads
  usePlayerStore.setState({
    tracks: [heavy, later, queued, downloading],
    queue,
    queueIndex: 0,
    activeTrack: heavy,
    activeSegment: queue[0].segment,
    playbackMode: "original_only",
    activePlaylistPlayingId: null,
    queueOrigin: { type: "home", shelf: "heavy_rotation", mode: "original_only", fromHome: true },
    queuesByMode: { mixed: [], slices_only: [], original_only: queue },
  });
});

afterEach(() => {
  playAudio.mockRestore();
});

// The library refreshes once the download is ready
async function finishDownload() {
  const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (input: RequestInfo | URL) =>
        Response.json((input instanceof Request ? input.url : input.toString()) === "/api/segments" ? [] : [heavy, later, queued, { ...downloading, status: "ready" }]),
      { preconnect: () => {} }
    )
  );
  try {
    await usePlayerStore.getState().fetchTracks(false);
  } finally {
    fetchSpy.mockRestore();
  }
}

// A Home shelf plays its own list; a library page's queue is what takes in songs as they become ready
it("keeps a Home shelf's queue to its songs, and what was queued onto it, when a download finishes", async () => {
  usePlayerStore.getState().enqueue([itemOf(queued)], "later", fromRoad);
  await finishDownload();

  expect(usePlayerStore.getState().queue.map((item) => item.track.id)).toEqual(["heavy", "later", "queued"]);
});

it("still adds the download to the queues kept for the library pages", async () => {
  const mixPage = [heavy, later].map(itemOf);
  usePlayerStore.setState((state) => ({ queuesByMode: { ...state.queuesByMode, mixed: mixPage } }));
  await finishDownload();

  expect(usePlayerStore.getState().queuesByMode.mixed.map((item) => item.track.id)).toEqual(["heavy", "later", "download"]);
});
