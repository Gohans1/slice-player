import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import "./i18n";
import { App } from "./App";
import { usePlayerStore } from "./store/usePlayerStore";
import { useSelectionStore } from "./store/useSelectionStore";
import type { Track } from "@/server/types";

const track: Track = {
  id: "trk_space",
  source_type: "youtube",
  source_uri: "https://www.youtube.com/watch?v=space",
  title: "Space Bar Song",
  artist: "Artist",
  duration: 180,
  status: "ready",
  thumbnail_url: "",
  volume: 0.5,
  created_at: 1000,
};

const { pause: originalPause, resume: originalResume, togglePlay: originalTogglePlay } = usePlayerStore.getState();

describe("Global keyboard shortcuts", () => {
  let container: HTMLDivElement;
  let root: Root;
  let originalFetch: typeof globalThis.fetch;
  const pause = mock(() => {});
  const resume = mock(async () => {});
  const togglePlay = mock(async () => {});

  beforeEach(() => {
    for (const fn of [pause, resume, togglePlay]) fn.mockClear();
    originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string) =>
      new Response(JSON.stringify(String(url) === "/api/tracks" ? [track] : []), { status: 200 })) as typeof fetch;

    useSelectionStore.getState().clearSelection();
    usePlayerStore.setState({
      tracks: [track],
      playlists: [],
      activePlaylistId: null,
      activeSystemCategory: "original_only",
      viewMode: "list",
      isLoadingTracks: false,
      activeTrack: track,
      activeSegment: null,
      isPlaying: true,
      pause,
      resume,
      togglePlay,
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    globalThis.fetch = originalFetch;
    usePlayerStore.setState({ pause: originalPause, resume: originalResume, togglePlay: originalTogglePlay });
  });

  async function pressSpaceOnTrackRow() {
    await act(async () => {
      root.render(<App />);
    });
    const row = Array.from(container.querySelectorAll<HTMLElement>('[role="row"]')).find((el) =>
      el.textContent?.includes(track.title)
    );
    expect(row).toBeDefined();
    await act(async () => {
      row!.focus();
      row!.dispatchEvent(new window.KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true, cancelable: true }));
    });
  }

  it("lets Space on the playing row pause it once, without the global play/pause shortcut", async () => {
    await pressSpaceOnTrackRow();

    expect(pause).toHaveBeenCalledTimes(1);
    expect(togglePlay).not.toHaveBeenCalled();
  });

  it("lets Space on a row in selection mode toggle the selection only", async () => {
    useSelectionStore.getState().selectTracks([track.id]);

    await pressSpaceOnTrackRow();

    expect(useSelectionStore.getState().selectedTrackIds.has(track.id)).toBe(false);
    expect(togglePlay).not.toHaveBeenCalled();
  });
});
