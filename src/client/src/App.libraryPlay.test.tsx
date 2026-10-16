import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { App } from "./App";
import { usePlayerStore, resetEtagCache, type PlayerState, type QueuePlacement } from "./store/usePlayerStore";
import { useHomeStore } from "./store/useHomeStore";
import type { HomeSummary, PlaySource, Segment, Track } from "@/server/types";

const originalFetch = globalThis.fetch;
const initialStore = usePlayerStore.getState();
const first: Track = { id: "trk-first", source_type: "local", source_uri: "a.opus", title: "First", duration: 60, status: "ready", segment_count: 0, created_at: 2 };
const second: Track = { id: "trk-second", source_type: "local", source_uri: "b.opus", title: "Second", duration: 90, status: "ready", segment_count: 1, created_at: 1 };
const chorus: Segment = { id: "seg-chorus", track_id: second.id, name: "Chorus", start_time: 10, end_time: 20, created_at: 3 };
// Listed on the Mix and Tracks pages while it downloads, but it can't play yet
const pending: Track = { id: "trk-pending", source_type: "youtube", source_uri: "https://www.youtube.com/watch?v=p", title: "Pending", duration: 30, status: "downloading", segment_count: 0, created_at: 4 };

type PlayCall = [mode: Parameters<PlayerState["playModeQueue"]>[0], songs: string[], options: Parameters<PlayerState["playModeQueue"]>[2]];
let played: PlayCall[] = [];
let queued: [songs: string[], placement: QueuePlacement, source: PlaySource][] = [];
const fromTracks: PlaySource = { source_type: "original_only", playlist_id: null, via_home: false };
let queueAccepts = true;
let segments: Segment[] = [chorus];
const noPlays: HomeSummary = { recently_played: [], heavy_rotation: [], top_playlists: [] };
let history = noPlays;
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  played = [];
  queued = [];
  queueAccepts = true;
  segments = [chorus];
  history = noPlays;
  useHomeStore.setState({ summary: null, failed: false });
  resetEtagCache();
  globalThis.fetch = Object.assign(async (input: Parameters<typeof fetch>[0]) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === "/api/tracks") return Response.json([pending, first, second]);
    if (url === "/api/segments") return Response.json(segments);
    if (url === "/api/home") return Response.json(history);
    return Response.json([]);
  }, { preconnect: originalFetch.preconnect });
  usePlayerStore.setState({
    ...initialStore,
    tracks: [],
    activePlaylistId: null,
    viewMode: "list",
    playModeQueue: async (mode, items, options) => {
      played.push([mode, items.map((item) => item.segment.id), options]);
    },
    enqueue: (items, placement, source) => {
      queued.push([items.map((item) => item.segment.id), placement, source]);
      return queueAccepts;
    },
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  globalThis.fetch = originalFetch;
  usePlayerStore.setState(initialStore);
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

async function renderPage(category: "home" | "mixed" | "slices_only" | "original_only" | "downloading_only", search?: string) {
  usePlayerStore.setState({ activeSystemCategory: category });
  await act(async () => {
    root.render(<App />);
    await tick();
  });
  if (search) {
    const field = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(field, search);
      field.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
  }
}

const button = (name: string) => container.querySelector<HTMLButtonElement>(`button[aria-label='${name}']`);

async function press(name: string) {
  await act(async () => {
    button(name)?.click();
    await tick();
  });
}

async function chooseFromMore(page: string, item: string) {
  await press(`More actions for ${page}`);
  await act(async () => {
    Array.from(document.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]'))
      .find((el) => el.textContent?.trim() === item)
      ?.click();
    await tick();
  });
}

// Like the Play and Shuffle buttons at the top of Songs in Apple Music
describe("Play and Shuffle on a library page", () => {
  it("plays the page's songs from the top, in the page's order", async () => {
    await renderPage("mixed");

    await press("Play Mix");

    expect(played).toEqual([["mixed", [chorus.id, `fallback_${first.id}`, `fallback_${second.id}`], { shuffle: false }]]);
  });

  it("shuffles the page's songs", async () => {
    await renderPage("slices_only");

    await press("Shuffle Slices");

    expect(played).toEqual([["slices_only", [chorus.id], { shuffle: true }]]);
  });

  it("plays only what a search found, and names the search", async () => {
    await renderPage("original_only", "First");

    await press("Play Tracks");

    expect(played).toEqual([
      ["original_only", [`fallback_${first.id}`], { shuffle: false, origin: { type: "search", query: "First", count: 1, mode: "original_only" } }],
    ]);
  });

  it("turns Play and Shuffle off on a page with nothing to play", async () => {
    segments = [];
    await renderPage("slices_only");

    expect(button("Play Slices")?.disabled).toBe(true);
    expect(button("Shuffle Slices")?.disabled).toBe(true);
  });

  it("has no Play on a page of downloads", async () => {
    await renderPage("downloading_only");

    expect(container.querySelector("button[aria-label^='Play ']") === null).toBe(true);
  });
});

describe("Play Next and Play Later on a library page", () => {
  it("adds the page's songs after the current one", async () => {
    await renderPage("original_only");

    await chooseFromMore("Tracks", "Play Next");

    expect(queued).toEqual([[[`fallback_${first.id}`, `fallback_${second.id}`], "next", fromTracks]]);
    expect(played).toEqual([]);
  });

  // The sidebar's menu is about the whole page, not what the search on the open page found
  it("queues the whole page from the sidebar, whatever the open page's search", async () => {
    await renderPage("original_only", "First");
    const tracksInSidebar = Array.from(container.querySelectorAll<HTMLElement>('[data-sidebar="menu-button"]')).find(
      (el) => el.textContent?.trim() === "Tracks"
    );

    await act(async () => {
      tracksInSidebar?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: 40, clientY: 40 }));
      await tick();
    });
    await act(async () => {
      Array.from(document.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]'))
        .find((el) => el.textContent?.trim() === "Play Next")
        ?.click();
      await tick();
    });

    expect(queued).toEqual([[[`fallback_${first.id}`, `fallback_${second.id}`], "next", fromTracks]]);
  });

  it("plays the page when nothing is queued for its songs to follow", async () => {
    queueAccepts = false;
    await renderPage("original_only");

    await chooseFromMore("Tracks", "Play Later");

    expect(queued.map(([, placement]) => placement)).toEqual(["later"]);
    expect(played).toEqual([["original_only", [`fallback_${first.id}`, `fallback_${second.id}`], { shuffle: false }]]);
  });
});

