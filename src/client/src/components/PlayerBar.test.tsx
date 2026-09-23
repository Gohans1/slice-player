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
    await act(async () => {
      usePlayerStore.setState({ isLoopQueue: true });
    });

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

  it("renders shuffle button to the left of previous button and toggles isShuffle on click", async () => {
    const mockTrack: Track = {
      id: "track-shuffle",
      source_type: "local",
      source_uri: "local://test.mp3",
      title: "Shuffle Track",
      duration: 180,
      status: "ready",
    };
    const mockSegment: Segment = {
      id: "seg-shuffle",
      track_id: "track-shuffle",
      name: "Seg Shuffle",
      start_time: 0,
      end_time: 30,
    };

    usePlayerStore.setState({
      activeTrack: mockTrack,
      activeSegment: mockSegment,
      queue: [{ track: mockTrack, segment: mockSegment }],
      queueIndex: 0,
      isShuffle: false,
    });

    await act(async () => {
      root.render(
        <PlayerBar
          onToggleQueue={() => {}}
          isQueueOpen={false}
        />
      );
    });

    const shuffleBtn = container.querySelector(
      'button[aria-label*="shuffle" i], button[aria-label*="ngẫu nhiên" i]'
    ) as HTMLButtonElement | null;
    expect(shuffleBtn).not.toBeNull();

    const prevBtn = container.querySelector(
      'button[aria-label*="previous" i], button[aria-label*="trước" i]'
    ) as HTMLButtonElement | null;
    expect(prevBtn).not.toBeNull();

    // Verify DOM position: shuffle button parent container comes before previous button
    const controlsContainer = prevBtn?.closest(".flex.items-center.gap-3");
    expect(controlsContainer).not.toBeNull();
    const children = Array.from(controlsContainer?.children || []);
    const shuffleWrapper = shuffleBtn?.closest(".relative");
    const shuffleIndex = children.indexOf(shuffleWrapper as Element);
    const prevIndex = children.indexOf(prevBtn as Element);
    expect(shuffleIndex).toBeLessThan(prevIndex);

    // Left-click toggles shuffle
    expect(usePlayerStore.getState().isShuffle).toBe(false);
    await act(async () => {
      shuffleBtn?.click();
    });
    expect(usePlayerStore.getState().isShuffle).toBe(true);
  });

  it("opens shuffle options menu on right click and handles playlist selection", async () => {
    const origFetch = globalThis.fetch;
    const mockTrack: Track = {
      id: "track-menu-test",
      source_type: "local",
      source_uri: "local://test.mp3",
      title: "Menu Track",
      duration: 200,
      status: "ready",
    };
    const mockSegment: Segment = {
      id: "seg-menu-test",
      track_id: "track-menu-test",
      name: "Main Slice",
      start_time: 0,
      end_time: 50,
    };

    const mockPlaylists = [
      { id: "pl_happy", name: "Nhạc Vui Tươi", item_count: 10, created_at: 1, updated_at: 1 },
      { id: "pl_other", name: "Nhạc Buồn", item_count: 5, created_at: 1, updated_at: 1 },
    ];

    let buildPlaylistQueueCalledWith: { id: string; shuffle: boolean; keep: boolean } | null = null;
    usePlayerStore.setState({
      activeTrack: mockTrack,
      activeSegment: mockSegment,
      queue: [{ track: mockTrack, segment: mockSegment }],
      queueIndex: 0,
      playlists: mockPlaylists,
      buildPlaylistQueue: async (id, shuffle, _, keep) => {
        buildPlaylistQueueCalledWith = { id, shuffle: !!shuffle, keep: !!keep };
      },
    });

    globalThis.fetch = (async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes("/api/playlist-memberships")) {
        return new Response(JSON.stringify([{ playlist_id: "pl_happy", item_id: "item_1" }]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("[]", { status: 200 });
    }) as any;

    try {
      await act(async () => {
        root.render(
          <PlayerBar
            onToggleQueue={() => {}}
            isQueueOpen={false}
          />
        );
      });

      // Allow useEffect to fetch memberships
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });

      const shuffleBtn = container.querySelector(
        'button[aria-label*="shuffle" i], button[aria-label*="ngẫu nhiên" i]'
      ) as HTMLButtonElement | null;
      expect(shuffleBtn).not.toBeNull();

      // Right-click opens menu
      await act(async () => {
        shuffleBtn?.dispatchEvent(new (globalThis as any).Event("contextmenu", { bubbles: true, cancelable: true }));
      });

      const menu = container.querySelector('div[role="menu"]');
      expect(menu).not.toBeNull();
      expect(menu?.textContent).toContain("Nhạc Vui Tươi");

      // Click on playlist in menu
      const plBtn = Array.from(menu?.querySelectorAll('button[role="menuitem"]') || []).find((btn) =>
        btn.textContent?.includes("Nhạc Vui Tươi")
      ) as HTMLButtonElement | undefined;
      expect(plBtn).toBeDefined();

      await act(async () => {
        plBtn?.click();
      });

      expect(buildPlaylistQueueCalledWith!).toEqual({
        id: "pl_happy",
        shuffle: true,
        keep: true,
      });

      // Menu should be closed after selection
      expect(container.querySelector('div[role="menu"]')).toBeNull();
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("opens shuffle menu on long-press and closes on outside click", async () => {
    const mockTrack: Track = {
      id: "track-longpress",
      source_type: "local",
      source_uri: "local://test.mp3",
      title: "Longpress Track",
      duration: 120,
      status: "ready",
    };
    const mockSegment: Segment = {
      id: "seg-longpress",
      track_id: "track-longpress",
      name: "Seg",
      start_time: 0,
      end_time: 30,
    };

    usePlayerStore.setState({
      activeTrack: mockTrack,
      activeSegment: mockSegment,
      queue: [{ track: mockTrack, segment: mockSegment }],
      queueIndex: 0,
    });

    await act(async () => {
      root.render(<PlayerBar onToggleQueue={() => {}} isQueueOpen={false} />);
    });

    const shuffleBtn = container.querySelector(
      'button[aria-label*="shuffle" i], button[aria-label*="ngẫu nhiên" i]'
    ) as HTMLButtonElement | null;
    expect(shuffleBtn).not.toBeNull();

    // Trigger pointerdown with button 0
    await act(async () => {
      const pointerDownEvent = new (globalThis as any).Event("pointerdown", { bubbles: true });
      (pointerDownEvent as any).button = 0;
      shuffleBtn?.dispatchEvent(pointerDownEvent);
    });

    // Advance for long-press timer
    await act(async () => {
      await new Promise((r) => setTimeout(r, 550));
    });

    // Menu should be open
    expect(container.querySelector('div[role="menu"]')).not.toBeNull();

    // Browser dispatches contextmenu right after touch long-press - ensure it does not close the menu
    await act(async () => {
      shuffleBtn?.dispatchEvent(new (globalThis as any).Event("contextmenu", { bubbles: true, cancelable: true }));
    });
    expect(container.querySelector('div[role="menu"]')).not.toBeNull();

    // Click outside on document body closes menu
    await act(async () => {
      const outsideEvent = new (globalThis as any).Event("mousedown", { bubbles: true });
      (globalThis as any).document.body.dispatchEvent(outsideEvent);
    });
    expect(container.querySelector('div[role="menu"]')).toBeNull();
  });

  it("renders interactive playlist tags next to track title and closes menu on Escape", async () => {
    const origFetch = globalThis.fetch;
    const mockTrack: Track = {
      id: "track-tags-test",
      source_type: "local",
      source_uri: "local://test.mp3",
      title: "Tag Song Title",
      duration: 150,
      status: "ready",
    };
    const mockSegment: Segment = {
      id: "seg-tags-test",
      track_id: "track-tags-test",
      name: "Seg",
      start_time: 0,
      end_time: 30,
    };

    const mockPlaylists = [
      { id: "pl_tag1", name: "V-Pop Hits", item_count: 20, created_at: 1, updated_at: 1 },
      { id: "pl_tag2", name: "Acoustic Chill", item_count: 15, created_at: 1, updated_at: 1 },
      { id: "pl_tag3", name: "Workout", item_count: 10, created_at: 1, updated_at: 1 },
    ];

    let activePlaylistIdCalled: any = null;
    usePlayerStore.setState({
      activeTrack: mockTrack,
      activeSegment: mockSegment,
      queue: [{ track: mockTrack, segment: mockSegment }],
      queueIndex: 0,
      playlists: mockPlaylists,
      setActivePlaylist: (async (id: string | null) => {
        activePlaylistIdCalled = id;
      }) as any,
    });

    globalThis.fetch = (async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes("/api/playlist-memberships")) {
        return new Response(
          JSON.stringify([
            { playlist_id: "pl_tag1", item_id: "it1" },
            { playlist_id: "pl_tag2", item_id: "it2" },
            { playlist_id: "pl_tag3", item_id: "it3" },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response("[]", { status: 200 });
    }) as any;

    try {
      await act(async () => {
        root.render(
          <PlayerBar
            onToggleQueue={() => {}}
            isQueueOpen={false}
          />
        );
      });

      // Wait for memberships fetch
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });

      // Check tags rendering
      expect(container.textContent).toContain("V-Pop Hits");
      expect(container.textContent).toContain("Acoustic Chill");
      // Third tag truncated with +1
      expect(container.textContent).toContain("+1");

      // Verify tags are clickable buttons that trigger setActivePlaylist
      const tagButtons = container.querySelectorAll('button[aria-label*="V-Pop Hits"], button[title*="V-Pop Hits"]');
      expect(tagButtons.length).toBeGreaterThan(0);
      await act(async () => {
        (tagButtons[0] as HTMLButtonElement).click();
      });
      expect(activePlaylistIdCalled).toBe("pl_tag1");

      // Open menu via right click
      const shuffleBtn = container.querySelector(
        'button[aria-label*="shuffle" i], button[aria-label*="ngẫu nhiên" i]'
      ) as HTMLButtonElement | null;
      await act(async () => {
        shuffleBtn?.dispatchEvent(new (globalThis as any).Event("contextmenu", { bubbles: true, cancelable: true }));
      });
      expect(container.querySelector('div[role="menu"]')).not.toBeNull();

      // Press Escape to close menu
      await act(async () => {
        const escEvent = new (globalThis as any).Event("keydown", { bubbles: true });
        (escEvent as any).key = "Escape";
        (globalThis as any).document.dispatchEvent(escEvent);
      });
      expect(container.querySelector('div[role="menu"]')).toBeNull();
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("deduplicates active playlist from containing playlists and navigates when clicking active playlist tag", async () => {
    const origFetch = globalThis.fetch;
    const mockTrack: Track = {
      id: "track-dedup",
      source_type: "local",
      source_uri: "local://test.mp3",
      title: "Phương Ly – My Sun",
      artist: "Phương Ly",
      duration: 180,
      volume: 0.8,
      created_at: Date.now(),
      status: "ready",
    };

    const mockSegment: Segment = {
      id: "seg-dedup",
      track_id: "track-dedup",
      name: "Full Track",
      start_time: 0,
      end_time: 180,
      color: "#4385BE",
      created_at: Date.now(),
    };

    const mockPlaylists = [
      { id: "pl_phuongly", name: "phương ly", item_count: 5, created_at: 1, updated_at: 1 },
      { id: "pl_chill", name: "chill vibes", item_count: 10, created_at: 1, updated_at: 1 },
    ];

    let navigatedPlaylistId: any = null;

    usePlayerStore.setState({
      activeTrack: mockTrack,
      activeSegment: mockSegment,
      queue: [{ track: mockTrack, segment: mockSegment }],
      queueIndex: 0,
      playlists: mockPlaylists,
      activePlaylistPlayingId: "pl_phuongly",
      setActivePlaylist: (async (id: string | null) => {
        navigatedPlaylistId = id;
      }) as any,
    });

    globalThis.fetch = (async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes("/api/playlist-memberships")) {
        return new Response(
          JSON.stringify([
            { playlist_id: "pl_phuongly", item_id: "it1" },
            { playlist_id: "pl_chill", item_id: "it2" },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response("[]", { status: 200 });
    }) as any;

    try {
      await act(async () => {
        root.render(
          <PlayerBar
            onToggleQueue={() => {}}
            isQueueOpen={false}
          />
        );
      });

      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });

      // Active playlist tag should be present
      const activeTagBtn = container.querySelector(
        'button[title*="phương ly"], button[aria-label*="phương ly"]'
      ) as HTMLButtonElement | null;
      expect(activeTagBtn).not.toBeNull();

      // Clicking active playlist tag navigates to active playlist in main view
      await act(async () => {
        activeTagBtn?.click();
      });
      expect(navigatedPlaylistId).toBe("pl_phuongly");

      // In containing playlists, "pl_phuongly" MUST BE DEDUPLICATED:
      // Only "chill vibes" should be rendered in the containing playlists folder tag, NOT a second "phương ly" folder badge!
      const folderTags = Array.from(container.querySelectorAll('div[aria-label*="Playlists"] button'));
      expect(folderTags.length).toBe(1);
      expect(folderTags[0]?.textContent).toContain("chill vibes");
      expect(folderTags[0]?.textContent).not.toContain("phương ly");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("remembers last chosen playlist and quick-shuffles it on left-click when track belongs to it", async () => {
    const origFetch = globalThis.fetch;
    const mockTrack: Track = {
      id: "track-shuffle-last",
      source_type: "local",
      source_uri: "local://test.mp3",
      title: "Test Shuffle Last",
      artist: "Test Artist",
      duration: 180,
      volume: 0.8,
      created_at: Date.now(),
      status: "ready",
    };

    const mockSegment: Segment = {
      id: "seg-shuffle-last",
      track_id: "track-shuffle-last",
      name: "Full Track",
      start_time: 0,
      end_time: 180,
      color: "#4385BE",
      created_at: Date.now(),
    };

    const mockPlaylists = [
      { id: "pl_happy", name: "Happy Songs", item_count: 5, created_at: 1, updated_at: 1 },
      { id: "pl_chill", name: "Chill Night", item_count: 8, created_at: 1, updated_at: 1 },
    ];

    let builtPlaylistQueueArgs: any = null;
    const mockBuildPlaylistQueue = async (
      playlistId: string,
      forceShuffle?: boolean,
      startIndex?: number,
      keepCurrentTrack?: boolean
    ) => {
      builtPlaylistQueueArgs = { playlistId, forceShuffle, startIndex, keepCurrentTrack };
    };

    // Pre-populate localStorage with "pl_happy"
    window.localStorage.setItem("slice_player_last_shuffle_playlist_id", "pl_happy");

    usePlayerStore.setState({
      activeTrack: mockTrack,
      activeSegment: mockSegment,
      queue: [{ track: mockTrack, segment: mockSegment }],
      queueIndex: 0,
      playlists: mockPlaylists,
      activePlaylistPlayingId: null, // Playing from Mix
      buildPlaylistQueue: mockBuildPlaylistQueue as any,
    });

    globalThis.fetch = (async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes("/api/playlist-memberships")) {
        return new Response(
          JSON.stringify([
            { playlist_id: "pl_happy", item_id: "it1" },
            { playlist_id: "pl_chill", item_id: "it2" },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response("[]", { status: 200 });
    }) as any;

    try {
      await act(async () => {
        root.render(
          <PlayerBar
            onToggleQueue={() => {}}
            isQueueOpen={false}
          />
        );
      });

      // Wait for memberships fetch
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });

      const shuffleBtn = container.querySelector(
        'button[aria-label*="shuffle" i], button[aria-label*="ngẫu nhiên" i]'
      ) as HTMLButtonElement | null;
      expect(shuffleBtn).not.toBeNull();

      // Tooltip should reflect quick shuffle for "Happy Songs"
      expect(shuffleBtn?.title).toMatch(/Happy Songs/);

      // Left-click should immediately quick-shuffle the last chosen playlist "pl_happy"
      await act(async () => {
        shuffleBtn?.click();
      });

      expect(builtPlaylistQueueArgs).toEqual({
        playlistId: "pl_happy",
        forceShuffle: true,
        startIndex: 0,
        keepCurrentTrack: true,
      });

      // Open context menu and verify Recent badge is displayed
      await act(async () => {
        shuffleBtn?.dispatchEvent(new (globalThis as any).Event("contextmenu", { bubbles: true, cancelable: true }));
      });

      const menu = container.querySelector('div[role="menu"]');
      expect(menu).not.toBeNull();
      expect(menu?.textContent).toMatch(/Recent|Gần nhất/);

      // Now click on Chill Night in menu to switch the preference
      const menuButtons = Array.from(menu?.querySelectorAll('button[role="menuitem"]') || []);
      const chillBtn = menuButtons.find((btn) => btn.textContent?.includes("Chill Night"));
      expect(chillBtn).not.toBeUndefined();

      await act(async () => {
        (chillBtn as HTMLButtonElement).click();
      });

      expect(window.localStorage.getItem("slice_player_last_shuffle_playlist_id")).toBe("pl_chill");
      expect(builtPlaylistQueueArgs.playlistId).toBe("pl_chill");
    } finally {
      globalThis.fetch = origFetch;
      window.localStorage.clear();
    }
  });

  it("does not hijack playback if already playing a custom playlist, even if track is also in lastShufflePlaylistId", async () => {
    const origFetch = globalThis.fetch;
    const mockTrack: Track = {
      id: "track-hijack-test",
      source_type: "local",
      source_uri: "local://test.mp3",
      title: "Test No Hijack",
      artist: "Test Artist",
      duration: 180,
      volume: 0.8,
      created_at: Date.now(),
      status: "ready",
    };

    const mockSegment: Segment = {
      id: "seg-hijack-test",
      track_id: "track-hijack-test",
      name: "Full Track",
      start_time: 0,
      end_time: 180,
      color: "#4385BE",
      created_at: Date.now(),
    };

    const mockPlaylists = [
      { id: "pl_happy", name: "Happy Songs", item_count: 5, created_at: 1, updated_at: 1 },
      { id: "pl_chill", name: "Chill Night", item_count: 8, created_at: 1, updated_at: 1 },
    ];

    let builtPlaylistQueueCalled = false;
    const mockBuildPlaylistQueue = async () => {
      builtPlaylistQueueCalled = true;
    };

    let toggleShuffleCalled = false;
    const mockToggleShuffle = () => {
      toggleShuffleCalled = true;
    };

    // Pre-populate localStorage with "pl_happy"
    window.localStorage.setItem("slice_player_last_shuffle_playlist_id", "pl_happy");

    usePlayerStore.setState({
      activeTrack: mockTrack,
      activeSegment: mockSegment,
      queue: [{ track: mockTrack, segment: mockSegment }],
      queueIndex: 0,
      playlists: mockPlaylists,
      activePlaylistPlayingId: "pl_chill", // Actively playing Chill Night!
      buildPlaylistQueue: mockBuildPlaylistQueue as any,
      toggleShuffle: mockToggleShuffle,
    });

    globalThis.fetch = (async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes("/api/playlist-memberships")) {
        return new Response(
          JSON.stringify([
            { playlist_id: "pl_happy", item_id: "it1" },
            { playlist_id: "pl_chill", item_id: "it2" },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response("[]", { status: 200 });
    }) as any;

    try {
      await act(async () => {
        root.render(
          <PlayerBar
            onToggleQueue={() => {}}
            isQueueOpen={false}
          />
        );
      });

      // Wait for memberships fetch
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });

      const shuffleBtn = container.querySelector(
        'button[aria-label*="shuffle" i], button[aria-label*="ngẫu nhiên" i]'
      ) as HTMLButtonElement | null;
      expect(shuffleBtn).not.toBeNull();

      // Tooltip should NOT offer quick shuffle since we are already playing Chill Night
      expect(shuffleBtn?.title).not.toMatch(/Happy Songs/);

      // Left-click should NOT hijack queue to Happy Songs, it should just toggle shuffle on the current playlist!
      await act(async () => {
        shuffleBtn?.click();
      });

      expect(builtPlaylistQueueCalled).toBe(false);
      expect(toggleShuffleCalled).toBe(true);
    } finally {
      globalThis.fetch = origFetch;
      window.localStorage.clear();
    }
  });
});

