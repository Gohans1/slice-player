import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { createQueueItem, usePlayerStore } from "./usePlayerStore";
import { audioEngine } from "../lib/audio";
import { createDefaultFullSegment } from "../lib/utils";
import type { PlayRecord, Segment, Track } from "@/server/types";

const track = (id: string): Track => ({ id, title: id, duration: 100, source_type: "youtube", source_uri: id, status: "ready" });
const [a, b] = ["a", "b"].map(track);
const itemOf = (t: Track) => createQueueItem(createDefaultFullSegment(t), t, t.id);
const chorus: Segment = { id: "s1", track_id: "a", name: "Chorus", start_time: 20, end_time: 80 };

// Plays on from `from` to `to` seconds, reported every 100ms as playback does
function listen(onTimeUpdate: (time: number) => void, from: number, to: number) {
  for (let time = from; time <= to + 1e-9; time += 0.1) onTimeUpdate(time);
}

describe("Counting plays", () => {
  let playAudio: ReturnType<typeof spyOn<typeof audioEngine, "playSegment">>;
  let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;

  beforeEach(() => {
    playAudio = spyOn(audioEngine, "playSegment").mockResolvedValue(undefined);
    fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(async () => new Response(null, { status: 204 }), { preconnect: () => {} })
    );
    // The Tracks page's queue
    usePlayerStore.setState({
      tracks: [a, b],
      queue: [a, b].map(itemOf),
      queueIndex: 0,
      playbackMode: "original_only",
      activePlaylistPlayingId: null,
      queueOrigin: { type: "system", mode: "original_only" },
    });
  });

  afterEach(() => {
    playAudio.mockRestore();
    fetchSpy.mockRestore();
  });

  // Starts the queue's entry at `index`; returns where playback reports its position
  async function start(index: number, seekTime?: number) {
    const item = usePlayerStore.getState().queue[index];
    await usePlayerStore.getState().playSegment(item.segment, item.track, index, seekTime);
    return playAudio.mock.calls.at(-1)![4]!;
  }
  const recordedPlays = (): PlayRecord[] =>
    fetchSpy.mock.calls.filter(([url]) => String(url) === "/api/plays").map(([, init]) => JSON.parse(String(init?.body)));

  it("records a play once half the song has been heard, credited to the page playing", async () => {
    const onTimeUpdate = await start(0);
    listen(onTimeUpdate, 0, 49);
    expect(recordedPlays()).toEqual([]);

    listen(onTimeUpdate, 49.1, 100);
    expect(recordedPlays()).toEqual([
      { track_id: "a", segment_id: null, source_type: "original_only", playlist_id: null, via_home: false },
    ]);
  });

  it("records a slice's play as that slice of its song, once half the slice has been heard", async () => {
    usePlayerStore.setState({ queue: [createQueueItem(chorus, a, "chorus")], playbackMode: "slices_only" });
    listen(await start(0), 20, 50.1);

    expect(recordedPlays()).toEqual([{ track_id: "a", segment_id: "s1", source_type: "slices_only", playlist_id: null, via_home: false }]);
  });

  it("credits the playlist playing, and marks a play started from Home", async () => {
    usePlayerStore.setState({ activePlaylistPlayingId: "p1", queueOrigin: { type: "playlist", playlistId: "p1", fromHome: true } });
    listen(await start(0), 0, 60);

    expect(recordedPlays()).toEqual([{ track_id: "a", segment_id: null, source_type: "playlist", playlist_id: "p1", via_home: true }]);
  });

  it("credits a song list on Home to Home", async () => {
    usePlayerStore.setState({ queueOrigin: { type: "home", shelf: "heavy_rotation", mode: "original_only", fromHome: true } });
    listen(await start(0), 0, 60);

    expect(recordedPlays()).toEqual([{ track_id: "a", segment_id: null, source_type: "home", playlist_id: null, via_home: true }]);
  });

  it("credits a song added with Play Next to where it was added from", async () => {
    await start(0);
    usePlayerStore.getState().enqueue([itemOf(b)], "next", { source_type: "playlist", playlist_id: "p2", via_home: false });
    listen(await start(1), 0, 60);

    expect(recordedPlays()).toEqual([{ track_id: "b", segment_id: null, source_type: "playlist", playlist_id: "p2", via_home: false }]);
  });

  it("carries on the same play when playback restarts where it paused", async () => {
    listen(await start(0), 0, 30);
    listen(await start(0, 30), 30, 50.1);

    expect(recordedPlays()).toHaveLength(1);
  });
});
