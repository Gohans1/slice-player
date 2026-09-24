import type { PlaylistItemWithDetails } from "@/server/types";

export type PlaylistSortMode = "manual" | "newest" | "oldest" | "random";

/**
 * Shuffles an array of item IDs using Fisher-Yates algorithm.
 */
export function getShuffledItemIds(items: PlaylistItemWithDetails[]): string[] {
  if (!items || items.length === 0) return [];
  const ids = items.map((it) => it.id);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids;
}

/**
 * Returns playlist items sorted according to the selected PlaylistSortMode.
 *
 * - "newest": Sorts by added_at DESC (newest first).
 * - "oldest": Sorts by added_at ASC (oldest first).
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
      const timeDiff = (b.added_at || 0) - (a.added_at || 0);
      if (timeDiff !== 0) return timeDiff;
      return (a.sort_order ?? 0) - (b.sort_order ?? 0);
    });
  }

  if (sortMode === "oldest") {
    return [...items].sort((a, b) => {
      const timeDiff = (a.added_at || 0) - (b.added_at || 0);
      if (timeDiff !== 0) return timeDiff;
      return (a.sort_order ?? 0) - (b.sort_order ?? 0);
    });
  }

  if (sortMode === "random") {
    if (!randomOrderMap || randomOrderMap.length === 0) {
      return [...items];
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
      return (a.sort_order ?? 0) - (b.sort_order ?? 0);
    });
  }

  // Custom ordered: follow manual sort_order
  return [...items].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
}
