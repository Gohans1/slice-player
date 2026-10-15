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
    usePlayerStore.setState({ buildPlaylistQueue: original.buildPlaylistQueue });
  });

  const button = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);

  it("plays, shuffles or opens a playlist from its tile", async () => {
    const buildPlaylistQueue = mock(async () => {});
    usePlayerStore.setState({ buildPlaylistQueue });
    const onOpen = mock((_id: string) => {});
    await act(async () => {
      root.render(<PlaylistGrid playlists={[chill]} onOpen={onOpen} onCreate={() => {}} onMix={() => {}} />);
    });

    await act(async () => {
      button("Play Chill")?.click();
    });
    expect(buildPlaylistQueue).toHaveBeenLastCalledWith("pl_chill", false);
    await act(async () => {
      button("Shuffle Chill")?.click();
    });
    expect(buildPlaylistQueue).toHaveBeenLastCalledWith("pl_chill", true);
    await act(async () => {
      button("Open playlist Chill")?.click();
    });
    expect(onOpen).toHaveBeenCalledWith("pl_chill");
  });

  it("offers no play or shuffle for an empty playlist", async () => {
    await act(async () => {
      root.render(<PlaylistGrid playlists={[empty]} onOpen={() => {}} onCreate={() => {}} onMix={() => {}} />);
    });

    expect(button("Open playlist Empty")).not.toBeNull();
    expect(button("Play Empty")).toBeNull();
    expect(button("Shuffle Empty")).toBeNull();
    expect(container.textContent).toContain("0 items");
  });

  it("creates a playlist from the New Playlist tile", async () => {
    const onCreate = mock(() => {});
    await act(async () => {
      root.render(<PlaylistGrid playlists={[chill]} onOpen={() => {}} onCreate={onCreate} onMix={() => {}} />);
    });

    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((b) => b.textContent?.includes("New Playlist"))
        ?.click();
    });
    expect(onCreate).toHaveBeenCalledTimes(1);
  });
});
