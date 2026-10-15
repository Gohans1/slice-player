import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PlaylistItemCardComponent } from "./PlaylistItemCard";
import { usePlayerStore } from "../store/usePlayerStore";
import i18n from "../i18n";
import type { Track, Segment, PlaylistItemWithDetails } from "@/server/types";

const dummyTrack: Track = {
  id: "trk_card_1",
  source_type: "youtube",
  source_uri: "yt_card_1",
  title: "Card Test Track",
  artist: "Card Artist",
  duration: 180,
  thumbnail_url: "https://example.com/thumb.jpg",
  status: "ready",
  volume: 0.5,
};

const dummySegment: Segment = {
  id: "seg_card_1",
  track_id: "trk_card_1",
  name: "Card Slice 1",
  start_time: 10,
  end_time: 50,
  created_at: 1000,
};

const dummyPlaylistItem: PlaylistItemWithDetails = {
  id: "pli_card_1",
  playlist_id: "pl_card_1",
  track_id: "trk_card_1",
  segment_id: "seg_card_1",
  sort_order: 0,
  added_at: 1000,
  track: dummyTrack,
  segment: dummySegment,
};

const fullTrackItem: PlaylistItemWithDetails = {
  id: "pli_full_1",
  playlist_id: "pl_card_1",
  track_id: "trk_card_1",
  segment_id: null,
  sort_order: 0,
  added_at: 1000,
  track: { ...dummyTrack, source_uri: "https://www.youtube.com/watch?v=playlist_yt_1", segment_count: 3 },
};

