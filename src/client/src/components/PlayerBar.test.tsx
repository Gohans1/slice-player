import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GlobalWindow } from "happy-dom";
import { PlayerBar } from "./PlayerBar";
import { usePlayerStore, type Track, type Segment } from "../store/usePlayerStore";

describe("PlayerBar Component", () => {
  let container: HTMLDivElement;
  let root: Root;
  let originalStoreState: ReturnType<typeof usePlayerStore.getState> | null = null;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const happyWindow = new GlobalWindow();
    (globalThis as any).window = happyWindow;
    (globalThis as any).document = happyWindow.document;
    (globalThis as any).HTMLElement = happyWindow.HTMLElement;
    (globalThis as any).Event = happyWindow.Event;

    container = happyWindow.document.createElement("div") as unknown as HTMLDivElement;
    happyWindow.document.body.appendChild(container as any);
    root = createRoot(container);

    originalStoreState = { ...usePlayerStore.getState() };
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    if (originalStoreState) {
      usePlayerStore.setState(originalStoreState, true);
    }
    container.remove();
  });

  it("renders empty state without log button when no track is active", async () => {
    usePlayerStore.setState({
      activeTrack: null,
      activeSegment: null,
      queue: [],
    });

    let queueToggled = false;
    await act(async () => {
      root.render(
        <PlayerBar
          onToggleQueue={() => {
            queueToggled = true;
          }}
          isQueueOpen={false}
        />
      );
    });

    expect(container.textContent).toMatch(/No track selected|Chưa chọn bài hát/);
    expect(container.textContent).not.toMatch(/Logs|Nhật ký/);
    expect(container.querySelector('button[title*="Log"], button[title*="Nhật ký"]')).toBeNull();
    expect(container.querySelector('button[aria-label*="log" i], button[aria-label*="nhật ký" i]')).toBeNull();
    expect(container.querySelector("svg.lucide-terminal")).toBeNull();

    const queueBtn = (container.querySelector('button[title*="Queue"], button[title*="Hàng đợi"]') ||
      container.querySelector('button[aria-label*="queue" i]')) as HTMLButtonElement | null;
    expect(queueBtn).not.toBeNull();
    await act(async () => {
      queueBtn?.click();
    });
    expect(queueToggled).toBe(true);
  });

  it("renders active playback state without log button when track is active", async () => {
    const mockTrack: Track = {
      id: "track-1",
      source_type: "local",
      source_uri: "local://test.mp3",
      title: "Test Track 1",
      artist: "Test Artist",
      duration: 180,
      volume: 0.8,
      created_at: Date.now(),
      status: "ready",
    };

    const mockSegment: Segment = {
      id: "seg-1",
      track_id: "track-1",
      name: "Intro",
      start_time: 0,
      end_time: 30,
      color: "#4385BE",
      created_at: Date.now(),
    };

    usePlayerStore.setState({
      activeTrack: mockTrack,
      activeSegment: mockSegment,
      queue: [{ track: mockTrack, segment: mockSegment }],
      queueIndex: 0,
      isPlaying: false,
    });

    await act(async () => {
      root.render(
        <PlayerBar
          onToggleQueue={() => {}}
          isQueueOpen={false}
        />
      );
    });

    expect(container.textContent).toContain("Test Track 1");
    expect(container.textContent).toContain("Intro");
    expect(container.textContent).not.toMatch(/Logs|Nhật ký/);
    expect(container.querySelector('button[title*="Log"], button[title*="Nhật ký"]')).toBeNull();
    expect(container.querySelector('button[aria-label*="log" i], button[aria-label*="nhật ký" i]')).toBeNull();
    expect(container.querySelector("svg.lucide-terminal")).toBeNull();

    // Verify queue and volume controls exist
    expect(container.querySelector('button[title*="Queue"], button[title*="Hàng đợi"], button[aria-label*="queue" i]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Track volume"], [aria-label="Âm lượng bài hát"]')).not.toBeNull();
  });

  it("renders loop track button and toggles isLoopTrack when clicked", async () => {
    const mockTrack: Track = {
      id: "track-1",
      source_type: "local",
      source_uri: "local://test.mp3",
      title: "Test Track 1",
      duration: 180,
      volume: 0.8,
      created_at: Date.now(),
      status: "ready",
    };
    const mockSegment: Segment = {
      id: "seg-1",
      track_id: "track-1",
      name: "Intro",
      start_time: 0,
      end_time: 30,
      created_at: Date.now(),
    };

    usePlayerStore.setState({
      activeTrack: mockTrack,
      activeSegment: mockSegment,
      queue: [{ track: mockTrack, segment: mockSegment }],
      queueIndex: 0,
      isPlaying: false,
      isLoopTrack: false,
    });

    await act(async () => {
      root.render(
        <PlayerBar
          onToggleQueue={() => {}}
          isQueueOpen={false}
        />
      );
    });

    const loopTrackBtn = container.querySelector('button[aria-label*="loop track" i], button[aria-label*="lặp lại bài" i]') as HTMLButtonElement | null;
    expect(loopTrackBtn).not.toBeNull();
    expect(loopTrackBtn?.getAttribute("aria-pressed")).toBe("false");

    await act(async () => {
      loopTrackBtn?.click();
    });

    expect(usePlayerStore.getState().isLoopTrack).toBe(true);

    await act(async () => {
      root.render(
        <PlayerBar
          onToggleQueue={() => {}}
          isQueueOpen={false}
        />
      );
    });

    const updatedBtn = container.querySelector('button[aria-label*="loop track" i], button[aria-label*="lặp lại bài" i]') as HTMLButtonElement | null;
    expect(updatedBtn?.getAttribute("aria-pressed")).toBe("true");
  });

  it("disables next button at the end of queue when isLoopQueue is false even if isLoopTrack is true", async () => {
    const mockTrack1: Track = {
      id: "track-1",
      source_type: "local",
      source_uri: "local://test1.mp3",
      title: "Test Track 1",
      duration: 180,
      status: "ready",
    };
    const mockTrack2: Track = {
      id: "track-2",
      source_type: "local",
      source_uri: "local://test2.mp3",
      title: "Test Track 2",
      duration: 200,
      status: "ready",
    };
    const mockSegment1: Segment = {
      id: "seg-1",
      track_id: "track-1",
      name: "Seg 1",
      start_time: 0,
      end_time: 30,
    };
    const mockSegment2: Segment = {
      id: "seg-2",
      track_id: "track-2",
      name: "Seg 2",
      start_time: 0,
      end_time: 40,
    };

    usePlayerStore.setState({
      activeTrack: mockTrack2,
      activeSegment: mockSegment2,
      queue: [
        { track: mockTrack1, segment: mockSegment1 },
        { track: mockTrack2, segment: mockSegment2 },
      ],
      queueIndex: 1, // Last item
      isPlaying: true,
      isLoopQueue: false,
      isLoopTrack: true, // Loop track is on, but loop queue is OFF
    });

    await act(async () => {
      root.render(
        <PlayerBar
          onToggleQueue={() => {}}
          isQueueOpen={false}
        />
      );
    });

    const nextBtn = container.querySelector('button[aria-label*="next" i], button[aria-label*="kế tiếp" i]') as HTMLButtonElement | null;
    expect(nextBtn).not.toBeNull();
    // Must be disabled because loop queue is false and we are at the end!
    expect(nextBtn?.disabled).toBe(true);

    // If isLoopQueue is toggled on, next button becomes enabled
    usePlayerStore.setState({ isLoopQueue: true });

    await act(async () => {
      root.render(
        <PlayerBar
          onToggleQueue={() => {}}
          isQueueOpen={false}
        />
      );
    });

    expect(nextBtn?.disabled).toBe(false);
  });
});
