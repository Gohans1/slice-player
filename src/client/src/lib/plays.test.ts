import { describe, expect, it } from "bun:test";
import { createListenCounter, playThreshold } from "./plays";

// A song playing from its start: playback reports where it is every 100ms, by the clock, and the counter is told each time
function playback(lengthSeconds: number) {
  let time = 0;
  let at = 0;
  let counted = 0;
  const counter = createListenCounter(lengthSeconds, time, at);
  const report = () => {
    if (counter.tick(time, at)) counted++;
  };
  return {
    play(seconds: number) {
      for (let step = 0; step < Math.round(seconds * 10); step++) {
        time += 0.1;
        at += 100;
        report();
      }
    },
    // Still reporting, but stuck where it is, waiting for the stream
    stall(seconds: number) {
      for (let step = 0; step < Math.round(seconds * 10); step++) {
        at += 100;
        report();
      }
    },
    // Reported from the new place on the next report
    seekTo(to: number) {
      time = to;
      at += 100;
      report();
    },
    seekBy(seconds: number) {
      this.seekTo(time + seconds);
    },
    // No reports while paused
    pause(seconds: number) {
      at += seconds * 1000;
    },
    // A seek while paused moves playback without a report
    moveTo(to: number) {
      time = to;
    },
    resume() {
      counter.resumeFrom(time, at);
    },
    get counted() {
      return counted;
    },
  };
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
    const song = playback(100);
    song.play(49.5);
    expect(song.counted).toBe(0);

    song.play(1);
    song.play(40);
    expect(song.counted).toBe(1);
  });

  it("doesn't count seeking as listening, however short the steps", () => {
    const song = playback(100);
    song.play(10);
    // Thirty presses of a 1.6s seek step, then a jump to near the end
    for (let press = 0; press < 30; press++) song.seekBy(1.6);
    song.seekTo(95);
    song.play(5);
    expect(song.counted).toBe(0);

    // What is heard after going back counts
    song.seekTo(0);
    song.play(35);
    expect(song.counted).toBe(1);
  });

  it("leaves out a pause, and a seek made during it", () => {
    const song = playback(100);
    song.play(10);
    song.pause(60);
    song.moveTo(70);
    song.resume();
    song.play(25);
    expect(song.counted).toBe(0);

    song.play(16);
    expect(song.counted).toBe(1);
  });

  it("leaves out the time playback stalled, waiting for the stream", () => {
    const song = playback(100);
    song.play(30);
    song.stall(30);
    song.play(19);
    expect(song.counted).toBe(0);

    song.play(2);
    expect(song.counted).toBe(1);
  });
});
