import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TrackCard } from "./TrackCard";
import { usePlayerStore } from "../store/usePlayerStore";
import type { Track } from "@/server/types";
import i18n from "../i18n";

describe("TrackCard", () => {
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

  const baseTrack: Track = {
    id: "yt_test1",
    source_type: "youtube",
    source_uri: "https://www.youtube.com/watch?v=test1",
    title: "Test Track In Queue",
    artist: "Artist Name",
    duration: 180,
    thumbnail_url: "https://i.ytimg.com/vi/test1/maxresdefault.jpg",
    status: "queued",
    volume: 0.5,
  };

  const studioButton = () => container.querySelector<HTMLButtonElement>('button[aria-label="Open Slice Studio"]');

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

  it("covers the artwork with the download status and disables Slice Studio while queued", () => {
    act(() => {
      root.render(<TrackCard track={baseTrack} onDelete={() => {}} />);
    });

    expect(container.textContent).toContain("Queued...");
    expect(studioButton()?.disabled).toBe(true);
    expect(container.querySelector(`button[title="Play ${baseTrack.title}"]`)).toBeNull();
  });

  it("shows download progress and disables Slice Studio while downloading", () => {
    act(() => {
      root.render(<TrackCard track={{ ...baseTrack, status: "downloading" }} onDelete={() => {}} />);
    });

    expect(container.textContent).toContain("Downloading audio...");
    expect(studioButton()?.disabled).toBe(true);
  });

  it("shows why a download failed and retries it", async () => {
    const retryTrack = mock(async () => true);
    const origRetry = usePlayerStore.getState().retryTrack;
    usePlayerStore.setState({ retryTrack });
    const errorTrack: Track = { ...baseTrack, status: "error", error_message: "Network unreachable" };

    try {
      act(() => {
        root.render(<TrackCard track={errorTrack} onDelete={() => {}} />);
      });

      expect(container.textContent).toContain("Download failed");
      expect(container.textContent).toContain("Network unreachable");
      const retry = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Retry"));
      await act(async () => {
        retry?.click();
      });
      expect(retryTrack).toHaveBeenCalledWith(errorTrack.id);
    } finally {
      usePlayerStore.setState({ retryTrack: origRetry });
    }
  });

  it("offers play and Slice Studio once ready", () => {
    const openSliceStudio = mock(() => {});
    const origOpen = usePlayerStore.getState().openSliceStudio;
    usePlayerStore.setState({ openSliceStudio });
    const readyTrack: Track = { ...baseTrack, status: "ready", segment_count: 3 };

    try {
      act(() => {
        root.render(<TrackCard track={readyTrack} onDelete={() => {}} />);
      });

      expect(container.textContent).not.toContain("Queued...");
      expect(container.textContent).toContain("3 slices");
      expect(container.querySelector(`button[title="Play ${readyTrack.title}"]`)).not.toBeNull();
      act(() => {
        studioButton()?.click();
      });
      expect(openSliceStudio).toHaveBeenCalledWith(readyTrack);
    } finally {
      usePlayerStore.setState({ openSliceStudio: origOpen });
    }
  });

  it("renders active playing equalizer badge and border when current track is playing", async () => {
    const readyTrack: Track = { ...baseTrack, status: "ready" };

    act(() => {
      usePlayerStore.setState({
        isPlaying: true,
        activeTrack: readyTrack,
      });
      root.render(<TrackCard track={readyTrack} onDelete={() => {}} />);
    });

    const textContent = container.textContent || "";
    expect(textContent).toContain("Playing");

    // Clean up store state inside act
    act(() => {
      usePlayerStore.setState({
        isPlaying: false,
        activeTrack: null,
      });
    });
  });

  it("renders pause button and calls pause when clicking thumbnail overlay while playing", async () => {
    const origPause = usePlayerStore.getState().pause;
    const readyTrack: Track = { ...baseTrack, status: "ready" };
    const pauseSpy = mock(() => {});

    act(() => {
      usePlayerStore.setState({
        isPlaying: true,
        activeTrack: readyTrack,
        pause: pauseSpy as any,
      });
      root.render(<TrackCard track={readyTrack} onDelete={() => {}} />);
    });

    const overlayBtn = container.querySelector<HTMLButtonElement>(`button[title="Pause ${readyTrack.title}"]`);
    expect(overlayBtn).not.toBeNull();

    act(() => {
      overlayBtn?.click();
    });

    expect(pauseSpy).toHaveBeenCalledTimes(1);

    act(() => {
      usePlayerStore.setState({
        isPlaying: false,
        activeTrack: null,
        pause: origPause,
      });
    });
  });

  it("calls resume when clicking thumbnail overlay while active track is paused", async () => {
    const origResume = usePlayerStore.getState().resume;
    const readyTrack: Track = { ...baseTrack, status: "ready" };
    const resumeSpy = mock(() => Promise.resolve());

    act(() => {
      usePlayerStore.setState({
        isPlaying: false,
        activeTrack: readyTrack,
        resume: resumeSpy as any,
      });
      root.render(<TrackCard track={readyTrack} onDelete={() => {}} />);
    });

    const overlayBtn = container.querySelector<HTMLButtonElement>(`button[title="Play ${readyTrack.title}"]`);
    expect(overlayBtn).not.toBeNull();

    await act(async () => {
      overlayBtn?.click();
    });

    expect(resumeSpy).toHaveBeenCalledTimes(1);

    act(() => {
      usePlayerStore.setState({
        isPlaying: false,
        activeTrack: null,
        resume: origResume,
      });
    });
  });

  it("prevents repeated play initiation when spam clicking thumbnail play button", async () => {
    const origPlaySegmentInMode = usePlayerStore.getState().playSegmentInMode;
    const readyTrack: Track = { ...baseTrack, id: "spam_track", status: "ready" };
    const playSegmentInModeSpy = mock(() => Promise.resolve());

    act(() => {
      usePlayerStore.setState({
        isPlaying: false,
        activeTrack: null,
        activeSystemCategory: "original_only",
        playbackMode: "original_only",
        playSegmentInMode: playSegmentInModeSpy as any,
      });
      root.render(<TrackCard track={readyTrack} onDelete={() => {}} />);
    });

    const overlayBtn = container.querySelector<HTMLButtonElement>(`button[title="Play ${readyTrack.title}"]`);
    expect(overlayBtn).not.toBeNull();

    // Rapid spam clicks
    await act(async () => {
      overlayBtn?.click();
      overlayBtn?.click();
      overlayBtn?.click();
      overlayBtn?.click();
    });

    // Should only initiate playback once despite rapid spam clicks
    expect(playSegmentInModeSpy).toHaveBeenCalledTimes(1);

    act(() => {
      usePlayerStore.setState({
        isPlaying: false,
        activeTrack: null,
        playSegmentInMode: origPlaySegmentInMode,
      });
    });
  });

  it("toggles track selection and does not initiate playback when in selection mode", async () => {
    const { useSelectionStore } = await import("../store/useSelectionStore");

    const playSegmentInModeSpy = mock(() => Promise.resolve());
    const pauseSpy = mock(() => {});
    const origPlaySegmentInMode = usePlayerStore.getState().playSegmentInMode;
    const origPause = usePlayerStore.getState().pause;

    const currentlyPlayingTrack: Track = { ...baseTrack, id: "active_playing_trk", status: "ready" };
    const targetTrack: Track = { ...baseTrack, id: "target_trk", title: "Target Track", status: "ready" };

    // Put store in selection mode (1 track already selected)
    act(() => {
      useSelectionStore.getState().clearSelection();
      useSelectionStore.getState().selectTracks(["other_track_id"]);
      usePlayerStore.setState({
        isPlaying: true,
        activeTrack: currentlyPlayingTrack,
        playSegmentInMode: playSegmentInModeSpy as any,
        pause: pauseSpy as any,
      });
      root.render(
        <TrackCard
          track={targetTrack}
          onDelete={() => {}}
          visibleTrackIds={[targetTrack.id, "other_track_id"]}
        />
      );
    });

    expect(useSelectionStore.getState().selectedTrackIds.size).toBe(1);
    expect(useSelectionStore.getState().selectedTrackIds.has("target_trk")).toBe(false);

    const overlayBtn = container.querySelector<HTMLButtonElement>(`button[title="Select Target Track"]`);
    expect(overlayBtn).not.toBeNull();

    // Click play overlay while in selection mode
    await act(async () => {
      overlayBtn?.click();
    });

    // Should be selected now!
    expect(useSelectionStore.getState().selectedTrackIds.has("target_trk")).toBe(true);
    expect(useSelectionStore.getState().selectedTrackIds.size).toBe(2);

    // Should NOT have touched playback
    expect(playSegmentInModeSpy).toHaveBeenCalledTimes(0);
    expect(pauseSpy).toHaveBeenCalledTimes(0);
    expect(usePlayerStore.getState().isPlaying).toBe(true);
    expect(usePlayerStore.getState().activeTrack?.id).toBe("active_playing_trk");

    // Clean up
    act(() => {
      useSelectionStore.getState().clearSelection();
      usePlayerStore.setState({
        isPlaying: false,
        activeTrack: null,
        playSegmentInMode: origPlaySegmentInMode,
        pause: origPause,
      });
    });
  });

  it("selects the track from its artwork checkbox without playing it", async () => {
    const { useSelectionStore } = await import("../store/useSelectionStore");
    const playSegmentInMode = mock(() => Promise.resolve());
    const origPlay = usePlayerStore.getState().playSegmentInMode;
    usePlayerStore.setState({ playSegmentInMode });
    const readyTrack: Track = { ...baseTrack, status: "ready" };

    try {
      act(() => {
        useSelectionStore.getState().clearSelection();
        root.render(<TrackCard track={readyTrack} onDelete={() => {}} />);
      });

      const checkbox = container.querySelector<HTMLElement>(`[role="checkbox"][aria-label="Select ${readyTrack.title}"]`);
      await act(async () => {
        checkbox?.click();
      });

      expect(useSelectionStore.getState().selectedTrackIds.has(readyTrack.id)).toBe(true);
      expect(checkbox?.getAttribute("aria-checked")).toBe("true");
      expect(playSegmentInMode).not.toHaveBeenCalled();
    } finally {
      act(() => {
        useSelectionStore.getState().clearSelection();
      });
      usePlayerStore.setState({ playSegmentInMode: origPlay });
    }
  });

  it("keeps add to playlist, copy link and delete in the More menu", async () => {
    const onDelete = mock((_id: string) => {});
    const readyTrack: Track = { ...baseTrack, status: "ready" };
    act(() => {
      root.render(<TrackCard track={readyTrack} onDelete={onDelete} />);
    });

    const menuItem = await openMoreMenu();
    expect(menuItem("Add to Playlist")).toBeDefined();
    expect(menuItem("Copy YouTube link")).toBeDefined();

    await act(async () => {
      menuItem("Delete track")?.click();
    });
    expect(onDelete).toHaveBeenCalledWith(readyTrack.id);
  });

  it("copies a YouTube track's link from the More menu", async () => {
    const writeText = mock((_text: string) => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const readyTrack: Track = { ...baseTrack, status: "ready", source_uri: "https://www.youtube.com/watch?v=test_vid_99" };
    act(() => {
      root.render(<TrackCard track={readyTrack} onDelete={() => {}} />);
    });

    const menuItem = await openMoreMenu();
    await act(async () => {
      menuItem("Copy YouTube link")?.click();
    });

    expect(writeText).toHaveBeenCalledWith("https://www.youtube.com/watch?v=test_vid_99");
    expect(menuItem("Copied link!")).toBeDefined();
  });

  it("has no copy link action for local audio", async () => {
    act(() => {
      root.render(
        <TrackCard track={{ ...baseTrack, source_type: "local", source_uri: "/music/song.flac", status: "ready" }} onDelete={() => {}} />
      );
    });

    const menuItem = await openMoreMenu();
    expect(menuItem("Add to Playlist")).toBeDefined();
    expect(menuItem("Copy YouTube link")).toBeUndefined();
  });
});
