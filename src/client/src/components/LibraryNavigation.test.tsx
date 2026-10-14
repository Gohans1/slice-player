import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GlobalWindow } from "happy-dom";
import i18n from "../i18n";
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

describe("Library navigation: sidebar, playlists overview and sticky header", () => {
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

  const sidebarButton = (label: string) =>
    Array.from(container.querySelectorAll<HTMLElement>('[data-sidebar="menu-button"]')).find(
      (el) => el.textContent?.trim() === label
    )!;

  async function waitFor(check: () => boolean) {
    for (let i = 0; i < 50 && !check(); i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
    }
  }

  it("switches library category from the sidebar and titles the view after it", async () => {
    await act(async () => {
      root.render(<App />);
    });

    await act(async () => {
      sidebarButton("Slices").click();
    });

    expect(usePlayerStore.getState().activeSystemCategory).toBe("slices_only");
    expect(sidebarButton("Slices").hasAttribute("data-active")).toBe(true);
    expect(container.querySelector('[data-testid="sticky-library-header"] h1')?.textContent).toContain("Slices");
  });

  it("opens the playlists overview from the sidebar with a card per playlist and a create card", async () => {
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
      sidebarButton("All Playlists").click();
    });

    const panel = container.querySelector("#main-library-panel")!;
    expect(usePlayerStore.getState().activeSystemCategory).toBe("playlists");
    expect(panel.querySelector('button[aria-label="Open playlist Gym Hype"]')).not.toBeNull();
    expect(panel.querySelector('button[aria-label="Open playlist Chill"]')).not.toBeNull();
    expect(panel.textContent).toContain("New Playlist");
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
      (container.querySelector('button[aria-label="Open playlist Gym Hype"]') as HTMLButtonElement).click();
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
      const panel = container.querySelector("#main-library-panel")!;
      await act(async () => {
        (panel.querySelector('button[aria-label="Play Gym Hype"]') as HTMLButtonElement).click();
      });
      await act(async () => {
        (panel.querySelector('button[aria-label="Shuffle Gym Hype"]') as HTMLButtonElement).click();
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

  it("highlights the open playlist in the sidebar", async () => {
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

    expect(sidebarButton("Custom 2").hasAttribute("data-active")).toBe(true);
    expect(sidebarButton("Custom 1").hasAttribute("data-active")).toBe(false);
    expect(sidebarButton("Mix").hasAttribute("data-active")).toBe(false);
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
    expect(header?.querySelector('button[aria-label="Play Gym Hype"]')).not.toBeNull();
  });

  it("searches the library from the sidebar", async () => {
    await act(async () => {
      root.render(<App />);
    });

    const search = container.querySelector('[data-sidebar="header"] input[type="search"]');
    expect(search?.getAttribute("aria-label")).toBe("Search tracks or artists");
  });

  it("opens the create playlist dialog from the sidebar", async () => {
    await act(async () => {
      root.render(<App />);
    });

    await act(async () => {
      (container.querySelector('[data-sidebar="group-action"][aria-label="New Playlist"]') as HTMLButtonElement).click();
    });
    const title = i18n.t("createPlaylist.title");
    await waitFor(() => Boolean(happyWindow.document.body.textContent?.includes(title)));

    expect(happyWindow.document.body.textContent).toContain(title);
  });

  it("keeps the view title, view switcher, library actions and master volume in one sticky toolbar", async () => {
    await act(async () => {
      root.render(<App />);
    });

    const stickyBar = container.querySelector('[data-testid="sticky-library-header"]');
    expect(stickyBar).not.toBeNull();
    expect(stickyBar?.querySelector("h1")?.textContent).toContain("Mix");
    expect(stickyBar?.querySelector('[role="group"][aria-label*="View"]')).not.toBeNull();
    expect(stickyBar?.querySelector('button[aria-label="+ YouTube"]')).not.toBeNull();
    expect(stickyBar?.querySelector('button[aria-label="+ Local Audio"]')).not.toBeNull();
    expect(stickyBar?.querySelector('input[type="range"][aria-label="Master volume"]')).not.toBeNull();
    expect(container.querySelectorAll('[role="tablist"]').length).toBe(0);
    expect(container.querySelectorAll("header").length).toBe(1);

    const panel = container.querySelector("#main-library-panel");
    expect(panel).not.toBeNull();
    expect(stickyBar?.contains(panel)).toBe(false);
  });
});
