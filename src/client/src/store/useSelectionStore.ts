import { create } from "zustand";

export interface SelectedItem {
  id: string; // unique ID in view: track.id, segment.id, or playlistItem.id
  type: "track" | "slice" | "playlist_item";
  trackId: string;
  segmentId?: string | null;
  playlistId?: string | null;
  title: string;
}

export interface SelectionState {
  selectedTrackIds: Set<string>;
  selectedItems: Map<string, SelectedItem>;
  lastSelectedTrackId: string | null;

  toggleTrack: (
    idOrItem: string | SelectedItem,
    visibleItemsOrIds?: (string | SelectedItem)[],
    shiftKey?: boolean,
    itemPayload?: SelectedItem
  ) => void;
  toggleItem: (
    item: SelectedItem,
    visibleItemsOrIds?: (string | SelectedItem)[],
    shiftKey?: boolean
  ) => void;
  selectTracks: (itemsOrIds: (string | SelectedItem)[]) => void;
  deselectTracks: (ids: string[]) => void;
  selectAllVisible: (visibleItemsOrIds: (string | SelectedItem)[]) => void;
  deselectAllVisible: (visibleIds: string[]) => void;
  clearSelection: () => void;
  pruneSelection: (validIds: Set<string> | string[], currentActivePlaylistId?: string | null) => void;
}

export function createFallbackSelectedItem(id: string): SelectedItem {
  if (id.startsWith("seg_")) {
    return {
      id,
      type: "slice",
      trackId: "",
      segmentId: id,
      title: id,
    };
  }
  if (id.startsWith("pli_")) {
    return {
      id,
      type: "playlist_item",
      trackId: "",
      title: id,
    };
  }
  return {
    id,
    type: "track",
    trackId: id,
    title: id,
  };
}

