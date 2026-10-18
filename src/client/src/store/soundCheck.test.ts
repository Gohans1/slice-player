import { describe, it, expect, afterEach, spyOn, mock } from "bun:test";
import type { Segment, Track } from "@/server/types";

// Without an AudioContext (headless), the engine writes the gain it outputs to the <audio> element's volume
class FakeAudio {
  static last: FakeAudio | null = null;
  crossOrigin = "";
  preload = "";
  currentTime = 0;
  src = "";
  volume = 1;
  constructor() {
    FakeAudio.last = this;
  }
  addEventListener() {}
  removeEventListener() {}
  pause() {}
  play() {
    return Promise.resolve();
  }
  load() {}
  removeAttribute() {}
}
Object.assign(globalThis, { Audio: FakeAudio });

const { usePlayerStore } = await import("./usePlayerStore");
const { audioEngine, outputGain } = await import("../lib/audio");

const outputVolume = () => FakeAudio.last!.volume;

function song(id: string, measured: Pick<Track, "loudness" | "true_peak">): Track {
  return { id, source_type: "youtube", source_uri: id, title: id, duration: 200, status: "ready", volume: 0.5, ...measured };
}
const fullSong = (track: Track): Segment => ({ id: `fallback_${track.id}`, track_id: track.id, name: "Full Track", start_time: 0, end_time: 200 });

afterEach(() => {
  mock.restore();
});

describe("Sound Check in playback", () => {
  it("plays a loud song turned down to the loudness every song plays at", async () => {
    spyOn(audioEngine, "playSegment").mockResolvedValue();
    const loud = song("trk_loud", { loudness: -8, true_peak: 0.5 });

    await usePlayerStore.getState().playSegment(fullSong(loud), loud);

    // 6 dB down from -8 LUFS to -14 LUFS
    expect(outputVolume()).toBeCloseTo(outputGain(0.5, usePlayerStore.getState().masterVolume) * 10 ** (-6 / 20), 6);
  });

  it("plays the next song at its own level, and a song not measured yet as it is", async () => {
    spyOn(audioEngine, "playSegment").mockResolvedValue();
    const loud = song("trk_loud", { loudness: -8, true_peak: 0.5 });
    const unmeasured = song("trk_unmeasured", { loudness: null, true_peak: null });

    await usePlayerStore.getState().playSegment(fullSong(loud), loud);
    await usePlayerStore.getState().playSegment(fullSong(unmeasured), unmeasured);

    expect(outputVolume()).toBeCloseTo(outputGain(0.5, usePlayerStore.getState().masterVolume), 6);
  });

  it("takes in a song's measurement made while the app is open", async () => {
    const measuredLater = song("trk_measured_later", { loudness: null, true_peak: null });
    const serve = (track: Track) =>
      spyOn(globalThis, "fetch").mockImplementation(async (input) =>
        (input instanceof Request ? input.url : input.toString()) === "/api/tracks" ? Response.json([track]) : Response.json([])
      );
    serve(measuredLater);
    await usePlayerStore.getState().fetchTracks();
    mock.restore();

    serve({ ...measuredLater, loudness: -8, true_peak: 0.5 });
    // As a Sound Check measurement asks for: the songs again, not the whole library
    await usePlayerStore.getState().fetchTracks(false);

    expect(usePlayerStore.getState().tracks[0]).toMatchObject({ loudness: -8, true_peak: 0.5 });
  });
});
