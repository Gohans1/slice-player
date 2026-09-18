import { describe, it, expect } from "bun:test";
import { pickSmartRandomItem } from "./shufflePicker";

describe("pickSmartRandomItem anti-repeat shuffle algorithm", () => {
  it("should handle empty array gracefully", () => {
    const history = new Map<string, number>();
    const res = pickSmartRandomItem([], (x: string) => x, history, 1);
    expect(res).toBeNull();
  });

  it("should return the single item when array has length 1", () => {
    const history = new Map<string, number>();
    history.set("a", 1);
    const res = pickSmartRandomItem(["a"], (x) => x, history, 2);
    expect(res).toEqual({ item: "a", index: 0 });
  });

  it("should zero out the weight for the item just played to guarantee no immediate repetition", () => {
    const items = ["song_1", "song_2", "song_3", "song_4", "song_5"];
    const history = new Map<string, number>();

    // Mark song_1 as just played at turn 10
    history.set("song_1", 10);
    const currentTurn = 11; // Immediate next turn: elapsedTurns = 11 - 10 - 1 = 0 -> weight 0

    // Run 500 picks and count frequency
    let song1Count = 0;
    const iterations = 500;
    for (let i = 0; i < iterations; i++) {
      const res = pickSmartRandomItem(items, (x) => x, history, currentTurn);
      if (res?.item === "song_1") {
        song1Count++;
      }
    }

    // song_1 has weight 0, so it should never be picked when other items exist
    expect(song1Count).toBe(0);
  });

  it("should smoothly recover item weight as turns pass", () => {
    const items = ["song_1", "song_2"];
    const history = new Map<string, number>();

    // cooldownWindow for 2 items is max(2, min(30, floor(2 * 0.7))) = 2
    // Turn 10: played song_1
    history.set("song_1", 10);

    // At turn 13 (elapsedTurns = 13 - 10 - 1 = 2 >= cooldownWindow), song_1 weight recovers to 1.0
    let song1Count = 0;
    const iterations = 500;
    for (let i = 0; i < iterations; i++) {
      const res = pickSmartRandomItem(items, (x) => x, history, 13);
      if (res?.item === "song_1") {
        song1Count++;
      }
    }

    // Both songs have equal weight 1.0, so song_1 should be chosen roughly 50% (+/- 15%)
    expect(song1Count).toBeGreaterThan(150);
    expect(song1Count).toBeLessThan(350);
  });

  it("should never select an item with weight 0 at index 0 even if Math.random returns 0", () => {
    const items = ["recent_song", "candidate_song"];
    const history = new Map<string, number>();
    history.set("recent_song", 5);

    const origRandom = Math.random;
    try {
      Math.random = () => 0; // Extreme boundary
      const res = pickSmartRandomItem(items, (x) => x, history, 6); // elapsedTurns = 0 -> weight = 0
      expect(res?.item).toBe("candidate_song");
      expect(res?.index).toBe(1);
    } finally {
      Math.random = origRandom;
    }
  });
});
