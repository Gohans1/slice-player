import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { createQueueItem, usePlayerStore } from "./usePlayerStore";
import { useHomeStore } from "./useHomeStore";
import { audioEngine } from "../lib/audio";
import { createDefaultFullSegment } from "../lib/utils";
import type { HomeSummary, PlayRecord, Segment, Track } from "@/server/types";

const track = (id: string): Track => ({ id, title: id, duration: 100, source_type: "youtube", source_uri: id, status: "ready" });
const [a, b] = ["a", "b"].map(track);
const itemOf = (t: Track) => createQueueItem(createDefaultFullSegment(t), t, t.id);
const chorus: Segment = { id: "s1", track_id: "a", name: "Chorus", start_time: 20, end_time: 80 };
const fresh: HomeSummary = { recently_played: [{ source_type: "original_only", playlist_id: null }], heavy_rotation: [{ track_id: "a", plays: 1 }], top_playlists: [] };
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const urlOf = (input: RequestInfo | URL) => (input instanceof Request ? input.url : input.toString());

// The clock playback is timed by, in ms
let clock = 0;

// Plays on from `from` to `to` seconds, reported every 100ms as playback does
function listen(onTimeUpdate: (time: number) => void, from: number, to: number) {
  for (let time = from; time <= to + 1e-9; time += 0.1) {
    clock += 100;
    onTimeUpdate(time);
  }
}

// As when the window is minimised or another tab is in front
function whileHidden(run: () => void) {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
  try {
    run();
  } finally {
    Reflect.deleteProperty(document, "visibilityState");
  }
}

describe("Counting plays", () => {
  let playAudio: ReturnType<typeof spyOn<typeof audioEngine, "playSegment">>;
  let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;
  let now: ReturnType<typeof spyOn<typeof performance, "now">>;

  beforeEach(() => {
    clock = 0;
    now = spyOn(performance, "now").mockImplementation(() => clock);
    playAudio = spyOn(audioEngine, "playSegment").mockResolvedValue(undefined);
    fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        async (input: RequestInfo | URL) =>
          urlOf(input) === "/api/home" ? Response.json(fresh) : new Response(null, { status: 204 }),
        { preconnect: () => {} }
      )
    );
    useHomeStore.setState({ summary: null, failed: false });
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
    now.mockRestore();
  });

  // Starts the queue's entry at `index`; returns where playback reports its position
  async function start(index: number, seekTime?: number) {
    const item = usePlayerStore.getState().queue[index];
    await usePlayerStore.getState().playSegment(item.segment, item.track, index, seekTime);
    return playAudio.mock.calls.at(-1)![4]!;
  }
  const recordedPlays = (): PlayRecord[] =>
    fetchSpy.mock.calls
      .filter(([input]) => urlOf(input) === "/api/plays")
      .flatMap(([, init]) => (typeof init?.body === "string" ? [JSON.parse(init.body)] : []));

  it("records a play once half the song has been heard, credited to the page playing", async () => {
    const onTimeUpdate = await start(0);
    listen(onTimeUpdate, 0, 49);
    expect(recordedPlays()).toEqual([]);

    listen(onTimeUpdate, 49.1, 100);
    expect(recordedPlays()).toEqual([
      { track_id: "a", segment_id: null, source_type: "original_only", playlist_id: null, via_home: false },
    ]);
  });

  it("counts a song heard while the window is hidden, without drawing where it is", async () => {
    const onTimeUpdate = await start(0);
    usePlayerStore.setState({ currentTime: 0 });
    whileHidden(() => listen(onTimeUpdate, 0, 60));

    expect(recordedPlays()).toHaveLength(1);
    expect(usePlayerStore.getState().currentTime).toBe(0);
  });

  for (const [resuming, resumes] of [["resuming", true], ["reloading the song to resume", false]] as const) {
    it(`doesn't count a seek made while paused, ${resuming}`, async () => {
      const resumeAudio = spyOn(audioEngine, "resume").mockResolvedValue(resumes);
      const position = spyOn(audioEngine, "getCurrentTime").mockReturnValue(70);
      try {
        listen(await start(0), 0, 10);
        usePlayerStore.getState().pause();
        clock += 60_000;
        usePlayerStore.getState().seek(70);
        await usePlayerStore.getState().resume();
        // Reported to whichever playback carries on
        listen(playAudio.mock.calls.at(-1)![4]!, 70.1, 99);

        expect(recordedPlays()).toEqual([]);
      } finally {
        resumeAudio.mockRestore();
        position.mockRestore();
      }
    });
  }

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

  // Home may be open while the song plays
  it("brings Home's shelves up to date once the play is recorded", async () => {
    listen(await start(0), 0, 60);
    await tick();

    expect(useHomeStore.getState().summary).toEqual(fresh);
  });

  it("leaves Home as it was when the play could not be recorded", async () => {
    fetchSpy.mockImplementation(
      Object.assign(
        async (input: RequestInfo | URL) =>
          urlOf(input) === "/api/home" ? Response.json(fresh) : new Response(null, { status: 500 }),
        { preconnect: () => {} }
      )
    );
    const logError = spyOn(console, "error").mockImplementation(() => {});
    try {
      listen(await start(0), 0, 60);
      await tick();

      expect(useHomeStore.getState().summary).toBeNull();
    } finally {
      logError.mockRestore();
    }
  });

  it("carries on the same play when playback restarts where it paused", async () => {
    listen(await start(0), 0, 30);
    listen(await start(0, 30), 30, 50.1);

    expect(recordedPlays()).toHaveLength(1);
  });
});