describe("PlaylistItemCardComponent", () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(async () => {
    await i18n.changeLanguage("en");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  const openMoreMenu = async () => {
    const trigger = container.querySelector<HTMLElement>('button[aria-label^="More options for"]');
    await act(async () => {
      trigger?.click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    return (label: string) =>
      Array.from(document.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]')).find((item) =>
        item.textContent?.includes(label)
      );
  };

  const withOpenPlaylist = (coverTrackId: string | null) => {
    const setPlaylistCover = mock(async () => true);
    const original = usePlayerStore.getState();
    usePlayerStore.setState({
      activePlaylistId: "pl_card_1",
      playlists: [{ id: "pl_card_1", name: "Drive", created_at: 1, updated_at: 1, item_count: 1, cover_track_id: coverTrackId }],
      setPlaylistCover,
    });
    return {
      setPlaylistCover,
      restore: () =>
        usePlayerStore.setState({
          activePlaylistId: original.activePlaylistId,
          playlists: original.playlists,
          setPlaylistCover: original.setPlaylistCover,
        }),
    };
  };

  it("shows a slice with its source track and time range", async () => {
    await act(async () => {
      root.render(<PlaylistItemCardComponent item={dummyPlaylistItem} index={0} onPlay={mock()} onDelete={mock()} />);
    });

    expect(container.querySelector("h3")?.textContent).toBe("Card Slice 1");
    expect(container.textContent).toContain("Card Test Track");
    expect(container.textContent).toContain("Slice (0:10 - 0:50)");
  });

  it("shows a full track with its artist and slice count", async () => {
    await act(async () => {
      root.render(<PlaylistItemCardComponent item={fullTrackItem} index={0} onPlay={mock()} onDelete={mock()} />);
    });

    expect(container.querySelector("h3")?.textContent).toBe("Card Test Track");
    expect(container.textContent).toContain("Card Artist");
    expect(container.textContent).toContain("3 slices");
  });

  it("keeps add to playlist and the original video's link in the More menu", async () => {
    const writeText = mock((_text: string) => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await act(async () => {
      root.render(<PlaylistItemCardComponent item={fullTrackItem} index={0} onPlay={mock()} onDelete={mock()} />);
    });

    const menuItem = await openMoreMenu();
    expect(menuItem("Add to Playlist")).toBeDefined();
    await act(async () => {
      menuItem("Copy YouTube link")?.click();
    });

    expect(writeText).toHaveBeenCalledWith("https://www.youtube.com/watch?v=playlist_yt_1");
  });

  it("removes the item from the More menu only when the playlist allows it (not in a mix)", async () => {
    const onDelete = mock((_id: string, _name: string) => {});
    await act(async () => {
      root.render(<PlaylistItemCardComponent item={dummyPlaylistItem} index={0} onPlay={mock()} onDelete={onDelete} />);
    });

    let menuItem = await openMoreMenu();
    await act(async () => {
      menuItem("Remove from Playlist")?.click();
    });
    expect(onDelete).toHaveBeenCalledWith("pli_card_1", "Card Slice 1");

    await act(async () => {
      root.render(<PlaylistItemCardComponent item={dummyPlaylistItem} index={0} onPlay={mock()} />);
    });
    menuItem = await openMoreMenu();
    expect(menuItem("Add to Playlist")).toBeDefined();
    expect(menuItem("Remove from Playlist")).toBeUndefined();
  });

  it("renders pause button and calls pause when clicked while actively playing", async () => {
    const origPause = usePlayerStore.getState().pause;
    const pauseSpy = mock(() => {});

    act(() => {
      usePlayerStore.setState({
        isPlaying: true,
        activePlaylistId: "pl_card_1",
        activePlaylistPlayingId: "pl_card_1",
        queue: [{ queueItemId: "pli_card_1", segment: dummySegment, track: dummyTrack }],
        queueIndex: 0,
        pause: pauseSpy as any,
      });
      root.render(
        <PlaylistItemCardComponent
          item={dummyPlaylistItem}
          index={0}
          onPlay={mock()}
          onDelete={mock()}
        />
      );
    });

    const pauseBtn = container.querySelector(`button[title='Pause slice "Card Slice 1"'], button[title='Pause Card Test Track']`);
    expect(pauseBtn).not.toBeNull();

    act(() => {
      (pauseBtn as HTMLElement).click();
    });

    expect(pauseSpy).toHaveBeenCalledTimes(1);

    act(() => {
      usePlayerStore.setState({
        isPlaying: false,
        activePlaylistId: null,
        activePlaylistPlayingId: null,
        queue: [],
        queueIndex: -1,
        pause: origPause,
      });
    });
  });

  it("calls resume when clicked while active item is paused", async () => {
    const origResume = usePlayerStore.getState().resume;
    const resumeSpy = mock(() => Promise.resolve());

    act(() => {
      usePlayerStore.setState({
        isPlaying: false,
        activePlaylistId: "pl_card_1",
        activePlaylistPlayingId: "pl_card_1",
        queue: [{ queueItemId: "pli_card_1", segment: dummySegment, track: dummyTrack }],
        queueIndex: 0,
        resume: resumeSpy as any,
      });
      root.render(
        <PlaylistItemCardComponent
          item={dummyPlaylistItem}
          index={0}
          onPlay={mock()}
          onDelete={mock()}
        />
      );
    });

    const playBtn = container.querySelector(`button[title='Play slice "Card Slice 1"'], button[title='Play Card Test Track']`);
    expect(playBtn).not.toBeNull();

    await act(async () => {
      (playBtn as HTMLElement).click();
    });

    expect(resumeSpy).toHaveBeenCalledTimes(1);

    act(() => {
      usePlayerStore.setState({
        isPlaying: false,
        activePlaylistId: null,
        activePlaylistPlayingId: null,
        queue: [],
        queueIndex: -1,
        resume: origResume,
      });
    });
  });

  it("prevents repeated play initiation when spam clicking thumbnail play button", async () => {
    const onPlaySpy = mock(() => {});

    act(() => {
      root.render(
        <PlaylistItemCardComponent
          item={dummyPlaylistItem}
          index={0}
          onPlay={onPlaySpy}
          onDelete={mock()}
        />
      );
    });

    const playBtn = container.querySelector(`button[title='Play slice "Card Slice 1"'], button[title='Play Card Test Track']`);
    expect(playBtn).not.toBeNull();

    await act(async () => {
      (playBtn as HTMLElement).click();
      (playBtn as HTMLElement).click();
      (playBtn as HTMLElement).click();
      (playBtn as HTMLElement).click();
    });

    expect(onPlaySpy).toHaveBeenCalledTimes(1);
  });

  it("toggles item selection when clicking play overlay or button in selection mode", async () => {
    const { useSelectionStore } = await import("../store/useSelectionStore");

    const onPlaySpy = mock(() => {});
    const pauseSpy = mock(() => {});
    const origPause = usePlayerStore.getState().pause;

    act(() => {
      useSelectionStore.getState().clearSelection();
      useSelectionStore.getState().selectTracks(["other_item"]);
      usePlayerStore.setState({
        isPlaying: true,
        pause: pauseSpy as any,
      });
      root.render(
        <PlaylistItemCardComponent
          item={dummyPlaylistItem}
          index={0}
          onPlay={onPlaySpy}
          onDelete={mock()}
          visibleItemIds={[dummyPlaylistItem.id, "other_item"]}
        />
      );
    });

    expect(useSelectionStore.getState().selectedTrackIds.size).toBe(1);
    expect(useSelectionStore.getState().selectedTrackIds.has(dummyPlaylistItem.id)).toBe(false);

    const playOverlayBtn = container.querySelector(`button[title='Select ${dummySegment.name}']`);
    expect(playOverlayBtn).not.toBeNull();

    // Click overlay
    await act(async () => {
      (playOverlayBtn as HTMLElement).click();
    });

    // Should be selected now!
    expect(useSelectionStore.getState().selectedTrackIds.has(dummyPlaylistItem.id)).toBe(true);
    expect(useSelectionStore.getState().selectedTrackIds.size).toBe(2);
    expect(onPlaySpy).toHaveBeenCalledTimes(0);
    expect(pauseSpy).toHaveBeenCalledTimes(0);

    // Click overlay again while still in selection mode -> should deselect!
    await act(async () => {
      (playOverlayBtn as HTMLElement).click();
    });

    // Should be deselected now!
    expect(useSelectionStore.getState().selectedTrackIds.has(dummyPlaylistItem.id)).toBe(false);
    expect(useSelectionStore.getState().selectedTrackIds.size).toBe(1);
    expect(onPlaySpy).toHaveBeenCalledTimes(0);
    expect(pauseSpy).toHaveBeenCalledTimes(0);

    act(() => {
      useSelectionStore.getState().clearSelection();
      usePlayerStore.setState({
        isPlaying: false,
        pause: origPause,
      });
    });
  });

  it("renders drag handle when dragProps.canDrag is true and handles interactions", async () => {
    const onPointerDownHandle = mock();
    const onKeyDownHandle = mock();

    await act(async () => {
      root.render(
        <PlaylistItemCardComponent
          item={dummyPlaylistItem}
          index={2}
          totalItems={10}
          onPlay={mock()}
          onDelete={mock()}
          dragProps={{
            canDrag: true,
            isDragging: false,
            isDragTarget: false,
            isReordering: false,
            onPointerDownHandle,
            onKeyDownHandle,
          }}
        />
      );
    });

    const handle = container.querySelector("[data-drag-handle='true']");
    expect(handle).not.toBeNull();
    expect(handle?.getAttribute("data-drag-handle-index")).toBe("2");

    // Pointer down with button 0
    await act(async () => {
      handle?.dispatchEvent(new (window as any).PointerEvent("pointerdown", { button: 0, bubbles: true }));
    });
    expect(onPointerDownHandle).toHaveBeenCalledTimes(1);

    // Key down with ArrowRight
    await act(async () => {
      handle?.dispatchEvent(new (window as any).KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    expect(onKeyDownHandle).toHaveBeenCalledTimes(1);
  });

  it("does not render drag handle when dragProps is omitted or canDrag is false", async () => {
    await act(async () => {
      root.render(
        <PlaylistItemCardComponent
          item={dummyPlaylistItem}
          index={0}
          onPlay={mock()}
          onDelete={mock()}
        />
      );
    });

    expect(container.querySelector("[data-drag-handle='true']")).toBeNull();

    await act(async () => {
      root.render(
        <PlaylistItemCardComponent
          item={dummyPlaylistItem}
          index={0}
          onPlay={mock()}
          onDelete={mock()}
          dragProps={{
            canDrag: false,
            isDragging: false,
            isDragTarget: false,
            onPointerDownHandle: mock(),
            onKeyDownHandle: mock(),
          }}
        />
      );
    });

    expect(container.querySelector("[data-drag-handle='true']")).toBeNull();
  });

  it("marks the tile while it's dragged and while it's the drop target", async () => {
    const dragProps = { canDrag: true, isDragging: true, isDragTarget: false, onPointerDownHandle: mock(), onKeyDownHandle: mock() };
    await act(async () => {
      root.render(<PlaylistItemCardComponent item={dummyPlaylistItem} index={0} onPlay={mock()} dragProps={dragProps} />);
    });
    const tile = container.firstElementChild;
    expect(tile?.hasAttribute("data-dragging")).toBe(true);
    expect(tile?.hasAttribute("data-drop-target")).toBe(false);

    await act(async () => {
      root.render(
        <PlaylistItemCardComponent
          item={dummyPlaylistItem}
          index={0}
          onPlay={mock()}
          dragProps={{ ...dragProps, isDragging: false, isDragTarget: true }}
        />
      );
    });
    expect(tile?.hasAttribute("data-dragging")).toBe(false);
    expect(tile?.hasAttribute("data-drop-target")).toBe(true);
  });

  it("sets this item's track as the open playlist's cover from the More menu", async () => {
    const { setPlaylistCover, restore } = withOpenPlaylist(null);
    try {
      await act(async () => {
        root.render(<PlaylistItemCardComponent item={dummyPlaylistItem} index={0} onPlay={mock()} onDelete={mock()} />);
      });
      const menuItem = await openMoreMenu();
      await act(async () => {
        menuItem("Set as playlist cover")?.click();
      });

      expect(setPlaylistCover).toHaveBeenCalledWith("pl_card_1", "trk_card_1");
    } finally {
      restore();
    }
  });

  it("clears the cover when this item's track is already the cover", async () => {
    const { setPlaylistCover, restore } = withOpenPlaylist("trk_card_1");
    try {
      await act(async () => {
        root.render(<PlaylistItemCardComponent item={dummyPlaylistItem} index={0} onPlay={mock()} onDelete={mock()} />);
      });
      const menuItem = await openMoreMenu();
      expect(menuItem("Set as playlist cover")).toBeUndefined();
      await act(async () => {
        menuItem("Remove playlist cover")?.click();
      });

      expect(setPlaylistCover).toHaveBeenCalledWith("pl_card_1", null);
    } finally {
      restore();
    }
  });
});
