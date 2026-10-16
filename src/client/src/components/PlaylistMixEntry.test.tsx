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
      root.render(<PlaylistGrid playlists={[plA, plB]} onOpen={() => {}} onCreate={() => {}} onMix={onMix} onEditSources={() => {}} />);
    });

    buttonNamed("Mix Playlists")!.click();

    // Once, with no playlist to start from (not, say, the click event)
    expect(onMix.mock.calls.map((args) => args.length)).toEqual([0]);
  });

  const menuItem = (label: string) =>
    Array.from(document.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]')).find((el) => el.textContent?.trim() === label);
  const openMenu = (label: string) =>
    act(async () => {
      container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)?.click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

  it("starts a mix with a playlist from its tile's menu, but not with a mix", async () => {
    const onMixWith = mock((_firstSourceId: string) => {});
    await act(async () => {
      root.render(<PlaylistGrid playlists={[plA, plB, mix]} onOpen={() => {}} onCreate={() => {}} onMixWith={onMixWith} onEditSources={() => {}} />);
    });

    await openMenu("More options for Chill");
    await act(async () => menuItem("New Mix with This Playlist")?.click());
    await openMenu("More options for Chill + Gym");

    expect(onMixWith.mock.calls).toEqual([["pl_a"]]);
    expect(menuItem("New Mix with This Playlist") === undefined).toBe(true);
  });

  // Mixing draws on the whole library, whatever a search left on the page
  it("keeps New Mix on for a playlist a search found on its own", async () => {
    await act(async () => {
      root.render(<PlaylistGrid playlists={[plA]} onOpen={() => {}} onCreate={() => {}} onMix={() => {}} onMixWith={() => {}} />);
    });

    await openMenu("More options for Chill");

    expect(menuItem("New Mix with This Playlist")?.getAttribute("aria-disabled") === "true").toBe(false);
    expect(buttonNamed("Mix Playlists") === undefined).toBe(false);
  });

  it("starts a mix with a sub-playlist from its tile in the parent's header", async () => {
    const sub: Listed = { id: "pl_sub", name: "Chill Morning", created_at: 4, updated_at: 4, item_count: 2, parent_id: "pl_a" };
    const onNewMix = mock((_firstSourceId: string) => {});
    usePlayerStore.setState({ playlists: [plA, plB, sub, mix] });
    await act(async () => {
      root.render(<PlaylistHeader playlist={plA} items={[]} onNewMix={onNewMix} />);
    });

    await openMenu("More options for Chill Morning");
    await act(async () => menuItem("New Mix with This Playlist")?.click());

    expect(onNewMix.mock.calls).toEqual([["pl_sub"]]);
  });

  it("starts a mix with the open playlist from its More menu, once there is another to mix it with", async () => {
    const onNewMix = mock((_firstSourceId: string) => {});
    usePlayerStore.setState({ playlists: [plA, mix] });
    await act(async () => {
      root.render(<PlaylistHeader playlist={plA} items={[]} onNewMix={onNewMix} />);
    });
    await openMenu("More actions for Chill");
    expect(menuItem("New Mix with This Playlist")?.getAttribute("aria-disabled")).toBe("true");
    await act(async () => {
      document.activeElement?.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    await act(async () => usePlayerStore.setState({ playlists: [plA, plB, mix] }));
    await openMenu("More actions for Chill");
    await act(async () => menuItem("New Mix with This Playlist")?.click());

    expect(onNewMix.mock.calls).toEqual([["pl_a"]]);
  });

  it("offers no mix of a mix in its header", async () => {
    await act(async () => {
      root.render(<PlaylistHeader playlist={mix} items={[]} onEditSources={() => {}} onNewMix={() => {}} />);
    });
    await openMenu("More actions for Chill + Gym");

    expect(menuItem("Delete playlist") === undefined).toBe(false);
    expect(menuItem("New Mix with This Playlist") === undefined).toBe(true);
  });

  it("hides the Mix Playlists tile when there are fewer than two playlists to mix", async () => {
    usePlayerStore.setState({ playlists: [plA, mix] });
    await act(async () => {
      root.render(<PlaylistGrid playlists={[plA, mix]} onOpen={() => {}} onCreate={() => {}} onMix={() => {}} onEditSources={() => {}} />);
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
