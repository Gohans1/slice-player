import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";

if (typeof globalThis.Audio === "undefined" || !(globalThis.Audio.prototype as any)?.removeAttribute) {
  (globalThis as any).Audio = class {
    crossOrigin = "";
    preload = "";
    currentTime = 0;
    src = "";
    addEventListener() {}
    removeEventListener() {}
    pause() {}
    play() {
      return Promise.resolve();
    }
    load() {}
    removeAttribute(attr: string) {
      if (attr === "src") this.src = "";
    }
  };
}

import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { GlobalWindow } from "happy-dom";
import { PlaylistTableView, type MixedItem } from "./PlaylistTableView";
import { usePlayerStore } from "../store/usePlayerStore";
import { useSelectionStore } from "../store/useSelectionStore";
import type { Track, Segment, Playlist, PlaylistItemWithDetails } from "@/server/types";

const dummyTrack: Track = {
  id: "trk_tbl_1",
  source_type: "youtube",
  source_uri: "yt_tbl_1",
  title: "Table Test Track",
  artist: "Table Artist",
  duration: 200,
  thumbnail_url: "https://example.com/thumb.jpg",
  status: "ready",
  volume: 0.5,
};

const dummyTrack2: Track = {
  id: "trk_tbl_2",
  source_type: "youtube",
  source_uri: "yt_tbl_2",
  title: "Second Track",
  artist: "Another Artist",
  duration: 150,
  thumbnail_url: "https://example.com/thumb2.jpg",
  status: "ready",
  volume: 0.5,
};

const dummySegment: Segment = {
  id: "seg_tbl_1",
  track_id: "trk_tbl_1",
  name: "Test Table Slice",
  start_time: 10,
  end_time: 40,
  created_at: 1001,
};

const dummyPlaylist: Playlist & { item_count: number } = {
  id: "pl_custom_1",
  name: "My Custom Playlist",
  created_at: 1000,
  updated_at: 1000,
  item_count: 2,
};

const dummyPlaylistItem1: PlaylistItemWithDetails = {
  id: "item_1",
  playlist_id: "pl_custom_1",
  track_id: "trk_tbl_1",
  segment_id: null,
  sort_order: 0,
  added_at: 1000,
  track: dummyTrack,
};

const dummyPlaylistItem2: PlaylistItemWithDetails = {
  id: "item_2",
  playlist_id: "pl_custom_1",
  track_id: "trk_tbl_1", // same track to test duplicate handling
  segment_id: null,
  sort_order: 1,
  added_at: 1001,
  track: dummyTrack,
};

