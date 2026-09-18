import { describe, it, expect, beforeEach, afterEach, afterAll } from "bun:test";

// Mock Audio for headless test environment
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
      if (!this.src) return Promise.reject(new Error("No src"));
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
import { QueueDrawer, getBoundaryDropIndex } from "./QueueDrawer";
import { PlayerBar } from "./PlayerBar";
import { usePlayerStore } from "../store/usePlayerStore";
import type { Track, Segment } from "@/server/types";
import i18n from "../i18n";

const dummyTrack: Track = {
  id: "trk_test_1",
  source_type: "youtube",
  source_uri: "yt_1",
  title: "Test Track Title",
  artist: "Test Artist",
  duration: 180,
  thumbnail_url: "https://example.com/thumb.jpg",
  file_path: "/music/test.mp3",
  status: "ready",
  error_message: null,
  created_at: 1000,
  segment_count: 1,
  volume: 0.5,
};

const dummySegment: Segment = {
  id: "seg_test_1",
  track_id: "trk_test_1",
  name: "Verse 1",
  start_time: 10,
  end_time: 40,
  color: "#4385BE",
  created_at: 1000,
};

const dummyTrack2: Track = {
  ...dummyTrack,
  id: "trk_test_2",
  title: "Test Track 2",
};

const dummySegment2: Segment = {
  ...dummySegment,
  id: "seg_test_2",
  track_id: "trk_test_2",
  name: "Verse 2",
};

