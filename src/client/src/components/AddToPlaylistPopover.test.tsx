import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { GlobalWindow } from "happy-dom";
import { AddToPlaylistPopover } from "./AddToPlaylistPopover";
import { usePlayerStore } from "../store/usePlayerStore";
import i18n from "../i18n";

describe("AddToPlaylistPopover Component", () => {
  let window: any;
  let container: any;
  let root: any;
  const originalFetch = globalThis.fetch;
  const originalAddToPlaylist = usePlayerStore.getState().addToPlaylist;
  const originalRemoveFromPlaylist = usePlayerStore.getState().removeFromPlaylist;

  beforeEach(async () => {
    await i18n.changeLanguage("en");
    window = new GlobalWindow();
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    (globalThis as any).window = window;
    (globalThis as any).document = window.document;
    (globalThis as any).Node = window.Node;
    (globalThis as any).Element = window.Element;
    (globalThis as any).HTMLElement = window.HTMLElement;

    container = window.document.createElement("div");
    window.document.body.appendChild(container);
    root = createRoot(container);

    usePlayerStore.setState({
      playlists: [
        { id: "pl_1", name: "Playlist One", created_at: 1, updated_at: 1, item_count: 1 },
        { id: "pl_2", name: "Playlist Two", created_at: 2, updated_at: 2, item_count: 0 },
      ],
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    usePlayerStore.setState({
      addToPlaylist: originalAddToPlaylist,
      removeFromPlaylist: originalRemoveFromPlaylist,
    });
    act(() => {
      root.unmount();
    });
    container.remove();
    delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
    delete (globalThis as any).window;
    delete (globalThis as any).document;
    delete (globalThis as any).Node;
    delete (globalThis as any).Element;
    delete (globalThis as any).HTMLElement;
  });

  it("fetches memberships on open and marks existing playlist with checkmark", async () => {
    globalThis.fetch = mock(async (url: any) => {
      if (String(url).includes("/api/playlist-memberships")) {
        return new Response(JSON.stringify([{ playlist_id: "pl_1", item_id: "item_1" }]), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }) as any;

    act(() => {
      root.render(<AddToPlaylistPopover trackId="trk_1" />);
    });

    const triggerBtn = container.querySelector('button[title="Add to Playlist"]');
    expect(triggerBtn).not.toBeNull();

    await act(async () => {
      triggerBtn.click();
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(container.textContent).toContain("Playlist One");
    expect(container.textContent).toContain("Playlist Two");

    const buttons = container.querySelectorAll("button");
    const pl1Button = Array.from(buttons).find((b: any) => b.textContent.includes("Playlist One")) as HTMLButtonElement;
    const pl2Button = Array.from(buttons).find((b: any) => b.textContent.includes("Playlist Two")) as HTMLButtonElement;

    expect(pl1Button.querySelector("svg.lucide-check")).not.toBeNull();
    expect(pl2Button.querySelector("svg.lucide-check")).toBeNull();
  });

  it("calls addToPlaylist when unchecked playlist is clicked", async () => {
    const addToPlaylistMock = mock(async () => true);
    usePlayerStore.setState({ addToPlaylist: addToPlaylistMock });

    globalThis.fetch = mock(async (url: any) => {
      if (String(url).includes("/api/playlist-memberships")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }) as any;

    act(() => {
      root.render(<AddToPlaylistPopover trackId="trk_1" segmentId="seg_1" />);
    });

    const triggerBtn = container.querySelector('button[title="Add to Playlist"]');
    await act(async () => {
      triggerBtn.click();
      await new Promise((r) => setTimeout(r, 50));
    });

    const buttons = container.querySelectorAll("button");
    const pl2Button = Array.from(buttons).find((b: any) => b.textContent.includes("Playlist Two")) as HTMLButtonElement;
    expect(pl2Button).not.toBeNull();

    await act(async () => {
      pl2Button.click();
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(addToPlaylistMock).toHaveBeenCalledWith("pl_2", "trk_1", "seg_1");
  });

  it("calls removeFromPlaylist when checked playlist is clicked", async () => {
    const removeFromPlaylistMock = mock(async () => true);
    usePlayerStore.setState({ removeFromPlaylist: removeFromPlaylistMock });

    globalThis.fetch = mock(async (url: any) => {
      if (String(url).includes("/api/playlist-memberships")) {
        return new Response(JSON.stringify([{ playlist_id: "pl_1", item_id: "pli_100" }]), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }) as any;

    act(() => {
      root.render(<AddToPlaylistPopover trackId="trk_1" />);
    });

    const triggerBtn = container.querySelector('button[title="Add to Playlist"]');
    await act(async () => {
      triggerBtn.click();
      await new Promise((r) => setTimeout(r, 50));
    });

    const buttons = container.querySelectorAll("button");
    const pl1Button = Array.from(buttons).find((b: any) => b.textContent.includes("Playlist One")) as HTMLButtonElement;
    expect(pl1Button.querySelector("svg.lucide-check")).not.toBeNull();

    await act(async () => {
      pl1Button.click();
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(removeFromPlaylistMock).toHaveBeenCalledWith("pl_1", "pli_100");
  });

  it("includes segment_id in fetch request when segmentId is provided", async () => {
    let capturedUrl = "";
    globalThis.fetch = mock(async (url: any) => {
      capturedUrl = String(url);
      return new Response(JSON.stringify([]), { status: 200 });
    }) as any;

    act(() => {
      root.render(<AddToPlaylistPopover trackId="trk_xyz" segmentId="seg_abc" />);
    });

    const triggerBtn = container.querySelector('button[title="Add to Playlist"]');
    await act(async () => {
      triggerBtn.click();
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(capturedUrl).toContain("/api/playlist-memberships");
    expect(capturedUrl).toContain("track_id=trk_xyz");
    expect(capturedUrl).toContain("segment_id=seg_abc");
  });
});
