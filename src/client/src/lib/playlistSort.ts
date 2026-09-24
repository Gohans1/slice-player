import type { PlaylistItemWithDetails, Track, Segment } from "@/server/types";

export type PlaylistSortMode = "manual" | "newest" | "oldest" | "random";

export type MixedItem =
  | {
      type: "track";
      id: string;
      track: Track;
      segment?: never;
      createdAt?: number;
    }
  | {
      type: "slice";
      id: string;
      track: Track;
      segment: Segment;
      createdAt?: number;
    };

export interface SliceItem {
  id: string;
  segment: Segment;
  track: Track;
}

/**
 * Shuffles an array of item IDs using Fisher-Yates algorithm.
 */
export function getShuffledEntityIds<T extends { id: string }>(items: T[]): string[] {
  if (!items || items.length === 0) return [];
  const ids = items.map((it) => it.id);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids;
}

/**
 * Backwards-compatible alias for getShuffledEntityIds.
 */
export function getShuffledItemIds(items: PlaylistItemWithDetails[]): string[] {
  return getShuffledEntityIds(items);
}

/**
 * Returns playlist items sorted according to the selected PlaylistSortMode.
 *
 * - "newest": Sorts by added_at DESC. If tied, falls back to track.created_at DESC, then sort_order DESC.
 * - "oldest": Sorts by added_at ASC. If tied, falls back to track.created_at ASC, then sort_order ASC.
 * - "manual":
 *     - If `isCustomOrdered` is false (or not set), initially sorts newest first.
 *     - If `isCustomOrdered` is true, respects manual sort_order ASC.
 * - "random":
 *     - If `randomOrderMap` is provided, orders items according to the IDs in `randomOrderMap`.
 *     - Any items not in `randomOrderMap` are placed at the end.
 */
export function getSortedPlaylistItems(
  items: PlaylistItemWithDetails[] | null | undefined,
  sortMode: PlaylistSortMode,
  randomOrderMap?: string[],
  isCustomOrdered?: boolean
): PlaylistItemWithDetails[] {
  if (!items || items.length <= 1) {
    return items ? [...items] : [];
  }

  if (sortMode === "newest") {
    return [...items].sort((a, b) => {
      // 1. Primary added_at DESC
      const timeDiff = (b.added_at || 0) - (a.added_at || 0);
      if (timeDiff !== 0) return timeDiff;

      // 2. Fallback when added_at is identical (e.g. batch-add or DB migration): track.created_at DESC
      const trackDiff = (b.track?.created_at || 0) - (a.track?.created_at || 0);
      if (trackDiff !== 0) return trackDiff;

      // 3. Fallback: match SQLite ORDER BY pi.sort_order ASC
      const orderDiff = (a.sort_order ?? 0) - (b.sort_order ?? 0);
      if (orderDiff !== 0) return orderDiff;

      return a.id.localeCompare(b.id);
    });
  }

  if (sortMode === "oldest") {
    return [...items].sort((a, b) => {
      // 1. Primary added_at ASC
      const timeDiff = (a.added_at || 0) - (b.added_at || 0);
      if (timeDiff !== 0) return timeDiff;

      // 2. Fallback when added_at is identical: track.created_at ASC
      const trackDiff = (a.track?.created_at || 0) - (b.track?.created_at || 0);
      if (trackDiff !== 0) return trackDiff;

      // 3. Fallback: earlier in batch has lower sort_order
      const orderDiff = (a.sort_order ?? 0) - (b.sort_order ?? 0);
      if (orderDiff !== 0) return orderDiff;

      return b.id.localeCompare(a.id);
    });
  }

  if (sortMode === "random") {
    if (!randomOrderMap || randomOrderMap.length === 0) {
      return [...items].reverse();
    }
    const orderMap = new Map(randomOrderMap.map((id, index) => [id, index]));
    return [...items].sort((a, b) => {
      const idxA = orderMap.has(a.id) ? orderMap.get(a.id)! : Number.MAX_SAFE_INTEGER;
      const idxB = orderMap.has(b.id) ? orderMap.get(b.id)! : Number.MAX_SAFE_INTEGER;
      if (idxA !== idxB) return idxA - idxB;
      return (a.sort_order ?? 0) - (b.sort_order ?? 0);
    });
  }

  // "manual" mode
  if (!isCustomOrdered) {
    // When the playlist hasn't been custom ordered yet, manual view initially defaults to newest first
    return [...items].sort((a, b) => {
      const timeDiff = (b.added_at || 0) - (a.added_at || 0);
      if (timeDiff !== 0) return timeDiff;
      const trackDiff = (b.track?.created_at || 0) - (a.track?.created_at || 0);
      if (trackDiff !== 0) return trackDiff;
      const orderDiff = (a.sort_order ?? 0) - (b.sort_order ?? 0);
      if (orderDiff !== 0) return orderDiff;
      return a.id.localeCompare(b.id);
    });
  }

  // Custom ordered: follow manual sort_order
  return [...items].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
}

/**
 * Sorts Mixed items (Mix category) according to sortMode:
 * - newest: createdAt DESC, title ASC
 * - oldest: createdAt ASC, title ASC
 * - random: according to randomOrderMap
 */
