import type { PlaylistItemWithDetails, Track, Segment } from "@/server/types";
import type { MixedItem } from "./playlistSort";

export interface ActiveItemResolutionOptions {
  currentQueueItemId?: string | null;
  activeTrackId?: string | null;
  activeSegmentId?: string | null;
  isFallbackSegment?: boolean;
}

export function findActivePlaylistItemIndex(
  items: PlaylistItemWithDetails[],
  options: ActiveItemResolutionOptions
): number {
  if (!items || items.length === 0) return -1;

  // 1. Precise match by queue item ID (handles duplicate tracks/slices in playlist)
  if (options.currentQueueItemId) {
    const queueIdx = items.findIndex((it) => it.id === options.currentQueueItemId);
    if (queueIdx >= 0) return queueIdx;
  }

  // 2. Exact match by segment ID if playing a custom slice
  if (options.activeSegmentId && !options.activeSegmentId.startsWith("fallback_")) {
    const segIdx = items.findIndex((item) => {
      const segId = item.segment?.id ?? item.segment_id;
      return segId === options.activeSegmentId;
    });
    if (segIdx >= 0) return segIdx;
  }

  // 3. Match by track ID
  if (options.activeTrackId) {
    // Prefer matching full-track item when active is fallback full track
    if (options.isFallbackSegment) {
      const fullTrackIdx = items.findIndex((item) => {
        const trackId = item.track?.id ?? item.track_id;
        return trackId === options.activeTrackId && !item.segment_id;
      });
      if (fullTrackIdx >= 0) return fullTrackIdx;
    }

    // Otherwise match any item belonging to this track
    const anyTrackIdx = items.findIndex((item) => {
      const trackId = item.track?.id ?? item.track_id;
      return trackId === options.activeTrackId;
    });
    if (anyTrackIdx >= 0) return anyTrackIdx;
  }

  return -1;
}

export function findActiveMixedItemIndex(
  items: MixedItem[],
  options: {
    activeTrackId?: string | null;
    activeSegmentId?: string | null;
    isFallbackSegment?: boolean;
  }
): number {
  if (!items || items.length === 0) return -1;

  // 1. Exact slice match if playing a real segment
  if (options.activeSegmentId && !options.activeSegmentId.startsWith("fallback_")) {
    const sliceIdx = items.findIndex(
      (item) => item.type === "slice" && item.segment?.id === options.activeSegmentId
    );
    if (sliceIdx >= 0) return sliceIdx;
    // If playing a specific non-fallback slice, do not incorrectly match the full track row
    if (options.isFallbackSegment === false) return -1;
  }

  // 2. Track match
  if (options.activeTrackId) {
    if (options.isFallbackSegment !== false) {
      const trackIdx = items.findIndex(
        (item) => item.type === "track" && item.track.id === options.activeTrackId
      );
      if (trackIdx >= 0) return trackIdx;
    }

    // Fallback: any item belonging to this track
    const anyIdx = items.findIndex((item) => item.track.id === options.activeTrackId);
    if (anyIdx >= 0) return anyIdx;
  }

  return -1;
}

export function findActiveSliceItemIndex(
  items: { segment: Pick<Segment, "id"> }[],
  activeSegmentId?: string | null
): number {
  if (!items || items.length === 0 || !activeSegmentId) return -1;
  return items.findIndex((item) => item.segment.id === activeSegmentId);
}

export function findActiveTrackIndex(
  tracks: Pick<Track, "id">[],
  activeTrackId?: string | null,
  isFallbackSegment?: boolean
): number {
  if (!tracks || tracks.length === 0 || !activeTrackId) return -1;
  if (isFallbackSegment === false) return -1;
  return tracks.findIndex((track) => track.id === activeTrackId);
}
