import { describe, it, expect, beforeEach } from "bun:test";
import { usePlayerStore } from "./usePlayerStore";

describe("View Scroll Position Persistence in usePlayerStore", () => {
  beforeEach(() => {
    usePlayerStore.setState({
      activePlaylistId: null,
      activeSystemCategory: "mixed",
      viewMode: "grid",
      viewScrollPositions: {},
    });
  });

  it("returns 0 for unrecorded view scroll keys", () => {
    const store = usePlayerStore.getState();
    expect(store.getViewScrollPosition("category:mixed:grid")).toBe(0);
    expect(store.getViewScrollPosition("playlist:pl_unknown")).toBe(0);
    expect(store.getViewScrollPosition("")).toBe(0);
  });

  it("saves and retrieves scroll positions independently per view key", () => {
    const store = usePlayerStore.getState();

    store.saveViewScrollPosition("category:mixed:grid", 4500);
    store.saveViewScrollPosition("playlist:pl_1000:grid", 8200);
    store.saveViewScrollPosition("playlist:pl_short:grid", 120);

    const freshStore = usePlayerStore.getState();
    expect(freshStore.getViewScrollPosition("category:mixed:grid")).toBe(4500);
    expect(freshStore.getViewScrollPosition("playlist:pl_1000:grid")).toBe(8200);
    expect(freshStore.getViewScrollPosition("playlist:pl_short:grid")).toBe(120);
  });

  it("clamps negative scroll positions to 0 and rounds fractional pixels", () => {
    const store = usePlayerStore.getState();
    store.saveViewScrollPosition("category:mixed:grid", -150);
    expect(usePlayerStore.getState().getViewScrollPosition("category:mixed:grid")).toBe(0);

    store.saveViewScrollPosition("category:mixed:grid", 1234.6);
    expect(usePlayerStore.getState().getViewScrollPosition("category:mixed:grid")).toBe(1235);
  });

  it("automatically saves scroll position of current view when switching system category", () => {
    // Simulate window.scrollY
    const win = (globalThis as any).window || ((globalThis as any).window = {});
    const originalDesc = Object.getOwnPropertyDescriptor(win, "scrollY");
    Object.defineProperty(win, "scrollY", { value: 3450, configurable: true, writable: true });

    const store = usePlayerStore.getState();
    // Initially on mixed
    expect(store.activeSystemCategory).toBe("mixed");

    // Switch to slices_only
    store.setActiveSystemCategory("slices_only");

    // The mixed category should have automatically saved 3450
    const updated = usePlayerStore.getState();
    expect(updated.getViewScrollPosition("category:mixed")).toBe(3450);
    expect(updated.activeSystemCategory).toBe("slices_only");

    // Cleanup
    if (originalDesc) {
      Object.defineProperty(win, "scrollY", originalDesc);
    }
  });

  it("automatically saves scroll position of current view when switching playlists", async () => {
    const win = (globalThis as any).window || ((globalThis as any).window = {});
    const originalDesc = Object.getOwnPropertyDescriptor(win, "scrollY");
    Object.defineProperty(win, "scrollY", { value: 6780, configurable: true, writable: true });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({ id: "pl_2", name: "Playlist 2", items: [] }),
    })) as any;

    try {
      usePlayerStore.setState({ activePlaylistId: "pl_1" });
      await usePlayerStore.getState().setActivePlaylist("pl_2");

      const updated = usePlayerStore.getState();
      expect(updated.getViewScrollPosition("playlist:pl_1")).toBe(6780);
      expect(updated.activePlaylistId).toBe("pl_2");
    } finally {
      globalThis.fetch = originalFetch;
      if (originalDesc) {
        Object.defineProperty(win, "scrollY", originalDesc);
      }
    }
  });
});
