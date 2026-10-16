import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { createQueueItem, dismissedTrackIdsByMode, usePlayerStore, type QueueItem } from "./usePlayerStore";
import { audioEngine } from "../lib/audio";
import { createDefaultFullSegment } from "../lib/utils";
import type { Segment, Track } from "@/server/types";

const track = (id: string): Track => ({ id, title: id, duration: 100, source_type: "youtube", source_uri: id, status: "ready" });
const slice = (id: string, trackId: string): Segment => ({ id, track_id: trackId, name: id, start_time: 10, end_time: 20 });

const tracks = ["trk_1", "trk_2", "trk_3", "trk_4", "trk_5"].map(track);
// A library page's songs, in the order the page shows them
const pageItems: QueueItem[] = tracks.map((t, i) => createQueueItem(slice(`seg_${i + 1}`, t.id), t, `seg_${i + 1}`));
const segmentIds = (items: QueueItem[]) => items.map((item) => item.segment.id);

describe("playModeQueue: Play and Shuffle on a library page", () => {
  let playAudio: ReturnType<typeof spyOn>;

  beforeEach(() => {
    playAudio = spyOn(audioEngine, "playSegment").mockResolvedValue(undefined);
    usePlayerStore.setState({
      tracks,
      queue: [],
      queueIndex: -1,
      activeSegment: null,
      activeTrack: null,
      playbackMode: "mixed",
      activePlaylistPlayingId: "pl_1",
      queueOrigin: { type: "playlist", playlistId: "pl_1" },
      isShuffle: true,
      shuffleByMode: { mixed: true, slices_only: true, original_only: true },
      queuesByMode: { mixed: [], slices_only: [], original_only: [] },
      initializedModes: { mixed: false, slices_only: false, original_only: false },
    });
  });

  afterEach(() => {
    playAudio.mockRestore();
  });

  it("plays the page from its first song, in the page's order", async () => {
    await usePlayerStore.getState().playModeQueue("slices_only", pageItems);

    const state = usePlayerStore.getState();
    expect(segmentIds(state.queue)).toEqual(segmentIds(pageItems));
    expect(state.queueIndex).toBe(0);
    expect(state.activeSegment?.id).toBe("seg_1");
    expect(state.isShuffle).toBe(false);
    expect(state.shuffleByMode.slices_only).toBe(false);
    expect(state.playbackMode).toBe("slices_only");
    expect(state.activePlaylistPlayingId === null).toBe(true);
    expect(state.queueOrigin).toEqual({ type: "system", mode: "slices_only" });
    expect(segmentIds(state.queuesByMode.slices_only)).toEqual(segmentIds(pageItems));
  });

  it("shuffles the page and starts from the first song of the shuffled order", async () => {
    usePlayerStore.setState({ isShuffle: false, shuffleByMode: { mixed: false, slices_only: false, original_only: false } });
    // A fixed random draw, so the shuffled order is known to differ from the page's
    const random = spyOn(Math, "random").mockReturnValue(0);

    try {
      await usePlayerStore.getState().playModeQueue("original_only", pageItems, { shuffle: true });
    } finally {
      random.mockRestore();
    }

    const state = usePlayerStore.getState();
    expect(segmentIds(state.queue)).not.toEqual(segmentIds(pageItems));
    expect([...segmentIds(state.queue)].sort()).toEqual(segmentIds(pageItems));
    expect(state.queueIndex).toBe(0);
    expect(state.activeSegment?.id).toBe(state.queue[0].segment.id);
    expect(state.isShuffle).toBe(true);
    expect(state.shuffleByMode.original_only).toBe(true);
  });

  // The player's Shuffle button reads the mode's own shuffle state, so the two must agree
  it("leaves shuffle on so that the player's Shuffle button turns it off", async () => {
    usePlayerStore.setState({ isShuffle: false, shuffleByMode: { mixed: false, slices_only: false, original_only: false } });
    await usePlayerStore.getState().playModeQueue("original_only", pageItems, { shuffle: true });

    usePlayerStore.getState().toggleShuffle();

    expect(usePlayerStore.getState().isShuffle).toBe(false);
  });

  it("keeps where the songs came from, such as a search", async () => {
    const origin = { type: "search" as const, query: "trk", count: pageItems.length, mode: "mixed" as const };

    await usePlayerStore.getState().playModeQueue("mixed", pageItems, { origin });

    expect(usePlayerStore.getState().queueOrigin).toEqual(origin);
  });

  // Songs taken out of the queue earlier stay out when the library refreshes, until the page is played again
  it("brings back songs that were taken out of the queue earlier", async () => {
    dismissedTrackIdsByMode.original_only.add("trk_2");

    await usePlayerStore.getState().playModeQueue("original_only", tracks.map((t) => createQueueItem(createDefaultFullSegment(t), t, t.id)));

    expect(dismissedTrackIdsByMode.original_only.has("trk_2")).toBe(false);
  });

  it("does nothing for a page with nothing to play", async () => {
    const before = usePlayerStore.getState();

    await usePlayerStore.getState().playModeQueue("slices_only", []);

    const after = usePlayerStore.getState();
    expect(after.queue === before.queue).toBe(true);
    expect(after.activePlaylistPlayingId).toBe("pl_1");
  });
});
