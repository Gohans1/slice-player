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

describe("Library Tabs Fold & Custom Playlists Separator", () => {
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

  it("renders a vertical separator between built-in tabs and custom playlists when playlists exist", async () => {
    usePlayerStore.setState({
      playlists: [
        {
          id: "pl_1",
          name: "My Custom Playlist",
          created_at: 1000,
          updated_at: 1000,
          item_count: 5,
        },
      ],
    });

    await act(async () => {
      root.render(<App />);
    });

    const separator = container.querySelector('[data-testid="playlist-separator"]');
    expect(separator).not.toBeNull();
    expect(container.querySelector("#tab-playlist-pl_1")).not.toBeNull();
  });

  it("does not render the separator when there are no custom playlists", async () => {
    usePlayerStore.setState({
      playlists: [],
    });

    await act(async () => {
      root.render(<App />);
    });

    const separator = container.querySelector('[data-testid="playlist-separator"]');
    expect(separator).toBeNull();
  });

  it("allows folding custom playlists, displays compact fold pill, and persists state", async () => {
    usePlayerStore.setState({
      playlists: [
        { id: "pl_1", name: "Custom 1", created_at: 1000, updated_at: 1000, item_count: 2 },
        { id: "pl_2", name: "Custom 2", created_at: 2000, updated_at: 2000, item_count: 4 },
      ],
    });

    await act(async () => {
      root.render(<App />);
    });

    expect(container.querySelector("#tab-playlist-pl_1")).not.toBeNull();
    expect(container.querySelector("#tab-playlist-pl_2")).not.toBeNull();

    // Find custom playlist fold button
    const foldCustomBtn = container.querySelector(
      'button[title="Collapse custom playlists"], button[title="Thu gọn playlist cá nhân"]'
    ) as HTMLButtonElement;
    expect(foldCustomBtn).not.toBeNull();

    await act(async () => {
      foldCustomBtn.click();
    });

    // Custom tabs are folded away
    expect(container.querySelector("#tab-playlist-pl_1")).toBeNull();
    expect(container.querySelector("#tab-playlist-pl_2")).toBeNull();

    // Unfold button is visible with count 2
    const unfoldBtn = container.querySelector(
      'button[title*="Expand custom playlists"], button[title*="Mở rộng playlist cá nhân"]'
    ) as HTMLButtonElement;
    expect(unfoldBtn).not.toBeNull();
    expect(unfoldBtn.textContent).toContain("2");
    expect(happyWindow.localStorage.getItem("slice_player_custom_playlists_folded")).toBe("true");

    // Clicking unfold restores custom tabs
    await act(async () => {
      unfoldBtn.click();
    });

    expect(container.querySelector("#tab-playlist-pl_1")).not.toBeNull();
    expect(container.querySelector("#tab-playlist-pl_2")).not.toBeNull();
    expect(happyWindow.localStorage.getItem("slice_player_custom_playlists_folded")).toBe("false");
  });

  it("keeps active custom playlist visible even when custom playlists are folded", async () => {
    usePlayerStore.setState({
      activePlaylistId: "pl_2",
      playlists: [
        { id: "pl_1", name: "Custom 1", created_at: 1000, updated_at: 1000, item_count: 2 },
        { id: "pl_2", name: "Custom 2", created_at: 2000, updated_at: 2000, item_count: 4 },
      ],
    });
    happyWindow.localStorage.setItem("slice_player_custom_playlists_folded", "true");

    await act(async () => {
      root.render(<App />);
    });

    // pl_2 is active, so its tab must remain visible even in folded mode
    const activeTab = container.querySelector("#tab-playlist-pl_2");
    expect(activeTab).not.toBeNull();
    expect(activeTab?.getAttribute("aria-selected")).toBe("true");

    // pl_1 is folded
    expect(container.querySelector("#tab-playlist-pl_1")).toBeNull();
  });

  it("limits visible custom playlists to 3 and displays more popover button for remaining playlists", async () => {
    usePlayerStore.setState({
      playlists: [
        { id: "pl_1", name: "Playlist 1", created_at: 1000, updated_at: 1000, item_count: 1 },
        { id: "pl_2", name: "Playlist 2", created_at: 2000, updated_at: 2000, item_count: 2 },
        { id: "pl_3", name: "Playlist 3", created_at: 3000, updated_at: 3000, item_count: 3 },
        { id: "pl_4", name: "Playlist 4", created_at: 4000, updated_at: 4000, item_count: 4 },
        { id: "pl_5", name: "Playlist 5", created_at: 5000, updated_at: 5000, item_count: 5 },
      ],
    });

    await act(async () => {
      root.render(<App />);
    });

    // First 3 are visible
    expect(container.querySelector("#tab-playlist-pl_1")).not.toBeNull();
    expect(container.querySelector("#tab-playlist-pl_2")).not.toBeNull();
    expect(container.querySelector("#tab-playlist-pl_3")).not.toBeNull();
    // 4 and 5 are not directly in the bar
    expect(container.querySelector("#tab-playlist-pl_4")).toBeNull();
    expect(container.querySelector("#tab-playlist-pl_5")).toBeNull();

    // More button is rendered with count 2
    const moreBtn = container.querySelector(
      'button[title*="More playlists"], button[title*="Playlist khác"]'
    ) as HTMLButtonElement;
    expect(moreBtn).not.toBeNull();
    expect(moreBtn.textContent).toContain("2");

    // Click more button to open popover
    await act(async () => {
      moreBtn.click();
    });

    const menu = container.querySelector('[role="menu"]');
    expect(menu).not.toBeNull();
    expect(menu?.textContent).toContain("Playlist 4");
    expect(menu?.textContent).toContain("Playlist 5");

    // Clicking Playlist 4 from popover selects it and brings it into visible tabs
    const pl4Btn = Array.from(menu!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find(
      (b) => b.textContent?.includes("Playlist 4")
    );
    expect(pl4Btn).toBeDefined();

    await act(async () => {
      pl4Btn!.click();
    });

    expect(usePlayerStore.getState().activePlaylistId).toBe("pl_4");
    expect(container.querySelector("#tab-playlist-pl_4")).not.toBeNull();
    expect(container.querySelector('[role="menu"]')).toBeNull();
  });

  it("tablist container has shrink-0 to prevent flexbox shrink collision with + New Playlist", async () => {
    await act(async () => {
      root.render(<App />);
    });

    const tablist = container.querySelector('[role="tablist"]');
    expect(tablist).not.toBeNull();
    expect(tablist?.classList.contains("shrink-0")).toBe(true);
  });
});
