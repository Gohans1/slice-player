import { describe, expect, it } from "bun:test";
import { createListenCounter, playThreshold } from "./plays";

// Plays the song from `from` to `to` the way playback reports it, every 100ms
function listen(tick: (time: number) => boolean, from: number, to: number): number {
  let counted = 0;
  for (let time = from; time <= to + 1e-9; time += 0.1) {
    if (tick(time)) counted++;
  }
  return counted;
}

describe("playThreshold", () => {
  it("never counts a song of 30 seconds or less", () => {
    expect(playThreshold(30)).toBeNull();
    expect(playThreshold(12)).toBeNull();
  });

  it("asks for half the song, or 4 minutes of a long one", () => {
    expect(playThreshold(100)).toBe(50);
    expect(playThreshold(600)).toBe(240);
  });
});

describe("createListenCounter", () => {
  it("counts a play once, when half the song has been heard", () => {
    const tick = createListenCounter(100, 0);

    expect(listen(tick, 0, 49.5)).toBe(0);
    expect(listen(tick, 49.6, 100)).toBe(1);
  });

  it("doesn't count time skipped by seeking", () => {
    const tick = createListenCounter(100, 0);
    listen(tick, 0, 10);

    expect(listen(tick, 80, 100)).toBe(0);
    expect(listen(tick, 20, 41)).toBe(1);
  });
});
