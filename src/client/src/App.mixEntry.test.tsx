import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { App } from "./App";
import { usePlayerStore, resetEtagCache } from "./store/usePlayerStore";
import i18n from "./i18n";
// Loaded up front, so the lazily loaded dialog opens within a tick
import "./components/MixPlaylistModal";
import type { Playlist } from "@/server/types";

const originalFetch = globalThis.fetch;
const initialStore = usePlayerStore.getState();
const rock: Playlist & { item_count: number } = { id: "pl_rock", name: "Rock", created_at: 1, updated_at: 1, item_count: 2 };
const jazz: Playlist & { item_count: number } = { id: "pl_jazz", name: "Jazz", created_at: 2, updated_at: 2, item_count: 2 };
let root: Root;
let container: HTMLDivElement;

const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("Starting a mix from the sidebar", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    resetEtagCache();
    globalThis.fetch = Object.assign(
      async (input: Parameters<typeof fetch>[0]) => {
        const url = input instanceof Request ? input.url : String(input);
        return Response.json(url === "/api/playlists" ? [rock, jazz] : []);
      },
      { preconnect: originalFetch.preconnect }
    );
    usePlayerStore.setState({ ...initialStore, activePlaylistId: null, activeSystemCategory: "playlists" });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(<App />);
      await tick();
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    globalThis.fetch = originalFetch;
    usePlayerStore.setState(initialStore);
  });

  const click = (el: Element | null | undefined) =>
    act(async () => {
      if (el instanceof HTMLElement) el.click();
      await tick();
    });
  const menuItem = (label: string) =>
    Array.from(document.querySelectorAll('[role="menu"] [role="menuitem"]')).find((el) => el.textContent?.trim() === label);
  const pickedNames = () =>
    Array.from(document.querySelectorAll("[role='dialog'] [role='combobox']")).map(
      (el) => el.querySelector("[data-slot='select-value']")?.textContent ?? ""
    );

  it("opens a new mix with the playlist whose menu it came from in the first row", async () => {
    await click(container.querySelector('[aria-label="More options for Rock"]'));
    await click(menuItem("New Mix with This Playlist"));

    expect(pickedNames()).toEqual(["Rock", "Choose a playlist"]);
  });

  it("opens an empty new mix from the Playlists group's +", async () => {
    await click(container.querySelector('[aria-label="New Playlist or Mix"]'));
    await click(menuItem("New Mix"));

    expect(pickedNames()).toEqual(["Choose a playlist", "Choose a playlist"]);
  });
});
