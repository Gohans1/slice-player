import { describe, it, expect } from "bun:test";
import { showsItemsOf, defaultMixName } from "./mixPlaylist";
import type { Playlist } from "@/server/types";

const pl = (id: string, extra: Partial<Playlist> = {}): Playlist => ({ id, name: id, created_at: 0, updated_at: 0, ...extra });

describe("showsItemsOf", () => {
  const playlists = [pl("a"), pl("b"), pl("c"), pl("mix", { is_mix: true, source_ids: ["a", "b"] })];

  it("is true for the playlist itself", () => {
    expect(showsItemsOf("a", "a", playlists)).toBe(true);
  });

  it("is true when the viewed mix uses the changed playlist as a source", () => {
    expect(showsItemsOf("mix", "b", playlists)).toBe(true);
  });

  it("is false when the viewed mix does not use the changed playlist", () => {
    expect(showsItemsOf("mix", "c", playlists)).toBe(false);
  });

  it("is false for an unrelated normal playlist", () => {
    expect(showsItemsOf("a", "b", playlists)).toBe(false);
  });

  it("is false when nothing is viewed", () => {
    expect(showsItemsOf(null, "a", playlists)).toBe(false);
  });
});

describe("defaultMixName", () => {
  it("joins two names with a plus", () => {
    expect(defaultMixName(["Chill", "Gym"])).toBe("Chill + Gym");
  });

  it("keeps the first two names and counts the rest", () => {
    expect(defaultMixName(["Chill", "Gym", "Focus", "Rain"])).toBe("Chill + Gym + 2");
  });

  it("stays within the 100 character playlist name limit", () => {
    expect(defaultMixName(["x".repeat(80), "y".repeat(80)]).length).toBeLessThanOrEqual(100);
  });
});
