import { describe, it, expect, beforeEach } from "bun:test";
import type { Segment, Track } from "@/server/types";
import type { QueueItem } from "../store/usePlayerStore";
import { createDefaultFullSegment } from "./utils";
import { loadSavedQueue, saveQueue } from "./savedQueue";

function track(id: string): Track {
  return { id, source_type: "local", source_uri: `local://${id}.flac`, title: id, duration: 200, status: "ready", volume: 0.5 };
}

const songA = track("trk_a");
const songB = track("trk_b");
const songC = track("trk_c");
const chorusB: Segment = { id: "seg_b_chorus", track_id: songB.id, name: "Chorus", start_time: 60, end_time: 90 };

function entry(id: string, segment: Segment, song: Track): QueueItem {
  return { queueItemId: id, segment, track: song };
}

const queue = [
  entry("q1", createDefaultFullSegment(songA), songA),
  entry("q2", chorusB, songB),
  entry("q3", createDefaultFullSegment(songC), songC),
];

function libraryQueueState(overrides: Partial<Parameters<typeof saveQueue>[0]> = {}): Parameters<typeof saveQueue>[0] {
  return {
    playbackMode: "mixed",
    queueOrigin: { type: "system", mode: "mixed" },
    activePlaylistPlayingId: null,
    isShuffle: false,
    isLoopQueue: false,
    isLoopTrack: false,
    queue,
    activePlaylistOriginalQueue: [],
    queueIndex: 1,
    currentTime: 72.5,
    ...overrides,
  };
}

describe("saved queue", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("brings back the queue at the song and the time it was left at", () => {
    saveQueue(libraryQueueState());

    const restored = loadSavedQueue([songA, songB, songC], [chorusB]);

    expect(restored?.queue.map((item) => item.queueItemId)).toEqual(["q1", "q2", "q3"]);
    expect(restored?.queueIndex).toBe(1);
    expect(restored?.activeSegment).toEqual(chorusB);
    expect(restored?.currentTime).toBe(72.5);
  });

  it("keeps where the queue plays from, and its shuffle and repeat", () => {
    saveQueue(libraryQueueState({ playbackMode: "slices_only", queueOrigin: { type: "search", query: "chorus" }, isShuffle: true, isLoopQueue: true }));

    const restored = loadSavedQueue([songA, songB, songC], [chorusB]);

    expect(restored?.playbackMode).toBe("slices_only");
    expect(restored?.queueOrigin).toEqual({ type: "search", query: "chorus" });
    expect(restored?.isShuffle).toBe(true);
    expect(restored?.isLoopQueue).toBe(true);
    expect(restored?.isLoopTrack).toBe(false);
  });

  it("brings back a playlist's queue with its order before shuffling", () => {
    const original = [queue[2], queue[0], queue[1]];
    saveQueue(libraryQueueState({ activePlaylistPlayingId: "pl_1", isShuffle: true, activePlaylistOriginalQueue: original }));

    const restored = loadSavedQueue([songA, songB, songC], [chorusB]);

    expect(restored?.activePlaylistPlayingId).toBe("pl_1");
    expect(restored?.activePlaylistOriginalQueue.map((item) => item.queueItemId)).toEqual(["q3", "q1", "q2"]);
  });

  it("keeps the songs queued with Play Next and where they came from", () => {
    const source = { source_type: "playlist" as const, playlist_id: "pl_2", via_home: false };
    saveQueue(libraryQueueState({ queue: [...queue, { ...entry("q4", chorusB, songB), userQueued: true, source }] }));

    const restored = loadSavedQueue([songA, songB, songC], [chorusB]);

    expect(restored?.queue[3]).toMatchObject({ queueItemId: "q4", userQueued: true, source });
  });

  it("leaves out songs deleted since, and starts the next one when the current song is gone", () => {
    saveQueue(libraryQueueState());

    const restored = loadSavedQueue([songA, songC], []);

    expect(restored?.queue.map((item) => item.queueItemId)).toEqual(["q1", "q3"]);
    expect(restored?.queueIndex).toBe(1);
    expect(restored?.activeTrack?.id).toBe(songC.id);
    expect(restored?.currentTime).toBe(0);
  });

  it("follows the current song when a song before it is gone", () => {
    saveQueue(libraryQueueState());

    const restored = loadSavedQueue([songB, songC], [chorusB]);

    expect(restored?.queueIndex).toBe(0);
    expect(restored?.activeSegment?.id).toBe(chorusB.id);
    expect(restored?.currentTime).toBe(72.5);
  });

  it("uses the slice as it is now, and starts it over when the time left falls outside it", () => {
    saveQueue(libraryQueueState());
    const trimmed = { ...chorusB, start_time: 80, end_time: 100 };

    const restored = loadSavedQueue([songA, songB, songC], [trimmed]);

    expect(restored?.activeSegment).toEqual(trimmed);
    expect(restored?.currentTime).toBe(80);
  });

  it("keeps nothing when no song of the queue is left", () => {
    saveQueue(libraryQueueState());

    expect(loadSavedQueue([], [])).toBeNull();
  });

  it("keeps nothing from a save it can't read", () => {
    window.localStorage.setItem("slice_player_queue", "{not json");

    expect(loadSavedQueue([songA], [])).toBeNull();
  });
});
