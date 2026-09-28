import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GlobalWindow } from "happy-dom";
import { MixPlaylistModal } from "./MixPlaylistModal";
import { usePlayerStore } from "../store/usePlayerStore";
import i18n from "../i18n";


const plA = { id: "pl_a", name: "Chill", created_at: 1, updated_at: 1, item_count: 3 };
const plB = { id: "pl_b", name: "Gym", created_at: 2, updated_at: 2, item_count: 3 };
const plC = { id: "pl_c", name: "Focus", created_at: 3, updated_at: 3, item_count: 2 };
const mix = { id: "mix_1", name: "Old Mix", created_at: 4, updated_at: 4, item_count: 5, is_mix: true, source_ids: ["pl_a", "pl_b"] };

describe("MixPlaylistModal", () => {
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
    (globalThis as any).Event = happyWindow.Event;
    (globalThis as any).KeyboardEvent = happyWindow.KeyboardEvent;
    container = happyWindow.document.createElement("div") as unknown as HTMLElement;
    happyWindow.document.body.appendChild(container as any);
    root = createRoot(container);
    usePlayerStore.setState({ playlists: [plA, plB, plC, mix] });
  });

  afterEach(() => {
    act(() => root.unmount());
    usePlayerStore.setState({
      playlists: original.playlists,
      createMixPlaylist: original.createMixPlaylist,
      setMixSources: original.setMixSources,
    });
  });

  const body = () => document.body;
  const rowFor = (name: string) =>
    Array.from(body().querySelectorAll("[role='checkbox']")).find((el) => el.textContent?.includes(name)) as HTMLElement | undefined;
  const buttonWithText = (text: string) =>
    Array.from(body().querySelectorAll("button")).find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined;

  it("creates a mix from the playlists in the order they were ticked, with an automatic name", async () => {
    const createMixPlaylist = mock(async () => ({ ...mix, id: "mix_new" }));
    const onCreated = mock();
    usePlayerStore.setState({ createMixPlaylist } as any);

    await act(async () => {
      root.render(<MixPlaylistModal isOpen onClose={() => {}} onCreated={onCreated} />);
    });
    await act(async () => {
      rowFor("Gym")!.click();
    });
    await act(async () => {
      rowFor("Chill")!.click();
    });

    expect((body().querySelector("input") as HTMLInputElement).value).toBe("Gym + Chill");

    await act(async () => {
      buttonWithText("Create Mix")!.click();
    });

    expect(createMixPlaylist).toHaveBeenCalledWith("Gym + Chill", ["pl_b", "pl_a"]);
    expect(onCreated).toHaveBeenCalledWith("mix_new");
  });

  it("does not list mixes as possible sources", async () => {
    await act(async () => {
      root.render(<MixPlaylistModal isOpen onClose={() => {}} />);
    });

    expect(rowFor("Old Mix")).toBeUndefined();
    expect(rowFor("Focus")).toBeDefined();
  });

  it("keeps the create button disabled until two playlists are ticked", async () => {
    await act(async () => {
      root.render(<MixPlaylistModal isOpen onClose={() => {}} />);
    });
    await act(async () => {
      rowFor("Chill")!.click();
    });

    expect(buttonWithText("Create Mix")!.disabled).toBe(true);
  });

  it("edits an existing mix: sources start ticked and can be moved up", async () => {
    const setMixSources = mock(async () => true);
    usePlayerStore.setState({ setMixSources } as any);

    await act(async () => {
      root.render(<MixPlaylistModal isOpen onClose={() => {}} mix={mix} />);
    });
    expect(rowFor("Chill")!.getAttribute("aria-checked")).toBe("true");
    expect(rowFor("Gym")!.getAttribute("aria-checked")).toBe("true");

    await act(async () => {
      (body().querySelector("button[aria-label='Move Gym up']") as HTMLButtonElement).click();
    });
    await act(async () => {
      buttonWithText("Save")!.click();
    });

    expect(setMixSources).toHaveBeenCalledWith("mix_1", ["pl_b", "pl_a"]);
  });
});