export function getSortedMixedItems(
  items: MixedItem[] | null | undefined,
  sortMode: PlaylistSortMode,
  randomOrderMap?: string[]
): MixedItem[] {
  if (!items || items.length <= 1) {
    return items ? [...items] : [];
  }

  if (sortMode === "newest" || sortMode === "manual") {
    return [...items].sort((a, b) => {
      const timeDiff = (b.createdAt || 0) - (a.createdAt || 0);
      if (timeDiff !== 0) return timeDiff;
      const titleA = a.type === "slice" ? a.segment?.name || "" : a.track?.title || "";
      const titleB = b.type === "slice" ? b.segment?.name || "" : b.track?.title || "";
      return titleA.localeCompare(titleB);
    });
  }

  if (sortMode === "oldest") {
    return [...items].sort((a, b) => {
      const timeDiff = (a.createdAt || 0) - (b.createdAt || 0);
      if (timeDiff !== 0) return timeDiff;
      const titleA = a.type === "slice" ? a.segment?.name || "" : a.track?.title || "";
      const titleB = b.type === "slice" ? b.segment?.name || "" : b.track?.title || "";
      return titleA.localeCompare(titleB);
    });
  }

  if (sortMode === "random") {
    if (!randomOrderMap || randomOrderMap.length === 0) {
      return [...items].reverse();
    }
    const orderMap = new Map(randomOrderMap.map((id, index) => [id, index]));
    return [...items].sort((a, b) => {
      const idxA = orderMap.has(a.id) ? orderMap.get(a.id)! : Number.MAX_SAFE_INTEGER;
      const idxB = orderMap.has(b.id) ? orderMap.get(b.id)! : Number.MAX_SAFE_INTEGER;
      if (idxA !== idxB) return idxA - idxB;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
  }

  return [...items];
}

/**
 * Sorts Slice items (Slices category) according to sortMode:
 * - newest: segment created_at DESC (fallback track created_at)
 * - oldest: segment created_at ASC (fallback track created_at)
 * - random: according to randomOrderMap
 */
export function getSortedSliceItems(
  items: SliceItem[] | null | undefined,
  sortMode: PlaylistSortMode,
  randomOrderMap?: string[]
): SliceItem[] {
  if (!items || items.length <= 1) {
    return items ? [...items] : [];
  }

  const getItemTime = (it: SliceItem) => it.segment.created_at || it.track.created_at || 0;

  if (sortMode === "newest" || sortMode === "manual") {
    return [...items].sort((a, b) => {
      const timeDiff = getItemTime(b) - getItemTime(a);
      if (timeDiff !== 0) return timeDiff;
      return (a.segment.name || "").localeCompare(b.segment.name || "");
    });
  }

  if (sortMode === "oldest") {
    return [...items].sort((a, b) => {
      const timeDiff = getItemTime(a) - getItemTime(b);
      if (timeDiff !== 0) return timeDiff;
      return (a.segment.name || "").localeCompare(b.segment.name || "");
    });
  }

  if (sortMode === "random") {
    if (!randomOrderMap || randomOrderMap.length === 0) {
      return [...items].reverse();
    }
    const orderMap = new Map(randomOrderMap.map((id, index) => [id, index]));
    return [...items].sort((a, b) => {
      const idxA = orderMap.has(a.id) ? orderMap.get(a.id)! : Number.MAX_SAFE_INTEGER;
      const idxB = orderMap.has(b.id) ? orderMap.get(b.id)! : Number.MAX_SAFE_INTEGER;
      if (idxA !== idxB) return idxA - idxB;
      return getItemTime(b) - getItemTime(a);
    });
  }

  return [...items];
}

/**
 * Sorts Track items (Tracks category) according to sortMode:
 * - newest: track created_at DESC
 * - oldest: track created_at ASC
 * - random: according to randomOrderMap
 */
export function getSortedTracks(
  tracks: Track[] | null | undefined,
  sortMode: PlaylistSortMode,
  randomOrderMap?: string[]
): Track[] {
  if (!tracks || tracks.length <= 1) {
    return tracks ? [...tracks] : [];
  }

  if (sortMode === "newest" || sortMode === "manual") {
    return [...tracks].sort((a, b) => {
      const timeDiff = (b.created_at || 0) - (a.created_at || 0);
      if (timeDiff !== 0) return timeDiff;
      return (a.title || "").localeCompare(b.title || "");
    });
  }

  if (sortMode === "oldest") {
    return [...tracks].sort((a, b) => {
      const timeDiff = (a.created_at || 0) - (b.created_at || 0);
      if (timeDiff !== 0) return timeDiff;
      return (a.title || "").localeCompare(b.title || "");
    });
  }

  if (sortMode === "random") {
    if (!randomOrderMap || randomOrderMap.length === 0) {
      return [...tracks].reverse();
    }
    const orderMap = new Map(randomOrderMap.map((id, index) => [id, index]));
    return [...tracks].sort((a, b) => {
      const idxA = orderMap.has(a.id) ? orderMap.get(a.id)! : Number.MAX_SAFE_INTEGER;
      const idxB = orderMap.has(b.id) ? orderMap.get(b.id)! : Number.MAX_SAFE_INTEGER;
      if (idxA !== idxB) return idxA - idxB;
      return (b.created_at || 0) - (a.created_at || 0);
    });
  }

  return [...tracks];
}
