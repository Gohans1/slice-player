import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GlobalWindow } from "happy-dom";
import { BulkActionBar } from "./BulkActionBar";
import { useSelectionStore } from "../store/useSelectionStore";
import { usePlayerStore } from "../store/usePlayerStore";
import i18n from "../i18n";

describe("BulkActionBar Component", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    await i18n.changeLanguage("en");
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const happyWindow = new GlobalWindow();
    (globalThis as any).window = happyWindow;
    (globalThis as any).document = happyWindow.document;
    (globalThis as any).HTMLElement = happyWindow.HTMLElement;
    (globalThis as any).Event = happyWindow.Event;
    (globalThis as any).KeyboardEvent = happyWindow.KeyboardEvent;

    container = happyWindow.document.createElement("div") as unknown as HTMLDivElement;
    happyWindow.document.body.appendChild(container as any);
    root = createRoot(container);

    useSelectionStore.getState().clearSelection();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    useSelectionStore.getState().clearSelection();
  });

  it("renders nothing when no items are selected", () => {
    act(() => {
      root.render(<BulkActionBar visibleTrackIds={[]} />);
    });

    const aside = container.querySelector("aside");
    expect(aside).toBeNull();
  });

  it("renders aside and opens ConfirmModal outside aside when delete button is clicked", () => {
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
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(container.textContent).toContain("Delete selected items?");

    // CRITICAL: Ensure modal is rendered OUTSIDE of the <aside> element so it is not
    // trapped in aside's transform (-translate-x-1/2) containing block and z-40 stacking context
    expect(aside?.contains(dialog)).toBe(false);

    // Cancel closes the dialog
    const cancelBtn = Array.from(container.querySelectorAll("button")).find((btn) =>
      btn.textContent?.includes("Cancel")
    );
    expect(cancelBtn).toBeDefined();

    act(() => {
      cancelBtn?.click();
    });

    expect(container.querySelector('[role="dialog"]')).toBeNull();
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

    // Verify "+ New Playlist" button is rendered at top of bulk menu
    const newPlaylistBtn = Array.from(container.querySelectorAll("button")).find((btn) =>
      btn.textContent?.toLowerCase().includes("new playlist")
    );
    expect(newPlaylistBtn).toBeDefined();

    // Click "+ New Playlist"
    await act(async () => {
      newPlaylistBtn?.click();
      await new Promise((r) => setTimeout(r, 50));
    });

    // Verify CreatePlaylistModal opened in document.body
    const dialog = (globalThis as any).document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();

    const input = (globalThis as any).document.querySelector('input[placeholder*="Focus Chill"]') as HTMLInputElement;
    expect(input).not.toBeNull();

    // Set input value
    act(() => {
      const reactPropsKey = Object.keys(input).find((k) => k.startsWith("__reactProps") || k.startsWith("__reactEventHandlers"));
      if (reactPropsKey && (input as any)[reactPropsKey]?.onChange) {
        (input as any)[reactPropsKey].onChange({ target: { value: "Workout Mix" }, currentTarget: { value: "Workout Mix" } });
      } else {
        input.value = "Workout Mix";
        input.dispatchEvent(new (globalThis as any).Event("input", { bubbles: true }));
        input.dispatchEvent(new (globalThis as any).Event("change", { bubbles: true }));
      }
    });

    // Submit form
    const form = (globalThis as any).document.querySelector("form");
    expect(form).not.toBeNull();

    await act(async () => {
      const formPropsKey = Object.keys(form!).find((k) => k.startsWith("__reactProps") || k.startsWith("__reactEventHandlers"));
      if (formPropsKey && (form as any)[formPropsKey]?.onSubmit) {
        (form as any)[formPropsKey].onSubmit({ preventDefault: () => {} });
      } else {
        form!.dispatchEvent(new (globalThis as any).Event("submit", { bubbles: true, cancelable: true }));
      }
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
