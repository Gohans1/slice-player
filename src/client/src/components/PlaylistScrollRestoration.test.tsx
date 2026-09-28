import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GlobalWindow } from "happy-dom";
import "../i18n";
import { App } from "../App";
import { usePlayerStore, getViewScrollKey } from "../store/usePlayerStore";

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

describe("Playlist & View Scroll Position Preservation (E2E Component)", () => {
  let container: HTMLDivElement;
  let root: Root;
  let happyWindow: GlobalWindow;
  let originalFetch: typeof globalThis.fetch;
  let origGetBoundingClientRectDesc: PropertyDescriptor | undefined;
  let origOffsetHeightDesc: PropertyDescriptor | undefined;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    happyWindow = new GlobalWindow();
    (happyWindow as any).requestAnimationFrame = (cb: any) => setTimeout(cb, 0);
    (happyWindow as any).cancelAnimationFrame = (id: any) => clearTimeout(id);
    (happyWindow as any).innerHeight = 800;
    (happyWindow as any).innerWidth = 1200;
    Object.defineProperty(happyWindow.document.documentElement, "scrollHeight", {
      get: () => 50000,
      configurable: true,
    });
    Object.defineProperty(happyWindow.document.documentElement, "clientHeight", {
      get: () => 800,
      configurable: true,
    });
    let currentScrollY = 0;
    Object.defineProperty(happyWindow, "scrollY", {
      get: () => currentScrollY,
      set: (v: number) => { currentScrollY = v; },
      configurable: true,
    });
    Object.defineProperty(happyWindow, "pageYOffset", {
      get: () => currentScrollY,
      set: (v: number) => { currentScrollY = v; },
      configurable: true,
    });
    (happyWindow as any).scrollTo = (options: any) => {
      const top = typeof options === "object" ? options.top : options;
      currentScrollY = top;
      (happyWindow.document.documentElement as any).scrollTop = top;
    };
    (globalThis as any).window = happyWindow;
    (globalThis as any).document = happyWindow.document;
    (globalThis as any).HTMLElement = happyWindow.HTMLElement;
    (globalThis as any).HTMLButtonElement = happyWindow.HTMLButtonElement;
    (globalThis as any).KeyboardEvent = happyWindow.KeyboardEvent;
    (globalThis as any).Event = happyWindow.Event;

    origGetBoundingClientRectDesc = Object.getOwnPropertyDescriptor(happyWindow.HTMLElement.prototype, "getBoundingClientRect");
    origOffsetHeightDesc = Object.getOwnPropertyDescriptor(happyWindow.HTMLElement.prototype, "offsetHeight");

    Object.defineProperty(happyWindow.HTMLElement.prototype, "getBoundingClientRect", {
      value: () => ({ top: 0, bottom: 310, height: 310, width: 300, left: 0, right: 300 }),
      writable: true,
      configurable: true,
    });
    Object.defineProperty(happyWindow.HTMLElement.prototype, "offsetHeight", {
      get: () => 310,
      configurable: true,
    });

    container = happyWindow.document.createElement("div") as unknown as HTMLDivElement;
    happyWindow.document.body.appendChild(container as any);
    root = createRoot(container);

    originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      if (typeof url === "string" && url.includes("/api/tracks")) {
        return {
          ok: true,
          json: async () => [
            { id: "trk_1", title: "Song 1", artist: "Artist 1", duration: 180, status: "ready" },
            { id: "trk_2", title: "Song 2", artist: "Artist 2", duration: 200, status: "ready" },
          ],
        };
      }
      if (typeof url === "string" && url.includes("/api/segments")) {
        return { ok: true, json: async () => [] };
      }
      if (typeof url === "string" && url.includes("/api/playlists")) {
        if (url.includes("pl_main")) {
          return {
            ok: true,
            json: async () => ({
              id: "pl_main",
              name: "Main 1000 Videos",
              items: Array.from({ length: 50 }, (_, i) => ({
                id: `pi_main_${i}`,
                track_id: `trk_main_${i}`,
                track: { id: `trk_main_${i}`, title: `Main Track ${i}`, artist: "Artist", duration: 180, status: "ready" },
                sort_order: i,
              })),
            }),
          };
        }
        if (url.includes("pl_other")) {
          return {
            ok: true,
            json: async () => ({
              id: "pl_other",
              name: "Other Short Playlist",
              items: [
                {
                  id: "pi_other_1",
                  track_id: "trk_2",
                  track: { id: "trk_2", title: "Other Track 1", artist: "Artist", duration: 200, status: "ready" },
                  sort_order: 0,
                },
              ],
            }),
          };
        }
        return {
          ok: true,
          json: async () => [
            { id: "pl_main", name: "Main 1000 Videos", item_count: 50 },
            { id: "pl_other", name: "Other Short Playlist", item_count: 1 },
          ],
        };
      }
      return { ok: true, json: async () => [] };
    }) as any;

    usePlayerStore.setState({
      activePlaylistId: null,
      activeSystemCategory: "mixed",
      viewMode: "grid",
      viewScrollPositions: {},
      tracks: [
        { id: "trk_1", title: "Song 1", artist: "Artist 1", duration: 180, status: "ready" } as any,
        { id: "trk_2", title: "Song 2", artist: "Artist 2", duration: 200, status: "ready" } as any,
      ],
      playlists: [
        { id: "pl_main", name: "Main 1000 Videos", item_count: 50 } as any,
        { id: "pl_other", name: "Other Short Playlist", item_count: 1 } as any,
      ],
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    globalThis.fetch = originalFetch;

    if (origGetBoundingClientRectDesc) {
      Object.defineProperty(happyWindow.HTMLElement.prototype, "getBoundingClientRect", origGetBoundingClientRectDesc);
    } else {
      delete (happyWindow.HTMLElement.prototype as any).getBoundingClientRect;
    }
    if (origOffsetHeightDesc) {
      Object.defineProperty(happyWindow.HTMLElement.prototype, "offsetHeight", origOffsetHeightDesc);
    } else {
      delete (happyWindow.HTMLElement.prototype as any).offsetHeight;
    }

    usePlayerStore.setState({
      activePlaylistId: null,
      activeSystemCategory: undefined,
      viewMode: "grid",
      viewScrollPositions: {},
      tracks: [],
      playlists: [],
    });
  });

  it("preserves scroll position when switching from main playlist/category to another playlist and back", async () => {
    await act(async () => {
      root.render(<App />);
    });

    // 1. User is on Mix (main view), scrolls down to 4200px
    await act(async () => {
      (happyWindow as any).scrollY = 4200;
      (happyWindow as any).dispatchEvent(new (happyWindow as any).Event("scroll"));
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(usePlayerStore.getState().getViewScrollPosition("category:mixed")).toBe(4200);

    // 2. User switches to "Other Short Playlist"
    await act(async () => {
      await usePlayerStore.getState().setActivePlaylist("pl_other");
    });

    // Short playlist starts at top (0)
    expect(happyWindow.scrollY).toBe(0);

    // 3. User switches back to "Mix" (the main 1000 videos view)
    await act(async () => {
      usePlayerStore.getState().setActiveSystemCategory("mixed");
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // 4. Scroll position of Mix is perfectly restored to 4200!
    expect(happyWindow.scrollY).toBe(4200);
  });

  it("preserves scroll position between custom playlists", async () => {
    await act(async () => {
      root.render(<App />);
    });

    // 1. Open pl_main and scroll to 3500px
    await act(async () => {
      await usePlayerStore.getState().setActivePlaylist("pl_main");
    });

    await act(async () => {
      (happyWindow as any).scrollY = 3500;
      (happyWindow as any).dispatchEvent(new (happyWindow as any).Event("scroll"));
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(usePlayerStore.getState().getViewScrollPosition("playlist:pl_main")).toBe(3500);

    // 2. Switch to pl_other, scroll to 150px
    await act(async () => {
      await usePlayerStore.getState().setActivePlaylist("pl_other");
    });

    await act(async () => {
      (happyWindow as any).scrollY = 150;
      (happyWindow as any).dispatchEvent(new (happyWindow as any).Event("scroll"));
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(usePlayerStore.getState().getViewScrollPosition("playlist:pl_other")).toBe(150);

    // 3. Switch back to pl_main
    await act(async () => {
      await usePlayerStore.getState().setActivePlaylist("pl_main");
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // pl_main is restored to 3500!
    expect(happyWindow.scrollY).toBe(3500);

    // 4. Switch back to pl_other
    await act(async () => {
      await usePlayerStore.getState().setActivePlaylist("pl_other");
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // pl_other is restored to 150!
    expect(happyWindow.scrollY).toBe(150);
  });

  it("does not clobber saved scroll position when user searches and clears search", async () => {
    await act(async () => {
      root.render(<App />);
    });

    // 1. User scrolls down to 4200px on Mix
    await act(async () => {
      (happyWindow as any).scrollY = 4200;
      (happyWindow as any).dispatchEvent(new (happyWindow as any).Event("scroll"));
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(usePlayerStore.getState().getViewScrollPosition("category:mixed")).toBe(4200);

    // 2. User searches for a track
    const searchInput = container.querySelector<HTMLInputElement>("#library-search-desktop") ||
      container.querySelector<HTMLInputElement>("input[type='search']")!;
    expect(searchInput).toBeTruthy();

    const triggerSearchInput = (val: string) => {
      const reactPropsKey = Object.keys(searchInput).find((k) => k.startsWith("__reactProps") || k.startsWith("__reactEventHandlers"));
      if (reactPropsKey && (searchInput as any)[reactPropsKey]?.onChange) {
        (searchInput as any)[reactPropsKey].onChange({ target: { value: val }, currentTarget: { value: val } });
      } else {
        searchInput.value = val;
        searchInput.dispatchEvent(new (happyWindow as any).Event("input", { bubbles: true }) as any);
      }
    };

    await act(async () => {
      triggerSearchInput("Song 1");
      await new Promise((r) => setTimeout(r, 50));
    });

    // When searching, browser window scroll clamps to 0
    await act(async () => {
      (happyWindow as any).scrollY = 0;
      (happyWindow as any).dispatchEvent(new (happyWindow as any).Event("scroll"));
      await new Promise((r) => setTimeout(r, 20));
    });

    // Stored scroll position must NOT be clobbered to 0!
    expect(usePlayerStore.getState().getViewScrollPosition("category:mixed")).toBe(4200);

    // 3. User clears search
    await act(async () => {
      triggerSearchInput("");
      await new Promise((r) => setTimeout(r, 50));
    });

    // Scroll is restored back to 4200!
    expect(happyWindow.scrollY).toBe(4200);
  });

  it("does not auto-scroll to playing track when returning to Mix after inspecting another playlist", async () => {
    const mockTrack = { id: "trk_1", title: "Song 1", artist: "Artist 1", duration: 180, status: "ready" } as any;
    const mockSegment = { id: "fallback_trk_1", track_id: "trk_1", name: "Full Track", start_time: 0, end_time: 180 } as any;

    usePlayerStore.setState({
      activeTrack: mockTrack,
      activeSegment: mockSegment,
      isPlaying: true,
      playbackMode: "mixed",
      activePlaylistPlayingId: null,
    });

    await act(async () => {
      root.render(<App />);
    });

    // 1. User is on Mix, scrolls down to 3800px
    await act(async () => {
      (happyWindow as any).scrollY = 3800;
      (happyWindow as any).dispatchEvent(new (happyWindow as any).Event("scroll"));
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(usePlayerStore.getState().getViewScrollPosition("category:mixed")).toBe(3800);

    // 2. User switches to "Other Short Playlist" to inspect it
    await act(async () => {
      await usePlayerStore.getState().setActivePlaylist("pl_other");
      await new Promise((r) => setTimeout(r, 60));
    });

    // Short playlist view is at 0
    expect(happyWindow.scrollY).toBe(0);

    // 3. User returns to Mix
    await act(async () => {
      usePlayerStore.getState().setActiveSystemCategory("mixed");
      await new Promise((r) => setTimeout(r, 120));
    });

    // Mix MUST keep its position at 3800px, NOT auto-scroll to the playing track (which is at index 0 / top)!
    expect(happyWindow.scrollY).toBe(3800);
  });

  it("navigates to active track with targetKey when active track title is clicked and clears request", async () => {
    const mockTrack = { id: "trk_1", title: "Song 1", artist: "Artist 1", duration: 180, status: "ready" } as any;
    const mockSegment = { id: "fallback_trk_1", track_id: "trk_1", name: "Full Track", start_time: 0, end_time: 180 } as any;

    usePlayerStore.setState({
      activeTrack: mockTrack,
      activeSegment: mockSegment,
      isPlaying: true,
      playbackMode: "mixed",
      activePlaylistPlayingId: null,
      activeTrackScrollRequest: null,
    });

    await act(async () => {
      root.render(<App />);
    });

    // Request scroll with targetKey
    await act(async () => {
      usePlayerStore.getState().requestScrollToActiveTrack("category:mixed");
      await new Promise((r) => setTimeout(r, 60));
    });

    // In happyWindow / test environment, active track index 0 was scrolled to
    expect(happyWindow.scrollY).toBe(0);

    // activeTrackScrollRequest should be cleared once handled
    expect(usePlayerStore.getState().activeTrackScrollRequest).toBeNull();
  });

  it("does not reset scroll position when activeTrackScrollRequest is cleared on the same view", async () => {
    usePlayerStore.setState({
      activePlaylistPlayingId: "pl_main",
      isPlaying: true,
      activeTrackScrollRequest: null,
      viewScrollPositions: {},
    });

    await usePlayerStore.getState().setActivePlaylist("pl_main");

    await act(async () => {
      root.render(<App />);
    });

    // Wait for playlist items to load
    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });

    const items = usePlayerStore.getState().activePlaylistItems;
    expect(items.length).toBeGreaterThan(30);

    // Target an item far down the list (e.g. index 35)
    const targetItem = items[35];
    act(() => {
      usePlayerStore.setState({
        activeTrack: targetItem.track,
        activeSegment: { id: `fallback_${targetItem.track.id}`, track_id: targetItem.track.id, name: targetItem.track.title, start_time: 0, end_time: 180 } as any,
        queue: [],
        queueIndex: -1,
      });
    });

    // Trigger activeTrackScrollRequest for the open playlist
    await act(async () => {
      usePlayerStore.getState().requestScrollToActiveTrack("playlist:pl_main");
      await new Promise((r) => setTimeout(r, 80));
    });

    // activeTrackScrollRequest was cleared by the scroll handler
    expect(usePlayerStore.getState().activeTrackScrollRequest).toBeNull();

    // Scroll was moved to target row (> 0) and MUST NOT have been reset to 0 by App.tsx layout effect!
    expect(happyWindow.scrollY).toBeGreaterThan(0);
  });
});

