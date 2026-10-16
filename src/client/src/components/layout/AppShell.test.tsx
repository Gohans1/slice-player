import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import "../../i18n";
import { AppShell } from "./AppShell";
import { usePlayerStore } from "../../store/usePlayerStore";
import { happyWindow } from "../../test/dom";

const setViewportWidth = (width: number) => happyWindow.happyDOM.setViewport({ width });
const emptyJsonFetch: typeof fetch = Object.assign(async () => Response.json([]), { preconnect: () => {} });

describe("AppShell", () => {
  let container: HTMLDivElement;
  let root: Root;
  let initialState: ReturnType<typeof usePlayerStore.getState>;
  let fetchSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    initialState = usePlayerStore.getState();
    fetchSpy = spyOn(globalThis, "fetch").mockImplementation(emptyJsonFetch);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    fetchSpy.mockRestore();
    usePlayerStore.setState(initialState, true);
    setViewportWidth(1024);
  });

  const renderShell = () =>
    act(async () => {
      root.render(
        <AppShell
          searchQuery=""
          onSearchChange={() => {}}
          onCreatePlaylist={() => {}}
          onPlayCategory={() => {}}
          onOpenShortcuts={() => {}}
        >
          <div />
        </AppShell>
      );
    });
  const sidebarState = () => container.querySelector('[data-slot="sidebar"][data-state]')?.getAttribute("data-state");
  const resize = (width: number) => act(async () => setViewportWidth(width));
  const toggleWithRail = () =>
    act(async () => {
      container.querySelector<HTMLButtonElement>('[data-sidebar="rail"]')?.click();
    });

  // happy-dom's MediaQueryList misses a first matched-to-unmatched change, so tests start narrow

  it("collapses the sidebar to icons below 1280px and expands it on wide screens", async () => {
    setViewportWidth(1024);
    await renderShell();
    expect(sidebarState()).toBe("collapsed");

    await resize(1400);
    expect(sidebarState()).toBe("expanded");

    await resize(1100);
    expect(sidebarState()).toBe("collapsed");
  });

  it("keeps a manual toggle until the screen crosses the breakpoint", async () => {
    setViewportWidth(1024);
    await renderShell();
    await toggleWithRail();
    expect(sidebarState()).toBe("expanded");

    await resize(1100);
    expect(sidebarState()).toBe("expanded");

    await resize(1400);
    await toggleWithRail();
    expect(sidebarState()).toBe("collapsed");

    await resize(1500);
    expect(sidebarState()).toBe("collapsed");
  });
});
