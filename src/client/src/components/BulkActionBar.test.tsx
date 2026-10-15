import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BulkActionBar } from "./BulkActionBar";
import { useSelectionStore } from "../store/useSelectionStore";
import { usePlayerStore } from "../store/usePlayerStore";
import i18n from "../i18n";

const originalPlayerState = usePlayerStore.getState();

describe("BulkActionBar Component", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    await i18n.changeLanguage("en");
    // React/Base UI bind to the preloaded document at import time; keep that DOM realm.
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    useSelectionStore.getState().clearSelection();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    useSelectionStore.getState().clearSelection();
    usePlayerStore.setState(originalPlayerState);
  });

  it("renders nothing when no items are selected", () => {
    act(() => {
      root.render(<BulkActionBar visibleTrackIds={[]} />);
    });

    const aside = container.querySelector("aside");
    expect(aside).toBeNull();
  });

  it("renders aside and opens ConfirmModal outside aside when delete button is clicked", async () => {
    // Select 2 tracks
    act(() => {
      useSelectionStore.getState().toggleTrack({
        id: "track_1",
        type: "track",
        trackId: "track_1",
        title: "Track 1",
      });
      useSelectionStore.getState().toggleTrack({
        id: "track_2",
        type: "track",
        trackId: "track_2",
        title: "Track 2",
      });
    });

    act(() => {
      root.render(<BulkActionBar visibleTrackIds={["track_1", "track_2"]} />);
    });

    const aside = container.querySelector("aside");
    expect(aside).not.toBeNull();
    expect(container.textContent).toContain("2");

    // Click delete button
    const deleteBtn = Array.from(container.querySelectorAll("button")).find((btn) =>
      btn.textContent?.includes("Delete")
    );
    expect(deleteBtn).toBeDefined();

    act(() => {
      deleteBtn?.click();
    });

    // Confirm modal should be rendered
    const dialog = document.querySelector('[role="alertdialog"]');
    expect(dialog?.textContent).toContain("Delete selected items?");

    // CRITICAL: Ensure modal is rendered OUTSIDE of the <aside> element so it is not
    // trapped in aside's transform (-translate-x-1/2) containing block and z-40 stacking context
    expect(aside?.contains(dialog)).toBe(false);

    // Cancel closes the dialog
    const cancelBtn = Array.from(dialog?.querySelectorAll("button") ?? []).find((btn) =>
      btn.textContent?.includes("Cancel")
    );
    expect(cancelBtn).toBeDefined();

    act(() => {
      cancelBtn?.click();
    });
    // Base UI unmounts the popup once its exit animation finishes
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(document.querySelectorAll('[role="alertdialog"]').length).toBe(0);
  });

  it("keeps the selection when Escape closes the delete confirmation", async () => {
    act(() => {
      useSelectionStore.getState().toggleTrack({ id: "track_1", type: "track", trackId: "track_1", title: "Track 1" });
      useSelectionStore.getState().toggleTrack({ id: "track_2", type: "track", trackId: "track_2", title: "Track 2" });
    });
    act(() => {
      root.render(<BulkActionBar visibleTrackIds={["track_1", "track_2"]} />);
    });

    const deleteBtn = Array.from(container.querySelectorAll("button")).find((btn) =>
      btn.textContent?.includes("Delete")
    );
    act(() => {
      deleteBtn?.click();
    });
    // Base UI moves focus into the dialog after it opens
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(document.querySelectorAll('[role="alertdialog"]').length).toBe(1);

    act(() => {
      (document.activeElement ?? document.body).dispatchEvent(
        new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(document.querySelectorAll('[role="alertdialog"]').length).toBe(0);
    expect(useSelectionStore.getState().selectedTrackIds.size).toBe(2);
  });

  it("offers no delete action while viewing a mix playlist (its songs live in the sources)", () => {
    const prev = usePlayerStore.getState();
    usePlayerStore.setState({
      activePlaylistId: "mix_1",
      playlists: [{ id: "mix_1", name: "Mix", created_at: 1, updated_at: 1, item_count: 2, is_mix: true, source_ids: ["pl_a", "pl_b"] }],
    });
    try {
      act(() => {
        useSelectionStore.getState().toggleTrack({
          id: "item_1",
          type: "playlist_item",
          trackId: "track_1",
          playlistId: "mix_1",
          title: "Track 1",
        });
      });
      act(() => {
        root.render(<BulkActionBar visibleTrackIds={["item_1"]} />);
      });

      const deleteBtn = Array.from(container.querySelectorAll("button")).find((btn) => btn.textContent?.includes("Delete"));
      expect(container.querySelector("aside")).not.toBeNull();
      expect(deleteBtn).toBeUndefined();
    } finally {
      usePlayerStore.setState({ activePlaylistId: prev.activePlaylistId, playlists: prev.playlists });
    }
  });

  it("adds the selection to a playlist picked from the menu, then closes it", async () => {
    const originalAddBatch = usePlayerStore.getState().addTracksToPlaylistBatch;
    const addBatchMock = mock(async () => true);
    usePlayerStore.setState({
      addTracksToPlaylistBatch: addBatchMock as any,
      playlists: [
        { id: "pl_existing", name: "Existing PL", created_at: 1, updated_at: 1, item_count: 0 },
        { id: "mix_1", name: "Gym Mix", created_at: 2, updated_at: 2, item_count: 0, is_mix: true, source_ids: [] },
      ],
    });
    act(() => {
      useSelectionStore.getState().toggleTrack({ id: "track_10", type: "track", trackId: "track_10", title: "Track 10" });
    });
    act(() => {
      root.render(<BulkActionBar visibleTrackIds={["track_10"]} />);
    });

    const trigger = Array.from(container.querySelectorAll("button")).find((btn) => btn.textContent?.includes("Playlist"));
    await act(async () => {
      trigger?.click();
      await new Promise((r) => setTimeout(r, 50));
    });

    const menuItems = () => Array.from(document.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]'));
    // Mixes take their songs from their sources, so they are not offered
    expect(menuItems().some((item) => item.textContent?.includes("Gym Mix"))).toBe(false);
    const target = menuItems().find((item) => item.textContent?.includes("Existing PL"));
    expect(target).toBeDefined();

    await act(async () => {
      target?.click();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(addBatchMock).toHaveBeenCalledWith("pl_existing", [{ track_id: "track_10", segment_id: null }]);
    // The menu stays up long enough to show the confirmation, then closes
    expect(document.querySelectorAll('[role="menu"]').length).toBe(1);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 800));
    });
    expect(document.querySelectorAll('[role="menu"]').length).toBe(0);

    usePlayerStore.setState({ addTracksToPlaylistBatch: originalAddBatch });
  });

  it("renders New Playlist button in bulk playlist menu and creates playlist with selected items", async () => {
    const originalCreatePlaylist = usePlayerStore.getState().createPlaylist;
    const originalAddBatch = usePlayerStore.getState().addTracksToPlaylistBatch;

    const createPlaylistMock = mock(async (name: string) => ({
      id: "pl_bulk_999",
      name,
      created_at: 1,
      updated_at: 1,
      item_count: 0,
    }));
    const addBatchMock = mock(async () => true);

    usePlayerStore.setState({
      createPlaylist: createPlaylistMock as any,
      addTracksToPlaylistBatch: addBatchMock as any,
      playlists: [{ id: "pl_existing", name: "Existing PL", created_at: 1, updated_at: 1, item_count: 0 }],
    });

    // Select 2 items
    act(() => {
      useSelectionStore.getState().toggleTrack({
        id: "track_10",
        type: "track",
        trackId: "track_10",
        title: "Track 10",
      });
      useSelectionStore.getState().toggleTrack({
        id: "slice_20",
        type: "slice",
        trackId: "track_10",
        segmentId: "seg_20",
        title: "Slice 20",
      });
    });

    act(() => {
      root.render(<BulkActionBar visibleTrackIds={["track_10"]} />);
    });

    // Find and click "Playlist" bulk button
    const playlistBtn = Array.from(container.querySelectorAll("button")).find((btn) =>
      btn.textContent?.includes("Playlist")
    );
    expect(playlistBtn).toBeDefined();

    await act(async () => {
      playlistBtn?.click();
      await new Promise((r) => setTimeout(r, 50));
    });

    // Verify "+ New Playlist" is offered in the bulk menu (rendered in a portal)
    const newPlaylistBtn = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find((item) =>
      item.textContent?.toLowerCase().includes("new playlist")
    );
    expect(newPlaylistBtn).toBeDefined();

    // Click "+ New Playlist"
    await act(async () => {
      newPlaylistBtn?.click();
      await new Promise((r) => setTimeout(r, 50));
    });

    // Lazy dialog loading is asynchronous; observe the UI instead of assuming 50ms.
    const deadline = performance.now() + 1000;
    while (!document.querySelector('[role="dialog"]') && performance.now() < deadline) {
      await act(async () => { await new Promise((fulfill) => setTimeout(fulfill, 0)); });
    }
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();

    const input = document.querySelector<HTMLInputElement>('input[placeholder*="Focus Chill"]');
    expect(input).not.toBeNull();

    // Set input value
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "Workout Mix");
      input!.dispatchEvent(new window.Event("input", { bubbles: true }));
    });

    // Submit form
    const form = document.querySelector<HTMLFormElement>("form");
    expect(form).not.toBeNull();

    await act(async () => {
      form!.requestSubmit();
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(createPlaylistMock).toHaveBeenCalledWith("Workout Mix");
    expect(addBatchMock).toHaveBeenCalledWith("pl_bulk_999", [
      { track_id: "track_10", segment_id: null },
      { track_id: "track_10", segment_id: "seg_20" },
    ]);

    // Restore store
    usePlayerStore.setState({
      createPlaylist: originalCreatePlaylist,
      addTracksToPlaylistBatch: originalAddBatch,
    });
  });
});
