import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

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
// Each gain node keeps the value last set on it, which is what it outputs once its ramps are done
const gains: { value: number }[] = [];
class TestContext {
  state = "running";
  currentTime = 0;
  destination = {};
  resume() { return Promise.resolve(); }
  createMediaElementSource() { return { connect() {} }; }
  createGain() {
    const gain = {
      value: 1,
      cancelScheduledValues() {},
      setValueAtTime(value: number) { gain.value = value; },
      linearRampToValueAtTime(value: number) { gain.value = value; },
      setValueCurveAtTime(values: Float32Array) { gain.value = values[values.length - 1]; },
    };
    gains.push(gain);
    return { connect() {}, gain };
  }
}
const originalWorker = globalThis.Worker;
const originalAudio = globalThis.Audio;
const originalContext = window.AudioContext;
Object.assign(globalThis, { Worker: class { postMessage() {} terminate() {} }, Audio: TestAudio });
Object.assign(window, { AudioContext: TestContext });
const { audioEngine, outputGain } = await import("./audio");
audioEngine.init();

afterAll(() => {
  Object.assign(globalThis, { Audio: originalAudio, Worker: originalWorker });
  Object.assign(window, { AudioContext: originalContext });
});

const FIRST = "http://slice-player.test/first.opus";
const NEXT = "http://slice-player.test/next.opus";
const THIRD = "http://slice-player.test/third.opus";

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

describe("crossfade between songs", () => {
  beforeEach(() => {
    audioEngine.setCrossfade(5);
    audioEngine.setOnCrossfade(null);
  });

  it("starts the next song as the current one nears its end, and stops the first once it has faded out", async () => {
    const ended = mock(() => {});
    audioEngine.setOnCrossfade(() => void audioEngine.playSegment(NEXT, 0, 60, () => {}));
    await audioEngine.playSegment(FIRST, 0, 10, ended);
    const first = audios.find((audio) => !audio.paused)!;

    reach(9.9);
    await wait(20);

    const next = audios.find((audio) => audio !== first)!;
    expect(next.src).toBe(NEXT);
    expect(next.paused).toBe(false);
    expect(first.paused).toBe(false);
    await wait(150);
    expect(first.paused).toBe(true);
    expect(next.paused).toBe(false);
    expect(ended).not.toHaveBeenCalled();
  });

  it("plays the next song at its own volume while the first fades out at its own", async () => {
    audioEngine.setMasterVolume(1);
    audioEngine.setVolume(0.5);
    audioEngine.setOnCrossfade(() => {
      audioEngine.setVolume(0.9);
      void audioEngine.playSegment(NEXT, 0, 60, () => {});
    });
    await audioEngine.playSegment(FIRST, 0, 10, () => {});
    const firstLevel = gains.find((gain) => gain.value === outputGain(0.5, 1))!;

    reach(9.9);
    await wait(20);

    expect(firstLevel.value).toBe(outputGain(0.5, 1));
    expect(gains.some((gain) => gain !== firstLevel && gain.value === outputGain(0.9, 1))).toBe(true);
  });

  it("plays the last song to its end when nothing comes after it", async () => {
    const ended = mock(() => {});
    const crossfade = mock(() => {});
    audioEngine.setOnCrossfade(crossfade);
    await audioEngine.playSegment(FIRST, 0, 10, ended);

    reach(9.9);
    await wait(20);
    expect(crossfade).toHaveBeenCalledTimes(1);
    expect(ended).not.toHaveBeenCalled();

    reach(10);
    await wait(40);
    expect(ended).toHaveBeenCalledTimes(1);
  });

  it("changes songs at the end, as before, when crossfade is off", async () => {
    audioEngine.setCrossfade(0);
    const crossfade = mock(() => {});
    audioEngine.setOnCrossfade(crossfade);
    await audioEngine.playSegment(FIRST, 0, 10, () => {});

    reach(9.9);
    await wait(20);

    expect(crossfade).not.toHaveBeenCalled();
  });

  it("crosses for at most half of a short slice", async () => {
    const crossfade = mock(() => {});
    audioEngine.setOnCrossfade(crossfade);
    await audioEngine.playSegment(FIRST, 0, 4, () => {});

    reach(1.9);
    expect(crossfade).not.toHaveBeenCalled();
    reach(2.1);
    expect(crossfade).toHaveBeenCalledTimes(1);
  });

  it("stops both songs on a pause while crossing", async () => {
    audioEngine.setOnCrossfade(() => void audioEngine.playSegment(NEXT, 0, 60, () => {}));
    await audioEngine.playSegment(FIRST, 0, 10, () => {});

    reach(9);
    await wait(20);
    audioEngine.pause();
    await wait(40);

    expect(audios.every((audio) => audio.paused)).toBe(true);
  });

  it("cuts the fading song off when another song is picked while crossing", async () => {
    audioEngine.setOnCrossfade(() => void audioEngine.playSegment(NEXT, 0, 60, () => {}));
    await audioEngine.playSegment(FIRST, 0, 10, () => {});
    const first = audios.find((audio) => !audio.paused)!;

    reach(9);
    await wait(20);
    await audioEngine.playSegment(THIRD, 0, 60, () => {});
    await wait(40);

    expect(first.paused).toBe(true);
    expect(audios.filter((audio) => !audio.paused).map((audio) => audio.src)).toEqual([THIRD]);
  });
});
