import type { PlaylistItemWithDetails, Track, Segment } from "@/server/types";
import type { MixedItem } from "../components/PlaylistTableView";

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

  // 2. Fallback match by segment ID or track ID
  return items.findIndex((item) => {
    if (item.segment_id) {
      const segId = item.segment?.id ?? item.segment_id;
      return Boolean(options.activeSegmentId && segId === options.activeSegmentId);
    }
    const trackId = item.track?.id ?? item.track_id;
    return Boolean(
      options.activeTrackId &&
      trackId === options.activeTrackId &&
      options.isFallbackSegment
    );
  });
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
  return items.findIndex((item) =>
    item.type === "slice"
      ? Boolean(options.activeSegmentId && item.segment.id === options.activeSegmentId)
      : Boolean(
          options.activeTrackId &&
          item.track.id === options.activeTrackId &&
          options.isFallbackSegment
        )
  );
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
  if (!tracks || tracks.length === 0 || !activeTrackId || !isFallbackSegment) return -1;
  return tracks.findIndex((track) => track.id === activeTrackId);
}
