import { describe, it, expect, beforeEach } from "bun:test";
import {
  useSelectionStore,
  isAllVisibleSelected,
  isPartiallyVisibleSelected,
} from "./useSelectionStore";

describe("useSelectionStore", () => {
  beforeEach(() => {
    useSelectionStore.getState().clearSelection();
  });

  it("should toggle single track selection", () => {
    const store = useSelectionStore.getState();
    store.toggleTrack("track-1");
    expect(useSelectionStore.getState().selectedTrackIds.has("track-1")).toBe(true);
    expect(useSelectionStore.getState().lastSelectedTrackId).toBe("track-1");

    store.toggleTrack("track-1");
    expect(useSelectionStore.getState().selectedTrackIds.has("track-1")).toBe(false);
    expect(useSelectionStore.getState().lastSelectedTrackId).toBe("track-1");
  });

  it("should support Shift + Click range selection based on visibleIds", () => {
    const store = useSelectionStore.getState();
    const visible = ["t1", "t2", "t3", "t4", "t5"];

    // First click t2
    store.toggleTrack("t2", visible, false);
    expect(useSelectionStore.getState().selectedTrackIds.size).toBe(1);
    expect(useSelectionStore.getState().selectedTrackIds.has("t2")).toBe(true);

    // Shift + click t4
    store.toggleTrack("t4", visible, true);
    const selected = useSelectionStore.getState().selectedTrackIds;
    expect(selected.size).toBe(3);
    expect(selected.has("t2")).toBe(true);
    expect(selected.has("t3")).toBe(true);
    expect(selected.has("t4")).toBe(true);
  });

  it("should select and deselect all visible items", () => {
    const store = useSelectionStore.getState();
    const visible = ["v1", "v2", "v3"];

    store.selectAllVisible(visible);
    expect(useSelectionStore.getState().selectedTrackIds.size).toBe(3);
    expect(isAllVisibleSelected(useSelectionStore.getState().selectedTrackIds, visible)).toBe(true);
    expect(isPartiallyVisibleSelected(useSelectionStore.getState().selectedTrackIds, visible)).toBe(false);

    // Deselect one
    store.toggleTrack("v2");
    expect(isAllVisibleSelected(useSelectionStore.getState().selectedTrackIds, visible)).toBe(false);
    expect(isPartiallyVisibleSelected(useSelectionStore.getState().selectedTrackIds, visible)).toBe(true);

    // Deselect all visible
    store.deselectAllVisible(visible);
    expect(useSelectionStore.getState().selectedTrackIds.size).toBe(0);
    expect(isAllVisibleSelected(useSelectionStore.getState().selectedTrackIds, visible)).toBe(false);
    expect(isPartiallyVisibleSelected(useSelectionStore.getState().selectedTrackIds, visible)).toBe(false);
  });

  it("should prune deleted/invalid track IDs", () => {
    const store = useSelectionStore.getState();
    store.selectTracks(["t1", "t2", "t3"]);

    // Only t1 and t3 still exist
    store.pruneSelection(new Set(["t1", "t3", "t4"]));
    const selected = useSelectionStore.getState().selectedTrackIds;
    expect(selected.size).toBe(2);
    expect(selected.has("t1")).toBe(true);
    expect(selected.has("t2")).toBe(false);
    expect(selected.has("t3")).toBe(true);
  });

  it("clearSelection resets state cleanly", () => {
    const store = useSelectionStore.getState();
    store.selectTracks(["t1", "t2"]);
    expect(useSelectionStore.getState().selectedTrackIds.size).toBe(2);

    store.clearSelection();
    expect(useSelectionStore.getState().selectedTrackIds.size).toBe(0);
    expect(useSelectionStore.getState().lastSelectedTrackId).toBeNull();
  });

  it("should store and preserve slice metadata via toggleItem", () => {
    const store = useSelectionStore.getState();
    store.toggleItem({
      id: "seg_123",
      type: "slice",
      trackId: "trk_1",
      segmentId: "seg_123",
      title: "Intro Slice",
    });

    expect(useSelectionStore.getState().selectedTrackIds.has("seg_123")).toBe(true);
    const item = useSelectionStore.getState().selectedItems.get("seg_123");
    expect(item).toBeDefined();
    expect(item?.type).toBe("slice");
    expect(item?.trackId).toBe("trk_1");
    expect(item?.segmentId).toBe("seg_123");
  });

  it("should selectAllVisible with SelectedItem objects", () => {
    const store = useSelectionStore.getState();
    const items = [
      { id: "trk_1", type: "track" as const, trackId: "trk_1", title: "Song 1" },
      { id: "seg_2", type: "slice" as const, trackId: "trk_1", segmentId: "seg_2", title: "Slice 2" },
    ];
    store.selectAllVisible(items);

    expect(useSelectionStore.getState().selectedTrackIds.size).toBe(2);
    expect(useSelectionStore.getState().selectedTrackIds.has("trk_1")).toBe(true);
    expect(useSelectionStore.getState().selectedTrackIds.has("seg_2")).toBe(true);

    const segItem = useSelectionStore.getState().selectedItems.get("seg_2");
    expect(segItem?.type).toBe("slice");
    expect(segItem?.title).toBe("Slice 2");
  });

  it("should preserve playlist_item when parent track exists and prune when parent track is deleted", () => {
    const store = useSelectionStore.getState();
    store.selectTracks([
      {
        id: "pli_1",
        type: "playlist_item",
        trackId: "trk_parent",
        segmentId: "seg_1",
        playlistId: "pl_1",
        title: "Playlist Slice",
      },
    ]);

    expect(useSelectionStore.getState().selectedTrackIds.has("pli_1")).toBe(true);

    // Prune with validIds containing trk_parent when navigating outside -> should retain pli_1
    store.pruneSelection(new Set(["trk_parent"]), null);
    expect(useSelectionStore.getState().selectedTrackIds.has("pli_1")).toBe(true);

    // Prune when actively viewing pl_1 and pli_1 is not in playlist items -> should prune pli_1 even if trk_parent is valid
    store.pruneSelection(new Set(["trk_parent"]), "pl_1");
    expect(useSelectionStore.getState().selectedTrackIds.has("pli_1")).toBe(false);
  });

  it("should preserve full SelectedItem metadata during Shift + Click range selection", () => {
    const store = useSelectionStore.getState();
    const visibleItems = [
      { id: "trk_1", type: "track" as const, trackId: "trk_1", title: "Full Track 1" },
      { id: "seg_1", type: "slice" as const, trackId: "trk_1", segmentId: "seg_1", title: "Slice 1" },
      { id: "seg_2", type: "slice" as const, trackId: "trk_2", segmentId: "seg_2", title: "Slice 2" },
      { id: "trk_2", type: "track" as const, trackId: "trk_2", title: "Full Track 2" },
    ];

    // First click seg_1
    store.toggleTrack(visibleItems[1], visibleItems, false);
    expect(useSelectionStore.getState().selectedTrackIds.size).toBe(1);
    expect(useSelectionStore.getState().selectedTrackIds.has("seg_1")).toBe(true);

    // Shift + click trk_2 (selects seg_1, seg_2, trk_2)
    store.toggleTrack(visibleItems[3], visibleItems, true);

    const selectedIds = useSelectionStore.getState().selectedTrackIds;
    const selectedItems = useSelectionStore.getState().selectedItems;

    expect(selectedIds.size).toBe(3);
    expect(selectedIds.has("seg_1")).toBe(true);
    expect(selectedIds.has("seg_2")).toBe(true);
    expect(selectedIds.has("trk_2")).toBe(true);

    // Verify metadata of range-selected items
    const slice2 = selectedItems.get("seg_2");
    expect(slice2).toBeDefined();
    expect(slice2?.type).toBe("slice");
    expect(slice2?.trackId).toBe("trk_2");
    expect(slice2?.segmentId).toBe("seg_2");
    expect(slice2?.title).toBe("Slice 2");

    const track2 = selectedItems.get("trk_2");
    expect(track2).toBeDefined();
    expect(track2?.type).toBe("track");
    expect(track2?.trackId).toBe("trk_2");
  });
});
