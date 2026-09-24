import { describe, it, expect } from "bun:test";
import {
  findActivePlaylistItemIndex,
  findActiveMixedItemIndex,
  findActiveSliceItemIndex,
  findActiveTrackIndex,
} from "./activeItemIndex";
import type { PlaylistItemWithDetails } from "@/server/types";
import type { MixedItem } from "../components/PlaylistTableView";

describe("activeItemIndex helpers", () => {
  describe("findActivePlaylistItemIndex", () => {
    const mockItems: PlaylistItemWithDetails[] = [
      {
        id: "pi_1",
        playlist_id: "pl_1",
        track_id: "t_1",
        segment_id: null,
        sort_order: 0,
        added_at: 100,
        track: { id: "t_1", title: "Song 1", artist: "Artist", duration: 180, status: "ready" } as any,
        segment: null,
      },
      {
        id: "pi_2",
        playlist_id: "pl_1",
        track_id: "t_1",
        segment_id: null,
        sort_order: 1,
        added_at: 101,
        track: { id: "t_1", title: "Song 1 (Duplicate)", artist: "Artist", duration: 180, status: "ready" } as any,
        segment: null,
      },
      {
        id: "pi_3",
        playlist_id: "pl_1",
        track_id: "t_2",
        segment_id: "seg_1",
        sort_order: 2,
        added_at: 102,
        track: { id: "t_2", title: "Song 2", artist: "Artist", duration: 200, status: "ready" } as any,
        segment: { id: "seg_1", track_id: "t_2", name: "Solo", start_time: 10, end_time: 30 } as any,
      },
    ];

    it("matches duplicate item accurately by currentQueueItemId first", () => {
      // Even though pi_1 and pi_2 share track t_1, currentQueueItemId is pi_2
      const idx = findActivePlaylistItemIndex(mockItems, {
        currentQueueItemId: "pi_2",
        activeTrackId: "t_1",
        activeSegmentId: "fallback_t_1",
        isFallbackSegment: true,
      });
      expect(idx).toBe(1);
    });

    it("falls back to track matching when currentQueueItemId is not matched", () => {
      const idx = findActivePlaylistItemIndex(mockItems, {
        currentQueueItemId: "pi_unknown",
        activeTrackId: "t_1",
        activeSegmentId: "fallback_t_1",
        isFallbackSegment: true,
      });
      expect(idx).toBe(0);
    });

    it("matches slice item by segment id", () => {
      const idx = findActivePlaylistItemIndex(mockItems, {
        currentQueueItemId: null,
        activeTrackId: "t_2",
        activeSegmentId: "seg_1",
        isFallbackSegment: false,
      });
      expect(idx).toBe(2);
    });

    it("returns -1 when no items match", () => {
      const idx = findActivePlaylistItemIndex(mockItems, {
        currentQueueItemId: null,
        activeTrackId: "t_999",
        activeSegmentId: "seg_999",
        isFallbackSegment: false,
      });
      expect(idx).toBe(-1);
    });
  });

  describe("findActiveMixedItemIndex", () => {
    const mockMixed: MixedItem[] = [
      {
        type: "track",
        id: "m_1",
        track: { id: "t_1", title: "Track 1" } as any,
        createdAt: 100,
      },
      {
        type: "slice",
        id: "m_2",
        track: { id: "t_1", title: "Track 1" } as any,
        segment: { id: "seg_1", track_id: "t_1", name: "Slice 1" } as any,
        createdAt: 101,
      },
    ];

    it("finds active slice item", () => {
      const idx = findActiveMixedItemIndex(mockMixed, {
        activeTrackId: "t_1",
        activeSegmentId: "seg_1",
        isFallbackSegment: false,
      });
      expect(idx).toBe(1);
    });

    it("finds active full track item only when isFallbackSegment is true", () => {
      const idx = findActiveMixedItemIndex(mockMixed, {
        activeTrackId: "t_1",
        activeSegmentId: "fallback_t_1",
        isFallbackSegment: true,
      });
      expect(idx).toBe(0);

      // If playing a slice of t_1, the track row shouldn't match
      const slicePlayingIdx = findActiveMixedItemIndex(mockMixed, {
        activeTrackId: "t_1",
        activeSegmentId: "seg_other",
        isFallbackSegment: false,
      });
      expect(slicePlayingIdx).toBe(-1);
    });
  });

  describe("findActiveSliceItemIndex", () => {
    const slices = [
      { id: "s1", segment: { id: "seg_1" } as any, track: {} as any },
      { id: "s2", segment: { id: "seg_2" } as any, track: {} as any },
    ];

    it("finds slice by segment id", () => {
      expect(findActiveSliceItemIndex(slices, "seg_2")).toBe(1);
      expect(findActiveSliceItemIndex(slices, "seg_none")).toBe(-1);
      expect(findActiveSliceItemIndex(slices, null)).toBe(-1);
    });
  });

  describe("findActiveTrackIndex", () => {
    const tracks = [
      { id: "t_1", title: "T1" } as any,
      { id: "t_2", title: "T2" } as any,
    ];

    it("finds track by id only when fallback", () => {
      expect(findActiveTrackIndex(tracks, "t_2", true)).toBe(1);
      expect(findActiveTrackIndex(tracks, "t_2", false)).toBe(-1);
      expect(findActiveTrackIndex(tracks, "t_99", true)).toBe(-1);
      expect(findActiveTrackIndex(tracks, null, true)).toBe(-1);
    });
  });
});
