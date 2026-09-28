import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GlobalWindow } from "happy-dom";
import { PlaylistGrid } from "./PlaylistGrid";
import { PlaylistHeader } from "./PlaylistHeader";
import { usePlayerStore } from "../store/usePlayerStore";
import i18n from "../i18n";
import type { Playlist } from "@/server/types";

type Listed = Playlist & { item_count: number };
const plA: Listed = { id: "pl_a", name: "Chill", created_at: 1, updated_at: 1, item_count: 3 };
const plB: Listed = { id: "pl_b", name: "Gym", created_at: 2, updated_at: 2, item_count: 3 };
const mix: Listed = { id: "mix_1", name: "Chill + Gym", created_at: 3, updated_at: 3, item_count: 6, is_mix: true, source_ids: ["pl_a", "pl_b"] };

describe("Mix playlist entry points", () => {
  let root: Root;
  let container: HTMLElement;
  const original = usePlayerStore.getState();

  beforeEach(async () => {
    await i18n.changeLanguage("en");
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const happyWindow = new GlobalWindow();
    (globalThis as any).window = happyWindow;
    (globalThis as any).document = happyWindow.document;
    (globalThis as any).HTMLElement = happyWindow.HTMLElement;
    container = happyWindow.document.createElement("div") as unknown as HTMLElement;
    happyWindow.document.body.appendChild(container as any);
    root = createRoot(container);
    usePlayerStore.setState({ playlists: [plA, plB, mix] });
  });

  afterEach(() => {
    act(() => root.unmount());
    usePlayerStore.setState({ playlists: original.playlists });
  });

  const buttonNamed = (label: string) =>
    Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes(label)) as HTMLButtonElement | undefined;

  it("offers a Mix Playlists tile in the library that opens the mix dialog", async () => {
    const onMix = mock();
    await act(async () => {
      root.render(<PlaylistGrid playlists={[plA, plB]} onOpen={() => {}} onCreate={() => {}} onMix={onMix} />);
    });

    buttonNamed("Mix Playlists")!.click();

    expect(onMix).toHaveBeenCalledTimes(1);
  });

  it("hides the Mix Playlists tile when there are fewer than two playlists to mix", async () => {
    await act(async () => {
      root.render(<PlaylistGrid playlists={[plA, mix]} onOpen={() => {}} onCreate={() => {}} onMix={() => {}} />);
    });

    expect(buttonNamed("Mix Playlists")).toBeUndefined();
  });

  it("names the sources of a mix in its header and lets them be edited", async () => {
    const onEditSources = mock();
    await act(async () => {
      root.render(<PlaylistHeader playlist={mix} items={[]} onEditSources={onEditSources} />);
    });

    expect(container.textContent).toContain("Mix of Chill · Gym");
    buttonNamed("Edit sources")!.click();
    expect(onEditSources).toHaveBeenCalledTimes(1);
  });

  it("shows no sources line for a regular playlist", async () => {
    await act(async () => {
      root.render(<PlaylistHeader playlist={plA} items={[]} onEditSources={() => {}} />);
    });

    expect(buttonNamed("Edit sources")).toBeUndefined();
  });
});
