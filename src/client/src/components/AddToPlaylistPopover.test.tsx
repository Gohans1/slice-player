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
  const originalCreatePlaylist = usePlayerStore.getState().createPlaylist;

  beforeEach(async () => {
    await i18n.changeLanguage("en");
    window = new GlobalWindow();
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    (globalThis as any).window = window;
    (globalThis as any).document = window.document;
    (globalThis as any).Node = window.Node;
    (globalThis as any).Element = window.Element;
    (globalThis as any).HTMLElement = window.HTMLElement;
    (globalThis as any).HTMLInputElement = window.HTMLInputElement;
    (globalThis as any).Event = window.Event;
    (globalThis as any).KeyboardEvent = window.KeyboardEvent;
    (globalThis as any).MouseEvent = window.MouseEvent;

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

  const menuItems = (role: string) => Array.from(document.querySelectorAll<HTMLElement>(`[role="${role}"]`));
  const playlistItem = (name: string) => menuItems("menuitemcheckbox").find((item) => item.textContent?.includes(name))!;
  const newPlaylistItem = () => menuItems("menuitem").find((item) => item.textContent?.toLowerCase().includes("new playlist"));

  afterEach(() => {
    globalThis.fetch = originalFetch;
    usePlayerStore.setState({
      addToPlaylist: originalAddToPlaylist,
      removeFromPlaylist: originalRemoveFromPlaylist,
      createPlaylist: originalCreatePlaylist,
    });
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("does not offer a mix playlist as a destination (mixes only mirror their sources)", async () => {
    globalThis.fetch = mock(async () => new Response("[]", { status: 200 })) as any;
    usePlayerStore.setState({
      playlists: [
        { id: "pl_1", name: "Playlist One", created_at: 1, updated_at: 1, item_count: 1 },
        { id: "mix_1", name: "Mix Of Both", created_at: 3, updated_at: 3, item_count: 1, is_mix: true, source_ids: ["pl_1", "pl_2"] },
      ],
    });

    act(() => {
      root.render(<AddToPlaylistPopover trackId="trk_1" />);
    });
    await act(async () => {
      container.querySelector('button[title="Add to Playlist"]').click();
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(window.document.body.textContent).toContain("Playlist One");
    expect(window.document.body.textContent).not.toContain("Mix Of Both");
  });

  it("does not fetch memberships while closed, fetches on open, and marks existing playlist with checkmark", async () => {
    let fetchCalls = 0;
    globalThis.fetch = mock(async (url: any) => {
      if (String(url).includes("/api/playlist-memberships")) {
        fetchCalls++;
        return new Response(JSON.stringify([{ playlist_id: "pl_1", item_id: "item_1" }]), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }) as any;

    act(() => {
      root.render(<AddToPlaylistPopover trackId="trk_1" />);
    });

    // CRITICAL: Ensure NO network request is fired while popover is closed (prevents N+1 flood on table mount)
    expect(fetchCalls).toBe(0);

    const triggerBtn = container.querySelector('button[title="Add to Playlist"]');
    expect(triggerBtn).not.toBeNull();

    await act(async () => {
      triggerBtn.click();
      await new Promise((r) => setTimeout(r, 50));
    });

    // Network request is only fired when popover is actually opened
    expect(fetchCalls).toBe(1);
    expect(window.document.body.textContent).toContain("Playlist One");
    expect(window.document.body.textContent).toContain("Playlist Two");

    const pl1Button = playlistItem("Playlist One");
    const pl2Button = playlistItem("Playlist Two");

    expect(pl1Button.getAttribute("aria-checked")).toBe("true");
    expect(pl2Button.getAttribute("aria-checked")).toBe("false");
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

    const pl2Button = playlistItem("Playlist Two");
    expect(pl2Button).not.toBeUndefined();

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

    const pl1Button = playlistItem("Playlist One");
    expect(pl1Button.getAttribute("aria-checked")).toBe("true");

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

  it("renders New Playlist button at top of menu and opens CreatePlaylistModal on click", async () => {
    globalThis.fetch = mock(async () => new Response(JSON.stringify([]), { status: 200 })) as any;

    act(() => {
      root.render(<AddToPlaylistPopover trackId="trk_1" />);
    });

    const triggerBtn = container.querySelector('button[title="Add to Playlist"]');
    await act(async () => {
      triggerBtn.click();
      await new Promise((r) => setTimeout(r, 50));
    });

    // Find the New Playlist item
    const newPlaylistBtn = newPlaylistItem();
    expect(newPlaylistBtn).not.toBeUndefined();

    // Click New Playlist button
    await act(async () => {
      newPlaylistBtn?.click();
      await new Promise((r) => setTimeout(r, 50));
    });

    // Modal dialog should be rendered into document.body
    const dialog = window.document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(window.document.body.textContent).toContain("New Playlist");
  });

  it("automatically adds track to newly created playlist after creation from modal", async () => {
    const addToPlaylistMock = mock(async () => true);
    const createPlaylistMock = mock(async (name: string) => ({
      id: "pl_new_123",
      name,
      created_at: 1,
      updated_at: 1,
      item_count: 0,
    }));
    usePlayerStore.setState({
      addToPlaylist: addToPlaylistMock,
      createPlaylist: createPlaylistMock as any,
    });
    globalThis.fetch = mock(async () => new Response(JSON.stringify([]), { status: 200 })) as any;

    act(() => {
      root.render(<AddToPlaylistPopover trackId="trk_focus" segmentId="seg_focus" />);
    });

    const triggerBtn = container.querySelector('button[title="Add to Playlist"]');
    await act(async () => {
      triggerBtn.click();
      await new Promise((r) => setTimeout(r, 50));
    });

    const newPlaylistBtn = newPlaylistItem();

    await act(async () => {
      newPlaylistBtn?.click();
      await new Promise((r) => setTimeout(r, 50));
    });

    const input = window.document.querySelector('input[placeholder*="Focus Chill"]') as HTMLInputElement;
    expect(input).not.toBeNull();

    // Fill in playlist name
    act(() => {
      Reflect.set(Object.getPrototypeOf(input), "value", "My Chill Mix", input);
      input.dispatchEvent(new window.Event("input", { bubbles: true }));
    });

    // Submit form
    const form = window.document.querySelector("form");
    expect(form).not.toBeNull();

    await act(async () => {
      form?.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(createPlaylistMock).toHaveBeenCalledWith("My Chill Mix");
    expect(addToPlaylistMock).toHaveBeenCalledWith("pl_new_123", "trk_focus", "seg_focus");
  });

  it("renders sub-playlists indented with ↳ connector beneath their parent", async () => {
    usePlayerStore.setState({
      playlists: [
        { id: "pl_root", name: "Root Playlist", created_at: 1, updated_at: 1, item_count: 5 },
        { id: "pl_child", name: "Child Sub-Playlist", parent_id: "pl_root", created_at: 2, updated_at: 2, item_count: 2 },
      ] as any,
    });

    globalThis.fetch = mock(async () => new Response(JSON.stringify([]), { status: 200 })) as any;

    await act(async () => {
      root.render(<AddToPlaylistPopover trackId="trk_1" />);
    });

    const triggerBtn = container.querySelector('button[title="Add to Playlist"]');
    await act(async () => {
      triggerBtn.click();
      await new Promise((r) => setTimeout(r, 50));
    });

    const items = menuItems("menuitemcheckbox");
    expect(items.length).toBe(2);

    const rootItem = items[0];
    const childItem = items[1];

    expect(rootItem.textContent).toContain("Root Playlist");
    expect(childItem.textContent).toContain("Child Sub-Playlist");
    expect(childItem.textContent).toContain("↳");
    expect(rootItem.hasAttribute("data-inset")).toBe(false);
    expect(childItem.hasAttribute("data-inset")).toBe(true);
  });
});

