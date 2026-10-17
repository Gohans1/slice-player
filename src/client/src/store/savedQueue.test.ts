import { describe, it, expect, afterEach, spyOn } from "bun:test";
import type { Segment, Track } from "@/server/types";
import { createDefaultFullSegment } from "../lib/utils";
import { loadSavedQueue, saveQueue } from "../lib/savedQueue";

const { usePlayerStore } = await import("./usePlayerStore");
const { audioEngine } = await import("../lib/audio");

function track(id: string): Track {
  return { id, source_type: "local", source_uri: `local://${id}.flac`, title: id, duration: 200, status: "ready", volume: 0.5 };
}

const songA = track("trk_saved_a");
const songB = { ...track("trk_saved_b"), volume: 0.8 };
const chorusB: Segment = { id: "seg_saved_b", track_id: songB.id, name: "Chorus", start_time: 60, end_time: 90 };

const origFetch = globalThis.fetch;
function serveLibrary(tracks: Track[], segments: Segment[]) {
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url === "/api/tracks") return Response.json(tracks);
      if (url === "/api/segments") return Response.json(segments);
      return new Response("Not found", { status: 404 });
    },
    { preconnect: origFetch.preconnect }
  );
}

afterEach(() => {
  globalThis.fetch = origFetch;
});

// One file, one app session: the first load is startup, which is when the saved queue comes back
describe("the queue across app restarts", () => {
  it("comes back on startup, paused at the song and time it was left at, and plays on from there", async () => {
    saveQueue({
      playbackMode: "mixed",
      queueOrigin: { type: "system", mode: "mixed" },
      activePlaylistPlayingId: null,
      isShuffle: false,
      isLoopQueue: false,
      isLoopTrack: false,
      queue: [
        { queueItemId: "q1", segment: createDefaultFullSegment(songA), track: songA },
        { queueItemId: "q2", segment: chorusB, track: songB },
      ],
      activePlaylistOriginalQueue: [],
      queueIndex: 1,
      currentTime: 72.5,
    });
    serveLibrary([songA, songB], [chorusB]);

    await usePlayerStore.getState().fetchTracks();

    const s = usePlayerStore.getState();
    expect(s.queue.map((item) => item.queueItemId)).toEqual(["q1", "q2"]);
    expect(s.queuesByMode.mixed).toBe(s.queue);
    expect(s.playbackMode).toBe("mixed");
    expect(s.activeSegment).toEqual(chorusB);
    expect(s.currentTime).toBe(72.5);
    expect(s.isPlaying).toBe(false);
    expect(s.volume).toBe(0.8);

    // Nothing is loaded yet, so there is nothing to resume: the song loads at the saved time
    spyOn(audioEngine, "resume").mockResolvedValue(false);
    const playSegment = spyOn(audioEngine, "playSegment").mockResolvedValue();
    await usePlayerStore.getState().togglePlay();
    expect(playSegment.mock.calls[0]?.slice(1, 3)).toEqual([72.5, chorusB.end_time]);
  });

  it("is saved for next time as it changes after startup", async () => {
    serveLibrary([songA, songB], [chorusB]);
    await usePlayerStore.getState().fetchTracks();

    usePlayerStore.setState({ isLoopQueue: true, queueIndex: 0, activeSegment: createDefaultFullSegment(songA), currentTime: 5 });

    const saved = loadSavedQueue([songA, songB], [chorusB]);

    expect(saved?.isLoopQueue).toBe(true);
    expect(saved?.activeTrack?.id).toBe(songA.id);
    expect(saved?.currentTime).toBe(5);
  });
});
