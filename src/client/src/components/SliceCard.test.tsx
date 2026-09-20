import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { GlobalWindow } from "happy-dom";
import { SliceCard } from "./SliceCard";
import type { Track, Segment } from "@/server/types";
import i18n from "../i18n";

describe("SliceCard Component", () => {
  let window: any;
  let container: any;
  let root: any;

  beforeEach(async () => {
    await i18n.changeLanguage("en");
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
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
    delete (globalThis as any).window;
    delete (globalThis as any).document;
    delete (globalThis as any).Node;
    delete (globalThis as any).Element;
    delete (globalThis as any).HTMLElement;
    delete (globalThis as any).HTMLImageElement;
  });

  const baseTrack: Track = {
    id: "trk_1",
    source_type: "youtube",
    source_uri: "https://www.youtube.com/watch?v=123",
    title: "Test Track",
    artist: "Artist Name",
    duration: 200,
    thumbnail_url: "",
    status: "ready",
    volume: 0.5,
  };

  const baseSegment: Segment = {
    id: "seg_1",
    track_id: "trk_1",
    name: "Chorus Slice",
    start_time: 10,
    end_time: 35,
  };

  it("renders segment name, track title, and delete button when onDelete is provided", () => {
    const onDelete = mock(() => {});
    act(() => {
      root.render(
        <SliceCard
          segment={baseSegment}
          track={baseTrack}
          index={0}
          onPlay={() => {}}
          onOpenStudio={() => {}}
          onDelete={onDelete}
        />
      );
    });

    expect(container.textContent).toContain("Chorus Slice");
    expect(container.textContent).toContain("Test Track");

    const deleteBtn = container.querySelector('button[title="Delete slice"]');
    expect(deleteBtn).not.toBeNull();

    act(() => {
      deleteBtn.click();
    });

    expect(onDelete).toHaveBeenCalledWith("seg_1");
  });

  it("does not render delete button when onDelete is omitted", () => {
    act(() => {
      root.render(
        <SliceCard
          segment={baseSegment}
          track={baseTrack}
          index={0}
          onPlay={() => {}}
          onOpenStudio={() => {}}
        />
      );
    });

    const deleteBtn = container.querySelector('button[title="Delete slice"]');
    expect(deleteBtn).toBeNull();
  });

  it("triggers onPlay and onOpenStudio when respective buttons are clicked", () => {
    const onPlay = mock(() => {});
    const onOpenStudio = mock(() => {});
    act(() => {
      root.render(
        <SliceCard
          segment={baseSegment}
          track={baseTrack}
          index={0}
          onPlay={onPlay}
          onOpenStudio={onOpenStudio}
        />
      );
    });

    const studioBtn = container.querySelector('button[title="Open Slice Studio"]');
    expect(studioBtn).not.toBeNull();
    act(() => {
      studioBtn.click();
    });
    expect(onOpenStudio).toHaveBeenCalledTimes(1);

    const playBtn = container.querySelector('button[title=\'Play slice "Chorus Slice"\']');
    expect(playBtn).not.toBeNull();
    act(() => {
      playBtn.click();
    });
    expect(onPlay).toHaveBeenCalledTimes(1);
  });

  it("renders pause button and calls pause when clicked while actively playing", async () => {
    const { usePlayerStore } = await import("../store/usePlayerStore");
    const origPause = usePlayerStore.getState().pause;
    const pauseSpy = mock(() => {});

    act(() => {
      usePlayerStore.setState({
        isPlaying: true,
        activeTrack: baseTrack,
        activeSegment: baseSegment,
        pause: pauseSpy as any,
      });
      root.render(
        <SliceCard
          segment={baseSegment}
          track={baseTrack}
          index={0}
          onPlay={() => {}}
          onOpenStudio={() => {}}
        />
      );
    });

    const pauseBtn = container.querySelector('button[title=\'Pause slice "Chorus Slice"\']');
    expect(pauseBtn).not.toBeNull();

    act(() => {
      pauseBtn.click();
    });

    expect(pauseSpy).toHaveBeenCalledTimes(1);

    act(() => {
      usePlayerStore.setState({
        isPlaying: false,
        activeTrack: null,
        activeSegment: null,
        pause: origPause,
      });
    });
  });

  it("calls resume when clicked while active slice is paused", async () => {
    const { usePlayerStore } = await import("../store/usePlayerStore");
    const origResume = usePlayerStore.getState().resume;
    const resumeSpy = mock(() => Promise.resolve());

    act(() => {
      usePlayerStore.setState({
        isPlaying: false,
        activeTrack: baseTrack,
        activeSegment: baseSegment,
        resume: resumeSpy as any,
      });
      root.render(
        <SliceCard
          segment={baseSegment}
          track={baseTrack}
          index={0}
          onPlay={() => {}}
          onOpenStudio={() => {}}
        />
      );
    });

    const playBtn = container.querySelector('button[title=\'Play slice "Chorus Slice"\']');
    expect(playBtn).not.toBeNull();

    await act(async () => {
      playBtn.click();
    });

    expect(resumeSpy).toHaveBeenCalledTimes(1);

    act(() => {
      usePlayerStore.setState({
        isPlaying: false,
        activeTrack: null,
        activeSegment: null,
        resume: origResume,
      });
    });
  });

  it("prevents repeated play initiation when spam clicking thumbnail play button", async () => {
    const onPlaySpy = mock(() => {});

    act(() => {
      root.render(
        <SliceCard
          segment={baseSegment}
          track={baseTrack}
          index={0}
          onPlay={onPlaySpy}
          onOpenStudio={() => {}}
        />
      );
    });

    const playBtn = container.querySelector('button[title=\'Play slice "Chorus Slice"\']');
    expect(playBtn).not.toBeNull();

    await act(async () => {
      playBtn.click();
      playBtn.click();
      playBtn.click();
      playBtn.click();
    });

    expect(onPlaySpy).toHaveBeenCalledTimes(1);
  });

  it("toggles slice selection and does not initiate playback when in selection mode", async () => {
    const { usePlayerStore } = await import("../store/usePlayerStore");
    const { useSelectionStore } = await import("../store/useSelectionStore");

    const onPlaySpy = mock(() => {});
    const pauseSpy = mock(() => {});
    const origPause = usePlayerStore.getState().pause;

    act(() => {
      useSelectionStore.getState().clearSelection();
      useSelectionStore.getState().selectTracks(["existing_id"]);
      usePlayerStore.setState({
        isPlaying: true,
        activeTrack: baseTrack,
        activeSegment: baseSegment,
        pause: pauseSpy as any,
      });
      root.render(
        <SliceCard
          segment={baseSegment}
          track={baseTrack}
          index={0}
          onPlay={onPlaySpy}
          onOpenStudio={() => {}}
          visibleItemIds={[baseSegment.id, "existing_id"]}
        />
      );
    });

    expect(useSelectionStore.getState().selectedTrackIds.size).toBe(1);
    expect(useSelectionStore.getState().selectedTrackIds.has(baseSegment.id)).toBe(false);

    const playOverlayBtn = container.querySelector(`button[title='Select ${baseSegment.name}']`);
    expect(playOverlayBtn).not.toBeNull();

    await act(async () => {
      (playOverlayBtn as HTMLElement).click();
    });

    expect(useSelectionStore.getState().selectedTrackIds.has(baseSegment.id)).toBe(true);
    expect(useSelectionStore.getState().selectedTrackIds.size).toBe(2);
    expect(onPlaySpy).toHaveBeenCalledTimes(0);
    expect(pauseSpy).toHaveBeenCalledTimes(0);
    expect(usePlayerStore.getState().isPlaying).toBe(true);

    act(() => {
      useSelectionStore.getState().clearSelection();
      usePlayerStore.setState({
        isPlaying: false,
        activeTrack: null,
        activeSegment: null,
        pause: origPause,
      });
    });
  });
});