export const useSelectionStore = create<SelectionState>((set, get) => ({
  selectedTrackIds: new Set<string>(),
  selectedItems: new Map<string, SelectedItem>(),
  lastSelectedTrackId: null,

  toggleTrack: (
    idOrItem: string | SelectedItem,
    visibleItemsOrIds?: (string | SelectedItem)[],
    shiftKey?: boolean,
    itemPayload?: SelectedItem
  ) => {
    const id = typeof idOrItem === "string" ? idOrItem : idOrItem.id;
    const payload = itemPayload || (typeof idOrItem !== "string" ? idOrItem : undefined);

    set((state) => {
      const nextIds = new Set(state.selectedTrackIds);
      const nextItems = new Map(state.selectedItems);

      // Handle Shift + Click Range Selection
      if (shiftKey && state.lastSelectedTrackId && visibleItemsOrIds && visibleItemsOrIds.length > 0) {
        const getStrId = (it: string | SelectedItem) => (typeof it === "string" ? it : it.id);
        const strIds = visibleItemsOrIds.map(getStrId);
        const lastIdx = strIds.indexOf(state.lastSelectedTrackId);
        const currIdx = strIds.indexOf(id);

        if (lastIdx !== -1 && currIdx !== -1) {
          const start = Math.min(lastIdx, currIdx);
          const end = Math.max(lastIdx, currIdx);
          for (let i = start; i <= end; i++) {
            const raw = visibleItemsOrIds[i];
            const rangeId = getStrId(raw);
            nextIds.add(rangeId);
            if (typeof raw !== "string") {
              nextItems.set(rangeId, raw);
            } else if (payload && rangeId === id) {
              nextItems.set(id, payload);
            } else if (!nextItems.has(rangeId)) {
              nextItems.set(rangeId, createFallbackSelectedItem(rangeId));
            }
          }
          if (payload) {
            nextItems.set(id, payload);
          }
          return { selectedTrackIds: nextIds, selectedItems: nextItems, lastSelectedTrackId: id };
        }
      }

      // Normal single toggle
      if (nextIds.has(id)) {
        nextIds.delete(id);
        nextItems.delete(id);
      } else {
        nextIds.add(id);
        nextItems.set(id, payload || createFallbackSelectedItem(id));
      }

      return {
        selectedTrackIds: nextIds,
        selectedItems: nextItems,
        lastSelectedTrackId: id,
      };
    });
  },

  toggleItem: (item: SelectedItem, visibleItemsOrIds?: (string | SelectedItem)[], shiftKey?: boolean) => {
    get().toggleTrack(item.id, visibleItemsOrIds, shiftKey, item);
  },

  selectTracks: (itemsOrIds: (string | SelectedItem)[]) => {
    if (!itemsOrIds || itemsOrIds.length === 0) return;
    set((state) => {
      const nextIds = new Set(state.selectedTrackIds);
      const nextItems = new Map(state.selectedItems);
      for (const it of itemsOrIds) {
        if (!it) continue;
        if (typeof it === "string") {
          nextIds.add(it);
          if (!nextItems.has(it)) {
            nextItems.set(it, createFallbackSelectedItem(it));
          }
        } else {
          nextIds.add(it.id);
          nextItems.set(it.id, it);
        }
      }
      return { selectedTrackIds: nextIds, selectedItems: nextItems };
    });
  },

  deselectTracks: (ids: string[]) => {
    if (!ids || ids.length === 0) return;
    set((state) => {
      const nextIds = new Set(state.selectedTrackIds);
      const nextItems = new Map(state.selectedItems);
      for (const id of ids) {
        nextIds.delete(id);
        nextItems.delete(id);
      }
      return { selectedTrackIds: nextIds, selectedItems: nextItems };
    });
  },

  selectAllVisible: (visibleItemsOrIds: (string | SelectedItem)[]) => {
    if (!visibleItemsOrIds || visibleItemsOrIds.length === 0) return;
    set((state) => {
      const nextIds = new Set(state.selectedTrackIds);
      const nextItems = new Map(state.selectedItems);
      for (const it of visibleItemsOrIds) {
        if (!it) continue;
        if (typeof it === "string") {
          nextIds.add(it);
          if (!nextItems.has(it)) {
            nextItems.set(it, createFallbackSelectedItem(it));
          }
        } else {
          nextIds.add(it.id);
          nextItems.set(it.id, it);
        }
      }
      return { selectedTrackIds: nextIds, selectedItems: nextItems };
    });
  },

  deselectAllVisible: (visibleIds: string[]) => {
    if (!visibleIds || visibleIds.length === 0) return;
    set((state) => {
      const nextIds = new Set(state.selectedTrackIds);
      const nextItems = new Map(state.selectedItems);
      for (const id of visibleIds) {
        nextIds.delete(id);
        nextItems.delete(id);
      }
      return { selectedTrackIds: nextIds, selectedItems: nextItems };
    });
  },

  clearSelection: () => {
    const current = get().selectedTrackIds;
    if (current.size === 0 && get().lastSelectedTrackId === null) return;
    set({
      selectedTrackIds: new Set<string>(),
      selectedItems: new Map<string, SelectedItem>(),
      lastSelectedTrackId: null,
    });
  },

  pruneSelection: (validIds: Set<string> | string[], currentActivePlaylistId?: string | null) => {
    const validSet = validIds instanceof Set ? validIds : new Set(validIds);
    set((state) => {
      const isItemValid = (id: string, item?: SelectedItem) => {
        if (!item) return validSet.has(id);
        const isViewingThisPlaylist =
          item.type === "playlist_item" &&
          Boolean(item.playlistId) &&
          item.playlistId === currentActivePlaylistId;

        if (isViewingThisPlaylist) {
          return validSet.has(id);
        }
        if (item.type === "playlist_item") {
          return validSet.has(id) || (Boolean(item.trackId) && validSet.has(item.trackId));
        }
        return validSet.has(id);
      };

      let hasOrphan = false;
      for (const [id, item] of state.selectedItems) {
        if (!isItemValid(id, item)) {
          hasOrphan = true;
          break;
        }
      }
      if (!hasOrphan) {
        for (const id of state.selectedTrackIds) {
          if (!state.selectedItems.has(id) && !validSet.has(id)) {
            hasOrphan = true;
            break;
          }
        }
      }
      if (!hasOrphan) return state;

      const nextIds = new Set<string>();
      const nextItems = new Map<string, SelectedItem>();
      for (const [id, item] of state.selectedItems) {
        if (isItemValid(id, item)) {
          nextIds.add(id);
          nextItems.set(id, item);
        }
      }
      for (const id of state.selectedTrackIds) {
        if (!nextItems.has(id) && validSet.has(id)) {
          nextIds.add(id);
        }
      }
      const nextLast =
        state.lastSelectedTrackId && nextIds.has(state.lastSelectedTrackId)
          ? state.lastSelectedTrackId
          : null;
      return { selectedTrackIds: nextIds, selectedItems: nextItems, lastSelectedTrackId: nextLast };
    });
  },
}));

// Selectors
export const useIsTrackSelected = (id: string): boolean => {
  return useSelectionStore((s) => s.selectedTrackIds.has(id));
};

export const useSelectedTrackCount = (): number => {
  return useSelectionStore((s) => s.selectedTrackIds.size);
};

export const isAllVisibleSelected = (selectedIds: Set<string>, visibleIds: string[]): boolean => {
  if (!visibleIds || visibleIds.length === 0) return false;
  return visibleIds.every((id) => selectedIds.has(id));
};

export const isPartiallyVisibleSelected = (selectedIds: Set<string>, visibleIds: string[]): boolean => {
  if (!visibleIds || visibleIds.length === 0) return false;
  const count = visibleIds.filter((id) => selectedIds.has(id)).length;
  return count > 0 && count < visibleIds.length;
};
