import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GlobalWindow } from "happy-dom";
import { BulkActionBar } from "./BulkActionBar";
import { useSelectionStore } from "../store/useSelectionStore";
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
});
