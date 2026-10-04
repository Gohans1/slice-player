import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";

// Mock Audio for headless test environment
if (typeof globalThis.Audio === "undefined" || !(globalThis.Audio.prototype as any)?.removeAttribute) {
  Object.defineProperty(globalThis, "Audio", {
    value: class {
      crossOrigin = "";
      preload = "";
      currentTime = 0;
      src = "";
      addEventListener() {}
      removeEventListener() {}
      pause() {}
      play() {
        return Promise.resolve();
      }
      load() {}
      removeAttribute(attr: string) {
        if (attr === "src") this.src = "";
      }
    },
    writable: true,
  });
}

const { usePlayerStore } = await import("./usePlayerStore");
import type { Track, Playlist } from "@/server/types";

describe("usePlayerStore Sub-Playlists management", () => {
  const dummyTrack: Track = {
    id: "trk_1",
    title: "Test Track 1",
    artist: "Artist 1",
    duration: 180,
    source_type: "youtube",
    source_uri: "https://youtube.com/watch?v=1",
    status: "ready",
  };

  const parentPlaylist: Playlist & { item_count: number } = {
    id: "pl_parent",
    name: "Parent Playlist",
    created_at: 1000,
    updated_at: 1000,
    item_count: 1,
    is_custom_ordered: false,
    parent_id: null,
  };

  const childPlaylist: Playlist & { item_count: number } = {
    id: "pl_child",
    name: "Child Playlist",
    created_at: 1001,
    updated_at: 1001,
    item_count: 1,
    is_custom_ordered: false,
    parent_id: "pl_parent",
  };

  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    usePlayerStore.setState({
      playlists: [parentPlaylist, childPlaylist],
      activePlaylistId: null,
      activePlaylistPlayingId: null,
      activePlaylistItems: [],
      queue: [],
      queueIndex: -1,
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    usePlayerStore.setState({
      activePlaylistId: null,
      activePlaylistPlayingId: null,
      activePlaylistItems: [],
      activePlaylistOriginalQueue: [],
      playlists: [],
      queue: [],
      queueIndex: -1,
    });
  });

  it("should create a child playlist with parentId in request body", async () => {
    let capturedBody: any = null;
    globalThis.fetch = mock(async (input: any, init?: any) => {
      const url = typeof input === "string" ? input : input.url;
      if (url === "/api/playlists" && init?.method === "POST") {
        capturedBody = JSON.parse(init.body);
        return new Response(
          JSON.stringify({
            id: "pl_new_child",
            name: capturedBody.name,
            parent_id: capturedBody.parent_id,
            created_at: Date.now(),
            updated_at: Date.now(),
            is_custom_ordered: false,
            item_count: 0,
          }),
          { status: 201, headers: { "Content-Type": "application/json" } }
        );
      }
      if (url === "/api/playlists" && (!init || init.method === "GET")) {
        return new Response(JSON.stringify([parentPlaylist, childPlaylist]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("Not found", { status: 404 });
    }) as any;

    const created = await usePlayerStore.getState().createPlaylist("Study Beats", "pl_parent");
    expect(created).not.toBeNull();
    expect(created?.parent_id).toBe("pl_parent");
    expect(capturedBody).toEqual({ name: "Study Beats", parent_id: "pl_parent" });
  });

  it("should cascade cleanup active child state when parent is deleted with keepChildren=false", async () => {
    usePlayerStore.setState({
      activePlaylistId: "pl_child",
      activePlaylistPlayingId: "pl_child",
    });

    globalThis.fetch = mock(async (input: any, init?: any) => {
      const url = typeof input === "string" ? input : input.url;
      if (url === "/api/playlists/pl_parent" && init?.method === "DELETE") {
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url === "/api/playlists" && (!init || init.method === "GET")) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("Not found", { status: 404 });
    }) as any;

    const ok = await usePlayerStore.getState().deletePlaylist("pl_parent", false);
    expect(ok).toBe(true);

    // Both active playlist and playing state should be reset
    expect(usePlayerStore.getState().activePlaylistId).toBeNull();
    expect(usePlayerStore.getState().activePlaylistPlayingId).toBeNull();
  });

  it("should preserve active child state when parent is deleted with keepChildren=true", async () => {
    usePlayerStore.setState({
      activePlaylistId: "pl_child",
      activePlaylistPlayingId: "pl_child",
    });

    globalThis.fetch = mock(async (input: any, init?: any) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("/api/playlists/pl_parent?keep_children=true") && init?.method === "DELETE") {
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url === "/api/playlists" && (!init || init.method === "GET")) {
        return new Response(
          JSON.stringify([{ ...childPlaylist, parent_id: null }]),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response("Not found", { status: 404 });
    }) as any;

    const ok = await usePlayerStore.getState().deletePlaylist("pl_parent", true);
    expect(ok).toBe(true);

    // Active child should remain active since keepChildren was true!
    expect(usePlayerStore.getState().activePlaylistId).toBe("pl_child");
    expect(usePlayerStore.getState().activePlaylistPlayingId).toBe("pl_child");
  });
});