describe("PlaylistTableView", () => {
  const origPlaySegmentInMode = usePlayerStore.getState().playSegmentInMode;
  const origPlayPlaylistItemAtIndex = usePlayerStore.getState().playPlaylistItemAtIndex;
  const origPause = usePlayerStore.getState().pause;
  const origResume = usePlayerStore.getState().resume;
  let window: any;
  let container: any;
  let root: any;

  beforeEach(() => {
    window = new GlobalWindow();
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    (globalThis as any).window = window;
    (globalThis as any).document = window.document;
    (globalThis as any).Node = window.Node;
    (globalThis as any).Element = window.Element;
    (globalThis as any).HTMLElement = window.HTMLElement;
    (globalThis as any).HTMLImageElement = window.HTMLImageElement;

    container = window.document.createElement("div");
    window.document.body.appendChild(container);
    root = createRoot(container);

    usePlayerStore.setState({
      activePlaylistId: null,
      activePlaylistPlayingId: null,
      playlists: [dummyPlaylist],
      activePlaylistItems: [],
      tracks: [dummyTrack, dummyTrack2],
      queue: [],
      queueIndex: -1,
      isPlaying: false,
      activeTrack: null,
      activeSegment: null,
    });
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root.unmount();
      });
    }
    usePlayerStore.setState({
      activePlaylistId: null,
      activePlaylistPlayingId: null,
      activeSystemCategory: undefined,
      playlists: [],
      activePlaylistItems: [],
      tracks: [],
      queue: [],
      queueIndex: -1,
      isPlaying: false,
      activeTrack: null,
      activeSegment: null,
      playSegmentInMode: origPlaySegmentInMode,
      playPlaylistItemAtIndex: origPlayPlaylistItemAtIndex,
      pause: origPause,
      resume: origResume,
      queuesByMode: {
        slices_only: [],
        mixed: [],
        original_only: [],
      },
      initializedModes: {
        slices_only: false,
        mixed: false,
        original_only: false,
      },
    });
  });

  it("switches smoothly between general library view and custom playlist view without React hook errors", async () => {
    // 1. Render in general library view (activePlaylistId === null)
    let renderError: any = null;
    try {
      await act(async () => {
        root.render(<PlaylistTableView filteredTracks={[dummyTrack]} />);
      });
    } catch (e) {
      renderError = e;
    }
    expect(renderError).toBeNull();
    expect(container.textContent).toContain("Table Test Track");

    // 2. Switch to custom playlist (activePlaylistId === 'pl_custom_1')
    try {
      await act(async () => {
        usePlayerStore.setState({
          activePlaylistId: "pl_custom_1",
          activePlaylistItems: [dummyPlaylistItem1],
        });
        root.render(<PlaylistTableView />);
      });
    } catch (e) {
      renderError = e;
    }
    expect(renderError).toBeNull();
    expect(container.textContent).toContain("Table Test Track");

    // 3. Switch back to general library view (activePlaylistId === null)
    try {
      await act(async () => {
        usePlayerStore.setState({
          activePlaylistId: null,
          activePlaylistItems: [],
        });
        root.render(<PlaylistTableView filteredTracks={[dummyTrack]} />);
      });
    } catch (e) {
      renderError = e;
    }
    expect(renderError).toBeNull();
    expect(container.textContent).toContain("Table Test Track");

    // 4. Render in mixedItems view (Trộn cả 2)
    try {
      await act(async () => {
        usePlayerStore.setState({
          activePlaylistId: null,
          activeSystemCategory: "mixed",
        });
        root.render(
          <PlaylistTableView
            mixedItems={[
              {
                type: "track",
                id: "track_trk_tbl_1",
                track: dummyTrack,
                createdAt: 1000,
              },
              {
                type: "slice",
                id: "slice_seg_tbl_1",
                track: dummyTrack,
                segment: dummySegment,
                createdAt: 1001,
              },
            ]}
          />
        );
      });
    } catch (e) {
      renderError = e;
    }
    expect(renderError).toBeNull();
    expect(container.textContent).toContain("Table Test Track");
    expect(container.textContent).toContain("Test Table Slice");
    expect(container.textContent).toMatch(/Full Track|Toàn bộ bài/);
    expect(container.textContent).toMatch(/Slice|Lát cắt/);
  });

  it("handles duplicate tracks in custom playlist highlighting only the matching queue item", async () => {
    await act(async () => {
      usePlayerStore.setState({
        activePlaylistId: "pl_custom_1",
        activePlaylistPlayingId: "pl_custom_1",
        activePlaylistItems: [dummyPlaylistItem1, dummyPlaylistItem2],
        queue: [
          { queueItemId: "item_1", segment: { id: "fallback_1", track_id: dummyTrack.id, name: dummyTrack.title, start_time: 0, end_time: dummyTrack.duration }, track: dummyTrack },
          { queueItemId: "item_2", segment: { id: "fallback_2", track_id: dummyTrack.id, name: dummyTrack.title, start_time: 0, end_time: dummyTrack.duration }, track: dummyTrack },
        ],
        queueIndex: 0,
        isPlaying: true,
        activeTrack: dummyTrack,
        activeSegment: { id: "fallback_1", track_id: dummyTrack.id, name: dummyTrack.title, start_time: 0, end_time: dummyTrack.duration },
      });
      root.render(<PlaylistTableView />);
    });

    const rows = container.querySelectorAll(".group[role='row']");
    expect(rows.length).toBe(2);

    // Row 1 (item_1) is active playing
    expect(rows[0].className).toContain("border-primary/50");
    // Row 2 (item_2) has the identical track but distinct queueItemId, should NOT be active playing
    expect(rows[1].className).not.toContain("border-primary/50");
  });

  it("renders sliceItems view mode correctly with slice badges and actions", async () => {
    await act(async () => {
      usePlayerStore.setState({
        activePlaylistId: null,
        activeSystemCategory: "slices_only",
      });
      root.render(
        <PlaylistTableView
          sliceItems={[
            {
              id: "seg_tbl_1",
              segment: dummySegment,
              track: dummyTrack,
            },
          ]}
        />
      );
    });

    expect(container.textContent).toContain("Test Table Slice");
    expect(container.textContent).toContain("Table Test Track");
    expect(container.textContent).toContain("Studio");
  });

  it("reorders playlist items when clicking move up / move down", async () => {
    const originalReorder = usePlayerStore.getState().reorderPlaylist;
    const reorderSpy = mock(() => Promise.resolve(true));
    usePlayerStore.setState({
      activePlaylistId: "pl_custom_1",
      activePlaylistItems: [dummyPlaylistItem1, dummyPlaylistItem2],
      reorderPlaylist: reorderSpy as any,
    });

    try {
      await act(async () => {
        root.render(<PlaylistTableView />);
      });

      // Row 1 has move down button enabled (originalIdx: 0 -> canMoveUp: false, canMoveDown: true)
      const moveDownButtons = container.querySelectorAll("button[title='Move down'], button[title='Di chuyển xuống']");
      expect(moveDownButtons.length).toBe(2);

      // Click move down on row 1
      await act(async () => {
        moveDownButtons[0].dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      });

      expect(reorderSpy).toHaveBeenCalledTimes(1);
      expect(reorderSpy).toHaveBeenCalledWith("pl_custom_1", ["item_2", "item_1"]);
    } finally {
      usePlayerStore.setState({ reorderPlaylist: originalReorder });
    }
  });

  it("renders drag handles on custom playlist items and reorders using keyboard arrow keys", async () => {
    const originalReorder = usePlayerStore.getState().reorderPlaylist;
    const reorderSpy = mock((_plId: string, _itemIds: string[]) => Promise.resolve(true));
    try {
      await act(async () => {
        usePlayerStore.setState({
          activePlaylistId: "pl_custom_1",
          activePlaylistItems: [dummyPlaylistItem1, dummyPlaylistItem2],
          playlists: [dummyPlaylist],
          reorderPlaylist: reorderSpy as any,
        });
        root.render(<PlaylistTableView />);
      });

      const dragHandles = container.querySelectorAll('[data-drag-handle="true"]');
      expect(dragHandles.length).toBe(2);

      // Press ArrowDown on row 0's drag handle
      await act(async () => {
        dragHandles[0].dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
      });

      expect(reorderSpy).toHaveBeenCalledTimes(1);
      expect(reorderSpy).toHaveBeenCalledWith("pl_custom_1", ["item_2", "item_1"]);
    } finally {
      usePlayerStore.setState({ reorderPlaylist: originalReorder });
    }
  });

  it("handles HTML5 drag and drop reordering in custom playlist", async () => {
    const originalReorder = usePlayerStore.getState().reorderPlaylist;
    const reorderSpy = mock((_plId: string, _itemIds: string[]) => Promise.resolve(true));
    try {
      await act(async () => {
        usePlayerStore.setState({
          activePlaylistId: "pl_custom_1",
          activePlaylistItems: [dummyPlaylistItem1, dummyPlaylistItem2],
          playlists: [dummyPlaylist],
          reorderPlaylist: reorderSpy as any,
        });
        root.render(<PlaylistTableView />);
      });

      const rows = container.querySelectorAll(".group[role='row']");
      expect(rows.length).toBe(2);

      const dragHandles = container.querySelectorAll('[data-drag-handle="true"]');
      expect(dragHandles.length).toBe(2);

      // 1. MouseDown on handle to activate dragging
      await act(async () => {
        dragHandles[0].dispatchEvent(new window.PointerEvent("pointerdown", { button: 0, bubbles: true }));
      });

      // 2. DragStart on row 0
      const dataStore: Record<string, string> = {};
      const dragEvent = new window.Event("dragstart", { bubbles: true }) as any;
      dragEvent.dataTransfer = {
        setData: (key: string, val: string) => {
          dataStore[key] = val;
        },
        getData: (key: string) => dataStore[key] || "",
        effectAllowed: "none",
      };

      await act(async () => {
        rows[0].dispatchEvent(dragEvent);
      });

      expect(dataStore["application/x-slice-playlist-index"]).toBe("0");

      // 3. DragOver on row 1
      const dragOverEvent = new window.Event("dragover", { bubbles: true }) as any;
      dragOverEvent.preventDefault = () => {};
      dragOverEvent.dataTransfer = { dropEffect: "none" };
      await act(async () => {
        rows[1].dispatchEvent(dragOverEvent);
      });

      // 4. Drop on row 1
      const dropEvent = new window.Event("drop", { bubbles: true }) as any;
      dropEvent.preventDefault = () => {};
      dropEvent.stopPropagation = () => {};
      dropEvent.dataTransfer = {
        getData: (key: string) => dataStore[key] || "",
      };

      await act(async () => {
        rows[1].dispatchEvent(dropEvent);
      });

      expect(reorderSpy).toHaveBeenCalledTimes(1);
      expect(reorderSpy).toHaveBeenCalledWith("pl_custom_1", ["item_2", "item_1"]);
    } finally {
      usePlayerStore.setState({ reorderPlaylist: originalReorder });
    }
  });

  it("prevents dragstart on row if drag handle was not pressed", async () => {
    await act(async () => {
      usePlayerStore.setState({
        activePlaylistId: "pl_custom_1",
        activePlaylistItems: [dummyPlaylistItem1, dummyPlaylistItem2],
        playlists: [dummyPlaylist],
      });
      root.render(<PlaylistTableView />);
    });

    const rows = container.querySelectorAll(".group[role='row']");
    let prevented = false;
    const dragEvent = new window.Event("dragstart", { bubbles: true, cancelable: true }) as any;
    dragEvent.dataTransfer = { setData: () => {}, effectAllowed: "none" };
    dragEvent.preventDefault = () => { prevented = true; };

    await act(async () => {
      rows[0].dispatchEvent(dragEvent);
    });

    expect(prevented).toBe(true);
  });

  it("hides drag handle and suppresses reordering when searching", async () => {
    const originalReorder = usePlayerStore.getState().reorderPlaylist;
    const reorderSpy = mock((_plId: string, _itemIds: string[]) => Promise.resolve(true));
    try {
      await act(async () => {
        usePlayerStore.setState({
          activePlaylistId: "pl_custom_1",
          activePlaylistItems: [dummyPlaylistItem1, dummyPlaylistItem2],
          playlists: [dummyPlaylist],
          reorderPlaylist: reorderSpy as any,
        });
        root.render(<PlaylistTableView searchQuery="Second" />);
      });

      // Drag handles should be hidden during search
      const dragHandles = container.querySelectorAll('[data-drag-handle="true"]');
      expect(dragHandles.length).toBe(0);
    } finally {
      usePlayerStore.setState({ reorderPlaylist: originalReorder });
    }
  });

  it("handles Home and End keys on drag handle", async () => {
    const originalReorder = usePlayerStore.getState().reorderPlaylist;
    const reorderSpy = mock((_plId: string, _itemIds: string[]) => Promise.resolve(true));
    try {
      await act(async () => {
        usePlayerStore.setState({
          activePlaylistId: "pl_custom_1",
          activePlaylistItems: [dummyPlaylistItem1, dummyPlaylistItem2],
          playlists: [dummyPlaylist],
          reorderPlaylist: reorderSpy as any,
        });
        root.render(<PlaylistTableView />);
      });

      const dragHandles = container.querySelectorAll('[data-drag-handle="true"]');
      expect(dragHandles.length).toBe(2);

      // Press End on row 0 to move to bottom
      await act(async () => {
        dragHandles[0].dispatchEvent(new window.KeyboardEvent("keydown", { key: "End", bubbles: true }));
      });
      expect(reorderSpy).toHaveBeenCalledWith("pl_custom_1", ["item_2", "item_1"]);

      // Press Home on row 1 to move to top
      await act(async () => {
        dragHandles[1].dispatchEvent(new window.KeyboardEvent("keydown", { key: "Home", bubbles: true }));
      });
      expect(reorderSpy).toHaveBeenCalledWith("pl_custom_1", ["item_2", "item_1"]);
    } finally {
      usePlayerStore.setState({ reorderPlaylist: originalReorder });
    }
  });

  it("does NOT trigger playback when pressing Enter or Space on drag handle", async () => {
    const originalPlay = usePlayerStore.getState().playPlaylistItemAtIndex;
    const playPlaylistItemAtIndexSpy = mock((_plId: string, _itemId: string) => Promise.resolve());
    try {
      await act(async () => {
        usePlayerStore.setState({
          activePlaylistId: "pl_custom_1",
          activePlaylistItems: [dummyPlaylistItem1, dummyPlaylistItem2],
          playlists: [dummyPlaylist],
          playPlaylistItemAtIndex: playPlaylistItemAtIndexSpy as any,
        });
        root.render(<PlaylistTableView />);
      });

      const dragHandles = container.querySelectorAll('[data-drag-handle="true"]');
      expect(dragHandles.length).toBe(2);

      // Press Enter on drag handle
      await act(async () => {
        dragHandles[0].dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      });
      // Press Space on drag handle
      await act(async () => {
        dragHandles[0].dispatchEvent(new window.KeyboardEvent("keydown", { key: " ", bubbles: true }));
      });

      expect(playPlaylistItemAtIndexSpy).toHaveBeenCalledTimes(0);
    } finally {
      usePlayerStore.setState({ playPlaylistItemAtIndex: originalPlay });
    }
  });

  it("resets isDraggingHandle when mouseup or pointerup occurs without drag", async () => {
    await act(async () => {
      usePlayerStore.setState({
        activePlaylistId: "pl_custom_1",
        activePlaylistItems: [dummyPlaylistItem1, dummyPlaylistItem2],
        playlists: [dummyPlaylist],
      });
      root.render(<PlaylistTableView />);
    });

    const rows = container.querySelectorAll(".group[role='row']");
    const dragHandles = container.querySelectorAll('[data-drag-handle="true"]');

    // Pointerdown on handle
    await act(async () => {
      dragHandles[0].dispatchEvent(new window.PointerEvent("pointerdown", { button: 0, bubbles: true }));
    });

    // Pointerup on window (user clicked handle without dragging)
    await act(async () => {
      window.dispatchEvent(new window.PointerEvent("pointerup", { bubbles: true }));
    });

    // Subsequent dragstart directly on row body should be prevented
    let prevented = false;
    const dragEvent = new window.Event("dragstart", { bubbles: true, cancelable: true }) as any;
    dragEvent.dataTransfer = { setData: () => {}, effectAllowed: "none" };
    dragEvent.preventDefault = () => { prevented = true; };

    await act(async () => {
      rows[0].dispatchEvent(dragEvent);
    });

    expect(prevented).toBe(true);
  });

  it("cancels drag handle state when Escape key is pressed", async () => {
    await act(async () => {
      usePlayerStore.setState({
        activePlaylistId: "pl_custom_1",
        activePlaylistItems: [dummyPlaylistItem1, dummyPlaylistItem2],
        playlists: [dummyPlaylist],
      });
      root.render(<PlaylistTableView />);
    });

    const rows = container.querySelectorAll(".group[role='row']");
    const dragHandles = container.querySelectorAll('[data-drag-handle="true"]');

    // Pointerdown on handle
    await act(async () => {
      dragHandles[0].dispatchEvent(new window.PointerEvent("pointerdown", { button: 0, bubbles: true }));
    });

    // Press Escape
    await act(async () => {
      window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    // DragStart should now be prevented
    let prevented = false;
    const dragEvent = new window.Event("dragstart", { bubbles: true, cancelable: true }) as any;
    dragEvent.dataTransfer = { setData: () => {}, effectAllowed: "none" };
    dragEvent.preventDefault = () => { prevented = true; };

    await act(async () => {
      rows[0].dispatchEvent(dragEvent);
    });

    expect(prevented).toBe(true);
  });

  it("does not call reorderPlaylist when dropping an item onto itself", async () => {
    const originalReorder = usePlayerStore.getState().reorderPlaylist;
    const reorderSpy = mock((_plId: string, _itemIds: string[]) => Promise.resolve(true));
    try {
      await act(async () => {
        usePlayerStore.setState({
          activePlaylistId: "pl_custom_1",
          activePlaylistItems: [dummyPlaylistItem1, dummyPlaylistItem2],
          playlists: [dummyPlaylist],
          reorderPlaylist: reorderSpy as any,
        });
        root.render(<PlaylistTableView />);
      });

      const rows = container.querySelectorAll(".group[role='row']");
      const dragHandles = container.querySelectorAll('[data-drag-handle="true"]');

      await act(async () => {
        dragHandles[0].dispatchEvent(new window.PointerEvent("pointerdown", { button: 0, bubbles: true }));
      });

      const dragEvent = new window.Event("dragstart", { bubbles: true }) as any;
      dragEvent.dataTransfer = { setData: () => {}, getData: () => "0", effectAllowed: "none" };
      await act(async () => {
        rows[0].dispatchEvent(dragEvent);
      });

      // Drop on row 0 (self)
      const dropEvent = new window.Event("drop", { bubbles: true }) as any;
      dropEvent.preventDefault = () => {};
      dropEvent.stopPropagation = () => {};
      dropEvent.dataTransfer = { getData: () => "0" };
      await act(async () => {
        rows[0].dispatchEvent(dropEvent);
      });

      expect(reorderSpy).toHaveBeenCalledTimes(0);
    } finally {
      usePlayerStore.setState({ reorderPlaylist: originalReorder });
    }
  });

  it("safely ignores ArrowUp on top item and ArrowDown on bottom item", async () => {
    const originalReorder = usePlayerStore.getState().reorderPlaylist;
    const reorderSpy = mock((_plId: string, _itemIds: string[]) => Promise.resolve(true));
    try {
      await act(async () => {
        usePlayerStore.setState({
          activePlaylistId: "pl_custom_1",
          activePlaylistItems: [dummyPlaylistItem1, dummyPlaylistItem2],
          playlists: [dummyPlaylist],
          reorderPlaylist: reorderSpy as any,
        });
        root.render(<PlaylistTableView />);
      });

      const dragHandles = container.querySelectorAll('[data-drag-handle="true"]');

      // ArrowUp on top item (index 0)
      await act(async () => {
        dragHandles[0].dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
      });
      // ArrowDown on bottom item (index 1)
      await act(async () => {
        dragHandles[1].dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
      });

      expect(reorderSpy).toHaveBeenCalledTimes(0);
    } finally {
      usePlayerStore.setState({ reorderPlaylist: originalReorder });
    }
  });

  it("suppresses row onClick playback immediately following a drop", async () => {
    const originalReorder = usePlayerStore.getState().reorderPlaylist;
    const originalPlay = usePlayerStore.getState().playPlaylistItemAtIndex;
    const reorderSpy = mock((_plId: string, _itemIds: string[]) => Promise.resolve(true));
    const playSpy = mock((..._args: any[]) => {});

    try {
      await act(async () => {
        usePlayerStore.setState({
          activePlaylistId: "pl_custom_1",
          activePlaylistItems: [dummyPlaylistItem1, dummyPlaylistItem2],
          playlists: [dummyPlaylist],
          reorderPlaylist: reorderSpy as any,
          playPlaylistItemAtIndex: playSpy as any,
        });
        root.render(<PlaylistTableView />);
      });

      const rows = container.querySelectorAll(".group[role='row']");
      const dragHandles = container.querySelectorAll('[data-drag-handle="true"]');

      await act(async () => {
        dragHandles[0].dispatchEvent(new window.PointerEvent("pointerdown", { button: 0, bubbles: true }));
      });

      const dragEvent = new window.Event("dragstart", { bubbles: true }) as any;
      dragEvent.dataTransfer = { setData: () => {}, getData: () => "0", effectAllowed: "none" };
      await act(async () => {
        rows[0].dispatchEvent(dragEvent);
      });

      const dropEvent = new window.Event("drop", { bubbles: true }) as any;
      dropEvent.preventDefault = () => {};
      dropEvent.stopPropagation = () => {};
      dropEvent.dataTransfer = { getData: () => "0" };
      await act(async () => {
        rows[1].dispatchEvent(dropEvent);
      });

      // Immediate synthetic click on row 1
      await act(async () => {
        rows[1].dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      });

      expect(reorderSpy).toHaveBeenCalledTimes(1);
      expect(playSpy).toHaveBeenCalledTimes(0);
    } finally {
      usePlayerStore.setState({
        reorderPlaylist: originalReorder,
        playPlaylistItemAtIndex: originalPlay,
      });
    }
  });

  describe("PlaylistTableView - Mixed Mode (Trộn cả 2)", () => {
    it("renders empty state when mixedItems is empty", async () => {
      await act(async () => {
        usePlayerStore.setState({
          activePlaylistId: null,
          activeSystemCategory: "mixed",
        });
        root.render(<PlaylistTableView mixedItems={[]} />);
      });

      expect(container.textContent).toMatch(/No tracks or slices found|Không có bài hát hoặc lát cắt nào/);
      expect(container.textContent).toMatch(/No items matched your search query|Chưa có mục nào phù hợp với bộ lọc tìm kiếm/);
    });

    it("triggers playSegmentInMode with full track when clicking track row, and with segment when clicking slice row", async () => {
      const playSegmentInModeSpy = mock((..._args: any[]) => {});
      usePlayerStore.setState({
        activePlaylistId: null,
        activeSystemCategory: "mixed",
        playbackMode: "mixed",
        playSegmentInMode: playSegmentInModeSpy as any,
      });

      const mixedItems: MixedItem[] = [
        {
          type: "track",
          id: "track_trk_tbl_1",
          track: dummyTrack,
          createdAt: 1000,
        },
        {
          type: "slice",
          id: "slice_seg_tbl_1",
          track: dummyTrack,
          segment: dummySegment,
          createdAt: 1001,
        },
      ];

      await act(async () => {
        root.render(<PlaylistTableView mixedItems={mixedItems} />);
      });

      const rows = container.querySelectorAll(".group[role='row']");
      expect(rows.length).toBe(2);

      // Click track row
      await act(async () => {
        rows[0].dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      });
      expect(playSegmentInModeSpy).toHaveBeenCalledTimes(1);
      const firstCallArgs = (playSegmentInModeSpy.mock.calls as any)[0];
      expect(firstCallArgs[0]).toBe("mixed");
      expect(firstCallArgs[1].id).toBe("fallback_trk_tbl_1");
      expect(firstCallArgs[2].id).toBe("trk_tbl_1");

      // Click slice row
      await act(async () => {
        rows[1].dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      });
      expect(playSegmentInModeSpy).toHaveBeenCalledTimes(2);
      const secondCallArgs = (playSegmentInModeSpy.mock.calls as any)[1];
      expect(secondCallArgs[0]).toBe("mixed");
      expect(secondCallArgs[1].id).toBe("seg_tbl_1");
      expect(secondCallArgs[2].id).toBe("trk_tbl_1");
    });

    it("handles keyboard Enter to play an item", async () => {
      const playSegmentInModeSpy = mock((..._args: any[]) => {});
      usePlayerStore.setState({
        activePlaylistId: null,
        activeSystemCategory: "mixed",
        playSegmentInMode: playSegmentInModeSpy as any,
      });

      await act(async () => {
        root.render(
          <PlaylistTableView
            mixedItems={[
              {
                type: "slice",
                id: "slice_seg_tbl_1",
                track: dummyTrack,
                segment: dummySegment,
              },
            ]}
          />
        );
      });

      const row = container.querySelector(".group[role='row']");
      expect(row).not.toBeNull();

      await act(async () => {
        row!.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      });

      expect(playSegmentInModeSpy).toHaveBeenCalledTimes(1);
    });

    it("renders delete button for track item and calls onDeleteTrack, but does not render delete for slice item", async () => {
      const onDeleteSpy = mock(() => {});
      await act(async () => {
        usePlayerStore.setState({
          activePlaylistId: null,
          activeSystemCategory: "mixed",
        });
        root.render(
          <PlaylistTableView
            mixedItems={[
              {
                type: "track",
                id: "track_trk_tbl_1",
                track: dummyTrack,
              },
              {
                type: "slice",
                id: "slice_seg_tbl_1",
                track: dummyTrack,
                segment: dummySegment,
              },
            ]}
            onDeleteTrack={onDeleteSpy}
          />
        );
      });

      const deleteButtons = container.querySelectorAll("button[title='Delete Track'], button[title='Delete track'], button[title='Xóa bài hát']");
      expect(deleteButtons.length).toBe(1);

      await act(async () => {
        deleteButtons[0].dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      });

      expect(onDeleteSpy).toHaveBeenCalledWith("trk_tbl_1");
    });

    it("renders slice delete button and calls onDeleteSlice in mixedItems view", async () => {
      const onDeleteSliceSpy = mock(() => {});
      await act(async () => {
        usePlayerStore.setState({
          activePlaylistId: null,
          activeSystemCategory: "mixed",
        });
        root.render(
          <PlaylistTableView
            mixedItems={[
              {
                type: "slice",
                id: "slice_seg_tbl_1",
                track: dummyTrack,
                segment: dummySegment,
              },
            ]}
            onDeleteSlice={onDeleteSliceSpy}
          />
        );
      });

      const sliceDeleteBtn = container.querySelector("button[title='Delete slice'], button[title='Xóa lát cắt']");
      expect(sliceDeleteBtn).not.toBeNull();

      await act(async () => {
        sliceDeleteBtn!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      });

      expect(onDeleteSliceSpy).toHaveBeenCalledWith(dummySegment.id);
    });

    it("renders slice delete button and calls onDeleteSlice in sliceItems view", async () => {
      const onDeleteSliceSpy = mock(() => {});
      await act(async () => {
        usePlayerStore.setState({
          activePlaylistId: null,
          activeSystemCategory: "slices_only",
        });
        root.render(
          <PlaylistTableView
            sliceItems={[
              {
                id: "seg_tbl_1",
                track: dummyTrack,
                segment: dummySegment,
              },
            ]}
            onDeleteSlice={onDeleteSliceSpy}
          />
        );
      });

      const sliceDeleteBtn = container.querySelector("button[title='Delete slice'], button[title='Xóa lát cắt']");
      expect(sliceDeleteBtn).not.toBeNull();

      await act(async () => {
        sliceDeleteBtn!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      });

      expect(onDeleteSliceSpy).toHaveBeenCalledWith(dummySegment.id);
    });

    it("omits slice delete button in sliceItems view when onDeleteSlice is not provided", async () => {
      await act(async () => {
        usePlayerStore.setState({
          activePlaylistId: null,
          activeSystemCategory: "slices_only",
        });
        root.render(
          <PlaylistTableView
            sliceItems={[
              {
                id: "seg_tbl_1",
                track: dummyTrack,
                segment: dummySegment,
              },
            ]}
          />
        );
      });

      const sliceDeleteBtn = container.querySelector("button[title='Delete slice'], button[title='Xóa lát cắt']");
      expect(sliceDeleteBtn).toBeNull();
    });

    it("highlights currently playing slice item vs playing track item", async () => {
      // 1. Slice is currently playing
      await act(async () => {
        usePlayerStore.setState({
          activePlaylistId: null,
          activeSystemCategory: "mixed",
          isPlaying: true,
          activeTrack: dummyTrack,
          activeSegment: dummySegment,
        });
        root.render(
          <PlaylistTableView
            mixedItems={[
              {
                type: "track",
                id: "track_trk_tbl_1",
                track: dummyTrack,
              },
              {
                type: "slice",
                id: "slice_seg_tbl_1",
                track: dummyTrack,
                segment: dummySegment,
              },
            ]}
          />
        );
      });

      const rows = container.querySelectorAll(".group[role='row']");
      // Row 0 is track (not active segment) -> should NOT have active border
      expect(rows[0].className).not.toContain("border-primary/50");
      // Row 1 is slice (matches activeSegment.id) -> SHOULD have active border
      expect(rows[1].className).toContain("border-primary/50");

      // 2. Track is currently playing (fallback segment)
      await act(async () => {
        usePlayerStore.setState({
          activeSegment: { ...dummySegment, id: "fallback_trk_tbl_1" },
        });
        root.render(
          <PlaylistTableView
            mixedItems={[
              {
                type: "track",
                id: "track_trk_tbl_1",
                track: dummyTrack,
              },
              {
                type: "slice",
                id: "slice_seg_tbl_1",
                track: dummyTrack,
                segment: dummySegment,
              },
            ]}
          />
        );
      });

      const updatedRows = container.querySelectorAll(".group[role='row']");
      // Row 0 is track -> now SHOULD have active border
      expect(updatedRows[0].className).toContain("border-primary/50");
      // Row 1 is slice -> should NOT have active border
      expect(updatedRows[1].className).not.toContain("border-primary/50");
    });
  });

  describe("PlaylistTableView - Error Tracks (Bài lỗi)", () => {
    const errorTrack: Track = {
      id: "trk_err_1",
      source_type: "youtube",
      source_uri: "https://youtube.com/watch?v=err1",
      title: "Error YouTube Song",
      artist: "Blocked Channel",
      duration: 0,
      status: "error",
      error_message: "Sign in to confirm you're not a bot",
      volume: 0.5,
    };

    it("renders error track with 'Lỗi tải' badge and 'Thử lại' button", async () => {
      await act(async () => {
        root.render(
          <PlaylistTableView
            filteredTracks={[errorTrack]}
            onDeleteTrack={() => {}}
          />
        );
      });

      const text = container.textContent || "";
      expect(text).toContain("Error YouTube Song");
      expect(text).toContain("Blocked Channel");
      expect(text).toMatch(/Error|Lỗi tải/);
      expect(text).toMatch(/Retry|Thử lại/);

      const retryBtn = container.querySelector("button[title='Retry'], button[title='Thử tải lại bài hát'], button[title='Thử lại']");
      expect(retryBtn).not.toBeNull();
    });

    it("clicking retry button calls /api/tracks/:id/retry endpoint", async () => {
      let retryUrl = "";
      const origFetch = globalThis.fetch;
      globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = String(url);
        if (urlStr.includes("/retry") && init?.method === "POST") {
          retryUrl = urlStr;
          return new Response(JSON.stringify({ success: true }), { status: 200 });
        }
        return new Response("{}", { status: 200 });
      }) as any;

      try {
        await act(async () => {
          root.render(
            <PlaylistTableView
              filteredTracks={[errorTrack]}
              onDeleteTrack={() => {}}
            />
          );
        });

        const retryBtn = container.querySelector("button[title='Retry'], button[title='Thử tải lại bài hát'], button[title='Thử lại']");
        expect(retryBtn).not.toBeNull();

        await act(async () => {
          retryBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
        });

        expect(retryUrl).toBe("/api/tracks/trk_err_1/retry");
      } finally {
        globalThis.fetch = origFetch;
      }
    });

    it("clicking row of an error track does NOT play it because track is not ready", async () => {
      let playCalled = false;
      usePlayerStore.setState({
        activeSystemCategory: "error_only",
        playSegmentInMode: async () => {
          playCalled = true;
        },
      });

      await act(async () => {
        root.render(
          <PlaylistTableView
            filteredTracks={[errorTrack]}
            onDeleteTrack={() => {}}
          />
        );
      });

      const row = container.querySelector(".group[role='row']");
      expect(row).not.toBeNull();

      await act(async () => {
        row.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      });

      expect(playCalled).toBe(false);
    });
  });

  it("renders AddToPlaylist button in custom playlist rows", async () => {
    await act(async () => {
      usePlayerStore.setState({
        activePlaylistId: "pl_custom_1",
        activePlaylistItems: [dummyPlaylistItem1],
        playlists: [dummyPlaylist],
      });
      root.render(<PlaylistTableView />);
    });

    const addButtons = container.querySelectorAll("button[title='Thêm vào danh sách'], button[title='Add to Playlist']");
    expect(addButtons.length).toBe(1);
  });

  it("toggles track selection when clicking row in selection mode without playing", async () => {
    let playCalled = false;
    useSelectionStore.getState().clearSelection();
    useSelectionStore.getState().selectTracks(["other_track"]);
    try {
      usePlayerStore.setState({
        activeSystemCategory: "mixed",
        playSegmentInMode: async () => {
          playCalled = true;
        },
      });

      await act(async () => {
        root.render(
          <PlaylistTableView
            filteredTracks={[dummyTrack]}
            onDeleteTrack={() => {}}
          />
        );
      });

      expect(useSelectionStore.getState().selectedTrackIds.size).toBe(1);
      expect(useSelectionStore.getState().selectedTrackIds.has(dummyTrack.id)).toBe(false);

      const row = container.querySelector(".group[role='row']");
      expect(row).not.toBeNull();

      await act(async () => {
        row.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      });

      expect(useSelectionStore.getState().selectedTrackIds.has(dummyTrack.id)).toBe(true);
      expect(useSelectionStore.getState().selectedTrackIds.size).toBe(2);
      expect(playCalled).toBe(false);
    } finally {
      usePlayerStore.setState({
        playSegmentInMode: origPlaySegmentInMode,
      });
      useSelectionStore.getState().clearSelection();
    }
  });

  it("toggles playlist item selection when clicking custom playlist row in selection mode", async () => {
    let playCalled = false;
    useSelectionStore.getState().clearSelection();
    useSelectionStore.getState().selectTracks(["other_item"]);
    try {
      usePlayerStore.setState({
        activePlaylistId: "pl_custom_1",
        activePlaylistItems: [dummyPlaylistItem1],
        playlists: [dummyPlaylist],
        playPlaylistItemAtIndex: async () => {
          playCalled = true;
        },
      });

      await act(async () => {
        root.render(<PlaylistTableView />);
      });

      expect(useSelectionStore.getState().selectedTrackIds.size).toBe(1);
      expect(useSelectionStore.getState().selectedTrackIds.has(dummyPlaylistItem1.id)).toBe(false);

      const row = container.querySelector(".group[role='row']");
      expect(row).not.toBeNull();

      await act(async () => {
        row.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      });

      expect(useSelectionStore.getState().selectedTrackIds.has(dummyPlaylistItem1.id)).toBe(true);
      expect(useSelectionStore.getState().selectedTrackIds.size).toBe(2);
      expect(playCalled).toBe(false);
    } finally {
      usePlayerStore.setState({
        playPlaylistItemAtIndex: origPlayPlaylistItemAtIndex,
      });
      useSelectionStore.getState().clearSelection();
    }
  });

  describe("Toggle play/pause and rapid spam prevention in Table View", () => {
    it("in custom playlist view, toggles pause when clicked while active and playing", async () => {
      const pauseSpy = mock(() => {});
      const resumeSpy = mock(async () => {});
      const playAtIndexSpy = mock(async () => {});

      usePlayerStore.setState({
        activePlaylistId: "pl_custom_1",
        activePlaylistPlayingId: "pl_custom_1",
        activePlaylistItems: [dummyPlaylistItem1],
        queue: [
          {
            queueItemId: dummyPlaylistItem1.id,
            segment: dummySegment,
            track: dummyTrack,
          },
        ],
        queueIndex: 0,
        activeTrack: dummyTrack,
        activeSegment: dummySegment,
        isPlaying: true,
        pause: pauseSpy,
        resume: resumeSpy,
        playPlaylistItemAtIndex: playAtIndexSpy,
      });

      await act(async () => {
        root.render(<PlaylistTableView />);
      });

      const row = container.querySelector(".group[role='row']");
      expect(row).not.toBeNull();

      // Click playing active row -> calls pause
      await act(async () => {
        row!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      });

      expect(pauseSpy).toHaveBeenCalledTimes(1);
      expect(resumeSpy).not.toHaveBeenCalled();
      expect(playAtIndexSpy).not.toHaveBeenCalled();
    });

    it("in custom playlist view, toggles resume when clicked while active and paused", async () => {
      const pauseSpy = mock(() => {});
      const resumeSpy = mock(async () => {});
      const playAtIndexSpy = mock(async () => {});

      usePlayerStore.setState({
        activePlaylistId: "pl_custom_1",
        activePlaylistPlayingId: "pl_custom_1",
        activePlaylistItems: [dummyPlaylistItem1],
        queue: [
          {
            queueItemId: dummyPlaylistItem1.id,
            segment: dummySegment,
            track: dummyTrack,
          },
        ],
        queueIndex: 0,
        activeTrack: dummyTrack,
        activeSegment: dummySegment,
        isPlaying: false,
        pause: pauseSpy,
        resume: resumeSpy,
        playPlaylistItemAtIndex: playAtIndexSpy,
      });

      await act(async () => {
        root.render(<PlaylistTableView />);
      });

      const row = container.querySelector(".group[role='row']");
      expect(row).not.toBeNull();

      // Click paused active row -> calls resume
      await act(async () => {
        row!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      });

      expect(resumeSpy).toHaveBeenCalledTimes(1);
      expect(pauseSpy).not.toHaveBeenCalled();
      expect(playAtIndexSpy).not.toHaveBeenCalled();
    });

    it("in track list view, toggles pause when active track is clicked while playing, and resume when paused", async () => {
      const pauseSpy = mock(() => {});
      const resumeSpy = mock(async () => {});
      const playSegmentInModeSpy = mock(async () => {});

      usePlayerStore.setState({
        activePlaylistId: null,
        activeTrack: dummyTrack,
        activeSegment: null,
        isPlaying: true,
        pause: pauseSpy,
        resume: resumeSpy,
        playSegmentInMode: playSegmentInModeSpy as any,
      });

      await act(async () => {
        root.render(<PlaylistTableView filteredTracks={[dummyTrack]} />);
      });

      const row = container.querySelector(".group[role='row']");
      expect(row).not.toBeNull();

      // Click active playing track -> pause
      await act(async () => {
        row!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      });

      expect(pauseSpy).toHaveBeenCalledTimes(1);
      expect(playSegmentInModeSpy).not.toHaveBeenCalled();

      // Set to paused and click again
      await act(async () => {
        usePlayerStore.setState({ isPlaying: false });
      });
      await new Promise((r) => setTimeout(r, 350));

      await act(async () => {
        row!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      });

      expect(resumeSpy).toHaveBeenCalledTimes(1);
      expect(playSegmentInModeSpy).not.toHaveBeenCalled();
    });

    it("in slices view, toggles pause when active slice is clicked while playing, and resume when paused", async () => {
      const pauseSpy = mock(() => {});
      const resumeSpy = mock(async () => {});
      const playSegmentInModeSpy = mock(async () => {});

      usePlayerStore.setState({
        activePlaylistId: null,
        activeTrack: dummyTrack,
        activeSegment: dummySegment,
        isPlaying: true,
        pause: pauseSpy,
        resume: resumeSpy,
        playSegmentInMode: playSegmentInModeSpy as any,
      });

      await act(async () => {
        root.render(
          <PlaylistTableView
            sliceItems={[
              {
                id: dummySegment.id,
                track: dummyTrack,
                segment: dummySegment,
              },
            ]}
          />
        );
      });

      const row = container.querySelector(".group[role='row']");
      expect(row).not.toBeNull();

      // Click active playing slice -> pause
      await act(async () => {
        row!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      });

      expect(pauseSpy).toHaveBeenCalledTimes(1);
      expect(playSegmentInModeSpy).not.toHaveBeenCalled();

      // Set to paused and click again
      await act(async () => {
        usePlayerStore.setState({ isPlaying: false });
      });
      await new Promise((r) => setTimeout(r, 350));

      await act(async () => {
        row!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      });

      expect(resumeSpy).toHaveBeenCalledTimes(1);
      expect(playSegmentInModeSpy).not.toHaveBeenCalled();
    });

    it("in mixed view, toggles pause when active item is clicked while playing, and resume when paused", async () => {
      const pauseSpy = mock(() => {});
      const resumeSpy = mock(async () => {});
      const playSegmentInModeSpy = mock(async () => {});

      usePlayerStore.setState({
        activePlaylistId: null,
        activeTrack: dummyTrack,
        activeSegment: dummySegment,
        isPlaying: true,
        pause: pauseSpy,
        resume: resumeSpy,
        playSegmentInMode: playSegmentInModeSpy as any,
      });

      await act(async () => {
        root.render(
          <PlaylistTableView
            mixedItems={[
              {
                type: "slice",
                id: "slice_seg_tbl_1",
                track: dummyTrack,
                segment: dummySegment,
              },
            ]}
          />
        );
      });

      const row = container.querySelector(".group[role='row']");
      expect(row).not.toBeNull();

      // Click active playing item -> pause
      await act(async () => {
        row!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      });

      expect(pauseSpy).toHaveBeenCalledTimes(1);
      expect(playSegmentInModeSpy).not.toHaveBeenCalled();

      // Set to paused and click again
      await act(async () => {
        usePlayerStore.setState({ isPlaying: false });
      });
      await new Promise((r) => setTimeout(r, 350));

      await act(async () => {
        row!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      });

      expect(resumeSpy).toHaveBeenCalledTimes(1);
      expect(playSegmentInModeSpy).not.toHaveBeenCalled();
    });

    it("debounces rapid spam clicks on the same row", async () => {
      const playSegmentInModeSpy = mock(async () => {});

      usePlayerStore.setState({
        activePlaylistId: null,
        activeTrack: null,
        activeSegment: null,
        isPlaying: false,
        playSegmentInMode: playSegmentInModeSpy as any,
      });

      await act(async () => {
        root.render(<PlaylistTableView filteredTracks={[dummyTrack]} />);
      });

      const row = container.querySelector(".group[role='row']");
      expect(row).not.toBeNull();

      // Fire 3 rapid clicks with no delay
      await act(async () => {
        row!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
        row!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
        row!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      });

      // Only the first click goes through
      expect(playSegmentInModeSpy).toHaveBeenCalledTimes(1);
    });

    it("renders animated equalizer bars when active row is playing", async () => {
      usePlayerStore.setState({
        activePlaylistId: null,
        activeTrack: dummyTrack,
        activeSegment: null,
        isPlaying: true,
      });

      await act(async () => {
        root.render(<PlaylistTableView filteredTracks={[dummyTrack]} />);
      });

      const equalizerBars = container.querySelectorAll(".animate-eq-1, .animate-eq-2, .animate-eq-3");
      expect(equalizerBars.length).toBe(3);
    });
  });

  describe("Table View Drag and Drop Auto-scroll & Boundary Drops", () => {
    const originalReorder = usePlayerStore.getState().reorderPlaylist;
    let scrollToSpy: any;
    let mockScrollY = 1000;

    beforeEach(() => {
      mockScrollY = 1000;
      Object.defineProperty(window, "innerHeight", {
        value: 800,
        writable: true,
        configurable: true,
      });
      Object.defineProperty(window, "scrollY", {
        get: () => mockScrollY,
        set: (v) => {
          mockScrollY = v;
        },
        configurable: true,
      });
      Object.defineProperty(window, "pageYOffset", {
        get: () => mockScrollY,
        set: (v) => {
          mockScrollY = v;
        },
        configurable: true,
      });
      if (window.document?.documentElement) {
        Object.defineProperty(window.document.documentElement, "scrollTop", {
          get: () => mockScrollY,
          set: (v) => {
            mockScrollY = v;
          },
          configurable: true,
        });
        Object.defineProperty(window.document.documentElement, "scrollHeight", {
          value: 6000,
          writable: true,
          configurable: true,
        });
      }
      scrollToSpy = mock((x: any, y?: any) => {
        if (typeof x === "object" && x !== null) {
          mockScrollY = x.top ?? mockScrollY;
        } else if (typeof y === "number") {
          mockScrollY = y;
        }
      });
      window.scrollTo = scrollToSpy;
    });

    afterEach(() => {
      usePlayerStore.setState({ reorderPlaylist: originalReorder });
    });

    it("triggers auto-scroll up when dragging near top of viewport", async () => {
      const reorderSpy = mock((_plId: string, _itemIds: string[]) => Promise.resolve(true));
      usePlayerStore.setState({
        activePlaylistId: "pl_custom_1",
        activePlaylistItems: [dummyPlaylistItem1, dummyPlaylistItem2],
        playlists: [dummyPlaylist],
        reorderPlaylist: reorderSpy as any,
      });

      await act(async () => {
        root.render(<PlaylistTableView />);
      });

      const dragHandles = container.querySelectorAll('[data-drag-handle="true"]');
      const rows = container.querySelectorAll(".group[role='row']");

      // 1. Pointerdown on drag handle
      await act(async () => {
        dragHandles[0].dispatchEvent(new window.PointerEvent("pointerdown", { button: 0, bubbles: true }));
      });

      // 2. DragStart on row
      const dragEvent = new window.Event("dragstart", { bubbles: true }) as any;
      dragEvent.dataTransfer = {
        setData: () => {},
        getData: () => "0",
        effectAllowed: "none",
      };
      await act(async () => {
        rows[0].dispatchEvent(dragEvent);
      });

      // 3. DragOver near top of window (clientY = 30px, in topZone 120px)
      const topDragOver = new window.Event("dragover", { bubbles: true }) as any;
      topDragOver.clientY = 30;
      topDragOver.preventDefault = () => {};
      topDragOver.dataTransfer = { dropEffect: "none" };

      await act(async () => {
        window.dispatchEvent(topDragOver);
      });

      // Wait a tick for requestAnimationFrame
      await new Promise((r) => setTimeout(r, 60));

      expect(scrollToSpy).toHaveBeenCalled();
      // Y position should have decreased (scrolling up from 1000)
      const numericCalls = scrollToSpy.mock.calls
        .map((call: any[]) => (typeof call[0] === "object" ? call[0].top : call[1]))
        .filter((y: any) => typeof y === "number");
      const lastCallY = numericCalls[numericCalls.length - 1];
      expect(typeof lastCallY).toBe("number");
      expect(lastCallY).toBeLessThan(1000);

      // Clean up drag state
      await act(async () => {
        window.dispatchEvent(new window.Event("dragend", { bubbles: true }));
      });
    });

    it("triggers auto-scroll down when dragging near bottom of viewport", async () => {
      mockScrollY = 500;
      const reorderSpy = mock((_plId: string, _itemIds: string[]) => Promise.resolve(true));
      usePlayerStore.setState({
        activePlaylistId: "pl_custom_1",
        activePlaylistItems: [dummyPlaylistItem1, dummyPlaylistItem2],
        playlists: [dummyPlaylist],
        reorderPlaylist: reorderSpy as any,
      });

      await act(async () => {
        root.render(<PlaylistTableView />);
      });

      const dragHandles = container.querySelectorAll('[data-drag-handle="true"]');
      const rows = container.querySelectorAll(".group[role='row']");

      // Pointerdown on drag handle
      await act(async () => {
        dragHandles[0].dispatchEvent(new window.PointerEvent("pointerdown", { button: 0, bubbles: true }));
      });

      // DragStart on row
      const dragEvent = new window.Event("dragstart", { bubbles: true }) as any;
      dragEvent.dataTransfer = {
        setData: () => {},
        getData: () => "0",
        effectAllowed: "none",
      };
      await act(async () => {
        rows[0].dispatchEvent(dragEvent);
      });

      // DragOver near bottom of window (clientY = 750px, in bottomZone > 800 - 140 = 660px)
      const bottomDragOver = new window.Event("dragover", { bubbles: true }) as any;
      bottomDragOver.clientY = 750;
      bottomDragOver.preventDefault = () => {};
      bottomDragOver.dataTransfer = { dropEffect: "none" };

      await act(async () => {
        window.dispatchEvent(bottomDragOver);
      });

      // Wait a tick for requestAnimationFrame
      await new Promise((r) => setTimeout(r, 60));

      expect(scrollToSpy).toHaveBeenCalled();
      // Y position should have increased (scrolling down from 500)
      const numericCalls = scrollToSpy.mock.calls
        .map((call: any[]) => (typeof call[0] === "object" ? call[0].top : call[1]))
        .filter((y: any) => typeof y === "number");
      const lastCallY = numericCalls[numericCalls.length - 1];
      expect(typeof lastCallY).toBe("number");
      expect(lastCallY).toBeGreaterThan(500);

      // Clean up drag state
      await act(async () => {
        window.dispatchEvent(new window.Event("dragend", { bubbles: true }));
      });
    });

    it("stops auto-scroll when moving cursor back to center zone", async () => {
      mockScrollY = 500;
      const reorderSpy = mock((_plId: string, _itemIds: string[]) => Promise.resolve(true));
      usePlayerStore.setState({
        activePlaylistId: "pl_custom_1",
        activePlaylistItems: [dummyPlaylistItem1, dummyPlaylistItem2],
        playlists: [dummyPlaylist],
        reorderPlaylist: reorderSpy as any,
      });

      await act(async () => {
        root.render(<PlaylistTableView />);
      });

      const dragHandles = container.querySelectorAll('[data-drag-handle="true"]');
      const rows = container.querySelectorAll(".group[role='row']");

      await act(async () => {
        dragHandles[0].dispatchEvent(new window.PointerEvent("pointerdown", { button: 0, bubbles: true }));
      });

      const dragEvent = new window.Event("dragstart", { bubbles: true }) as any;
      dragEvent.dataTransfer = { setData: () => {}, getData: () => "0", effectAllowed: "none" };
      await act(async () => {
        rows[0].dispatchEvent(dragEvent);
      });

      // Move to top zone
      const topDragOver = new window.Event("dragover", { bubbles: true }) as any;
      topDragOver.clientY = 20;
      topDragOver.preventDefault = () => {};
      topDragOver.dataTransfer = { dropEffect: "none" };
      await act(async () => {
        window.dispatchEvent(topDragOver);
      });
      await new Promise((r) => setTimeout(r, 30));

      const callsBeforeCenter = scrollToSpy.mock.calls.length;

      // Move to center zone (clientY = 400, outside top and bottom zones)
      const centerDragOver = new window.Event("dragover", { bubbles: true }) as any;
      centerDragOver.clientY = 400;
      centerDragOver.preventDefault = () => {};
      centerDragOver.dataTransfer = { dropEffect: "none" };
      await act(async () => {
        window.dispatchEvent(centerDragOver);
      });
      await new Promise((r) => setTimeout(r, 60));

      // Auto-scroll should have stopped (calls count stays same or +1 before loop ended)
      const callsAfterCenter = scrollToSpy.mock.calls.length;
      expect(callsAfterCenter - callsBeforeCenter).toBeLessThanOrEqual(1);

      await act(async () => {
        window.dispatchEvent(new window.Event("dragend", { bubbles: true }));
      });
    });

    it("dropping on the table header reorders dragged item to position 0", async () => {
      const reorderSpy = mock((_plId: string, _itemIds: string[]) => Promise.resolve(true));
      usePlayerStore.setState({
        activePlaylistId: "pl_custom_1",
        activePlaylistItems: [dummyPlaylistItem1, dummyPlaylistItem2],
        playlists: [dummyPlaylist],
        reorderPlaylist: reorderSpy as any,
      });

      await act(async () => {
        root.render(<PlaylistTableView />);
      });

      const dragHandles = container.querySelectorAll('[data-drag-handle="true"]');
      const rows = container.querySelectorAll(".group[role='row']");
      const header = container.querySelector("[role='row'][aria-rowindex='1']");
      expect(header).not.toBeNull();

      // Start drag from row 1 (second item)
      await act(async () => {
        dragHandles[1].dispatchEvent(new window.PointerEvent("pointerdown", { button: 0, bubbles: true }));
      });

      const dataStore: Record<string, string> = {};
      const dragEvent = new window.Event("dragstart", { bubbles: true }) as any;
      dragEvent.dataTransfer = {
        setData: (k: string, v: string) => {
          dataStore[k] = v;
        },
        getData: (k: string) => dataStore[k] || "",
        effectAllowed: "none",
      };
      await act(async () => {
        rows[1].dispatchEvent(dragEvent);
      });

      expect(dataStore["application/x-slice-playlist-index"]).toBe("1");

      // DragOver the header
      const dragOverHeader = new window.Event("dragover", { bubbles: true }) as any;
      dragOverHeader.clientY = 50;
      dragOverHeader.preventDefault = () => {};
      dragOverHeader.dataTransfer = { dropEffect: "none" };
      await act(async () => {
        header!.dispatchEvent(dragOverHeader);
      });

      // Drop on the header
      const dropEvent = new window.Event("drop", { bubbles: true }) as any;
      dropEvent.preventDefault = () => {};
      dropEvent.stopPropagation = () => {};
      dropEvent.dataTransfer = {
        getData: (k: string) => dataStore[k] || "",
      };
      await act(async () => {
        header!.dispatchEvent(dropEvent);
      });

      expect(reorderSpy).toHaveBeenCalledTimes(1);
      // Item 2 was dragged to index 0 -> ["item_2", "item_1"]
      expect(reorderSpy).toHaveBeenCalledWith("pl_custom_1", ["item_2", "item_1"]);
    });

    it("stops auto-scroll immediately when Escape key is pressed", async () => {
      const reorderSpy = mock((_plId: string, _itemIds: string[]) => Promise.resolve(true));
      usePlayerStore.setState({
        activePlaylistId: "pl_custom_1",
        activePlaylistItems: [dummyPlaylistItem1, dummyPlaylistItem2],
        playlists: [dummyPlaylist],
        reorderPlaylist: reorderSpy as any,
      });

      await act(async () => {
        root.render(<PlaylistTableView />);
      });

      const dragHandles = container.querySelectorAll('[data-drag-handle="true"]');
      const rows = container.querySelectorAll(".group[role='row']");

      await act(async () => {
        dragHandles[0].dispatchEvent(new window.PointerEvent("pointerdown", { button: 0, bubbles: true }));
      });

      const dragEvent = new window.Event("dragstart", { bubbles: true }) as any;
      dragEvent.dataTransfer = { setData: () => {}, getData: () => "0", effectAllowed: "none" };
      await act(async () => {
        rows[0].dispatchEvent(dragEvent);
      });

      // Start autoscroll
      const topDragOver = new window.Event("dragover", { bubbles: true }) as any;
      topDragOver.clientY = 10;
      topDragOver.preventDefault = () => {};
      topDragOver.dataTransfer = { dropEffect: "none" };
      await act(async () => {
        window.dispatchEvent(topDragOver);
      });

      // Press Escape
      await act(async () => {
        window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      });
      await new Promise((r) => setTimeout(r, 60));

      const callsAfterEscape = scrollToSpy.mock.calls.length;
      await new Promise((r) => setTimeout(r, 60));
      expect(scrollToSpy.mock.calls.length).toBe(callsAfterEscape);
      expect(reorderSpy).not.toHaveBeenCalled();
    });

    it("maintains auto-scroll loop continuously when dragOverIdx changes between rows", async () => {
      const reorderSpy = mock((_plId: string, _itemIds: string[]) => Promise.resolve(true));
      usePlayerStore.setState({
        activePlaylistId: "pl_custom_1",
        activePlaylistItems: [dummyPlaylistItem1, dummyPlaylistItem2],
        playlists: [dummyPlaylist],
        reorderPlaylist: reorderSpy as any,
      });

      await act(async () => {
        root.render(<PlaylistTableView />);
      });

      const dragHandles = container.querySelectorAll('[data-drag-handle="true"]');
      const rows = container.querySelectorAll(".group[role='row']");

      // Start drag on row 0
      await act(async () => {
        dragHandles[0].dispatchEvent(new window.PointerEvent("pointerdown", { button: 0, bubbles: true }));
      });

      const dragEvent = new window.Event("dragstart", { bubbles: true }) as any;
      dragEvent.dataTransfer = { setData: () => {}, getData: () => "0", effectAllowed: "none" };
      await act(async () => {
        rows[0].dispatchEvent(dragEvent);
      });

      // Trigger autoscroll down
      const bottomDragOver = new window.Event("dragover", { bubbles: true }) as any;
      bottomDragOver.clientY = 750;
      bottomDragOver.preventDefault = () => {};
      bottomDragOver.dataTransfer = { dropEffect: "none" };
      await act(async () => {
        window.dispatchEvent(bottomDragOver);
      });
      await new Promise((r) => setTimeout(r, 30));

      const callsBefore = scrollToSpy.mock.calls.length;
      expect(callsBefore).toBeGreaterThan(0);

      // Now fire dragOver on row 1 (this updates dragOverIdx)
      const rowDragOver = new window.Event("dragover", { bubbles: true }) as any;
      rowDragOver.clientY = 750;
      rowDragOver.preventDefault = () => {};
      rowDragOver.dataTransfer = { dropEffect: "none" };
      await act(async () => {
        rows[1].dispatchEvent(rowDragOver);
      });
      await new Promise((r) => setTimeout(r, 60));

      // Auto-scroll loop should NOT have been killed by changing dragOverIdx
      const callsAfter = scrollToSpy.mock.calls.length;
      expect(callsAfter).toBeGreaterThan(callsBefore);

      await act(async () => {
        window.dispatchEvent(new window.Event("dragend", { bubbles: true }));
      });
    });

    it("global drop near table bottom boundary drops at the last item index", async () => {
      const reorderSpy = mock((_plId: string, _itemIds: string[]) => Promise.resolve(true));
      usePlayerStore.setState({
        activePlaylistId: "pl_custom_1",
        activePlaylistItems: [dummyPlaylistItem1, dummyPlaylistItem2],
        playlists: [dummyPlaylist],
        reorderPlaylist: reorderSpy as any,
      });

      await act(async () => {
        root.render(<PlaylistTableView />);
      });

      const dragHandles = container.querySelectorAll('[data-drag-handle="true"]');
      const rows = container.querySelectorAll(".group[role='row']");
      const table = container.querySelector("[role='table']");
      expect(table).not.toBeNull();

      // Mock getBoundingClientRect for table
      table!.getBoundingClientRect = () => ({
        top: 100,
        bottom: 500,
        left: 0,
        right: 800,
        width: 800,
        height: 400,
        x: 0,
        y: 100,
        toJSON: () => {},
      });

      // Start drag from row 0
      await act(async () => {
        dragHandles[0].dispatchEvent(new window.PointerEvent("pointerdown", { button: 0, bubbles: true }));
      });

      const dataStore: Record<string, string> = {};
      const dragEvent = new window.Event("dragstart", { bubbles: true }) as any;
      dragEvent.dataTransfer = {
        setData: (k: string, v: string) => {
          dataStore[k] = v;
        },
        getData: (k: string) => dataStore[k] || "",
        effectAllowed: "none",
      };
      await act(async () => {
        rows[0].dispatchEvent(dragEvent);
      });

      // Global drop near table bottom (clientY = 490, which is >= rect.bottom - 30)
      const dropEvent = new window.Event("drop", { bubbles: true }) as any;
      dropEvent.clientY = 490;
      dropEvent.preventDefault = () => {};
      dropEvent.dataTransfer = {
        getData: (k: string) => dataStore[k] || "0",
      };
      await act(async () => {
        window.dispatchEvent(dropEvent);
      });

      // Should have dropped to index 1 (last index) -> ["item_2", "item_1"]
      expect(reorderSpy).toHaveBeenCalledTimes(1);
      expect(reorderSpy).toHaveBeenCalledWith("pl_custom_1", ["item_2", "item_1"]);
    });

    it("renders floating drag preview with track title and index badge during drag", async () => {
      usePlayerStore.setState({
        activePlaylistId: "pl_custom_1",
        activePlaylistItems: [dummyPlaylistItem1, dummyPlaylistItem2],
        playlists: [dummyPlaylist],
      });

      await act(async () => {
        root.render(<PlaylistTableView />);
      });

      const dragHandles = container.querySelectorAll('[data-drag-handle="true"]');
      const rows = container.querySelectorAll(".group[role='row']");

      // Pointer down on handle 0
      await act(async () => {
        dragHandles[0].dispatchEvent(new window.PointerEvent("pointerdown", { button: 0, bubbles: true }));
      });

      // Dragstart with coordinates
      const dataStore: Record<string, string> = {};
      const dragStartEvent = new window.Event("dragstart", { bubbles: true }) as any;
      dragStartEvent.clientX = 150;
      dragStartEvent.clientY = 250;
      dragStartEvent.dataTransfer = {
        setData: (k: string, v: string) => {
          dataStore[k] = v;
        },
        getData: (k: string) => dataStore[k] || "",
        effectAllowed: "none",
      };
      await act(async () => {
        rows[0].dispatchEvent(dragStartEvent);
      });

      // Dragover to update cursorPos
      const dragOverEvent = new window.Event("dragover", { bubbles: true }) as any;
      dragOverEvent.clientX = 180;
      dragOverEvent.clientY = 320;
      dragOverEvent.preventDefault = () => {};
      dragOverEvent.dataTransfer = { dropEffect: "none" };
      await act(async () => {
        rows[1].dispatchEvent(dragOverEvent);
      });

      // Floating preview should be rendered
      const badge = container.querySelector(".select-none.max-w-sm");
      expect(badge).not.toBeNull();
      expect(badge?.textContent).toContain("#1");
      expect(badge?.textContent).toContain(dummyTrack.title);
      expect((badge as HTMLElement).style.position).toBe("fixed");
    });

    it("calculates FLIP shift transform when dragging over another item", async () => {
      usePlayerStore.setState({
        activePlaylistId: "pl_custom_1",
        activePlaylistItems: [dummyPlaylistItem1, dummyPlaylistItem2],
        playlists: [dummyPlaylist],
        reorderPlaylist: mock(() => Promise.resolve(true)) as any,
      });

      await act(async () => {
        root.render(<PlaylistTableView />);
      });

      const dragHandles = container.querySelectorAll('[data-drag-handle="true"]');
      const rows = container.querySelectorAll(".group[role='row']");

      // Pointer down on handle 0 (top item)
      await act(async () => {
        dragHandles[0].dispatchEvent(new window.PointerEvent("pointerdown", { button: 0, bubbles: true }));
      });

      // Dragstart on item 0
      const dataStore: Record<string, string> = {};
      const dragStartEvent = new window.Event("dragstart", { bubbles: true }) as any;
      dragStartEvent.clientX = 100;
      dragStartEvent.clientY = 100;
      dragStartEvent.dataTransfer = {
        setData: (k: string, v: string) => {
          dataStore[k] = v;
        },
        getData: (k: string) => dataStore[k] || "",
        effectAllowed: "none",
      };
      await act(async () => {
        rows[0].dispatchEvent(dragStartEvent);
      });

      // Drag over item 1 (dragging DOWN: item 0 -> 1)
      const dragOverEvent = new window.Event("dragover", { bubbles: true }) as any;
      dragOverEvent.clientX = 100;
      dragOverEvent.clientY = 170;
      dragOverEvent.preventDefault = () => {};
      dragOverEvent.dataTransfer = { dropEffect: "none" };
      await act(async () => {
        rows[1].dispatchEvent(dragOverEvent);
      });

      // Item 1 (target) should shift UP to make room (-68px)
      expect((rows[1] as HTMLElement).style.transform).toBe("translateY(-68px)");
      expect((rows[1] as HTMLElement).style.transition).toContain("transform 220ms");

      // Now drop item 0 onto item 1
      const dropEvent = new window.Event("drop", { bubbles: true }) as any;
      dropEvent.preventDefault = () => {};
      dropEvent.stopPropagation = () => {};
      dropEvent.dataTransfer = {
        getData: (k: string) => dataStore[k] || "0",
      };
      await act(async () => {
        rows[1].dispatchEvent(dropEvent);
      });

      // Target row should no longer have inline transform or transform transition (preventing bounce)
      const updatedRows = container.querySelectorAll(".group[role='row']");
      expect((updatedRows[0] as HTMLElement).style.transform).toBe("");
      expect((updatedRows[0] as HTMLElement).style.transition).toBe("");
      expect(updatedRows[0].className).toContain("transition-colors");
    });

    it("allows dragging back to original position to cancel reorder and restore rows", async () => {
      const reorderSpy = mock(() => Promise.resolve(true));
      usePlayerStore.setState({
        activePlaylistId: "pl_custom_1",
        activePlaylistItems: [dummyPlaylistItem1, dummyPlaylistItem2],
        playlists: [dummyPlaylist],
        reorderPlaylist: reorderSpy as any,
      });

      await act(async () => {
        root.render(<PlaylistTableView />);
      });

      const dragHandles = container.querySelectorAll('[data-drag-handle="true"]');
      const rows = container.querySelectorAll(".group[role='row']");

      // Pointer down on item 0
      await act(async () => {
        dragHandles[0].dispatchEvent(new window.PointerEvent("pointerdown", { button: 0, bubbles: true }));
      });

      // Dragstart on item 0
      const dataStore: Record<string, string> = {};
      const dragStartEvent = new window.Event("dragstart", { bubbles: true }) as any;
      dragStartEvent.clientX = 100;
      dragStartEvent.clientY = 100;
      dragStartEvent.dataTransfer = {
        setData: (k: string, v: string) => {
          dataStore[k] = v;
        },
        getData: (k: string) => dataStore[k] || "",
        effectAllowed: "none",
      };
      await act(async () => {
        rows[0].dispatchEvent(dragStartEvent);
      });

      // Drag over item 1 -> item 1 shifts up
      const dragOverItem1 = new window.Event("dragover", { bubbles: true }) as any;
      dragOverItem1.clientX = 100;
      dragOverItem1.clientY = 170;
      dragOverItem1.preventDefault = () => {};
      dragOverItem1.dataTransfer = { dropEffect: "none" };
      await act(async () => {
        rows[1].dispatchEvent(dragOverItem1);
      });
      expect((rows[1] as HTMLElement).style.transform).toBe("translateY(-68px)");

      // User changes mind and drags back over item 0 (original position)
      const dragOverItem0 = new window.Event("dragover", { bubbles: true }) as any;
      dragOverItem0.clientX = 100;
      dragOverItem0.clientY = 100;
      dragOverItem0.preventDefault = () => {};
      dragOverItem0.dataTransfer = { dropEffect: "none" };
      await act(async () => {
        rows[0].dispatchEvent(dragOverItem0);
      });

      // All shifted rows should restore to normal position (transform = "")
      expect((rows[1] as HTMLElement).style.transform).toBe("");

      // Drop on item 0
      const dropEvent = new window.Event("drop", { bubbles: true }) as any;
      dropEvent.preventDefault = () => {};
      dropEvent.stopPropagation = () => {};
      dropEvent.dataTransfer = {
        getData: (k: string) => dataStore[k] || "0",
      };
      await act(async () => {
        rows[0].dispatchEvent(dropEvent);
      });

      // Reorder must NOT have been called!
      expect(reorderSpy).not.toHaveBeenCalled();
    });
  });
});