describe("Home", () => {
  const sidebarButton = (name: string) =>
    Array.from(container.querySelectorAll<HTMLElement>('[data-sidebar="menu-button"]')).find((el) => el.textContent?.trim() === name);
  const pageTitle = () => container.querySelector("#main-library-panel h2")?.textContent;

  it("is where the app opens, picked in the sidebar", async () => {
    await act(async () => {
      root.render(<App />);
      await tick();
    });

    expect(pageTitle()).toBe("Home");
    expect([sidebarButton("Home"), sidebarButton("Mix")].map((el) => el?.hasAttribute("data-active"))).toEqual([true, false]);
  });

  // Home has no songs of its own to filter
  it("looks through the whole library for a search typed there", async () => {
    await renderPage("home", "First");

    expect(pageTitle()).toBe("Mix");
    expect(container.querySelector<HTMLInputElement>('input[type="search"]')?.value).toBe("First");
  });

  it("plays a library page as the page lists it, as started from Home", async () => {
    history = { ...noPlays, recently_played: [{ source_type: "original_only", playlist_id: null }] };
    await renderPage("home");

    await press("Play Tracks");

    expect(played).toEqual([
      ["original_only", [`fallback_${first.id}`, `fallback_${second.id}`], { shuffle: false, origin: { type: "system", mode: "original_only", fromHome: true } }],
    ]);
  });

  it("queues a library page credited to that page, as started from Home", async () => {
    history = { ...noPlays, recently_played: [{ source_type: "original_only", playlist_id: null }] };
    await renderPage("home");

    await press("More options for Tracks");
    await act(async () => {
      Array.from(document.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]'))
        .find((el) => el.textContent?.trim() === "Play Next")
        ?.click();
      await tick();
    });

    expect(queued).toEqual([[[`fallback_${first.id}`, `fallback_${second.id}`], "next", { ...fromTracks, via_home: true }]]);
  });
});

