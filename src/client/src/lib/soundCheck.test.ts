import { describe, it, expect } from "bun:test";
import { soundCheckGain } from "./soundCheck";

const dB = (gain: number) => 20 * Math.log10(gain);

describe("Sound Check", () => {
  it("turns a loud song down to -14 LUFS", () => {
    expect(dB(soundCheckGain({ loudness: -9, true_peak: 0.4 }))).toBeCloseTo(-5, 5);
  });

  it("turns a song down all the way, whatever its peak", () => {
    expect(dB(soundCheckGain({ loudness: -13, true_peak: 1.5 }))).toBeCloseTo(-1, 5);
  });

  it("raises a quiet song with headroom all the way", () => {
    expect(dB(soundCheckGain({ loudness: -17, true_peak: -10 }))).toBeCloseTo(3, 5);
  });

  // Spotify's example: a -20 LUFS song peaking at -5 dB is raised to -16 LUFS, not -14
  it("raises a quiet song only as far as leaves its peak 1 dB below full scale", () => {
    expect(dB(soundCheckGain({ loudness: -20, true_peak: -5 }))).toBeCloseTo(4, 5);
  });

  it("leaves a quiet song that already peaks near full scale as it is", () => {
    expect(soundCheckGain({ loudness: -16, true_peak: -0.5 })).toBe(1);
  });

  it("leaves a song not measured yet as it is", () => {
    expect(soundCheckGain({ loudness: null, true_peak: null })).toBe(1);
    expect(soundCheckGain({})).toBe(1);
  });
});
