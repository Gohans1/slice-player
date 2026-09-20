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
import { PlaylistItemCardComponent } from "./PlaylistItemCard";
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

describe("PlaylistItemCardComponent", () => {
  let window: InstanceType<typeof GlobalWindow>;
  let document: Document;
  let container: HTMLDivElement;
  let root: any;

  beforeEach(() => {
    window = new GlobalWindow();
    document = window.document as unknown as Document;
    (globalThis as any).window = window;
    (globalThis as any).document = document;
    (globalThis as any).navigator = window.navigator;

    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  });

  it("renders AddToPlaylist button in playlist item card", async () => {
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

    const addButtons = container.querySelectorAll("button[title='Thêm vào danh sách'], button[title='Add to Playlist']");
    expect(addButtons.length).toBe(1);
  });

  it("renders pause button and calls pause when clicked while actively playing", async () => {
    const { usePlayerStore } = await import("../store/usePlayerStore");
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
    const { usePlayerStore } = await import("../store/usePlayerStore");
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
    const { usePlayerStore } = await import("../store/usePlayerStore");
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

    // Click bottom button while still in selection mode -> should deselect!
    const bottomBtn = container.querySelector("button.h-8.text-xs.gap-1\\.5");
    expect(bottomBtn).not.toBeNull();

    await act(async () => {
      (bottomBtn as HTMLElement).click();
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
});
