import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PlaylistGrid } from "./PlaylistGrid";
import { usePlayerStore } from "../store/usePlayerStore";
import i18n from "../i18n";
import type { Playlist } from "@/server/types";

type Listed = Playlist & { item_count: number };
const chill: Listed = { id: "pl_chill", name: "Chill", created_at: 1, updated_at: 1, item_count: 3 };
const empty: Listed = { id: "pl_empty", name: "Empty", created_at: 2, updated_at: 2, item_count: 0 };
const nightMix: Listed = { id: "mix_night", name: "Night", created_at: 3, updated_at: 3, item_count: 3, is_mix: true, source_ids: ["pl_chill", "pl_empty"] };

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("PlaylistGrid", () => {
  let root: Root;
  let container: HTMLElement;
  const original = usePlayerStore.getState();

  beforeEach(async () => {
    await i18n.changeLanguage("en");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    usePlayerStore.setState({
      buildPlaylistQueue: original.buildPlaylistQueue,
      queuePlaylist: original.queuePlaylist,
      deletePlaylist: original.deletePlaylist,
    });
  });

  const button = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  const click = (el: HTMLElement | null | undefined) =>
    act(async () => {
      el?.focus();
      el?.click();
      await tick();
    });
  const menuItems = () =>
    Array.from(document.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]')).map(
      (el) => `${el.textContent?.trim()}${el.getAttribute("aria-disabled") === "true" ? " (off)" : ""}`
    );
  const menuItem = (label: string) =>
    Array.from(document.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]')).find((el) => el.textContent?.trim() === label);
  const renderGrid = (playlists: Listed[], props: Partial<React.ComponentProps<typeof PlaylistGrid>> = {}) =>
    act(async () => {
      root.render(<PlaylistGrid playlists={playlists} onOpen={() => {}} onCreate={() => {}} onMix={() => {}} onEditSources={() => {}} {...props} />);
    });

  it("plays or opens a playlist from its tile, and shuffles it from its More menu", async () => {
    const buildPlaylistQueue = mock(async (_id: string, _shuffle?: boolean) => {});
    usePlayerStore.setState({ buildPlaylistQueue });
    const onOpen = mock((_id: string) => {});
    await renderGrid([chill], { onOpen });

    await click(button("Play Chill"));
    await click(button("More options for Chill"));
    expect(menuItems()).toEqual(["Play", "Shuffle", "Play Next", "Play Later", "Delete playlist"]);
    await click(menuItem("Shuffle"));
    await click(button("Open playlist Chill"));

    expect(buildPlaylistQueue.mock.calls).toEqual([
      ["pl_chill", false],
      ["pl_chill", true],
    ]);
    expect(onOpen.mock.calls).toEqual([["pl_chill"]]);
  });

  it("queues a playlist after the current song from its menu", async () => {
    const queuePlaylist = mock(async (_id: string, _placement: "next" | "later") => {});
    usePlayerStore.setState({ queuePlaylist });
    await renderGrid([chill]);

    await click(button("More options for Chill"));
    await click(menuItem("Play Next"));

    expect(queuePlaylist.mock.calls).toEqual([["pl_chill", "next"]]);
  });

  it("opens the same menu on a right-click anywhere on the tile", async () => {
    await renderGrid([chill]);

    await act(async () => {
      container.querySelector("h3")?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: 40, clientY: 40 }));
      await tick();
    });

    expect(menuItems()).toEqual(["Play", "Shuffle", "Play Next", "Play Later", "Delete playlist"]);
  });

  it("asks before deleting a playlist from its menu", async () => {
    const deletePlaylist = mock(async (_id: string, _keepChildren?: boolean) => true);
    usePlayerStore.setState({ deletePlaylist });
    await renderGrid([chill]);

    await click(button("More options for Chill"));
    await click(menuItem("Delete playlist"));
    expect(deletePlaylist.mock.calls).toEqual([]);
    await click(document.querySelector<HTMLElement>("[data-testid='delete-playlist-submit-btn']"));

    expect(deletePlaylist.mock.calls).toEqual([["pl_chill", false]]);
  });

  it("edits a mix's sources from its menu", async () => {
    const onEditSources = mock((_mix: Listed) => {});
    await renderGrid([chill, nightMix], { onEditSources });

    await click(button("More options for Night"));
    expect(menuItems()).toEqual(["Play", "Shuffle", "Play Next", "Play Later", "Edit sources", "Delete playlist"]);
    await click(menuItem("Edit sources"));

    expect(onEditSources.mock.calls).toEqual([[nightMix]]);
  });

  it("offers no play or shuffle for an empty playlist", async () => {
    await renderGrid([empty]);

    expect(button("Open playlist Empty") === null).toBe(false);
    expect(button("Play Empty")).toBe(null);
    expect(container.textContent).toContain("0 items");
    await click(button("More options for Empty"));
    expect(menuItems()).toEqual(["Play (off)", "Shuffle (off)", "Play Next (off)", "Play Later (off)", "Delete playlist"]);
  });

  it("creates a playlist from the New Playlist tile", async () => {
    const onCreate = mock(() => {});
    await renderGrid([chill], { onCreate });

    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((b) => b.textContent?.includes("New Playlist"))
        ?.click();
    });
    expect(onCreate).toHaveBeenCalledTimes(1);
  });
});
