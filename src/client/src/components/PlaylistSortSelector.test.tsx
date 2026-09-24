import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GlobalWindow } from "happy-dom";
import { PlaylistSortSelector } from "./PlaylistSortSelector";
import { usePlayerStore } from "../store/usePlayerStore";

describe("PlaylistSortSelector Component", () => {
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

  it("renders all 4 sort mode buttons with manual active by default for custom playlist", async () => {
    usePlayerStore.setState({ activePlaylistId: "pl_1", playlistSortMode: "manual" });

    await act(async () => {
      root.render(<PlaylistSortSelector />);
    });

    const buttons = container.querySelectorAll("button");
    expect(buttons.length).toBe(4);

    expect(buttons[0].getAttribute("aria-pressed")).toBe("true");
    expect(buttons[1].getAttribute("aria-pressed")).toBe("false");
    expect(buttons[2].getAttribute("aria-pressed")).toBe("false");
    expect(buttons[3].getAttribute("aria-pressed")).toBe("false");
  });

  it("renders 3 sort mode buttons for built-in categories with newest active by default", async () => {
    usePlayerStore.setState({
      activePlaylistId: null,
      activeSystemCategory: "mixed",
      systemCategorySortMode: {
        mixed: "newest",
        slices_only: "newest",
        original_only: "newest",
      },
    });

    await act(async () => {
      root.render(<PlaylistSortSelector />);
    });

    const buttons = container.querySelectorAll("button");
    expect(buttons.length).toBe(3);

    // [0] is newest, [1] is oldest, [2] is random
    expect(buttons[0].getAttribute("aria-pressed")).toBe("true");
    expect(buttons[1].getAttribute("aria-pressed")).toBe("false");
    expect(buttons[2].getAttribute("aria-pressed")).toBe("false");

    // Click "Oldest"
    await act(async () => {
      buttons[1].dispatchEvent(new (window as any).MouseEvent("click", { bubbles: true }));
    });
    expect(usePlayerStore.getState().systemCategorySortMode.mixed).toBe("oldest");
  });

  it("switches to newest, oldest, and random mode when clicked", async () => {
    usePlayerStore.setState({
      activePlaylistId: "pl_1",
      activePlaylistItems: [
        { id: "pi_1", playlist_id: "pl_1", track_id: "t_1", sort_order: 0, added_at: 100 } as any,
        { id: "pi_2", playlist_id: "pl_1", track_id: "t_2", sort_order: 1, added_at: 200 } as any,
      ],
      playlistSortMode: "manual",
    });

    await act(async () => {
      root.render(<PlaylistSortSelector />);
    });

    const buttons = container.querySelectorAll("button");

    // Click "Newest" (button 1)
    await act(async () => {
      buttons[1].dispatchEvent(new (window as any).MouseEvent("click", { bubbles: true }));
    });
    expect(usePlayerStore.getState().playlistSortMode).toBe("newest");

    // Click "Oldest" (button 2)
    await act(async () => {
      buttons[2].dispatchEvent(new (window as any).MouseEvent("click", { bubbles: true }));
    });
    expect(usePlayerStore.getState().playlistSortMode).toBe("oldest");

    // Click "Random" (button 3)
    await act(async () => {
      buttons[3].dispatchEvent(new (window as any).MouseEvent("click", { bubbles: true }));
    });
    expect(usePlayerStore.getState().playlistSortMode).toBe("random");
    expect(usePlayerStore.getState().playlistRandomMap["pl_1"]).toBeDefined();
    expect(usePlayerStore.getState().playlistRandomMap["pl_1"].length).toBe(2);
  });

  it("re-randomizes when clicking random button while already in random mode", async () => {
    usePlayerStore.setState({
      activePlaylistId: "pl_1",
      activePlaylistItems: [
        { id: "pi_1", playlist_id: "pl_1", track_id: "t_1", sort_order: 0, added_at: 100 } as any,
        { id: "pi_2", playlist_id: "pl_1", track_id: "t_2", sort_order: 1, added_at: 200 } as any,
        { id: "pi_3", playlist_id: "pl_1", track_id: "t_3", sort_order: 2, added_at: 300 } as any,
      ],
      playlistSortMode: "random",
      playlistRandomMap: { pl_1: ["pi_1", "pi_2", "pi_3"] },
    });

    await act(async () => {
      root.render(<PlaylistSortSelector />);
    });

    const buttons = container.querySelectorAll("button");
    const randomBtn = buttons[3];
    expect(randomBtn.getAttribute("aria-pressed")).toBe("true");

    await act(async () => {
      randomBtn.dispatchEvent(new (window as any).MouseEvent("click", { bubbles: true }));
    });

    expect(usePlayerStore.getState().playlistSortMode).toBe("random");
    const shuffled = usePlayerStore.getState().playlistRandomMap["pl_1"];
    expect(shuffled).toBeDefined();
    expect(shuffled.length).toBe(3);
    expect(shuffled.sort()).toEqual(["pi_1", "pi_2", "pi_3"]);
  });
});
