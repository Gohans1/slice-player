import { describe, it, expect } from "bun:test";
import {
  type PlaylistSortMode,
  getSortedPlaylistItems,
  getShuffledItemIds,
} from "./playlistSort";
import type { PlaylistItemWithDetails } from "@/server/types";

describe("playlistSort helpers", () => {
  const dummyTrack = {
    id: "trk_1",
    title: "Track 1",
    duration: 180,
    source_type: "local" as const,
    source_uri: "local://trk_1",
    status: "ready" as const,
  };

  const item1: PlaylistItemWithDetails = {
    id: "pli_1",
    playlist_id: "pl_1",
    track_id: "trk_1",
    segment_id: null,
    sort_order: 0,
    added_at: 1000,
    track: dummyTrack,
    segment: null,
  };

  const item2: PlaylistItemWithDetails = {
    id: "pli_2",
    playlist_id: "pl_1",
    track_id: "trk_1",
    segment_id: null,
    sort_order: 1,
    added_at: 2000,
    track: dummyTrack,
    segment: null,
  };

  const item3: PlaylistItemWithDetails = {
    id: "pli_3",
    playlist_id: "pl_1",
    track_id: "trk_1",
    segment_id: null,
    sort_order: 2,
    added_at: 3000,
    track: dummyTrack,
    segment: null,
  };

  const items = [item1, item2, item3];

  describe("getSortedPlaylistItems", () => {
    it("returns empty array when given empty or null", () => {
      expect(getSortedPlaylistItems([], "manual")).toEqual([]);
      expect(getSortedPlaylistItems(null as any, "newest")).toEqual([]);
    });

    it("returns single item without modifying", () => {
      expect(getSortedPlaylistItems([item1], "random")).toEqual([item1]);
    });

    it("sorts by newest first (added_at DESC) when mode is newest", () => {
      const sorted = getSortedPlaylistItems(items, "newest");
      expect(sorted.map((it) => it.id)).toEqual(["pli_3", "pli_2", "pli_1"]);
    });

    it("sorts by oldest first (added_at ASC) when mode is oldest", () => {
      const sorted = getSortedPlaylistItems(items, "oldest");
      expect(sorted.map((it) => it.id)).toEqual(["pli_1", "pli_2", "pli_3"]);
    });

    it("in manual mode, sorts newest first when playlist is not custom ordered (isCustomOrdered = false)", () => {
      const sorted = getSortedPlaylistItems(items, "manual", undefined, false);
      expect(sorted.map((it) => it.id)).toEqual(["pli_3", "pli_2", "pli_1"]);
    });

    it("in manual mode, preserves manual sort_order when playlist is custom ordered (isCustomOrdered = true)", () => {
      // Create items where manual sort_order differs from added_at
      const customItems: PlaylistItemWithDetails[] = [
        { ...item2, sort_order: 0 },
        { ...item3, sort_order: 1 },
        { ...item1, sort_order: 2 },
      ];
      const sorted = getSortedPlaylistItems(customItems, "manual", undefined, true);
      expect(sorted.map((it) => it.id)).toEqual(["pli_2", "pli_3", "pli_1"]);
    });

    it("in random mode, respects given randomOrderMap", () => {
      const randomOrder = ["pli_2", "pli_1", "pli_3"];
      const sorted = getSortedPlaylistItems(items, "random", randomOrder);
      expect(sorted.map((it) => it.id)).toEqual(["pli_2", "pli_1", "pli_3"]);
    });

    it("in random mode, places items not in randomOrderMap at the end safely", () => {
      const randomOrder = ["pli_3"];
      const sorted = getSortedPlaylistItems(items, "random", randomOrder);
      expect(sorted[0].id).toBe("pli_3");
      expect(sorted.length).toBe(3);
    });
  });

  describe("getShuffledItemIds", () => {
    it("returns a permutation of all item ids", () => {
      const shuffled = getShuffledItemIds(items);
      expect(shuffled.length).toBe(3);
      expect(new Set(shuffled)).toEqual(new Set(["pli_1", "pli_2", "pli_3"]));
    });
  });
});