describe("QueueDrawer & PlayerBar Mode UI", () => {
  let window: any;
  let container: any;
  let root: any;

  beforeEach(async () => {
    await i18n.changeLanguage("vi");
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
      playbackMode: "slices_only",
      currentTime: 0,
      activeTrack: dummyTrack,
      activeSegment: dummySegment,
      isPlaying: true,
      queue: [{ segment: dummySegment, track: dummyTrack }],
      queueIndex: 0,
      queuesByMode: {
        slices_only: [{ segment: dummySegment, track: dummyTrack }],
        original_only: [
          {
            segment: {
              id: "fallback_trk_test_1",
              track_id: "trk_test_1",
              name: "Toàn bộ bài hát",
              start_time: 0,
              end_time: 180,
              color: "#4385BE",
              created_at: 1000,
            },
            track: dummyTrack,
          },
        ],
        mixed: [{ segment: dummySegment, track: dummyTrack }],
      },
      initializedModes: {
        slices_only: true,
        original_only: true,
        mixed: true,
      },
      shuffleByMode: {
        slices_only: false,
        original_only: false,
        mixed: false,
      },
      isShuffle: false,
      isLoopQueue: false,
      isLoopTrack: false,
      activePlaylistPlayingId: null,
      activePlaylistId: null,
      playlists: [],
      activePlaylistItems: [],
      activePlaylistOriginalQueue: [],
    });
  });

  afterEach(async () => {
    await i18n.changeLanguage("en");
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  afterAll(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
    delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
    delete (globalThis as any).window;
    delete (globalThis as any).document;
    delete (globalThis as any).Node;
    delete (globalThis as any).Element;
    delete (globalThis as any).HTMLElement;
    delete (globalThis as any).HTMLImageElement;
  });

  it("QueueDrawer renders playing source badge and active queue items", () => {
    act(() => {
      root.render(<QueueDrawer isOpen={true} onClose={() => {}} />);
    });

    const html = container.innerHTML;
    expect(html).toContain("Hàng Đợi Phát");
    expect(html).toContain("Đang phát");
    expect(html).toContain("Lát cắt");
    expect(html).toContain("Verse 1");
  });

  it("QueueDrawer renders empty state when queue is empty", () => {
    usePlayerStore.setState({
      queue: [],
      queueIndex: -1,
      activeTrack: null,
      activeSegment: null,
    });

    act(() => {
      root.render(<QueueDrawer isOpen={true} onClose={() => {}} />);
    });

    const html = container.innerHTML;
    expect(html).toContain("Hàng đợi đang trống");
  });

  it("PlayerBar renders active playlist mode badge with aria-label", () => {
    usePlayerStore.setState({
      playbackMode: "slices_only",
      activePlaylistPlayingId: null,
      isShuffle: false,
      activeTrack: dummyTrack,
      activeSegment: dummySegment,
      isPlaying: true,
    });

    act(() => {
      root.render(
        <PlayerBar
          onToggleQueue={() => {}}
          isQueueOpen={false}
        />
      );
    });

    const html = container.innerHTML;
    expect(html).toContain('Playlist đang phát: Lát cắt');
    expect(html).toContain('Lát cắt');
  });

  it("PlayerBar does not render a shuffle button in controls", () => {
    usePlayerStore.setState({
      activeTrack: dummyTrack,
      activeSegment: dummySegment,
      isPlaying: true,
    });

    act(() => {
      root.render(
        <PlayerBar
          onToggleQueue={() => {}}
          isQueueOpen={false}
        />
      );
    });

    const shuffleBtn = container.querySelector(
      'button[aria-label*="shuffle" i], button[title*="shuffle" i], button[title*="xáo trộn" i], button svg.lucide-shuffle'
    );
    expect(shuffleBtn).toBeNull();
  });

  it("PlayerBar transport controls render with accessible aria-labels and queue aria-expanded", () => {
    usePlayerStore.setState({
      activeTrack: dummyTrack,
      activeSegment: dummySegment,
      isPlaying: true,
    });

    act(() => {
      root.render(
        <PlayerBar
          onToggleQueue={() => {}}
          isQueueOpen={true}
        />
      );
    });

    expect(container.querySelector('button[aria-label="Đoạn trước"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Tạm dừng"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Đoạn kế tiếp"]')).not.toBeNull();
    expect(container.querySelector('button[aria-expanded="true"][aria-controls="queue-drawer"]')).not.toBeNull();
  });

  it("QueueDrawer shows 'Khôi phục thứ tự ban đầu' button when isShuffle is active and calls toggleShuffle", async () => {
    let toggleShuffleCalled = false;
    const origToggleShuffle = usePlayerStore.getState().toggleShuffle;

    try {
      usePlayerStore.setState({
        isShuffle: true,
        queue: [
          { segment: dummySegment, track: dummyTrack },
          { segment: dummySegment2, track: dummyTrack2 },
        ],
        toggleShuffle: (() => {
          toggleShuffleCalled = true;
        }) as any,
      });

      act(() => {
        root.render(<QueueDrawer isOpen={true} onClose={() => {}} />);
      });

      const restoreBtn = container.querySelector('button[aria-label="Khôi phục thứ tự ban đầu"]') as HTMLButtonElement;
      expect(restoreBtn).not.toBeNull();

      await act(async () => {
        restoreBtn.click();
        await new Promise((resolve) => setTimeout(resolve, 30));
      });

      expect(toggleShuffleCalled).toBe(true);
    } finally {
      usePlayerStore.setState({
        isShuffle: false,
        toggleShuffle: origToggleShuffle,
      });
    }
  });

  it("QueueDrawer shows loop queue button and calls toggleLoopQueue when clicked", async () => {
    let toggleLoopQueueCalled = false;
    const origToggleLoopQueue = usePlayerStore.getState().toggleLoopQueue;

    try {
      usePlayerStore.setState({
        isLoopQueue: false,
        toggleLoopQueue: (() => {
          toggleLoopQueueCalled = true;
        }) as any,
      });

      act(() => {
        root.render(<QueueDrawer isOpen={true} onClose={() => {}} />);
      });

      const loopBtn = container.querySelector('button[aria-label*="loop queue" i], button[aria-label*="lặp lại hàng đợi" i]') as HTMLButtonElement;
      expect(loopBtn).not.toBeNull();
      expect(loopBtn.getAttribute("aria-pressed")).toBe("false");

      await act(async () => {
        loopBtn.click();
      });

      expect(toggleLoopQueueCalled).toBe(true);
    } finally {
      usePlayerStore.setState({
        isLoopQueue: false,
        toggleLoopQueue: origToggleLoopQueue,
      });
    }
  });

  it("QueueDrawer displays custom playlist name when activePlaylistPlayingId is set", () => {
    usePlayerStore.setState({
      activePlaylistPlayingId: "pl_my_mix",
      playlists: [
        {
          id: "pl_my_mix",
          name: "My Awesome Mix",
          created_at: 1000,
          updated_at: 1000,
          item_count: 5,
        },
      ],
    });

    act(() => {
      root.render(<QueueDrawer isOpen={true} onClose={() => {}} />);
    });

    const html = container.innerHTML;
    expect(html).toContain("My Awesome Mix");
    expect(html).toContain("Đang phát");
  });

  it("QueueDrawer does NOT mark any item as isCurrent when player is idle (activeSegment is null)", () => {
    usePlayerStore.setState({
      playbackMode: "slices_only",
      activeTrack: null,
      activeSegment: null,
      isPlaying: false,
      queue: [{ segment: dummySegment, track: dummyTrack }],
      queueIndex: 0, // stale queueIndex while idle
      queuesByMode: {
        slices_only: [{ segment: dummySegment, track: dummyTrack }],
        original_only: [],
        mixed: [],
      },
      initializedModes: {
        slices_only: true,
        original_only: true,
        mixed: true,
      },
    });

    act(() => {
      root.render(<QueueDrawer isOpen={true} onClose={() => {}} />);
    });

    const html = container.innerHTML;
    // Should NOT have the active ring/border or 'Đang phát' label on the item
    expect(html).not.toContain("border-primary bg-primary/10");
  });

  it("QueueDrawer does NOT mark item as isCurrent when playing an out-of-mode transitional segment", () => {
    const transitionalSegment = {
      ...dummySegment,
      id: "foreign_slice_999",
      name: "Transitional Foreign Slice",
    };

    usePlayerStore.setState({
      playbackMode: "slices_only",
      activeTrack: dummyTrack,
      activeSegment: transitionalSegment, // out-of-mode segment playing
      isPlaying: true,
      queue: [{ segment: dummySegment, track: dummyTrack }],
      queueIndex: 0,
      queuesByMode: {
        slices_only: [{ segment: dummySegment, track: dummyTrack }],
        original_only: [],
        mixed: [],
      },
      initializedModes: {
        slices_only: true,
        original_only: true,
        mixed: true,
      },
    });

    act(() => {
      root.render(<QueueDrawer isOpen={true} onClose={() => {}} />);
    });

    const html = container.innerHTML;
    // In-queue item (dummySegment) must NOT be marked isCurrent since foreign_slice_999 is playing!
    expect(html).not.toContain("border-primary bg-primary/10");
  });

  it("header shuffle button calls reshuffleCurrentQueue", () => {
    let shuffleCalled = false;
    const origReshuffle = usePlayerStore.getState().reshuffleCurrentQueue;

    try {
      usePlayerStore.setState({
        queue: [
          { segment: dummySegment, track: dummyTrack },
          {
            segment: {
              id: "seg_test_2",
              track_id: "trk_test_1",
              name: "Chorus",
              start_time: 40,
              end_time: 80,
              color: "#E25D56",
              created_at: 1000,
            },
            track: dummyTrack,
          },
        ],
        reshuffleCurrentQueue: (() => {
          shuffleCalled = true;
        }) as any,
      });

      act(() => {
        root.render(<QueueDrawer isOpen={true} onClose={() => {}} />);
      });

      const shuffleBtn = container.querySelector('button[title*="Xáo trộn"]');
      expect(shuffleBtn).not.toBeNull();

      act(() => {
        shuffleBtn?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      });

      expect(shuffleCalled).toBe(true);
    } finally {
      act(() => {
        usePlayerStore.setState({
          reshuffleCurrentQueue: origReshuffle,
        });
      });
    }
  });

  it("clicking shuffle button resets scroll to top (scrollTop 0) and selects track at index 0", () => {
    const origReshuffle = usePlayerStore.getState().reshuffleCurrentQueue;
    try {
      usePlayerStore.setState({
        queue: [
          { segment: dummySegment, track: dummyTrack },
          {
            segment: {
              id: "seg_test_2",
              track_id: "trk_test_1",
              name: "Chorus",
              start_time: 40,
              end_time: 80,
              color: "#E25D56",
              created_at: 1000,
            },
            track: dummyTrack,
          },
        ],
        queueIndex: 1,
        activeSegment: {
          id: "seg_test_2",
          track_id: "trk_test_1",
          name: "Chorus",
          start_time: 40,
          end_time: 80,
          color: "#E25D56",
          created_at: 1000,
        },
        playbackMode: "mixed",
        queuesByMode: {
          mixed: [
            { segment: dummySegment, track: dummyTrack },
            {
              segment: {
                id: "seg_test_2",
                track_id: "trk_test_1",
                name: "Chorus",
                start_time: 40,
                end_time: 80,
                color: "#E25D56",
                created_at: 1000,
              },
              track: dummyTrack,
            },
          ],
          slices_only: [],
          original_only: [],
        },
      });

      act(() => {
        root.render(<QueueDrawer isOpen={true} onClose={() => {}} />);
      });

      const listContainer = container.querySelector('[role="region"][aria-label="Danh sách phát hiện tại"]') as HTMLElement;
      expect(listContainer).not.toBeNull();
      if (listContainer) {
        listContainer.scrollTop = 250;
      }

      const shuffleBtn = container.querySelector('button[title*="Xáo trộn"]');
      expect(shuffleBtn).not.toBeNull();

      act(() => {
        shuffleBtn?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      });

      expect(listContainer.scrollTop).toBe(0);
      expect(usePlayerStore.getState().queueIndex).toBe(0);
    } finally {
      act(() => {
        usePlayerStore.setState({
          reshuffleCurrentQueue: origReshuffle,
        });
      });
    }
  });

  it("clicking play on an item in QueueDrawer calls playSegment", async () => {
    let playedItem: any = null;
    const origPlaySegment = usePlayerStore.getState().playSegment;

    try {
      usePlayerStore.setState({
        playbackMode: "slices_only",
        activeTrack: dummyTrack,
        activeSegment: dummySegment,
        isPlaying: true,
        queue: [{ segment: dummySegment, track: dummyTrack }],
        queueIndex: 0,
        playSegment: ((seg: any) => {
          playedItem = seg.id;
          return Promise.resolve();
        }) as any,
      });

      act(() => {
        root.render(<QueueDrawer isOpen={true} onClose={() => {}} />);
      });

      // Find the play button for the item
      const playBtn = container.querySelector('[role="button"][aria-label^="Phát"]');
      expect(playBtn).not.toBeNull();

      await act(async () => {
        playBtn?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      });

      expect(playedItem).toBe(dummySegment.id);
    } finally {
      act(() => {
        usePlayerStore.setState({
          playSegment: origPlaySegment,
        });
      });
    }
  });

  it("QueueDrawer virtualizes queue items and sets total size container", () => {
    const manyItems = Array.from({ length: 25 }, (_, i) => ({
      segment: {
        id: `seg_batch_${i}`,
        track_id: `trk_batch_${i}`,
        name: `Batch Segment ${i}`,
        start_time: i * 10,
        end_time: (i + 1) * 10,
        created_at: 1000 + i,
      },
      track: {
        ...dummyTrack,
        id: `trk_batch_${i}`,
        title: `Batch Track ${i}`,
      },
    }));

    usePlayerStore.setState({
      playbackMode: "slices_only",
      activeTrack: manyItems[0].track,
      activeSegment: manyItems[0].segment,
      isPlaying: true,
      queue: manyItems,
      queueIndex: 0,
    });

    act(() => {
      root.render(<QueueDrawer isOpen={true} onClose={() => {}} />);
    });

    // Outer scrollable container should exist
    const scrollContainer = container.querySelector('[role="region"][aria-label="Danh sách phát hiện tại"]');
    expect(scrollContainer).not.toBeNull();

    // Virtual container should have total height (25 items * ~62px = ~1550px)
    const virtualWrapper = scrollContainer?.querySelector('[role="list"]');
    expect(virtualWrapper).not.toBeNull();
    const styleAttr = virtualWrapper?.getAttribute("style") || "";
    expect(styleAttr).toContain("position: relative");
    expect(styleAttr).toContain("height:");

    // Rendered items should have role="listitem", absolute positioning and translateY
    const renderedRows = virtualWrapper?.querySelectorAll('[data-index]');
    expect(renderedRows?.length).toBeGreaterThan(0);
    expect(renderedRows?.length).toBeLessThanOrEqual(25);
    expect(renderedRows?.[0]?.getAttribute("role")).toBe("listitem");
  });

  it("QueueDrawer handles keyboard reordering with ArrowDown and ArrowUp", () => {
    let reorderCalledWith: [number, number] | null = null;
    const origReorder = usePlayerStore.getState().reorderQueue;

    try {
      usePlayerStore.setState({
        queue: [
          { segment: dummySegment, track: dummyTrack },
          {
            segment: {
              id: "seg_test_2",
              track_id: "trk_test_1",
              name: "Chorus",
              start_time: 40,
              end_time: 80,
              created_at: 1000,
            },
            track: dummyTrack,
          },
        ],
        reorderQueue: ((from: number, to: number) => {
          reorderCalledWith = [from, to];
        }) as any,
      });

      act(() => {
        root.render(<QueueDrawer isOpen={true} onClose={() => {}} />);
      });

      const dragHandle = container.querySelector('[data-drag-handle="true"]');
      expect(dragHandle).not.toBeNull();

      act(() => {
        dragHandle?.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
      });

      expect(reorderCalledWith as [number, number] | null).toEqual([0, 1]);
    } finally {
      act(() => {
        usePlayerStore.setState({
          reorderQueue: origReorder,
        });
      });
    }
  });

  it("QueueDrawer dismisses with Escape key", () => {
    let closed = false;
    act(() => {
      root.render(<QueueDrawer isOpen={true} onClose={() => { closed = true; }} />);
    });

    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();

    act(() => {
      dialog?.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(closed).toBe(true);
  });

  describe("getBoundaryDropIndex", () => {
    it("returns null for empty items or null container", () => {
      expect(getBoundaryDropIndex(100, null, 10)).toBeNull();
      const div = document.createElement("div");
      expect(getBoundaryDropIndex(100, div, 0)).toBeNull();
    });

    it("returns 0 when near top and scrollTop is 0", () => {
      const div = document.createElement("div");
      div.scrollTop = 0;
      const rect = { top: 100, bottom: 500, left: 0, right: 300, width: 300, height: 400 } as DOMRect;
      expect(getBoundaryDropIndex(110, div, 10, rect)).toBe(0);
    });

    it("returns totalItems - 1 when at or below bottom", () => {
      const div = document.createElement("div");
      div.scrollTop = 500;
      Object.defineProperty(div, "scrollHeight", { value: 900 });
      Object.defineProperty(div, "clientHeight", { value: 400 });
      const rect = { top: 100, bottom: 500, left: 0, right: 300, width: 300, height: 400 } as DOMRect;
      expect(getBoundaryDropIndex(490, div, 10, rect)).toBe(9);
    });

    it("returns null when hovering in middle of list", () => {
      const div = document.createElement("div");
      div.scrollTop = 100;
      Object.defineProperty(div, "scrollHeight", { value: 1000 });
      Object.defineProperty(div, "clientHeight", { value: 400 });
      const rect = { top: 100, bottom: 500, left: 0, right: 300, width: 300, height: 400 } as DOMRect;
      expect(getBoundaryDropIndex(250, div, 10, rect, 800)).toBeNull();
    });
  });

  it("QueueDrawer calls removeQueueItemAtIndex when delete button is clicked", () => {
    let removedIndex: number | null = null;
    const origRemove = usePlayerStore.getState().removeQueueItemAtIndex;

    try {
      usePlayerStore.setState({
        playbackMode: "slices_only",
        activeTrack: dummyTrack,
        activeSegment: dummySegment,
        isPlaying: true,
        queue: [
          { segment: dummySegment, track: dummyTrack },
          { segment: dummySegment2, track: dummyTrack2 },
        ],
        queueIndex: 0,
        removeQueueItemAtIndex: ((idx: number) => {
          removedIndex = idx;
        }) as any,
      });

      act(() => {
        root.render(<QueueDrawer isOpen={true} onClose={() => {}} />);
      });

      const deleteButtons = container.querySelectorAll('button[aria-label*="Xóa"]');
      expect(deleteButtons.length).toBeGreaterThan(0);

      act(() => {
        deleteButtons[0]?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      });

      expect(removedIndex as number | null).toBe(0 as number | null);
    } finally {
      act(() => {
        usePlayerStore.setState({
          removeQueueItemAtIndex: origRemove,
        });
      });
    }
  });

  it("QueueDrawer handles Home and End keys on drag handle", () => {
    let reorderCalledWith: [number, number] | null = null;
    const origReorder = usePlayerStore.getState().reorderQueue;

    try {
      usePlayerStore.setState({
        playbackMode: "slices_only",
        activeTrack: dummyTrack,
        activeSegment: dummySegment,
        isPlaying: true,
        queue: [
          { segment: dummySegment, track: dummyTrack },
          { segment: dummySegment2, track: dummyTrack2 },
          { segment: { ...dummySegment, id: "seg_3", name: "Segment 3" }, track: dummyTrack },
        ],
        queueIndex: 1,
        reorderQueue: ((from: number, to: number) => {
          reorderCalledWith = [from, to];
        }) as any,
      });

      act(() => {
        root.render(<QueueDrawer isOpen={true} onClose={() => {}} />);
      });

      const dragHandles = container.querySelectorAll('[data-drag-handle="true"]');
      expect(dragHandles.length).toBeGreaterThan(1);

      // Press Home on item 1 -> moves to 0
      act(() => {
        dragHandles[1]?.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Home", bubbles: true }));
      });
      expect(reorderCalledWith as [number, number] | null).toEqual([1, 0]);

      // Press End on item 0 -> moves to 2 (totalItems - 1)
      act(() => {
        dragHandles[0]?.dispatchEvent(new window.KeyboardEvent("keydown", { key: "End", bubbles: true }));
      });
      expect(reorderCalledWith as [number, number] | null).toEqual([0, 2]);
    } finally {
      act(() => {
        usePlayerStore.setState({
          reorderQueue: origReorder,
        });
      });
    }
  });

  it("QueueDrawer traps focus with Tab and Shift+Tab", () => {
    usePlayerStore.setState({
      queue: [
        { segment: dummySegment, track: dummyTrack },
        { segment: dummySegment2, track: dummyTrack2 },
      ],
      queueIndex: 0,
    });

    act(() => {
      root.render(<QueueDrawer isOpen={true} onClose={() => {}} />);
    });

    const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog).not.toBeNull();

    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]):not([tabindex="-1"]), [tabindex="0"]:not([disabled]), a[href], input:not([disabled])'
      )
    );
    expect(focusable.length).toBeGreaterThan(1);

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    // Focus last, press Tab -> should wrap to first
    last.focus();
    expect(document.activeElement).toBe(last);

    act(() => {
      dialog.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    });
    expect(document.activeElement).toBe(first);

    // Focus first, press Shift+Tab -> should wrap to last
    first.focus();
    expect(document.activeElement).toBe(first);

    act(() => {
      dialog.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true }));
    });
    expect(document.activeElement).toBe(last);
  });

  it("QueueDrawer restores focus to triggering element on close", () => {
    const triggerBtn = document.createElement("button");
    document.body.appendChild(triggerBtn);
    triggerBtn.focus();
    expect(document.activeElement).toBe(triggerBtn);

    act(() => {
      root.render(<QueueDrawer isOpen={true} onClose={() => {}} />);
    });

    // Close drawer
    act(() => {
      root.render(<QueueDrawer isOpen={false} onClose={() => {}} />);
    });

    expect(document.activeElement).toBe(triggerBtn);
    document.body.removeChild(triggerBtn);
  });

  it("QueueDrawer cancels active drag on Escape instead of closing drawer", () => {
    let closed = false;
    usePlayerStore.setState({
      queue: [
        { segment: dummySegment, track: dummyTrack },
        { segment: dummySegment2, track: dummyTrack2 },
      ],
      queueIndex: 0,
    });

    act(() => {
      root.render(<QueueDrawer isOpen={true} onClose={() => { closed = true; }} />);
    });

    const dragHandles = container.querySelectorAll('[data-drag-handle="true"]');
    expect(dragHandles.length).toBeGreaterThan(0);

    // Mouse down on drag handle to initiate dragging
    act(() => {
      dragHandles[0]?.dispatchEvent(new window.MouseEvent("mousedown", { button: 0, bubbles: true }));
    });

    // Press Escape on dialog
    const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
    act(() => {
      dialog.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });

    // onClose should NOT have been called because drag was active
    expect(closed).toBe(false);

    // Pressing Escape again now that drag is reset SHOULD call onClose
    act(() => {
      dialog.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    expect(closed).toBe(true);
  });

  it("QueueDrawer handles mobile reorder buttons", () => {
    let reorderCalled: [number, number] | null = null;
    const origReorder = usePlayerStore.getState().reorderQueue;

    try {
      usePlayerStore.setState({
        queue: [
          { segment: dummySegment, track: dummyTrack },
          { segment: dummySegment2, track: dummyTrack2 },
        ],
        queueIndex: 0,
        reorderQueue: ((from: number, to: number) => {
          reorderCalled = [from, to];
        }) as any,
      });

      act(() => {
        root.render(<QueueDrawer isOpen={true} onClose={() => {}} />);
      });

      const moveDownBtn = container.querySelector('button[aria-label*="Chuyển"][aria-label*="xuống"]');
      expect(moveDownBtn).not.toBeNull();

      act(() => {
        moveDownBtn?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      });

      expect(reorderCalled as [number, number] | null).toEqual([0, 1]);
    } finally {
      act(() => {
        usePlayerStore.setState({ reorderQueue: origReorder });
      });
    }
  });

  it("QueueDrawer dismisses when clicking backdrop", () => {
    let closed = false;
    act(() => {
      root.render(<QueueDrawer isOpen={true} onClose={() => { closed = true; }} />);
    });

    const backdrop = container.querySelector('[aria-hidden="true"]');
    expect(backdrop).not.toBeNull();

    act(() => {
      backdrop?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });

    expect(closed).toBe(true);
  });

  it("QueueDrawer advances virtualized rows when tabbing at edge of rendered window", () => {
    const thirtyItems = Array.from({ length: 30 }, (_, i) => ({
      queueItemId: `queue_batch_${i}`,
      segment: {
        ...dummySegment,
        id: `seg_batch_${i}`,
        name: `Batch Segment ${i}`,
      },
      track: dummyTrack,
    }));

    usePlayerStore.setState({
      queue: thirtyItems,
      queueIndex: 0,
    });

    act(() => {
      root.render(<QueueDrawer isOpen={true} onClose={() => {}} />);
    });

    const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog).not.toBeNull();

    const shuffleBtn = container.querySelector('button[title*="Xáo trộn"]') as HTMLElement;

    // Find all rendered rows in the virtual list and focus the last interactive button of the last rendered row
    const renderedRows = Array.from(container.querySelectorAll('[data-index]')) as HTMLElement[];
    expect(renderedRows.length).toBeGreaterThan(0);
    const lastRow = renderedRows[renderedRows.length - 1];
    const lastRowButtons = Array.from(lastRow.querySelectorAll('button:not([disabled])')) as HTMLElement[];
    const lastInLastRow = lastRowButtons[lastRowButtons.length - 1];
    lastInLastRow.focus();

    // Tab at the edge of the window should advance to the next off-screen row rather than wrapping to the top
    act(() => {
      dialog.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    });

    expect(document.activeElement).not.toBe(shuffleBtn);
  });

  it("QueueDrawer preserves focus inside drawer when item is deleted", () => {
    let removedIndex: number | null = null;
    const origRemove = usePlayerStore.getState().removeQueueItemAtIndex;

    try {
      usePlayerStore.setState({
        queue: [
          { segment: dummySegment, track: dummyTrack },
          { segment: dummySegment2, track: dummyTrack2 },
        ],
        queueIndex: 0,
        removeQueueItemAtIndex: ((idx: number) => {
          removedIndex = idx;
          usePlayerStore.setState((s) => ({
            queue: s.queue.filter((_, i) => i !== idx),
          }));
        }) as any,
      });

      act(() => {
        root.render(<QueueDrawer isOpen={true} onClose={() => {}} />);
      });

      const deleteBtns = Array.from(container.querySelectorAll('button[aria-label*="Xóa"]')) as HTMLElement[];
      expect(deleteBtns.length).toBeGreaterThan(0);

      deleteBtns[0].focus();
      expect(document.activeElement).toBe(deleteBtns[0]);

      act(() => {
        deleteBtns[0].dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      });

      expect(removedIndex as number | null).toBe(0);
      expect(document.activeElement).not.toBe(document.body);
    } finally {
      act(() => {
        usePlayerStore.setState({ removeQueueItemAtIndex: origRemove });
      });
    }
  });

  it("QueueDrawer transfers focus to remaining shuffle button when 'Khôi phục thứ tự ban đầu' unmounts", async () => {
    let toggled = false;
    const origToggleShuffle = usePlayerStore.getState().toggleShuffle;
    usePlayerStore.setState({
      queue: [
        { segment: dummySegment, track: dummyTrack },
        { segment: dummySegment2, track: dummyTrack2 },
      ],
      queueIndex: 0,
      isShuffle: true,
      toggleShuffle: () => {
        toggled = true;
        usePlayerStore.setState({ isShuffle: false });
      },
    });

    try {
      act(() => {
        root.render(<QueueDrawer isOpen={true} onClose={() => {}} />);
      });

      const restoreBtn = container.querySelector('button[title="Khôi phục thứ tự ban đầu"]') as HTMLButtonElement | null;
      expect(restoreBtn).not.toBeNull();

      await act(async () => {
        restoreBtn?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 30));
      });

      expect(toggled).toBe(true);
      expect(usePlayerStore.getState().isShuffle).toBe(false);
      // Focus should remain inside the drawer and not fall back to document.body
      expect(document.activeElement).not.toBe(document.body);
    } finally {
      act(() => {
        usePlayerStore.setState({ toggleShuffle: origToggleShuffle, isShuffle: false });
      });
    }
  });

  it("QueueDrawer empty state copy does not reference shuffle", () => {
    usePlayerStore.setState({
      queue: [],
      queueIndex: -1,
      activeTrack: null,
      activeSegment: null,
    });

    act(() => {
      root.render(<QueueDrawer isOpen={true} onClose={() => {}} />);
    });

    const html = container.innerHTML;
    expect(html).toContain("Chọn một danh sách phát hoặc bài hát trong thư viện để bắt đầu nghe nhạc.");
    expect(html).not.toContain("bấm Shuffle để bắt đầu nghe nhạc");
  });

  it("QueueDrawer has proper WAI-ARIA aria-labelledby relationship with title", () => {
    act(() => {
      root.render(<QueueDrawer isOpen={true} onClose={() => {}} />);
    });

    const dialog = container.querySelector('div[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute("aria-labelledby")).toBe("queue-drawer-title");

    const titleEl = container.querySelector("#queue-drawer-title");
    expect(titleEl).not.toBeNull();
    expect(titleEl?.textContent).toBe("Hàng Đợi Phát");
  });

  it("QueueDrawer handles Shift+Tab reverse navigation from first focusable in row", () => {
    usePlayerStore.setState({
      queue: [
        { segment: dummySegment, track: dummyTrack },
        { segment: dummySegment2, track: dummyTrack2 },
      ],
      queueIndex: 0,
    });

    act(() => {
      root.render(<QueueDrawer isOpen={true} onClose={() => {}} />);
    });

    const row1 = container.querySelector('[data-index="1"]') as HTMLElement | null;
    expect(row1).not.toBeNull();

    const firstFocusableInRow1 = row1?.querySelector('button:not([disabled]):not([tabindex="-1"]), [tabindex="0"]:not([disabled])') as HTMLElement | null;
    expect(firstFocusableInRow1).not.toBeNull();

    act(() => {
      firstFocusableInRow1?.focus();
    });
    expect(document.activeElement).toBe(firstFocusableInRow1);

    const drawer = container.querySelector('div[role="dialog"]') as HTMLElement;
    const shiftTabEvt = new window.KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });

    act(() => {
      drawer.dispatchEvent(shiftTabEvt);
    });

    // Event should have called preventDefault() and moved focus or scheduled focus to row 0
    expect(shiftTabEvt.defaultPrevented).toBe(true);
    const row0 = container.querySelector('[data-index="0"]') as HTMLElement;
    expect(row0.contains(document.activeElement)).toBe(true);
  });

  it("QueueDrawer does NOT show 'Khôi phục thứ tự ban đầu' button when queue is empty even if isShuffle is true", () => {
    usePlayerStore.setState({
      isShuffle: true,
      queue: [],
      queueIndex: -1,
      activeTrack: null,
      activeSegment: null,
    });

    act(() => {
      root.render(<QueueDrawer isOpen={true} onClose={() => {}} />);
    });

    const restoreBtn = container.querySelector('button[title="Khôi phục thứ tự ban đầu"]');
    expect(restoreBtn).toBeNull();
  });

  it("PlayerBar handles pointer scrubbing on progress slider and seeks audio", () => {
    let seekedTime: number | null = null;
    const origSeek = usePlayerStore.getState().seek;
    usePlayerStore.setState({
      activeTrack: dummyTrack,
      activeSegment: dummySegment,
      currentTime: 10,
      isPlaying: true,
      seek: ((time: number) => {
        seekedTime = time;
      }) as any,
    });

    try {
      act(() => {
        root.render(
          <PlayerBar
            onToggleQueue={() => {}}
            isQueueOpen={false}
          />
        );
      });

      const slider = container.querySelector('[role="slider"]') as HTMLElement | null;
      expect(slider).not.toBeNull();

      slider!.getBoundingClientRect = () => ({
        left: 0,
        top: 0,
        right: 100,
        bottom: 10,
        width: 100,
        height: 10,
        x: 0,
        y: 0,
        toJSON: () => {},
      });

      act(() => {
        const pDown = new window.MouseEvent("pointerdown", { bubbles: true, clientX: 50, clientY: 5 });
        (pDown as any).pointerId = 1;
        slider!.dispatchEvent(pDown);
      });

      act(() => {
        const pUp = new window.MouseEvent("pointerup", { bubbles: true, clientX: 50, clientY: 5 });
        (pUp as any).pointerId = 1;
        slider!.dispatchEvent(pUp);
      });

      expect<number | null>(seekedTime).toBe(25);
    } finally {
      usePlayerStore.setState({ seek: origSeek });
    }
  });

  it("PlayerBar skip buttons handle 1-item queue and empty queue correctly", () => {
    usePlayerStore.setState({
      activeTrack: dummyTrack,
      activeSegment: dummySegment,
      queue: [{ segment: dummySegment, track: dummyTrack }],
      queueIndex: 0,
      isPlaying: true,
    });

    act(() => {
      root.render(
        <PlayerBar
          onToggleQueue={() => {}}
          isQueueOpen={false}
        />
      );
    });

    const prevBtn = container.querySelector('button[aria-label="Đoạn trước"]') as HTMLButtonElement | null;
    const nextBtn = container.querySelector('button[aria-label="Đoạn kế tiếp"]') as HTMLButtonElement | null;
    // prevBtn is enabled on 1-item queue so user can restart/rewind the current track
    expect(prevBtn?.disabled).toBe(false);
    expect(nextBtn?.disabled).toBe(true);

    // When playing a transitional segment not matching the 1-item queue item,
    // nextBtn is enabled to allow jumping into the queue
    usePlayerStore.setState({
      activeTrack: dummyTrack2,
      activeSegment: dummySegment2,
      queue: [{ segment: dummySegment, track: dummyTrack }],
      queueIndex: 0,
      isPlaying: true,
    });

    act(() => {
      root.render(
        <PlayerBar
          onToggleQueue={() => {}}
          isQueueOpen={false}
        />
      );
    });

    const nextBtnTransitional = container.querySelector('button[aria-label="Đoạn kế tiếp"]') as HTMLButtonElement | null;
    expect(nextBtnTransitional?.disabled).toBe(false);

    // Also when queueIndex is -1 (standard transitional state from store playSegment)
    usePlayerStore.setState({
      activeTrack: dummyTrack2,
      activeSegment: dummySegment2,
      queue: [{ segment: dummySegment, track: dummyTrack }],
      queueIndex: -1,
      isPlaying: true,
    });

    act(() => {
      root.render(
        <PlayerBar
          onToggleQueue={() => {}}
          isQueueOpen={false}
        />
      );
    });

    const nextBtnTransitionalNegative = container.querySelector('button[aria-label="Đoạn kế tiếp"]') as HTMLButtonElement | null;
    expect(nextBtnTransitionalNegative?.disabled).toBe(false);

    // With empty queue, both prev and next buttons are disabled
    usePlayerStore.setState({
      activeTrack: dummyTrack,
      activeSegment: dummySegment,
      queue: [],
      queueIndex: -1,
      isPlaying: false,
    });

    act(() => {
      root.render(
        <PlayerBar
          onToggleQueue={() => {}}
          isQueueOpen={false}
        />
      );
    });

    const prevBtnEmpty = container.querySelector('button[aria-label="Đoạn trước"]') as HTMLButtonElement | null;
    const nextBtnEmpty = container.querySelector('button[aria-label="Đoạn kế tiếp"]') as HTMLButtonElement | null;
    expect(prevBtnEmpty).not.toBeNull();
    expect(prevBtnEmpty?.disabled).toBe(true);
    expect(nextBtnEmpty).not.toBeNull();
    expect(nextBtnEmpty?.disabled).toBe(true);
  });

  it("QueueDrawer shuffle button reflects action state matching isShuffle", () => {
    usePlayerStore.setState({
      isShuffle: true,
      queue: [
        { segment: dummySegment, track: dummyTrack },
        { segment: dummySegment2, track: dummyTrack2 },
      ],
    });

    act(() => {
      root.render(<QueueDrawer isOpen={true} onClose={() => {}} />);
    });

    const shuffleBtn = container.querySelector('button[aria-label="Xáo trộn lại hàng đợi"]') as HTMLButtonElement;
    expect(shuffleBtn).not.toBeNull();
    expect(shuffleBtn.getAttribute("title")).toBe("Xáo trộn lại hàng đợi");
    expect(shuffleBtn.hasAttribute("aria-pressed")).toBe(false);
    expect(shuffleBtn.className).not.toContain("text-flexoki-green");
    expect(shuffleBtn.getAttribute("aria-description")).toBe(
      "Hàng đợi đang xáo trộn. Bấm để xáo trộn lại, hoặc bấm Khôi phục để quay về thứ tự gốc."
    );

    // Restore button appears when isShuffle is true
    const restoreBtn = container.querySelector('button[aria-label="Khôi phục thứ tự ban đầu"]');
    expect(restoreBtn).not.toBeNull();

    act(() => {
      usePlayerStore.setState({ isShuffle: false });
      root.render(<QueueDrawer isOpen={true} onClose={() => {}} />);
    });

    const offShuffleBtn = container.querySelector('button[aria-label="Xáo trộn hàng đợi"]') as HTMLButtonElement;
    expect(offShuffleBtn).not.toBeNull();
    expect(offShuffleBtn.getAttribute("title")).toBe("Xáo trộn thứ tự phát trong hàng đợi");
    expect(offShuffleBtn.hasAttribute("aria-pressed")).toBe(false);
    expect(offShuffleBtn.getAttribute("aria-description")).toBeNull();

    // Boundary condition: disabled when queue length <= 1
    act(() => {
      usePlayerStore.setState({
        queue: [{ segment: dummySegment, track: dummyTrack }],
      });
      root.render(<QueueDrawer isOpen={true} onClose={() => {}} />);
    });

    const disabledShuffleBtn = container.querySelector('button[aria-label="Xáo trộn hàng đợi"]') as HTMLButtonElement;
    expect(disabledShuffleBtn).not.toBeNull();
    expect(disabledShuffleBtn.disabled).toBe(true);
  });

  it("PlayerBar queue toggle buttons have correct aria-haspopup, aria-expanded, and aria-controls", () => {
    // Test empty state
    usePlayerStore.setState({
      activeTrack: null,
      activeSegment: null,
      queue: [],
      queueIndex: -1,
      isPlaying: false,
    });

    act(() => {
      root.render(<PlayerBar onToggleQueue={() => {}} isQueueOpen={false} />);
    });

    const emptyQueueBtn = (container.querySelector('button[aria-controls="queue-drawer"]') ||
      container.querySelector('button[title*="Hàng đợi"]')) as HTMLButtonElement;
    expect(emptyQueueBtn).not.toBeNull();
    expect(emptyQueueBtn.getAttribute("aria-haspopup")).toBe("dialog");
    expect(emptyQueueBtn.getAttribute("aria-expanded")).toBe("false");
    expect(emptyQueueBtn.getAttribute("aria-controls")).toBe("queue-drawer");

    // Test active playback state
    usePlayerStore.setState({
      activeTrack: dummyTrack,
      activeSegment: dummySegment,
      queue: [{ segment: dummySegment, track: dummyTrack }],
      queueIndex: 0,
      isPlaying: true,
    });

    act(() => {
      root.render(<PlayerBar onToggleQueue={() => {}} isQueueOpen={true} />);
    });

    const activeQueueBtn = (container.querySelector('button[aria-controls="queue-drawer"]') ||
      container.querySelector('button[title*="Hàng đợi"]')) as HTMLButtonElement;
    expect(activeQueueBtn).not.toBeNull();
    expect(activeQueueBtn.getAttribute("aria-haspopup")).toBe("dialog");
    expect(activeQueueBtn.getAttribute("aria-expanded")).toBe("true");
    expect(activeQueueBtn.getAttribute("aria-controls")).toBe("queue-drawer");
  });

  it("PlayerBar displays subtle shuffle indicator in badge when isShuffle is true", () => {
    usePlayerStore.setState({
      activeTrack: dummyTrack,
      activeSegment: dummySegment,
      isShuffle: true,
      isPlaying: true,
    });

    act(() => {
      root.render(
        <PlayerBar
          onToggleQueue={() => {}}
          isQueueOpen={false}
        />
      );
    });

    const badge = container.querySelector('[aria-label*="đang xáo trộn" i], [aria-label*="Shuffled" i]');
    expect(badge).not.toBeNull();

    act(() => {
      usePlayerStore.setState({ isShuffle: false });
      root.render(
        <PlayerBar
          onToggleQueue={() => {}}
          isQueueOpen={false}
        />
      );
    });

    const unShuffledBadge = container.querySelector('[aria-label*="đang xáo trộn"]');
    expect(unShuffledBadge).toBeNull();
  });

  it("QueueDrawer reorders items via HTML5 drag-and-drop events", () => {
    let reorderCalledWith: [number, number] | null = null;
    const origReorder = usePlayerStore.getState().reorderQueue;

    try {
      usePlayerStore.setState({
        playbackMode: "slices_only",
        activeTrack: dummyTrack,
        activeSegment: dummySegment,
        isPlaying: true,
        queue: [
          { segment: dummySegment, track: dummyTrack },
          { segment: dummySegment2, track: dummyTrack2 },
        ],
        queueIndex: 0,
        reorderQueue: ((from: number, to: number) => {
          reorderCalledWith = [from, to];
        }) as any,
      });

      act(() => {
        root.render(<QueueDrawer isOpen={true} onClose={() => {}} />);
      });

      const rows = container.querySelectorAll('[data-index]');
      expect(rows.length).toBeGreaterThanOrEqual(2);

      const dragHandle0 = rows[0].querySelector('[data-drag-handle="true"]');
      expect(dragHandle0).not.toBeNull();

      const rowItem0 = rows[0].querySelector('[draggable="true"]');
      const rowItem1 = rows[1].querySelector('[draggable="true"]');
      expect(rowItem0).not.toBeNull();
      expect(rowItem1).not.toBeNull();

      act(() => {
        dragHandle0?.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true, button: 0 }));
      });

      const dataStore: Record<string, string> = {};
      const mockDataTransfer = {
        data: dataStore,
        setData(key: string, val: string) { dataStore[key] = val; },
        getData(key: string) { return dataStore[key] || ""; },
        effectAllowed: "none",
        dropEffect: "none",
      };

      const dragStartEvent = new window.Event("dragstart", { bubbles: true, cancelable: true });
      (dragStartEvent as any).dataTransfer = mockDataTransfer;
      act(() => {
        rowItem0?.dispatchEvent(dragStartEvent);
      });

      const dragOverEvent = new window.Event("dragover", { bubbles: true, cancelable: true });
      (dragOverEvent as any).dataTransfer = mockDataTransfer;
      act(() => {
        rowItem1?.dispatchEvent(dragOverEvent);
      });

      const dropEvent = new window.Event("drop", { bubbles: true, cancelable: true });
      (dropEvent as any).dataTransfer = mockDataTransfer;
      act(() => {
        rowItem1?.dispatchEvent(dropEvent);
      });

      expect(reorderCalledWith as [number, number] | null).toEqual([0, 1]);
    } finally {
      act(() => {
        usePlayerStore.setState({ reorderQueue: origReorder });
      });
    }
  });

  it("QueueDrawer renders track title on top and artist on bottom for full tracks (no repetitive Full Track label)", () => {
    const fullTrackItem = {
      segment: {
        id: "fallback_trk_special_1",
        track_id: "trk_special_1",
        name: "Full Track",
        start_time: 0,
        end_time: 215,
        color: "#4385BE",
        created_at: 1000,
      },
      track: {
        ...dummyTrack,
        id: "trk_special_1",
        title: "Envy (feat. THANHDRAW)",
        artist: "RPT MCK",
        duration: 215,
      },
    };

    usePlayerStore.setState({
      queue: [fullTrackItem],
      queueIndex: 0,
      activeTrack: fullTrackItem.track,
      activeSegment: fullTrackItem.segment,
      isPlaying: true,
    });

    act(() => {
      root.render(<QueueDrawer isOpen={true} onClose={() => {}} />);
    });

    const html = container.innerHTML;
    // Track title should be present
    expect(html).toContain("Envy (feat. THANHDRAW)");
    // Artist should be present
    expect(html).toContain("RPT MCK");
    // "Full Track" should NOT be displayed as the title
    expect(html).not.toContain(">Full Track<");
  });

  it("QueueDrawer renders slice name with start/end cut timestamps and track title for slices", () => {
    const sliceItem = {
      segment: {
        id: "seg_cut_1",
        track_id: "trk_special_2",
        name: "Đoạn 1",
        start_time: 62.15,
        end_time: 75.28,
        color: "#4385BE",
        created_at: 1000,
      },
      track: {
        ...dummyTrack,
        id: "trk_special_2",
        title: "Thịt Lợn",
        artist: "RPT MCK",
        duration: 228,
      },
    };

    usePlayerStore.setState({
      queue: [sliceItem],
      queueIndex: 0,
      activeTrack: sliceItem.track,
      activeSegment: sliceItem.segment,
      isPlaying: true,
    });

    act(() => {
      root.render(<QueueDrawer isOpen={true} onClose={() => {}} />);
    });

    const html = container.innerHTML;
    // Slice name should be present
    expect(html).toContain("Đoạn 1");
    // Formatted start and end timestamps [1:02 - 1:15] should be present
    expect(html).toContain("[1:02 - 1:15]");
    // Track title and artist should be present in the subtitle
    expect(html).toContain("Thịt Lợn • RPT MCK");
  });

  it("QueueDrawer falls back to unknownArtist when artist is empty for full track", () => {
    const trackWithoutArtist = {
      segment: {
        id: "fallback_no_art",
        track_id: "trk_no_art",
        name: "Full Track",
        start_time: 0,
        end_time: 150,
        color: "#4385BE",
        created_at: 1000,
      },
      track: {
        ...dummyTrack,
        id: "trk_no_art",
        title: "Mystery Song",
        artist: "",
        duration: 150,
      },
    };

    usePlayerStore.setState({
      queue: [trackWithoutArtist],
      queueIndex: 0,
      activeTrack: trackWithoutArtist.track,
      activeSegment: trackWithoutArtist.segment,
      isPlaying: true,
    });

    act(() => {
      root.render(<QueueDrawer isOpen={true} onClose={() => {}} />);
    });

    const html = container.innerHTML;
    expect(html).toContain("Mystery Song");
    expect(html).toContain("Không rõ ca sĩ");
  });
});


