import { afterAll, afterEach, beforeEach, expect, it, spyOn } from "bun:test";

class TestAudio extends EventTarget {
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
const contexts: TestContext[] = [];
let releaseContext: () => void;
let contextReady: Promise<void>;
class TestContext {
  state = "suspended";
  currentTime = 0;
  destination = {};
  constructor() { contexts.push(this); }
  resume() { return contextReady.then(() => { this.state = "running"; }); }
  createMediaElementSource() { return { connect() {} }; }
  createGain() {
    return { connect() {}, gain: { value: 1, cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime() {} } };
  }
}
const originalWorker = globalThis.Worker;
Object.assign(globalThis, { Worker: class { postMessage() {} terminate() {} } });
const originalAudio = globalThis.Audio;
const originalContext = window.AudioContext;
Object.assign(globalThis, { Audio: TestAudio });
Object.assign(window, { AudioContext: TestContext });
const { audioEngine } = await import("./audio");
const { usePlayerStore } = await import("../store/usePlayerStore");
audioEngine.init();

beforeEach(() => {
  contexts[0].state = "suspended";
  contextReady = new Promise<void>((resolve) => { releaseContext = resolve; });
  audioEngine.setSource("http://slice-player.test/fixture.opus");
});
afterEach(() => { releaseContext(); audioEngine.pause(); });
afterAll(() => {
  Object.assign(globalThis, { Audio: originalAudio, Worker: originalWorker });
  Object.assign(window, { AudioContext: originalContext });
});

it("does not start a segment after pause cancels its pending AudioContext resume", async () => {
  const playing = audioEngine.playSegment("http://slice-player.test/fixture.opus", 0, 60, () => {});
  audioEngine.pause();
  releaseContext();
  await playing;
  expect(audioEngine.isPaused()).toBe(true);
});

it("reports a cancelled resume without restarting audio or requesting fallback playback", async () => {
  const resuming = audioEngine.resume();
  audioEngine.pause();
  releaseContext();
  expect(await resuming).toBeNull();
  expect(audioEngine.isPaused()).toBe(true);
});

for (const outcome of [true, false]) {
  it(`keeps the store paused when an obsolete resume completes with ${outcome}`, async () => {
    const track = { id: "track", source_type: "local" as const, source_uri: "fixture.opus", title: "Track", duration: 60, status: "ready" as const };
    const segment = { id: "slice", track_id: track.id, name: "Slice", start_time: 0, end_time: 60 };
    usePlayerStore.setState({ activeTrack: track, activeSegment: segment, currentTime: 10, isPlaying: false, queue: [], queueIndex: -1 });
    let complete!: (value: boolean) => void;
    const resume = spyOn(audioEngine, "resume").mockImplementation(() => new Promise<boolean>((resolve) => { complete = resolve; }));
    const play = spyOn(audioEngine, "playSegment").mockResolvedValue(undefined);
    try {
      const pending = usePlayerStore.getState().resume();
      usePlayerStore.getState().pause();
      complete(outcome);
      await pending;
      expect(usePlayerStore.getState().isPlaying).toBe(false);
      expect(play).not.toHaveBeenCalled();
    } finally {
      resume.mockRestore();
      play.mockRestore();
    }
  });
}
