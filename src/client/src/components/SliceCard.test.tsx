import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import * as React from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createAppRoot } from "../test/app-root";
import { SliceCard } from "./SliceCard";
import { usePlayerStore } from "../store/usePlayerStore";
import type { Track, Segment } from "@/server/types";
import i18n from "../i18n";

describe("SliceCard", () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(async () => {
    await i18n.changeLanguage("en");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createAppRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
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

  it("names the slice, its track and its time range", () => {
    act(() => {
      root.render(<SliceCard segment={baseSegment} track={baseTrack} onPlay={() => {}} onOpenStudio={() => {}} />);
    });

    expect(container.querySelector("h3")?.textContent).toBe("Chorus Slice");
    expect(container.textContent).toContain("Test Track");
    expect(container.textContent).toContain("Slice (0:10 - 0:35)");
  });

  it("deletes the slice from the More menu", async () => {
    const onDelete = mock((_id: string) => {});
    act(() => {
      root.render(
        <SliceCard segment={baseSegment} track={baseTrack} onPlay={() => {}} onOpenStudio={() => {}} onDelete={onDelete} />
      );
    });

    const menuItem = await openMoreMenu();
    await act(async () => {
      menuItem("Delete slice")?.click();
    });

    expect(onDelete).toHaveBeenCalledWith("seg_1");
  });

  it("offers no delete when onDelete is omitted", async () => {
    act(() => {
      root.render(<SliceCard segment={baseSegment} track={baseTrack} onPlay={() => {}} onOpenStudio={() => {}} />);
    });

    const menuItem = await openMoreMenu();
    expect(menuItem("Add to Playlist")).toBeDefined();
    expect(menuItem("Delete slice")).toBeUndefined();
  });

  it("plays the slice from its artwork and opens Slice Studio from its button", () => {
    const onPlay = mock(() => {});
    const onOpenStudio = mock(() => {});
    act(() => {
      root.render(<SliceCard segment={baseSegment} track={baseTrack} onPlay={onPlay} onOpenStudio={onOpenStudio} />);
    });

    act(() => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Open Slice Studio"]')?.click();
    });
    expect(onOpenStudio).toHaveBeenCalledTimes(1);
    expect(onOpenStudio).toHaveBeenCalledWith(baseTrack);

    act(() => {
      container.querySelector<HTMLButtonElement>('button[title=\'Play slice "Chorus Slice"\']')?.click();
    });
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onPlay).toHaveBeenCalledWith(baseSegment, baseTrack);
  });

  it("renders pause button and calls pause when clicked while actively playing", async () => {
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
          onPlay={() => {}}
          onOpenStudio={() => {}}
        />
      );
    });

    const pauseBtn = container.querySelector<HTMLButtonElement>('button[title=\'Pause slice "Chorus Slice"\']');
    expect(pauseBtn).not.toBeNull();

    act(() => {
      pauseBtn?.click();
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
          onPlay={() => {}}
          onOpenStudio={() => {}}
        />
      );
    });

    const playBtn = container.querySelector<HTMLButtonElement>('button[title=\'Play slice "Chorus Slice"\']');
    expect(playBtn).not.toBeNull();

    await act(async () => {
      playBtn?.click();
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
          onPlay={onPlaySpy}
          onOpenStudio={() => {}}
        />
      );
    });

    const playBtn = container.querySelector<HTMLButtonElement>('button[title=\'Play slice "Chorus Slice"\']');
    expect(playBtn).not.toBeNull();

    await act(async () => {
      playBtn?.click();
      playBtn?.click();
      playBtn?.click();
      playBtn?.click();
    });

    expect(onPlaySpy).toHaveBeenCalledTimes(1);
  });

  it("toggles slice selection and does not initiate playback when in selection mode", async () => {
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
          onPlay={onPlaySpy}
          onOpenStudio={() => {}}
          visibleItemIds={[baseSegment.id, "existing_id"]}
        />
      );
    });

    expect(useSelectionStore.getState().selectedTrackIds.size).toBe(1);
    expect(useSelectionStore.getState().selectedTrackIds.has(baseSegment.id)).toBe(false);

    const playOverlayBtn = container.querySelector<HTMLButtonElement>(`button[title='Select ${baseSegment.name}']`);
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

  it("copies the original video's link from the More menu without playing", async () => {
    const writeText = mock((_text: string) => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const onPlay = mock(() => {});
    act(() => {
      root.render(<SliceCard segment={baseSegment} track={baseTrack} onPlay={onPlay} onOpenStudio={() => {}} />);
    });

    const menuItem = await openMoreMenu();
    await act(async () => {
      menuItem("Copy YouTube link")?.click();
    });

    expect(writeText).toHaveBeenCalledWith("https://www.youtube.com/watch?v=123");
    expect(onPlay).not.toHaveBeenCalled();
  });

  it("has no copy link action for slices of local audio", async () => {
    const localTrack: Track = { ...baseTrack, id: "local_trk", source_type: "local", source_uri: "/music/local.flac" };
    act(() => {
      root.render(<SliceCard segment={baseSegment} track={localTrack} onPlay={() => {}} onOpenStudio={() => {}} />);
    });

    const menuItem = await openMoreMenu();
    expect(menuItem("Add to Playlist")).toBeDefined();
    expect(menuItem("Copy YouTube link")).toBeUndefined();
  });
});
