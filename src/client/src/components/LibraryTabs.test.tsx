import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GlobalWindow } from "happy-dom";
import "../i18n";
import { App } from "../App";
import { usePlayerStore } from "../store/usePlayerStore";
import { useLogStore } from "../store/useLogStore";

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

describe("Library Tabs: built-in fold & Playlists tab", () => {
  let container: HTMLDivElement;
  let root: Root;
  let happyWindow: GlobalWindow;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    happyWindow = new GlobalWindow();
    (globalThis as any).window = happyWindow;
    (globalThis as any).document = happyWindow.document;
    (globalThis as any).KeyboardEvent = happyWindow.KeyboardEvent;
    (globalThis as any).HTMLElement = happyWindow.HTMLElement;
    (globalThis as any).HTMLButtonElement = happyWindow.HTMLButtonElement;
    (globalThis as any).Event = happyWindow.Event;

    container = happyWindow.document.createElement("div") as unknown as HTMLDivElement;
    happyWindow.document.body.appendChild(container as any);
    root = createRoot(container);

    originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      if (typeof url === "string" && url.includes("/api/tracks")) {
        return { ok: true, json: async () => [] };
      }
      if (typeof url === "string" && url.includes("/api/segments")) {
        return { ok: true, json: async () => [] };
      }
      if (typeof url === "string" && url.includes("/api/playlists")) {
        if (url.includes("/items")) return { ok: true, json: async () => [] };
        return { ok: true, json: async () => usePlayerStore.getState().playlists };
      }
      return { ok: true, json: async () => ({}) };
    }) as any;

    happyWindow.localStorage.clear();

    usePlayerStore.setState({
      tracks: [],
      playlists: [],
      activePlaylistId: null,
      activeSystemCategory: "mixed",
      activePlaylistItems: [],
      isLoadingTracks: false,
    });

    useLogStore.setState({
      logs: [],
      unreadErrorCount: 0,
      isDrawerOpen: false,
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    globalThis.fetch = originalFetch;
  });

  it("renders Mix and all 4 collapsible built-in tabs by default when not folded", async () => {
    await act(async () => {
      root.render(<App />);
    });

    const mixTab = container.querySelector("#tab-category-mixed");
    const slicesTab = container.querySelector("#tab-category-slices_only");
    const tracksTab = container.querySelector("#tab-category-original_only");
    const downloadingTab = container.querySelector("#tab-category-downloading_only");
    const errorTab = container.querySelector("#tab-category-error_only");

    expect(mixTab).not.toBeNull();
    expect(slicesTab).not.toBeNull();
    expect(tracksTab).not.toBeNull();
    expect(downloadingTab).not.toBeNull();
    expect(errorTab).not.toBeNull();

    // Fold button is present
    const foldBtn = container.querySelector('button[aria-label*="system"], button[title*="system"], button[aria-label*="hệ thống"]');
    expect(foldBtn).not.toBeNull();
  });

  it("clicking fold button hides the 4 tabs, shows the folded toggle, and persists to localStorage", async () => {
    await act(async () => {
      root.render(<App />);
    });

    const foldBtn = container.querySelector('button[title="Collapse system filters"], button[title="Thu gọn danh mục hệ thống"]') as HTMLButtonElement;
    expect(foldBtn).not.toBeNull();

    await act(async () => {
      foldBtn.click();
    });

    expect(container.querySelector("#tab-category-mixed")).not.toBeNull();
    expect(container.querySelector("#tab-category-slices_only")).toBeNull();
    expect(container.querySelector("#tab-category-original_only")).toBeNull();
    expect(container.querySelector("#tab-category-downloading_only")).toBeNull();
    expect(container.querySelector("#tab-category-error_only")).toBeNull();

    // Expand button is present with label
    const expandBtn = container.querySelector('button[title="Expand system filters (4)"], button[title="Mở rộng danh mục hệ thống (4)"]') as HTMLButtonElement;
    expect(expandBtn).not.toBeNull();
    expect(expandBtn.textContent).toContain("4");

    // LocalStorage checked
    expect(happyWindow.localStorage.getItem("slice_player_builtin_folded")).toBe("true");

    // Clicking expand restores the tabs
    await act(async () => {
      expandBtn.click();
    });

    expect(container.querySelector("#tab-category-slices_only")).not.toBeNull();
    expect(container.querySelector("#tab-category-original_only")).not.toBeNull();
    expect(happyWindow.localStorage.getItem("slice_player_builtin_folded")).toBe("false");
  });

  it("resets activeSystemCategory to mixed if folding while on a non-mixed system category", async () => {
    usePlayerStore.setState({
      activePlaylistId: null,
      activeSystemCategory: "slices_only",
    });

    await act(async () => {
      root.render(<App />);
    });

    const foldBtn = container.querySelector('button[title="Collapse system filters"], button[title="Thu gọn danh mục hệ thống"]') as HTMLButtonElement;
    expect(foldBtn).not.toBeNull();

    await act(async () => {
      foldBtn.click();
    });

    expect(usePlayerStore.getState().activeSystemCategory).toBe("mixed");
  });

  it("renders a Playlists tab first in the tab list with the playlist count", async () => {
    usePlayerStore.setState({
      playlists: [
        { id: "pl_1", name: "Gym Hype", created_at: 1000, updated_at: 1000, item_count: 24 },
        { id: "pl_2", name: "Chill", created_at: 2000, updated_at: 2000, item_count: 9 },
      ],
    });

    await act(async () => {
      root.render(<App />);
    });

    const firstTab = container.querySelector('[role="tablist"] [role="tab"]');
    expect(firstTab?.id).toBe("tab-category-playlists");
    expect(firstTab?.textContent).toContain("2");
  });

  it("opening the Playlists tab shows a card per playlist and a create card, without custom playlist pills", async () => {
    usePlayerStore.setState({
      playlists: [
        { id: "pl_1", name: "Gym Hype", created_at: 1000, updated_at: 1000, item_count: 24 },
        { id: "pl_2", name: "Chill", created_at: 2000, updated_at: 2000, item_count: 9 },
      ],
    });

    await act(async () => {
      root.render(<App />);
    });
    await act(async () => {
      (container.querySelector("#tab-category-playlists") as HTMLButtonElement).click();
    });

    const panel = container.querySelector("#main-library-panel")!;
    expect(usePlayerStore.getState().activeSystemCategory).toBe("playlists");
    expect(panel.querySelector('button[aria-label="Open playlist Gym Hype"], button[aria-label="Mở playlist Gym Hype"]')).not.toBeNull();
    expect(panel.querySelector('button[aria-label="Open playlist Chill"], button[aria-label="Mở playlist Chill"]')).not.toBeNull();
    expect(panel.textContent).toMatch(/New Playlist|Tạo Playlist Mới/);
    expect(container.querySelector('[id^="tab-playlist-"]')).toBeNull();
  });

  it("clicking a playlist card opens that playlist", async () => {
    usePlayerStore.setState({
      activeSystemCategory: "playlists",
      playlists: [{ id: "pl_1", name: "Gym Hype", created_at: 1000, updated_at: 1000, item_count: 24 }],
    });

    await act(async () => {
      root.render(<App />);
    });
    await act(async () => {
      (container.querySelector('button[aria-label="Open playlist Gym Hype"], button[aria-label="Mở playlist Gym Hype"]') as HTMLButtonElement).click();
    });

    expect(usePlayerStore.getState().activePlaylistId).toBe("pl_1");
  });

  it("card play and shuffle buttons start the playlist without opening it", async () => {
    const origBuild = usePlayerStore.getState().buildPlaylistQueue;
    const buildCalls: unknown[][] = [];
    usePlayerStore.setState({
      activeSystemCategory: "playlists",
      playlists: [{ id: "pl_1", name: "Gym Hype", created_at: 1000, updated_at: 1000, item_count: 24 }],
      buildPlaylistQueue: (async (...args: unknown[]) => {
        buildCalls.push(args);
      }) as any,
    });

    try {
      await act(async () => {
        root.render(<App />);
      });
      await act(async () => {
        (container.querySelector('button[aria-label="Play Gym Hype"], button[aria-label="Phát Gym Hype"]') as HTMLButtonElement).click();
      });
      await act(async () => {
        (container.querySelector('button[aria-label="Shuffle Gym Hype"], button[aria-label="Xáo trộn Gym Hype"]') as HTMLButtonElement).click();
      });

      expect(buildCalls.map((args) => args.slice(0, 2))).toEqual([["pl_1", false], ["pl_1", true]]);
      expect(usePlayerStore.getState().activePlaylistId).toBeNull();
    } finally {
      usePlayerStore.setState({ buildPlaylistQueue: origBuild });
    }
  });

  it("shows a 2x2 mosaic cover for a playlist without a chosen cover", async () => {
    usePlayerStore.setState({
      activeSystemCategory: "playlists",
      playlists: [
        {
          id: "pl_1",
          name: "Gym Hype",
          created_at: 1000,
          updated_at: 1000,
          item_count: 24,
          cover_url: null,
          mosaic_urls: ["https://img/a.jpg", "https://img/b.jpg", "https://img/c.jpg", "https://img/d.jpg"],
        },
      ],
    });

    await act(async () => {
      root.render(<App />);
    });

    const imgs = Array.from(container.querySelectorAll("#main-library-panel img")).map((img) => img.getAttribute("src"));
    expect(imgs).toEqual(["https://img/a.jpg", "https://img/b.jpg", "https://img/c.jpg", "https://img/d.jpg"]);
  });

  it("shows only the open playlist as a pill in the tab strip", async () => {
    usePlayerStore.setState({
      activePlaylistId: "pl_2",
      playlists: [
        { id: "pl_1", name: "Custom 1", created_at: 1000, updated_at: 1000, item_count: 2 },
        { id: "pl_2", name: "Custom 2", created_at: 2000, updated_at: 2000, item_count: 4 },
      ],
    });

    await act(async () => {
      root.render(<App />);
    });

    const activeTab = container.querySelector("#tab-playlist-pl_2");
    expect(activeTab?.getAttribute("aria-selected")).toBe("true");
    expect(container.querySelector("#tab-playlist-pl_1")).toBeNull();
  });

  it("renders a playlist header with name, item count and play controls when a playlist is open", async () => {
    usePlayerStore.setState({
      activePlaylistId: "pl_1",
      playlists: [{ id: "pl_1", name: "Gym Hype", created_at: 1000, updated_at: 1000, item_count: 24 }],
    });

    await act(async () => {
      root.render(<App />);
    });

    const header = container.querySelector('[data-testid="playlist-header"]');
    expect(header?.querySelector("h2")?.textContent).toBe("Gym Hype");
    expect(header?.textContent).toMatch(/24/);
    expect(header?.querySelector('button[aria-label="Play Gym Hype"], button[aria-label="Phát Gym Hype"]')).not.toBeNull();
  });

  it("keeps built-in categories folded while browsing the Playlists tab", async () => {
    happyWindow.localStorage.setItem("slice_player_builtin_folded", "true");

    await act(async () => {
      root.render(<App />);
    });
    await act(async () => {
      (container.querySelector("#tab-category-playlists") as HTMLButtonElement).click();
    });

    expect(container.querySelector("#tab-category-slices_only")).toBeNull();
    expect(happyWindow.localStorage.getItem("slice_player_builtin_folded")).toBe("true");
  });

  it("tablist container has shrink-0 to prevent flexbox shrink collision with + New Playlist", async () => {
    await act(async () => {
      root.render(<App />);
    });

    const tablist = container.querySelector('[role="tablist"]');
    expect(tablist).not.toBeNull();
    expect(tablist?.classList.contains("shrink-0")).toBe(true);
  });

  it("renders sticky compact header and tabs bar that stays with user on scroll", async () => {
    await act(async () => {
      root.render(<App />);
    });

    const stickyBar = container.querySelector('[data-testid="sticky-library-header"]');
    expect(stickyBar).not.toBeNull();
    expect(stickyBar?.classList.contains("z-30")).toBe(true);

    // Header title and View mode switcher are inside the sticky bar
    const title = stickyBar?.querySelector("h1");
    expect(title).not.toBeNull();
    expect(title?.textContent).toContain("Mix");

    const viewGroup = stickyBar?.querySelector('[role="group"][aria-label*="View"], [role="group"][aria-label*="chế độ"]');
    expect(viewGroup).not.toBeNull();

    // Tablist is also inside the sticky bar
    const tablist = stickyBar?.querySelector('[role="tablist"]');
    expect(tablist).not.toBeNull();

    // Content panel is outside and below the sticky bar
    const panel = container.querySelector("#main-library-panel");
    expect(panel).not.toBeNull();
    expect(stickyBar?.contains(panel)).toBe(false);
  });
});
