import { describe, it, expect } from "bun:test";
import {
  type PlaylistSortMode,
  getSortedPlaylistItems,
  getShuffledItemIds,
  getSortedMixedItems,
  getSortedSliceItems,
  getSortedTracks,
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

    it("produces identical order between newest and uncustomized manual view even with timestamp collisions", () => {
      const collisionItems: PlaylistItemWithDetails[] = [
        { ...item1, id: "batch_1", added_at: 1000, sort_order: 0, track: { ...dummyTrack, created_at: 10 } },
        { ...item2, id: "batch_2", added_at: 1000, sort_order: 1, track: { ...dummyTrack, created_at: 10 } },
        { ...item3, id: "batch_3", added_at: 1000, sort_order: 2, track: { ...dummyTrack, created_at: 10 } },
      ];
      const newestOrder = getSortedPlaylistItems(collisionItems, "newest").map((it) => it.id);
      const manualOrder = getSortedPlaylistItems(collisionItems, "manual", undefined, false).map((it) => it.id);
      expect(manualOrder).toEqual(newestOrder);
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

  describe("getSortedMixedItems", () => {
    const mixedList: any[] = [
      { type: "track", id: "m_1", track: { id: "t1", title: "Track A" }, createdAt: 100 },
      { type: "slice", id: "m_2", track: { id: "t2", title: "Track B" }, segment: { name: "Slice Z" }, createdAt: 300 },
      { type: "track", id: "m_3", track: { id: "t3", title: "Track C" }, createdAt: 200 },
    ];

    it("sorts newest first by createdAt DESC", () => {
      const res = getSortedMixedItems(mixedList, "newest");
      expect(res.map((r) => r.id)).toEqual(["m_2", "m_3", "m_1"]);
    });

    it("sorts oldest first by createdAt ASC", () => {
      const res = getSortedMixedItems(mixedList, "oldest");
      expect(res.map((r) => r.id)).toEqual(["m_1", "m_3", "m_2"]);
    });

    it("sorts random according to randomOrderMap", () => {
      const res = getSortedMixedItems(mixedList, "random", ["m_3", "m_1", "m_2"]);
      expect(res.map((r) => r.id)).toEqual(["m_3", "m_1", "m_2"]);
    });
  });

  describe("getSortedSliceItems", () => {
    const sliceList: any[] = [
      { id: "sl_1", segment: { id: "s1", name: "Alpha", created_at: 50 }, track: { created_at: 50 } },
      { id: "sl_2", segment: { id: "s2", name: "Beta", created_at: 200 }, track: { created_at: 200 } },
      { id: "sl_3", segment: { id: "s3", name: "Gamma", created_at: 100 }, track: { created_at: 100 } },
    ];

    it("sorts newest first by segment created_at DESC", () => {
      const res = getSortedSliceItems(sliceList, "newest");
      expect(res.map((r) => r.id)).toEqual(["sl_2", "sl_3", "sl_1"]);
    });

    it("sorts oldest first by segment created_at ASC", () => {
      const res = getSortedSliceItems(sliceList, "oldest");
      expect(res.map((r) => r.id)).toEqual(["sl_1", "sl_3", "sl_2"]);
    });

    it("sorts random according to randomOrderMap", () => {
      const res = getSortedSliceItems(sliceList, "random", ["sl_3", "sl_1", "sl_2"]);
      expect(res.map((r) => r.id)).toEqual(["sl_3", "sl_1", "sl_2"]);
    });
  });

  describe("getSortedTracks", () => {
    const trackList: any[] = [
      { id: "tr_1", title: "A", created_at: 10 },
      { id: "tr_2", title: "B", created_at: 30 },
      { id: "tr_3", title: "C", created_at: 20 },
    ];

    it("sorts newest first by track created_at DESC", () => {
      const res = getSortedTracks(trackList, "newest");
      expect(res.map((r) => r.id)).toEqual(["tr_2", "tr_3", "tr_1"]);
    });

    it("sorts oldest first by track created_at ASC", () => {
      const res = getSortedTracks(trackList, "oldest");
      expect(res.map((r) => r.id)).toEqual(["tr_1", "tr_3", "tr_2"]);
    });

    it("sorts random according to randomOrderMap", () => {
      const res = getSortedTracks(trackList, "random", ["tr_3", "tr_2", "tr_1"]);
      expect(res.map((r) => r.id)).toEqual(["tr_3", "tr_2", "tr_1"]);
    });
  });
});
