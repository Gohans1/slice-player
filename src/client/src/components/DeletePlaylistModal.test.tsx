import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GlobalWindow } from "happy-dom";
import { DeletePlaylistModal } from "./DeletePlaylistModal";
import { usePlayerStore } from "../store/usePlayerStore";
import i18n from "../i18n";
import type { Playlist } from "@/server/types";

describe("DeletePlaylistModal Component (TDD)", () => {
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
    (globalThis as any).HTMLInputElement = happyWindow.HTMLInputElement;
    (globalThis as any).Event = happyWindow.Event;
    container = happyWindow.document.createElement("div") as unknown as HTMLElement;
    happyWindow.document.body.appendChild(container as any);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    usePlayerStore.setState({
      playlists: original.playlists,
    });
  });

  it("renders simple confirmation when playlist has no children", async () => {
    const parentPlaylist: Playlist & { item_count: number } = {
      id: "pl_standalone",
      name: "Standalone",
      created_at: 1,
      updated_at: 1,
      item_count: 5,
    };

    usePlayerStore.setState({
      playlists: [parentPlaylist],
    });

    const onConfirm = mock(async () => {});
    const onClose = mock(() => {});

    await act(async () => {
      root.render(
        <DeletePlaylistModal
          isOpen={true}
          playlist={parentPlaylist}
          onClose={onClose}
          onConfirm={onConfirm}
        />
      );
    });

    const dialog = document.body.querySelector("[role='dialog']");
    expect(dialog).not.toBeNull();
    // No radio fieldset when 0 children
    expect(dialog?.querySelector("fieldset")).toBeNull();
    expect(dialog?.textContent).toContain('Delete playlist "Standalone"?');

    const submitBtn = dialog?.querySelector("[data-testid='delete-playlist-submit-btn']") as HTMLButtonElement;
    await act(async () => {
      submitBtn.click();
    });

    expect(onConfirm).toHaveBeenCalledWith(false);
  });

  it("renders sub-playlist retention choices when parent has children, defaulting to cascade", async () => {
    const parentPlaylist: Playlist & { item_count: number } = {
      id: "pl_parent",
      name: "Rock Classics",
      created_at: 1,
      updated_at: 1,
      item_count: 10,
    };
    const childPlaylist: Playlist & { item_count: number } = {
      id: "pl_child",
      name: "Guitar Solos",
      parent_id: "pl_parent",
      created_at: 2,
      updated_at: 2,
      item_count: 3,
    };

    usePlayerStore.setState({
      playlists: [parentPlaylist, childPlaylist],
    });

    const onConfirm = mock(async () => {});
    const onClose = mock(() => {});

    await act(async () => {
      root.render(
        <DeletePlaylistModal
          isOpen={true}
          playlist={parentPlaylist}
          onClose={onClose}
          onConfirm={onConfirm}
        />
      );
    });

    const dialog = document.body.querySelector("[role='dialog']");
    expect(dialog).not.toBeNull();
    expect(dialog?.querySelector("fieldset")).not.toBeNull();
    expect(dialog?.textContent).toContain("contains 1 sub-playlist");

    const radios = Array.from(dialog?.querySelectorAll("input[type='radio']") || []) as HTMLInputElement[];
    expect(radios.length).toBe(2);
    // Cascade is checked by default
    expect(radios[0].checked).toBe(true);
    expect(radios[1].checked).toBe(false);

    // Click confirm with cascade (keepChildren = false)
    const submitBtn = dialog?.querySelector("[data-testid='delete-playlist-submit-btn']") as HTMLButtonElement;
    await act(async () => {
      submitBtn.click();
    });

    expect(onConfirm).toHaveBeenCalledWith(false);
  });

  it("passes keepChildren = true when user selects keep sub-playlists option", async () => {
    const parentPlaylist: Playlist & { item_count: number } = {
      id: "pl_parent",
      name: "Rock Classics",
      created_at: 1,
      updated_at: 1,
      item_count: 10,
    };
    const childPlaylist: Playlist & { item_count: number } = {
      id: "pl_child",
      name: "Guitar Solos",
      parent_id: "pl_parent",
      created_at: 2,
      updated_at: 2,
      item_count: 3,
    };

    usePlayerStore.setState({
      playlists: [parentPlaylist, childPlaylist],
    });

    const onConfirm = mock(async () => {});
    const onClose = mock(() => {});

    await act(async () => {
      root.render(
        <DeletePlaylistModal
          isOpen={true}
          playlist={parentPlaylist}
          onClose={onClose}
          onConfirm={onConfirm}
        />
      );
    });

    const dialog = document.body.querySelector("[role='dialog']");
    const radios = Array.from(dialog?.querySelectorAll("input[type='radio']") || []) as HTMLInputElement[];

    // Switch to keepChildren = true
    await act(async () => {
      radios[1].click();
    });

    expect(radios[1].checked).toBe(true);

    const submitBtn = dialog?.querySelector("[data-testid='delete-playlist-submit-btn']") as HTMLButtonElement;
    await act(async () => {
      submitBtn.click();
    });

    expect(onConfirm).toHaveBeenCalledWith(true);
  });
});
