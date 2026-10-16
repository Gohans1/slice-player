import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MixPlaylistModal } from "./MixPlaylistModal";
import { usePlayerStore } from "../store/usePlayerStore";
import i18n from "../i18n";

const plA = { id: "pl_a", name: "Chill", created_at: 1, updated_at: 1, item_count: 3 };
const plB = { id: "pl_b", name: "Gym", created_at: 2, updated_at: 2, item_count: 4 };
const plC = { id: "pl_c", name: "Focus", created_at: 3, updated_at: 3, item_count: 2 };
const mix = { id: "mix_1", name: "Old Mix", created_at: 4, updated_at: 4, item_count: 7, is_mix: true, source_ids: ["pl_a", "pl_b"] };

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("MixPlaylistModal", () => {
  let root: Root;
  let container: HTMLElement;
  const original = usePlayerStore.getState();

  beforeEach(async () => {
    await i18n.changeLanguage("en");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    usePlayerStore.setState({ playlists: [plA, plB, plC, mix] });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    usePlayerStore.setState({
      playlists: original.playlists,
      createMixPlaylist: original.createMixPlaylist,
      setMixSources: original.setMixSources,
    });
  });

  const renderModal = (props: Partial<React.ComponentProps<typeof MixPlaylistModal>> = {}) =>
    act(async () => {
      root.render(<MixPlaylistModal isOpen onClose={() => {}} {...props} />);
    });
  const click = (el: HTMLElement | null | undefined) =>
    act(async () => {
      el?.focus();
      el?.click();
      await tick();
    });
  // Each row of the mix is a pop-up button named by its place in the play order
  const picker = (position: number) => document.querySelector<HTMLElement>(`[role='combobox'][aria-label='Playlist ${position}']`);
  const pickedNames = () =>
    Array.from(document.querySelectorAll("[role='combobox']")).map((el) => el.querySelector("[data-slot='select-value']")?.textContent ?? "");
  const openOptions = async (position: number) => {
    await click(picker(position));
    return Array.from(document.querySelectorAll<HTMLElement>("[data-slot='select-content'][data-open] [role='option']"));
  };
  const choose = async (position: number, name: string) => {
    const option = (await openOptions(position)).find((el) => el.textContent?.trim() === name);
    await click(option);
  };
  const button = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label='${label}']`);
  const buttonWithText = (text: string) => Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === text);
  const nameField = () => {
    const label = Array.from(document.querySelectorAll("label")).find((l) => l.textContent?.trim() === "Mix name");
    const field = document.getElementById(label?.getAttribute("for") ?? "");
    return field instanceof HTMLInputElement ? field : null;
  };

  it("creates a mix from the playlists chosen row by row, named after them", async () => {
    const createMixPlaylist = mock(async (_name: string, _sourceIds: string[]) => ({ ...mix, id: "mix_new" }));
    const onCreated = mock((_id: string) => {});
    usePlayerStore.setState({ createMixPlaylist });
    await renderModal({ onCreated });
    expect(pickedNames()).toEqual(["Choose a playlist", "Choose a playlist"]);

    await choose(1, "Gym");
    await choose(2, "Chill");

    expect(pickedNames()).toEqual(["Gym", "Chill"]);
    expect(nameField()?.value).toBe("Gym + Chill");
    await click(buttonWithText("Create Mix"));
    expect(createMixPlaylist.mock.calls).toEqual([["Gym + Chill", ["pl_b", "pl_a"]]]);
    expect(onCreated.mock.calls).toEqual([["mix_new"]]);
  });

  it("offers every playlist but mixes, with the ones already in the mix turned off", async () => {
    await renderModal();
    await choose(1, "Gym");

    const options = await openOptions(2);

    expect(options.map((el) => el.textContent?.trim())).toEqual(["Chill", "Gym", "Focus"]);
    expect(options.map((el) => el.getAttribute("aria-disabled") === "true")).toEqual([false, true, false]);
  });

  it("keeps Create Mix off until two rows have a playlist, even with a name typed in", async () => {
    await renderModal();
    const field = nameField()!;
    await act(async () => {
      Reflect.set(HTMLInputElement.prototype, "value", "Evening", field);
      field.dispatchEvent(new InputEvent("input", { bubbles: true }));
    });
    expect(buttonWithText("Create Mix")?.disabled).toBe(true);

    await choose(1, "Chill");
    expect(buttonWithText("Create Mix")?.disabled).toBe(true);

    await choose(2, "Focus");
    expect(nameField()?.value).toBe("Evening");
    expect(buttonWithText("Create Mix")?.disabled).toBe(false);
  });

  it("adds an empty row after the row whose Add button was pressed, and moves focus to it", async () => {
    await renderModal();
    await choose(1, "Gym");
    await choose(2, "Chill");

    await click(button("Add a playlist after Gym"));

    expect(pickedNames()).toEqual(["Gym", "Choose a playlist", "Chill"]);
    expect(document.activeElement === picker(2)).toBe(true);
  });

  it("stops adding rows once there is one for every playlist", async () => {
    await renderModal();
    await click(button("Add a playlist after Playlist 2"));

    expect(pickedNames()).toHaveLength(3);
    expect(button("Add a playlist after Playlist 1")?.disabled).toBe(true);
  });

  it("removes rows down to the two a mix needs, handing focus to the row that takes the place", async () => {
    await renderModal({ mix: { ...mix, source_ids: ["pl_a", "pl_b", "pl_c"] } });
    expect(pickedNames()).toEqual(["Chill", "Gym", "Focus"]);

    await click(button("Remove Gym"));

    expect(pickedNames()).toEqual(["Chill", "Focus"]);
    expect(document.activeElement === picker(2)).toBe(true);
    expect(button("Remove Chill")?.disabled).toBe(true);
  });

  it("reorders a mix's playlists, keeping focus on the row being moved", async () => {
    const setMixSources = mock(async (_mixId: string, _sourceIds: string[]) => true);
    usePlayerStore.setState({ setMixSources });
    await renderModal({ mix });
    expect(pickedNames()).toEqual(["Chill", "Gym"]);

    await click(button("Move Gym up"));
    expect(pickedNames()).toEqual(["Gym", "Chill"]);
    // Its Move Up button turns off at the top, so focus goes to the other one
    expect(document.activeElement === button("Move Gym down")).toBe(true);

    await click(button("Move Gym down"));
    expect(pickedNames()).toEqual(["Chill", "Gym"]);
    expect(document.activeElement === button("Move Gym up")).toBe(true);

    await click(button("Move Gym up"));
    await click(buttonWithText("Save"));
    expect(setMixSources.mock.calls).toEqual([["mix_1", ["pl_b", "pl_a"]]]);
  });

  it("gives a mix that has lost its playlists two rows to choose new ones in", async () => {
    const setMixSources = mock(async (_mixId: string, _sourceIds: string[]) => true);
    usePlayerStore.setState({ setMixSources });

    await renderModal({ mix: { ...mix, source_ids: [] } });
    expect(pickedNames()).toEqual(["Choose a playlist", "Choose a playlist"]);
    await act(async () => root.unmount());
    root = createRoot(container);

    // A source deleted since the playlists were loaded is left out
    await renderModal({ mix: { ...mix, source_ids: ["pl_gone", "pl_a"] } });
    expect(pickedNames()).toEqual(["Chill", "Choose a playlist"]);

    await choose(2, "Gym");
    await click(buttonWithText("Save"));
    expect(setMixSources.mock.calls).toEqual([["mix_1", ["pl_a", "pl_b"]]]);
  });
});
