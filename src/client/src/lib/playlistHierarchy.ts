import type { Playlist } from "@/server/types";

export interface HierarchicalPlaylistItem {
  playlist: Playlist & { item_count?: number };
  isChild: boolean;
}

/**
 * Organizes a flat list of playlists into a hierarchy where children
 * are placed directly beneath their parent playlist.
 */
export function getHierarchicalPlaylists(
  playlists: (Playlist & { item_count?: number })[],
  options: { excludeMixes?: boolean } = {}
): HierarchicalPlaylistItem[] {
  const source = options.excludeMixes ? playlists.filter((pl) => !pl.is_mix) : playlists;
  const roots = source.filter((pl) => !pl.parent_id);
  const childrenByParent = new Map<string, typeof source>();

  for (const pl of source) {
    if (pl.parent_id) {
      const list = childrenByParent.get(pl.parent_id) || [];
      list.push(pl);
      childrenByParent.set(pl.parent_id, list);
    }
  }

  const result: HierarchicalPlaylistItem[] = [];
  for (const root of roots) {
    result.push({ playlist: root, isChild: false });
    const children = childrenByParent.get(root.id) || [];
    for (const child of children) {
      result.push({ playlist: child, isChild: true });
    }
  }

  // Fallback for orphaned children whose parent might be missing or filtered out
  const addedIds = new Set(result.map((r) => r.playlist.id));
  for (const pl of source) {
    if (!addedIds.has(pl.id)) {
      result.push({ playlist: pl, isChild: Boolean(pl.parent_id) });
    }
  }

  return result;
}
