import { afterAll, afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Segment, Track } from "@/server/types";

const audios: TestAudio[] = [];
class TestAudio extends EventTarget {
  constructor() { super(); audios.push(this); }
  src = "";
  paused = true;
  preload = "";
  crossOrigin = "";
  currentTime = 0;
  readyState = 4;
  seeking = false;
  volume = 1;
  play() { this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
  load() { this.dispatchEvent(new Event("canplay")); }
  removeAttribute(name: string) { if (name === "src") this.src = ""; }
}
class TestContext {
  state = "running";
  currentTime = 0;
  destination = {};
  resume() { return Promise.resolve(); }
  createMediaElementSource() { return { connect() {} }; }
  createGain() {
    const ramp = () => {};
    return { connect() {}, gain: { value: 1, cancelScheduledValues: ramp, setValueAtTime: ramp, linearRampToValueAtTime: ramp, setValueCurveAtTime: ramp } };
  }
}
const originalWorker = globalThis.Worker;
const originalAudio = globalThis.Audio;
const originalContext = window.AudioContext;
Object.assign(globalThis, { Worker: class { postMessage() {} terminate() {} }, Audio: TestAudio });
Object.assign(window, { AudioContext: TestContext });
const { audioEngine } = await import("../lib/audio");
const { usePlayerStore } = await import("./usePlayerStore");
audioEngine.init();

afterAll(() => {
  Object.assign(globalThis, { Audio: originalAudio, Worker: originalWorker });
  Object.assign(window, { AudioContext: originalContext });
});

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// The playing <audio> reaching a time, as playback does
function reach(time: number) {
  const playing = audios.find((audio) => !audio.paused)!;
  playing.currentTime = time;
  playing.dispatchEvent(new Event("timeupdate"));
}

afterEach(async () => {
  audioEngine.unload();
  await wait(20);
});

describe("crossfade in the queue", () => {
  const track = (id: string): Track => ({ id, source_type: "local", source_uri: id, title: id, duration: 10, status: "ready", volume: 0.5 });
  const songA = track("trk_cross_a");
  const songB = track("trk_cross_b");
  const full = (song: Track): Segment => ({ id: `fallback_${song.id}`, track_id: song.id, name: "Full Track", start_time: 0, end_time: 10 });
  const queue = [
    { queueItemId: "qa", segment: full(songA), track: songA },
    { queueItemId: "qb", segment: full(songB), track: songB },
  ];

  beforeEach(() => {
    usePlayerStore.setState({ queue, queueIndex: 0, isLoopQueue: false, isLoopTrack: false, activePlaylistPlayingId: null, isCrossfade: true });
    audioEngine.setCrossfade(5);
  });

  it("starts the queue's next song as the current one nears its end", async () => {
    await usePlayerStore.getState().playSegment(queue[0].segment, songA, 0);

    reach(9.9);
    await wait(20);

    expect(usePlayerStore.getState().queueIndex).toBe(1);
    expect(usePlayerStore.getState().activeTrack?.id).toBe(songB.id);
  });

  it("starts the next song when a song resumes inside its crossfade", async () => {
    await usePlayerStore.getState().playSegment(queue[0].segment, songA, 0);
    const playing = audios.find((audio) => !audio.paused)!;
    usePlayerStore.getState().pause();
    await wait(20);
    usePlayerStore.getState().seek(8);
    // Chrome reports the time as playback starts, before the store hears that the resume went through
    const play = playing.play.bind(playing);
    playing.play = () => {
      const started = play();
      playing.dispatchEvent(new Event("timeupdate"));
      return started;
    };

    await usePlayerStore.getState().resume();
    await wait(20);

    expect(usePlayerStore.getState().activeTrack?.id).toBe(songB.id);
  });

  it("plays the last song of a queue that doesn't loop to its end", async () => {
    await usePlayerStore.getState().playSegment(queue[1].segment, songB, 1);

    reach(9.9);
    await wait(20);

    expect(usePlayerStore.getState().isPlaying).toBe(true);
    expect(usePlayerStore.getState().activeTrack?.id).toBe(songB.id);
  });

  it("changes songs at the end when crossfade is turned off", async () => {
    usePlayerStore.getState().toggleCrossfade();
    await usePlayerStore.getState().playSegment(queue[0].segment, songA, 0);

    reach(9.9);
    await wait(20);

    expect(usePlayerStore.getState().isCrossfade).toBe(false);
    expect(usePlayerStore.getState().queueIndex).toBe(0);
  });
});
