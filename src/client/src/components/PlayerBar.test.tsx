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

  // The shuffle menu renders in a portal, so look for it on the whole page
  const shuffleMenus = () => document.querySelectorAll('[role="menu"]');
  const rightClick = (target: Element | null) =>
    target?.dispatchEvent(
      new (globalThis as any).window.MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: 10, clientY: 10 })
    );
  // The More ("…") menu, like the shuffle menu, renders in a portal
  const menuItemTexts = () => Array.from(document.querySelectorAll('[role="menu"] [role="menuitem"]')).map((item) => item.textContent ?? "");
  const pressMore = async (title: string) => {
    const moreBtn = container.querySelector<HTMLButtonElement>(`button[aria-label="More options for ${title}"]`);
    expect(moreBtn).not.toBeNull();
    await act(async () => {
      moreBtn?.click();
      await new Promise((r) => setTimeout(r, 20));
    });
  };
  // Menus unmount once their exit animation finishes
  const settle = () =>
    act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

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

    expect(container.querySelector('button[title*="Queue"], button[title*="Hàng đợi"], button[aria-label*="queue" i]')).not.toBeNull();

    // Like Apple Music, the track volume opens from the speaker button
    expect(document.querySelector('[aria-label="Track volume"]') === null).toBe(true);
    const volumeBtn = container.querySelector<HTMLButtonElement>('button[aria-label="Volume"]');
    expect(volumeBtn).not.toBeNull();
    await act(async () => {
      volumeBtn?.click();
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(document.querySelector('[aria-label="Track volume"]') !== null).toBe(true);
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

    // Shuffle comes before Previous, as in Apple Music's transport
    const order = prevBtn ? shuffleBtn?.compareDocumentPosition(prevBtn) ?? 0 : 0;
    expect(Boolean(order & (shuffleBtn?.DOCUMENT_POSITION_FOLLOWING ?? 0))).toBe(true);

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
        rightClick(shuffleBtn);
      });

      const menu = document.querySelector('[role="menu"]');
      expect(menu?.textContent).toContain("Nhạc Vui Tươi");

      // Click on playlist in menu
      const plBtn = Array.from(menu?.querySelectorAll('[role="menuitem"]') || []).find((btn) =>
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
      await settle();
      expect(shuffleMenus().length).toBe(0);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("opens shuffle menu on a touch long-press and closes on outside click", async () => {
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

    // Press and hold with a finger
    await act(async () => {
      const touch = { identifier: 1, target: shuffleBtn, clientX: 10, clientY: 10, pageX: 10, pageY: 10, screenX: 10, screenY: 10 };
      shuffleBtn?.dispatchEvent(
        new (globalThis as any).window.TouchEvent("touchstart", { bubbles: true, cancelable: true, touches: [touch], targetTouches: [touch], changedTouches: [touch] })
      );
    });

    // Advance for long-press timer
    await act(async () => {
      await new Promise((r) => setTimeout(r, 550));
    });

    // Menu should be open
    expect(shuffleMenus().length).toBe(1);

    // Browser dispatches contextmenu right after touch long-press - ensure it does not close the menu
    await act(async () => {
      rightClick(shuffleBtn);
    });
    expect(shuffleMenus().length).toBe(1);

    // Clicking outside closes the menu
    await act(async () => {
      for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
        const EventType = type.startsWith("pointer") ? (globalThis as any).window.PointerEvent : (globalThis as any).window.MouseEvent;
        document.body.dispatchEvent(new EventType(type, { bubbles: true, cancelable: true, button: 0 }));
      }
    });
    await settle();
    expect(shuffleMenus().length).toBe(0);
  });

  it("lists every playlist containing the playing song in its More menu and opens the one chosen", async () => {
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

      // The capsule shows no playlist chips; its More menu lists them all
      expect(container.textContent).not.toContain("V-Pop Hits");
      await pressMore("Tag Song Title");
      expect(menuItemTexts()).toEqual([
        expect.stringContaining("V-Pop Hits"),
        expect.stringContaining("Acoustic Chill"),
        expect.stringContaining("Workout"),
      ]);

      const vPop = Array.from(document.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]')).find((item) =>
        item.textContent?.includes("V-Pop Hits")
      );
      await act(async () => {
        vPop?.click();
      });
      expect(activePlaylistIdCalled).toBe("pl_tag1");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("closes the shuffle menu on Escape", async () => {
    const origFetch = globalThis.fetch;
    const mockTrack: Track = {
      id: "track-escape-test",
      source_type: "local",
      source_uri: "local://test.mp3",
      title: "Escape Song",
      duration: 150,
      status: "ready",
    };
    const mockSegment: Segment = {
      id: "seg-escape-test",
      track_id: "track-escape-test",
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
    globalThis.fetch = (async () => new Response("[]", { status: 200 })) as any;

    try {
      await act(async () => {
        root.render(<PlayerBar onToggleQueue={() => {}} isQueueOpen={false} />);
      });

      const shuffleBtn = container.querySelector(
        'button[aria-label*="shuffle" i], button[aria-label*="ngẫu nhiên" i]'
      ) as HTMLButtonElement | null;
      await act(async () => {
        rightClick(shuffleBtn);
      });
      expect(shuffleMenus().length).toBe(1);

      await act(async () => {
        (document.activeElement ?? document.body).dispatchEvent(
          new (globalThis as any).window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })
        );
      });
      await settle();
      expect(shuffleMenus().length).toBe(0);
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

      // The More menu lists the other playlists containing the song, not the one playing
      await pressMore("Phương Ly – My Sun");
      expect(menuItemTexts()).toEqual([expect.stringContaining("chill vibes")]);
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
        rightClick(shuffleBtn);
      });

      const menu = document.querySelector('[role="menu"]');
      expect(menu?.textContent).toMatch(/Recent|Gần nhất/);

      // Now click on Chill Night in menu to switch the preference
      const menuButtons = Array.from(menu?.querySelectorAll('[role="menuitem"]') || []);
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

  it("triggers requestScrollToActiveTrack when clicking active Mix or playlist tag", async () => {
    const origFetch = globalThis.fetch;
    const mockTrack: Track = {
      id: "track-mix-scroll",
      source_type: "local",
      source_uri: "local://test.mp3",
      title: "New World - Minecraft Parody",
      artist: "SkyDoesMinecraft",
      duration: 275.9,
      status: "ready",
    };
    const mockSegment: Segment = {
      id: "fallback_track-mix-scroll",
      track_id: "track-mix-scroll",
      name: "Full Track",
      start_time: 0,
      end_time: 275.9,
    };

    let scrollRequested = false;
    usePlayerStore.setState({
      activeTrack: mockTrack,
      activeSegment: mockSegment,
      queue: [{ track: mockTrack, segment: mockSegment }],
      queueIndex: 0,
      playbackMode: "mixed",
      activePlaylistPlayingId: null,
      requestScrollToActiveTrack: () => {
        scrollRequested = true;
      },
    });

    globalThis.fetch = (async () => new Response("[]", { status: 200 })) as any;

    try {
      await act(async () => {
        root.render(
          <PlayerBar
            onToggleQueue={() => {}}
            isQueueOpen={false}
          />
        );
      });

      const mixTagBtn = container.querySelector(
        'button[title*="Mix"], button[aria-label*="Mix"], button[title*="Trộn"], button[aria-label*="Trộn"]'
      ) as HTMLButtonElement | null;
      expect(mixTagBtn).not.toBeNull();

      await act(async () => {
        mixTagBtn?.click();
      });

      expect(scrollRequested).toBe(true);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("triggers requestScrollToActiveTrack when clicking track title or thumbnail", async () => {
    const origFetch = globalThis.fetch;
    const mockTrack: Track = {
      id: "track-lowg",
      source_type: "local",
      source_uri: "local://lowg.mp3",
      title: "Low G - An Thit Cho",
      artist: "Low G",
      duration: 180,
      status: "ready",
    };
    const mockSegment: Segment = {
      id: "fallback_track-lowg",
      track_id: "track-lowg",
      name: "Full Track",
      start_time: 0,
      end_time: 180,
    };

    let scrollRequestedCount = 0;
    usePlayerStore.setState({
      activeTrack: mockTrack,
      activeSegment: mockSegment,
      queue: [{ track: mockTrack, segment: mockSegment }],
      queueIndex: 0,
      playbackMode: "mixed",
      activePlaylistPlayingId: null,
      requestScrollToActiveTrack: () => {
        scrollRequestedCount++;
      },
    });

    globalThis.fetch = (async () => new Response("[]", { status: 200 })) as any;

    try {
      await act(async () => {
        root.render(
          <PlayerBar
            onToggleQueue={() => {}}
            isQueueOpen={false}
          />
        );
      });

      // Find button containing track title
      const titleBtn = Array.from(container.querySelectorAll("button")).find(
        (b) => b.textContent?.includes("Low G - An Thit Cho")
      );
      expect(titleBtn).toBeDefined();

      await act(async () => {
        titleBtn?.click();
      });

      expect(scrollRequestedCount).toBe(1);

      // Find thumbnail button
      const thumbBtn = container.querySelector('button[title*="jump to active track" i], button[aria-label*="jump to active track" i]') as HTMLButtonElement | null;
      expect(thumbBtn).not.toBeNull();

      await act(async () => {
        thumbBtn?.click();
      });

      expect(scrollRequestedCount).toBe(2);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("renders search origin badge with search icon, tab name, and matching count", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response("[]", { status: 200 })) as any;

    const mockTrack: Track = {
      id: "track-search-1",
      source_type: "local",
      source_uri: "local://test.mp3",
      title: "Search Result Track",
      artist: "Search Artist",
      duration: 200,
      volume: 0.8,
      created_at: Date.now(),
      status: "ready",
    };

    const mockSegment: Segment = {
      id: "seg-search-1",
      track_id: "track-search-1",
      name: "Search Slice",
      start_time: 0,
      end_time: 45,
      created_at: Date.now(),
    };

    usePlayerStore.setState({
      activeTrack: mockTrack,
      activeSegment: mockSegment,
      queue: [
        { track: mockTrack, segment: mockSegment },
        { track: mockTrack, segment: mockSegment },
        { track: mockTrack, segment: mockSegment },
      ],
      queueIndex: 0,
      playbackMode: "mixed",
      activePlaylistPlayingId: null,
      isShuffle: false,
      queueOrigin: {
        type: "search",
        query: "chill",
        count: 3,
        mode: "mixed",
      },
    });

    try {
      await act(async () => {
        root.render(<PlayerBar onToggleQueue={() => {}} isQueueOpen={false} />);
      });

      // Find badge button
      const badgeBtn = Array.from(container.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("Mix") && b.textContent?.includes("(3)")
      );
      expect(badgeBtn).toBeDefined();

      // Check for search icon inside badge
      const searchIcon = badgeBtn?.querySelector("svg.lucide-search");
      expect(searchIcon).not.toBeNull();

      // Should not have shuffle icon
      const shuffleIcon = badgeBtn?.querySelector("svg.lucide-shuffle");
      expect(shuffleIcon).toBeNull();

      // Check title / aria-label contains search info
      const titleAttr = badgeBtn?.getAttribute("title") || "";
      expect(titleAttr.length).toBeGreaterThan(0);
      expect(titleAttr).toMatch(/chill|3/i);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("renders both shuffle and search icons when queue is shuffled from search results", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response("[]", { status: 200 })) as any;

    const mockTrack: Track = {
      id: "track-search-2",
      source_type: "local",
      source_uri: "local://test.mp3",
      title: "Search Result Track 2",
      artist: "Search Artist 2",
      duration: 200,
      volume: 0.8,
      created_at: Date.now(),
      status: "ready",
    };

    const mockSegment: Segment = {
      id: "seg-search-2",
      track_id: "track-search-2",
      name: "Search Slice 2",
      start_time: 0,
      end_time: 60,
      created_at: Date.now(),
    };

    usePlayerStore.setState({
      activeTrack: mockTrack,
      activeSegment: mockSegment,
      queue: [
        { track: mockTrack, segment: mockSegment },
        { track: mockTrack, segment: mockSegment },
      ],
      queueIndex: 0,
      playbackMode: "mixed",
      activePlaylistPlayingId: null,
      isShuffle: true,
      queueOrigin: {
        type: "search",
        query: "acoustic",
        count: 2,
        mode: "mixed",
      },
    });

    try {
      await act(async () => {
        root.render(<PlayerBar onToggleQueue={() => {}} isQueueOpen={false} />);
      });

      // Find badge button
      const badgeBtn = Array.from(container.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("Mix") && b.textContent?.includes("(2)")
      );
      expect(badgeBtn).toBeDefined();

      // Check for both shuffle and search icons
      const searchIcon = badgeBtn?.querySelector("svg.lucide-search");
      const shuffleIcon = badgeBtn?.querySelector("svg.lucide-shuffle");
      expect(searchIcon).not.toBeNull();
      expect(shuffleIcon).not.toBeNull();
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("clicking shuffle button when playing from search toggles shuffle on current queue without hijacking to last shuffled playlist", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      if (url.includes("/containing-playlists")) {
        return new Response(JSON.stringify([{ id: "pl-last", name: "Recent Playlist" }]), { status: 200 });
      }
      return new Response("[]", { status: 200 });
    }) as any;

    const mockTrack: Track = {
      id: "track-search-3",
      source_type: "local",
      source_uri: "local://test.mp3",
      title: "Search Result Track 3",
      artist: "Search Artist 3",
      duration: 180,
      volume: 0.8,
      created_at: Date.now(),
      status: "ready",
    };

    const mockSegment: Segment = {
      id: "seg-search-3",
      track_id: "track-search-3",
      name: "Search Slice 3",
      start_time: 0,
      end_time: 50,
      created_at: Date.now(),
    };

    let shuffleToggled = false;
    let buildPlaylistQueueCalled = false;

    usePlayerStore.setState({
      activeTrack: mockTrack,
      activeSegment: mockSegment,
      queue: [{ track: mockTrack, segment: mockSegment }],
      queueIndex: 0,
      playbackMode: "mixed",
      activePlaylistPlayingId: null,
      playlists: [
        {
          id: "pl-last",
          name: "Recent Playlist",
          created_at: Date.now(),
          updated_at: Date.now(),
          item_count: 1,
          is_custom_ordered: false,
        },
      ],
      isShuffle: false,
      queueOrigin: {
        type: "search",
        query: "pop",
        count: 1,
        mode: "mixed",
      },
      toggleShuffle: () => {
        shuffleToggled = true;
      },
      buildPlaylistQueue: async () => {
        buildPlaylistQueueCalled = true;
      },
    });

    try {
      await act(async () => {
        root.render(<PlayerBar onToggleQueue={() => {}} isQueueOpen={false} />);
      });

      const shuffleBtn = container.querySelector('button[aria-label*="shuffle" i], button[title*="shuffle" i]') as HTMLButtonElement | null;
      expect(shuffleBtn).not.toBeNull();

      await act(async () => {
        shuffleBtn?.click();
      });

      expect(shuffleToggled).toBe(true);
      expect(buildPlaylistQueueCalled).toBe(false);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("when playing from Mix and viewing an open playlist containing the active track, clicking Mix badge jumps to track in the open playlist without closing it", async () => {
    const origFetch = globalThis.fetch;
    const mockTrack: Track = {
      id: "track-open-pl",
      source_type: "local",
      source_uri: "local://open.mp3",
      title: "Song In Open Playlist",
      artist: "Open Artist",
      duration: 180,
      status: "ready",
    };
    const mockSegment: Segment = {
      id: "seg-open-pl",
      track_id: "track-open-pl",
      name: "Full Track",
      start_time: 0,
      end_time: 180,
    };

    let requestedTargetKey: string | undefined = undefined;
    let setActivePlaylistCalled = false;

    usePlayerStore.setState({
      activeTrack: mockTrack,
      activeSegment: mockSegment,
      queue: [{ track: mockTrack, segment: mockSegment }],
      queueIndex: 0,
      playbackMode: "mixed",
      activePlaylistPlayingId: null, // playing from Mix -> badge says Mix
      activePlaylistId: "pl_open", // User is currently viewing playlist "pl_open"
      activePlaylistItems: [
        {
          id: "item_1",
          playlist_id: "pl_open",
          track_id: "track-open-pl",
          sort_order: 0,
          added_at: 1000,
          track: mockTrack,
          segment: null,
        } as any,
      ],
      setActivePlaylist: (async (id: string | null) => {
        setActivePlaylistCalled = true;
      }) as any,
      requestScrollToActiveTrack: (targetKey?: string) => {
        requestedTargetKey = targetKey;
      },
    });

    globalThis.fetch = (async () => new Response("[]", { status: 200 })) as any;

    try {
      await act(async () => {
        root.render(<PlayerBar onToggleQueue={() => {}} isQueueOpen={false} />);
      });

      // Find Mix badge button
      const mixBadgeBtn = Array.from(container.querySelectorAll("button")).find(
        (b) => b.textContent?.includes("Mix") || b.textContent?.includes("Trộn")
      );
      expect(mixBadgeBtn).toBeDefined();

      await act(async () => {
        mixBadgeBtn?.click();
      });

      // Crucial: It MUST NOT close the open playlist!
      expect(setActivePlaylistCalled).toBe(false);
      // Crucial: It MUST request scroll in the currently open playlist!
      expect(requestedTargetKey as string | undefined).toBe("playlist:pl_open");

      // Also verify clicking track title or thumbnail jumps to the track in the open playlist
      requestedTargetKey = undefined;
      const titleBtn = Array.from(container.querySelectorAll("button")).find(
        (b) => b.textContent?.includes("Song In Open Playlist")
      );
      expect(titleBtn).toBeDefined();
      await act(async () => {
        titleBtn?.click();
      });
      expect(setActivePlaylistCalled).toBe(false);
      expect(requestedTargetKey as string | undefined).toBe("playlist:pl_open");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("when playing from Mix and viewing an open playlist that does NOT contain the active track, clicking Mix badge navigates to Mix category", async () => {
    const origFetch = globalThis.fetch;
    const mockTrack: Track = {
      id: "track-other",
      source_type: "local",
      source_uri: "local://other.mp3",
      title: "Song Not In Open Playlist",
      artist: "Other Artist",
      duration: 180,
      status: "ready",
    };
    const mockSegment: Segment = {
      id: "seg-other",
      track_id: "track-other",
      name: "Full Track",
      start_time: 0,
      end_time: 180,
    };

    let requestedTargetKey: string | undefined = undefined;
    let setActivePlaylistArg: string | null | undefined = undefined;

    usePlayerStore.setState({
      activeTrack: mockTrack,
      activeSegment: mockSegment,
      queue: [{ track: mockTrack, segment: mockSegment }],
      queueIndex: 0,
      playbackMode: "mixed",
      activePlaylistPlayingId: null, // playing from Mix -> badge says Mix
      activePlaylistId: "pl_open", // User is currently viewing playlist "pl_open"
      activePlaylistItems: [
        {
          id: "item_99",
          playlist_id: "pl_open",
          track_id: "some-different-track",
          sort_order: 0,
          added_at: 1000,
          track: { id: "some-different-track", title: "Diff", status: "ready" } as any,
          segment: null,
        } as any,
      ],
      setActivePlaylist: (async (id: string | null) => {
        setActivePlaylistArg = id;
      }) as any,
      requestScrollToActiveTrack: (targetKey?: string) => {
        requestedTargetKey = targetKey;
      },
    });

    globalThis.fetch = (async () => new Response("[]", { status: 200 })) as any;

    try {
      await act(async () => {
        root.render(<PlayerBar onToggleQueue={() => {}} isQueueOpen={false} />);
      });

      const mixBadgeBtn = Array.from(container.querySelectorAll("button")).find(
        (b) => b.textContent?.includes("Mix") || b.textContent?.includes("Trộn")
      );
      expect(mixBadgeBtn).toBeDefined();

      await act(async () => {
        mixBadgeBtn?.click();
      });

      // Because the track is NOT in the open playlist, it SHOULD navigate back to Mix
      expect(setActivePlaylistArg).toBeNull();
      expect(requestedTargetKey as string | undefined).toBe("category:mixed");
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});



