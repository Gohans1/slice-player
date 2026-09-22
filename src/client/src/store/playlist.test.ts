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

const { usePlayerStore, clearDismissedSegments } = await import("./usePlayerStore");
import type { Track, Segment, Playlist, PlaylistItemWithDetails } from "@/server/types";

describe("usePlayerStore playlist management", () => {
  const dummyTrack: Track = {
    id: "trk_1",
    title: "Test Track 1",
    artist: "Artist 1",
    duration: 180,
    source_type: "youtube",
    source_uri: "https://youtube.com/watch?v=1",
    status: "ready",
  };

  const dummySegment: Segment = {
    id: "seg_1",
    track_id: "trk_1",
    name: "Chorus",
    start_time: 30,
    end_time: 60,
  };

  const mockPlaylist: Playlist & { item_count: number } = {
    id: "pl_1",
    name: "My Chill Vibes",
    created_at: 1000,
    updated_at: 1000,
    item_count: 2,
  };

  const mockItem1: PlaylistItemWithDetails = {
    id: "item_1",
    playlist_id: "pl_1",
    track_id: "trk_1",
    segment_id: null,
    sort_order: 0,
    added_at: 1000,
    track: dummyTrack,
    segment: null,
  };

  const mockItem2: PlaylistItemWithDetails = {
    id: "item_2",
    playlist_id: "pl_1",
    track_id: "trk_1",
    segment_id: "seg_1",
    sort_order: 1,
    added_at: 1001,
    track: dummyTrack,
    segment: dummySegment,
  };

  beforeEach(() => {
    clearDismissedSegments();
    usePlayerStore.setState({
      playlists: [],
      activePlaylistId: null,
      activePlaylistPlayingId: null,
      activePlaylistItems: [],
      activePlaylistOriginalQueue: [],
      viewMode: "grid",
    });
  });

  afterEach(() => {
    clearDismissedSegments();
    usePlayerStore.setState({
      activePlaylistId: null,
      activePlaylistPlayingId: null,
      activePlaylistItems: [],
      activePlaylistOriginalQueue: [],
    });
  });

  it("setViewMode updates viewMode state", () => {
    expect(usePlayerStore.getState().viewMode).toBe("grid");
    usePlayerStore.getState().setViewMode("list");
    expect(usePlayerStore.getState().viewMode).toBe("list");
    usePlayerStore.getState().setViewMode("grid");
    expect(usePlayerStore.getState().viewMode).toBe("grid");
  });

  it("fetchPlaylists retrieves playlists from server", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes("/api/playlists")) {
        return new Response(JSON.stringify([mockPlaylist]), { status: 200 });
      }
      return new Response("Not found", { status: 404 });
    }) as any;

    try {
      await usePlayerStore.getState().fetchPlaylists();
      expect(usePlayerStore.getState().playlists.length).toBe(1);
      expect(usePlayerStore.getState().playlists[0].name).toBe("My Chill Vibes");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("createPlaylist posts to api and updates state", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = url.toString();
      if (urlStr === "/api/playlists" && init?.method === "POST") {
        const body = JSON.parse(init.body as string);
        return new Response(JSON.stringify({ ...mockPlaylist, name: body.name }), { status: 201 });
      }
      if (urlStr === "/api/playlists") {
        return new Response(JSON.stringify([mockPlaylist]), { status: 200 });
      }
      return new Response("Not found", { status: 404 });
    }) as any;

    try {
      const created = await usePlayerStore.getState().createPlaylist("Workout Music");
      expect(created).not.toBeNull();
      expect(created?.name).toBe("Workout Music");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("setActivePlaylist loads playlist items and updates activePlaylistItems", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes("/api/playlists/pl_1")) {
        return new Response(
          JSON.stringify({
            ...mockPlaylist,
            items: [mockItem1, mockItem2],
          }),
          { status: 200 }
        );
      }
      return new Response("Not found", { status: 404 });
    }) as any;

    try {
      await usePlayerStore.getState().setActivePlaylist("pl_1");
      expect(usePlayerStore.getState().activePlaylistId).toBe("pl_1");
      expect(usePlayerStore.getState().activePlaylistItems.length).toBe(2);
      expect(usePlayerStore.getState().activePlaylistItems[1].segment?.name).toBe("Chorus");

      // Set to null clears items
      await usePlayerStore.getState().setActivePlaylist(null);
      expect(usePlayerStore.getState().activePlaylistId).toBeNull();
      expect(usePlayerStore.getState().activePlaylistItems.length).toBe(0);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("buildPlaylistQueue creates queue items with full tracks and slices", async () => {
    const origFetch = globalThis.fetch;
    const origPlaySegment = usePlayerStore.getState().playSegment;
    let playedSegmentId: string | null = null;

    usePlayerStore.setState({
      playSegment: async (seg) => {
        playedSegmentId = seg.id;
      },
    });

    globalThis.fetch = mock(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes("/api/playlists/pl_1")) {
        return new Response(
          JSON.stringify({
            ...mockPlaylist,
            items: [mockItem1, mockItem2],
          }),
          { status: 200 }
        );
      }
      return new Response("Not found", { status: 404 });
    }) as any;

    try {
      await usePlayerStore.getState().buildPlaylistQueue("pl_1", false);
      const queue = usePlayerStore.getState().queue;
      expect(queue.length).toBe(2);
      // First item is full track fallback
      expect(queue[0].segment.id).toBe("fallback_trk_1");
      // Second item is custom slice
      expect(queue[1].segment.id).toBe("seg_1");
      expect(playedSegmentId).toBe("fallback_trk_1" as any);
      expect(usePlayerStore.getState().activePlaylistPlayingId).toBe("pl_1");
    } finally {
      globalThis.fetch = origFetch;
      usePlayerStore.setState({ playSegment: origPlaySegment });
    }
  });

  it("playPlaylistItemAtIndex starts playing at the given index", async () => {
    const origFetch = globalThis.fetch;
    const origPlaySegment = usePlayerStore.getState().playSegment;
    let playedIndex = -1;

    usePlayerStore.setState({
      activePlaylistId: null,
      activePlaylistItems: [],
      playSegment: async (_seg, _track, idx) => {
        playedIndex = idx ?? -1;
      },
    });

    globalThis.fetch = mock(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes("/api/playlists/pl_1")) {
        return new Response(
          JSON.stringify({
            ...mockPlaylist,
            items: [mockItem1, mockItem2],
          }),
          { status: 200 }
        );
      }
      return new Response("Not found", { status: 404 });
    }) as any;

    try {
      await usePlayerStore.getState().playPlaylistItemAtIndex("pl_1", 1);
      expect(usePlayerStore.getState().queueIndex).toBe(1);
      expect(playedIndex).toBe(1);
      expect(usePlayerStore.getState().activePlaylistPlayingId).toBe("pl_1");
    } finally {
      globalThis.fetch = origFetch;
      usePlayerStore.setState({ playSegment: origPlaySegment });
    }
  });

  it("deletePlaylist deletes on server and resets activePlaylistId if matching", async () => {
    const origFetch = globalThis.fetch;
    usePlayerStore.setState({ activePlaylistId: "pl_1", activePlaylistItems: [mockItem1] });

    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = url.toString();
      if (urlStr.includes("/api/playlists/pl_1") && init?.method === "DELETE") {
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      if (urlStr === "/api/playlists") {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response("Not found", { status: 404 });
    }) as any;

    try {
      const ok = await usePlayerStore.getState().deletePlaylist("pl_1");
      expect(ok).toBe(true);
      expect(usePlayerStore.getState().activePlaylistId).toBeNull();
      expect(usePlayerStore.getState().activePlaylistItems.length).toBe(0);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("renamePlaylist sends PATCH to server", async () => {
    const origFetch = globalThis.fetch;
    let patchedName = "";

    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = url.toString();
      if (urlStr.includes("/api/playlists/pl_1") && init?.method === "PATCH") {
        const body = JSON.parse(init.body as string);
        patchedName = body.name;
        return new Response(JSON.stringify({ ...mockPlaylist, name: body.name }), { status: 200 });
      }
      if (urlStr === "/api/playlists") {
        return new Response(JSON.stringify([{ ...mockPlaylist, name: patchedName }]), { status: 200 });
      }
      return new Response("Not found", { status: 404 });
    }) as any;

    try {
      const ok = await usePlayerStore.getState().renamePlaylist("pl_1", "Updated Name");
      expect(ok).toBe(true);
      expect(patchedName).toBe("Updated Name");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("addToPlaylist sends POST to server", async () => {
    const origFetch = globalThis.fetch;
    let addedTrackId = "";

    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = url.toString();
      if (urlStr.includes("/api/playlists/pl_1/items") && init?.method === "POST") {
        const body = JSON.parse(init.body as string);
        addedTrackId = body.track_id;
        return new Response(JSON.stringify(mockItem1), { status: 201 });
      }
      if (urlStr === "/api/playlists") {
        return new Response(JSON.stringify([mockPlaylist]), { status: 200 });
      }
      return new Response("Not found", { status: 404 });
    }) as any;

    try {
      const ok = await usePlayerStore.getState().addToPlaylist("pl_1", "trk_1", null);
      expect(ok).toBe(true);
      expect(addedTrackId).toBe("trk_1");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("removeFromPlaylist sends DELETE to server", async () => {
    const origFetch = globalThis.fetch;
    let deletedItemId = "";

    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = url.toString();
      if (urlStr.includes("/api/playlists/pl_1/items/item_1") && init?.method === "DELETE") {
        deletedItemId = "item_1";
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      if (urlStr === "/api/playlists") {
        return new Response(JSON.stringify([mockPlaylist]), { status: 200 });
      }
      return new Response("Not found", { status: 404 });
    }) as any;

    try {
      const ok = await usePlayerStore.getState().removeFromPlaylist("pl_1", "item_1");
      expect(ok).toBe(true);
      expect(deletedItemId).toBe("item_1");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("reorderPlaylist sends PUT to server", async () => {
    const origFetch = globalThis.fetch;
    let reorderedIds: string[] = [];

    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = url.toString();
      if (urlStr.includes("/api/playlists/pl_1/reorder") && init?.method === "PUT") {
        const body = JSON.parse(init.body as string);
        reorderedIds = body.itemIds;
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      return new Response("Not found", { status: 404 });
    }) as any;

    try {
      const ok = await usePlayerStore.getState().reorderPlaylist("pl_1", ["item_2", "item_1"]);
      expect(ok).toBe(true);
      expect(reorderedIds).toEqual(["item_2", "item_1"]);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("setActivePlaylist ignores response if activePlaylistId was changed during fetch", async () => {
    const origFetch = globalThis.fetch;

    globalThis.fetch = mock(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes("/api/playlists/pl_slow")) {
        // simulate slow response
        await new Promise((r) => setTimeout(r, 20));
        return new Response(JSON.stringify({ ...mockPlaylist, items: [mockItem1] }), { status: 200 });
      }
      return new Response("Not found", { status: 404 });
    }) as any;

    try {
      const p = usePlayerStore.getState().setActivePlaylist("pl_slow");
      // Immediately switch to pl_fast
      usePlayerStore.setState({ activePlaylistId: "pl_fast", activePlaylistItems: [] });
      await p;
      // Should NOT have overwritten with pl_slow's items
      expect(usePlayerStore.getState().activePlaylistId).toBe("pl_fast");
      expect(usePlayerStore.getState().activePlaylistItems.length).toBe(0);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("setActivePlaylist refetches items when force is true", async () => {
    const origFetch = globalThis.fetch;
    let fetchCount = 0;

    globalThis.fetch = mock(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes("/api/playlists/pl_1")) {
        fetchCount++;
        return new Response(JSON.stringify({ ...mockPlaylist, items: [mockItem1] }), { status: 200 });
      }
      return new Response("Not found", { status: 404 });
    }) as any;

    try {
      usePlayerStore.setState({ activePlaylistId: "pl_1", activePlaylistItems: [] });
      // Call without force should no-op
      await usePlayerStore.getState().setActivePlaylist("pl_1", false);
      expect(fetchCount).toBe(0);

      // Call with force should refetch
      await usePlayerStore.getState().setActivePlaylist("pl_1", true);
      expect(fetchCount).toBe(1);
      expect(usePlayerStore.getState().activePlaylistItems.length).toBe(1);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("reorderPlaylist performs optimistic update and updates queue when playing sequentially", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = url.toString();
      if (urlStr.includes("/api/playlists/pl_1/reorder") && init?.method === "PUT") {
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      if (urlStr.includes("/api/playlists/pl_1")) {
        return new Response(JSON.stringify({ ...mockPlaylist, items: [mockItem2, mockItem1] }), { status: 200 });
      }
      return new Response("Not found", { status: 404 });
    }) as any;

    try {
      usePlayerStore.setState({
        activePlaylistId: "pl_1",
        activePlaylistItems: [mockItem1, mockItem2],
        activePlaylistPlayingId: "pl_1",
        isShuffle: false,
        queue: [
          { segment: mockItem1.segment || { id: "seg_1", track_id: "trk_1", name: "S1", start_time: 0, end_time: 10, color: "#fff", sort_order: 0, created_at: 0 }, track: mockItem1.track, queueItemId: "item_1" },
          { segment: mockItem2.segment || { id: "seg_2", track_id: "trk_2", name: "S2", start_time: 0, end_time: 10, color: "#fff", sort_order: 0, created_at: 0 }, track: mockItem2.track, queueItemId: "item_2" },
        ],
        queueIndex: 0,
      });

      const ok = await usePlayerStore.getState().reorderPlaylist("pl_1", ["item_2", "item_1"]);
      expect(ok).toBe(true);
      expect(usePlayerStore.getState().activePlaylistItems[0].id).toBe("item_2");
      expect(usePlayerStore.getState().queue[0].queueItemId).toBe("item_2");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("removeFromPlaylist cleanly transitions when removing the actively playing item", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes("/api/playlists/pl_1/items/item_1")) {
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      if (urlStr === "/api/playlists") {
        return new Response(JSON.stringify([mockPlaylist]), { status: 200 });
      }
      if (urlStr.includes("/api/playlists/pl_1")) {
        return new Response(JSON.stringify({ ...mockPlaylist, items: [mockItem2] }), { status: 200 });
      }
      return new Response("Not found", { status: 404 });
    }) as any;

    try {
      const q1 = { segment: mockItem1.segment || { id: "seg_1", track_id: "trk_1", name: "S1", start_time: 0, end_time: 10, color: "#fff", sort_order: 0, created_at: 0 }, track: mockItem1.track, queueItemId: "item_1" };
      const q2 = { segment: mockItem2.segment || { id: "seg_2", track_id: "trk_2", name: "S2", start_time: 0, end_time: 10, color: "#fff", sort_order: 0, created_at: 0 }, track: mockItem2.track, queueItemId: "item_2" };

      usePlayerStore.setState({
        activePlaylistId: "pl_1",
        activePlaylistPlayingId: "pl_1",
        queue: [q1, q2],
        queueIndex: 0,
        activeTrack: mockItem1.track,
        activeSegment: q1.segment,
        isPlaying: false,
      });

      const ok = await usePlayerStore.getState().removeFromPlaylist("pl_1", "item_1");
      expect(ok).toBe(true);
      expect(usePlayerStore.getState().queue.length).toBe(1);
      expect(usePlayerStore.getState().activeTrack?.id).toBe(mockItem2.track.id);
      expect(usePlayerStore.getState().queueIndex).toBe(0);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("setActiveSystemCategory updates activeSystemCategory without altering queue or activePlaylistPlayingId", () => {
    const q1 = { segment: mockItem1.segment || { id: "seg_1", track_id: "trk_1", name: "S1", start_time: 0, end_time: 10, color: "#fff", sort_order: 0, created_at: 0 }, track: mockItem1.track, queueItemId: "item_1" };
    usePlayerStore.setState({
      activeSystemCategory: "mixed",
      activePlaylistId: "pl_1",
      activePlaylistPlayingId: "pl_1",
      queue: [q1],
      queueIndex: 0,
      playbackMode: "mixed",
    });

    usePlayerStore.getState().setActiveSystemCategory("slices_only");

    const state = usePlayerStore.getState();
    expect(state.activeSystemCategory).toBe("slices_only");
    expect(state.activePlaylistId).toBeNull();
    // Must NOT alter playing playlist or queue!
    expect(state.activePlaylistPlayingId).toBe("pl_1");
    expect(state.queue.length).toBe(1);
    expect(state.queue[0].queueItemId).toBe("item_1");
    expect(state.playbackMode).toBe("mixed");
  });

  it("removeFromPlaylist correctly decrements queueIndex when deleting item before active playing item", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes("/api/playlists/pl_1/items/item_1")) {
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      if (urlStr === "/api/playlists") {
        return new Response(JSON.stringify([mockPlaylist]), { status: 200 });
      }
      if (urlStr.includes("/api/playlists/pl_1")) {
        return new Response(JSON.stringify({ ...mockPlaylist, items: [mockItem2] }), { status: 200 });
      }
      return new Response("Not found", { status: 404 });
    }) as any;

    try {
      const q1 = { segment: mockItem1.segment || { id: "seg_1", track_id: "trk_1", name: "S1", start_time: 0, end_time: 10, color: "#fff", sort_order: 0, created_at: 0 }, track: mockItem1.track, queueItemId: "item_1" };
      const q2 = { segment: mockItem2.segment || { id: "seg_2", track_id: "trk_2", name: "S2", start_time: 0, end_time: 10, color: "#fff", sort_order: 0, created_at: 0 }, track: mockItem2.track, queueItemId: "item_2" };

      // item_2 is currently playing at index 1
      usePlayerStore.setState({
        activePlaylistId: "pl_1",
        activePlaylistPlayingId: "pl_1",
        queue: [q1, q2],
        queueIndex: 1,
        activeTrack: mockItem2.track,
        activeSegment: q2.segment,
        isPlaying: true,
      });

      // Remove item_1 (which is at index 0, prior to item_2)
      const ok = await usePlayerStore.getState().removeFromPlaylist("pl_1", "item_1");
      expect(ok).toBe(true);
      expect(usePlayerStore.getState().queue.length).toBe(1);
      expect(usePlayerStore.getState().queue[0].queueItemId).toBe("item_2");
      // queueIndex must decrement to 0 to keep pointing to item_2!
      expect(usePlayerStore.getState().queueIndex).toBe(0);
      expect(usePlayerStore.getState().queue[usePlayerStore.getState().queueIndex].queueItemId).toBe("item_2");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("reorderPlaylist updates activePlaylistOriginalQueue even when in shuffle mode", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = url.toString();
      if (urlStr.includes("/api/playlists/pl_1/reorder") && init?.method === "PUT") {
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      return new Response("Not found", { status: 404 });
    }) as any;

    try {
      const q1 = { segment: mockItem1.segment || { id: "seg_1", track_id: "trk_1", name: "S1", start_time: 0, end_time: 10, color: "#fff", sort_order: 0, created_at: 0 }, track: mockItem1.track, queueItemId: "item_1" };
      const q2 = { segment: mockItem2.segment || { id: "seg_2", track_id: "trk_2", name: "S2", start_time: 0, end_time: 10, color: "#fff", sort_order: 0, created_at: 0 }, track: mockItem2.track, queueItemId: "item_2" };

      usePlayerStore.setState({
        activePlaylistId: "pl_1",
        activePlaylistPlayingId: "pl_1",
        activePlaylistItems: [mockItem1, mockItem2],
        activePlaylistOriginalQueue: [q1, q2],
        isShuffle: true,
        queue: [q2, q1],
        queueIndex: 0,
      });

      // Reorder from [item_1, item_2] to [item_2, item_1]
      const ok = await usePlayerStore.getState().reorderPlaylist("pl_1", ["item_2", "item_1"]);
      expect(ok).toBe(true);

      // activePlaylistOriginalQueue should be updated to [item_2, item_1]
      const origQ = usePlayerStore.getState().activePlaylistOriginalQueue;
      expect(origQ[0].queueItemId).toBe("item_2");
      expect(origQ[1].queueItemId).toBe("item_1");

      // Turning off shuffle restores from activePlaylistOriginalQueue
      usePlayerStore.getState().toggleShuffle();
      expect(usePlayerStore.getState().isShuffle).toBe(false);
      expect(usePlayerStore.getState().queue[0].queueItemId).toBe("item_2");
      expect(usePlayerStore.getState().queue[1].queueItemId).toBe("item_1");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("reshuffleCurrentQueue on active playlist reshuffles queue, preserves originalQueue and plays item at index 0", async () => {
    const q1 = {
      segment: mockItem1.segment || { id: "seg_1", track_id: "trk_1", name: "S1", start_time: 0, end_time: 10, color: "#fff", sort_order: 0, created_at: 0 },
      track: mockItem1.track,
      queueItemId: "item_1",
    };
    const q2 = {
      segment: mockItem2.segment || { id: "seg_2", track_id: "trk_2", name: "S2", start_time: 0, end_time: 10, color: "#fff", sort_order: 0, created_at: 0 },
      track: mockItem2.track,
      queueItemId: "item_2",
    };

    usePlayerStore.setState({
      activePlaylistId: "pl_1",
      activePlaylistPlayingId: "pl_1",
      activePlaylistItems: [mockItem1, mockItem2],
      activePlaylistOriginalQueue: [q1, q2],
      isShuffle: false,
      queue: [q1, q2],
      queueIndex: 1,
      activeSegment: q2.segment,
      activeTrack: q2.track,
    });

    usePlayerStore.getState().reshuffleCurrentQueue();

    const state = usePlayerStore.getState();
    expect(state.isShuffle).toBe(true);
    expect(state.activePlaylistPlayingId).toBe("pl_1");
    expect(state.activePlaylistOriginalQueue[0].queueItemId).toBe("item_1");
    expect(state.activePlaylistOriginalQueue[1].queueItemId).toBe("item_2");
    expect(state.queueIndex).toBe(0);
    expect(state.activeSegment?.id).toBe(state.queue[0].segment.id);
    expect(state.activeTrack?.id).toBe(state.queue[0].track.id);
  });

  it("addToPlaylist does not add duplicate queue item when active playlist is already playing", async () => {
    const origFetch = globalThis.fetch;
    try {
      globalThis.fetch = mock(async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes("/items")) {
          return new Response(JSON.stringify(mockItem1), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        if (urlStr === "/api/playlists") {
          return new Response(JSON.stringify([mockPlaylist]), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        return new Response("[]", { status: 200 });
      }) as any;

      const q1 = {
        track: dummyTrack,
        segment: { id: "seg_full_trk_1", track_id: "trk_1", name: "Full", start_time: 0, end_time: 180 },
        queueItemId: "item_1",
      };

      usePlayerStore.setState({
        tracks: [dummyTrack],
        activePlaylistId: "pl_1",
        activePlaylistPlayingId: "pl_1",
        queue: [q1],
        activePlaylistOriginalQueue: [q1],
      });

      const ok = await usePlayerStore.getState().addToPlaylist("pl_1", "trk_1", null);
      expect(ok).toBe(true);

      // Should not duplicate item_1 in queue
      expect(usePlayerStore.getState().queue.length).toBe(1);
      expect(usePlayerStore.getState().activePlaylistOriginalQueue.length).toBe(1);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("reorderQueue updates activePlaylistOriginalQueue when sequentially playing a playlist", () => {
    const q1 = {
      track: dummyTrack,
      segment: { id: "seg_full_trk_1", track_id: "trk_1", name: "Full", start_time: 0, end_time: 180 },
      queueItemId: "item_1",
    };
    const q2 = {
      track: dummyTrack,
      segment: { id: "seg_full_trk_2", track_id: "trk_2", name: "Full", start_time: 0, end_time: 180 },
      queueItemId: "item_2",
    };

    usePlayerStore.setState({
      activePlaylistId: "pl_1",
      activePlaylistPlayingId: "pl_1",
      isShuffle: false,
      queue: [q1, q2],
      queueIndex: 0,
      activePlaylistOriginalQueue: [q1, q2],
    });

    usePlayerStore.getState().reorderQueue(0, 1);

    expect(usePlayerStore.getState().queue[0].queueItemId).toBe("item_2");
    expect(usePlayerStore.getState().queue[1].queueItemId).toBe("item_1");
    expect(usePlayerStore.getState().activePlaylistOriginalQueue[0].queueItemId).toBe("item_2");
    expect(usePlayerStore.getState().activePlaylistOriginalQueue[1].queueItemId).toBe("item_1");
  });

  it("removeFromPlaylist preserves queueIndex === -1 when removing an item while player is idle", async () => {
    const origFetch = globalThis.fetch;
    try {
      globalThis.fetch = mock(async () => new Response(JSON.stringify({ success: true }), { status: 200 })) as any;

      const q1 = {
        track: dummyTrack,
        segment: { id: "seg_full_trk_1", track_id: "trk_1", name: "Full", start_time: 0, end_time: 180 },
        queueItemId: "item_1",
      };
      const q2 = {
        track: dummyTrack,
        segment: { id: "seg_full_trk_2", track_id: "trk_2", name: "Full", start_time: 0, end_time: 180 },
        queueItemId: "item_2",
      };

      usePlayerStore.setState({
        activePlaylistId: "pl_1",
        activePlaylistPlayingId: "pl_1",
        activePlaylistItems: [mockItem1, mockItem2],
        queue: [q1, q2],
        queueIndex: -1, // Idle!
        activeSegment: null,
      });

      const ok = await usePlayerStore.getState().removeFromPlaylist("pl_1", "item_1");
      expect(ok).toBe(true);
      expect(usePlayerStore.getState().queueIndex).toBe(-1);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("removeQueueItemAtIndex resets activePlaylistPlayingId when last item is removed while player is idle", () => {
    const q1 = {
      track: dummyTrack,
      segment: { id: "seg_full_trk_1", track_id: "trk_1", name: "Full", start_time: 0, end_time: 180 },
      queueItemId: "item_1",
    };

    usePlayerStore.setState({
      activePlaylistId: "pl_1",
      activePlaylistPlayingId: "pl_1",
      queue: [q1],
      queueIndex: -1,
      activeSegment: null,
    });

    usePlayerStore.getState().removeQueueItemAtIndex(0);

    expect(usePlayerStore.getState().queue.length).toBe(0);
    expect(usePlayerStore.getState().activePlaylistPlayingId).toBeNull();
  });

  it("removeFromPlaylist updates currentTime and volume when removing active item while paused", async () => {
    const origFetch = globalThis.fetch;
    try {
      globalThis.fetch = mock(async () => new Response(JSON.stringify({ success: true }), { status: 200 })) as any;

      const track2: Track = {
        ...dummyTrack,
        id: "trk_2",
        volume: 0.8,
      };
      const seg2: Segment = {
        id: "seg_2",
        track_id: "trk_2",
        name: "Verse",
        start_time: 45,
        end_time: 90,
      };

      const q1 = {
        track: dummyTrack,
        segment: { id: "seg_full_trk_1", track_id: "trk_1", name: "Full", start_time: 0, end_time: 180 },
        queueItemId: "item_1",
      };
      const q2 = {
        track: track2,
        segment: seg2,
        queueItemId: "item_2",
      };

      usePlayerStore.setState({
        activePlaylistId: "pl_1",
        activePlaylistPlayingId: "pl_1",
        activePlaylistItems: [mockItem1, mockItem2],
        activePlaylistOriginalQueue: [q1, q2],
        queue: [q1, q2],
        queueIndex: 0,
        isPlaying: false,
        currentTime: 10,
        volume: 0.5,
      });

      const ok = await usePlayerStore.getState().removeFromPlaylist("pl_1", "item_1");
      expect(ok).toBe(true);

      const state = usePlayerStore.getState();
      expect(state.queue.length).toBe(1);
      expect(state.queueIndex).toBe(0);
      expect(state.activeTrack?.id).toBe("trk_2");
      expect(state.activeSegment?.id).toBe("seg_2");
      expect(state.currentTime).toBe(45);
      expect(state.volume).toBeCloseTo(0.8);
      expect(state.isPlaying).toBe(false);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("removeFromPlaylist resets activePlaylistPlayingId when removing non-active/idle item leaves queue empty", async () => {
    const origFetch = globalThis.fetch;
    try {
      globalThis.fetch = mock(async () => new Response(JSON.stringify({ success: true }), { status: 200 })) as any;

      const q1 = {
        track: dummyTrack,
        segment: { id: "seg_full_trk_1", track_id: "trk_1", name: "Full", start_time: 0, end_time: 180 },
        queueItemId: "item_1",
      };

      usePlayerStore.setState({
        activePlaylistId: "pl_1",
        activePlaylistPlayingId: "pl_1",
        activePlaylistItems: [mockItem1],
        activePlaylistOriginalQueue: [q1],
        queue: [q1],
        queueIndex: -1,
        activeTrack: null,
        activeSegment: null,
      });

      const ok = await usePlayerStore.getState().removeFromPlaylist("pl_1", "item_1");
      expect(ok).toBe(true);

      const state = usePlayerStore.getState();
      expect(state.queue.length).toBe(0);
      expect(state.activePlaylistPlayingId).toBeNull();
      expect(state.activeTrack).toBeNull();
      expect(state.activeSegment).toBeNull();
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("retryTrack prevents concurrent duplicate calls for same trackId and cleans up state", async () => {
    const origFetch = globalThis.fetch;
    let callCount = 0;

    globalThis.fetch = mock(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes("/api/tracks/trk_err/retry")) {
        callCount++;
        await new Promise((r) => setTimeout(r, 15));
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      if (urlStr === "/api/tracks") {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }) as any;

    try {
      const p1 = usePlayerStore.getState().retryTrack("trk_err");
      expect(usePlayerStore.getState().retryingTrackIds["trk_err"]).toBe(true);

      // Concurrent call should be guarded and return false
      const p2 = usePlayerStore.getState().retryTrack("trk_err");
      const res2 = await p2;
      expect(res2).toBe(false);

      const res1 = await p1;
      expect(res1).toBe(true);
      expect(callCount).toBe(1);
      // Cleaned up after completion
      expect(usePlayerStore.getState().retryingTrackIds["trk_err"]).toBeUndefined();
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("retryTrack syncs tracks via fetchTracks even on HTTP 400 rejection", async () => {
    const origFetch = globalThis.fetch;
    let fetchTracksCalled = false;

    globalThis.fetch = mock(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes("/api/tracks/trk_err_400/retry")) {
        return new Response(JSON.stringify({ success: false, message: "YouTube bot challenge" }), { status: 400 });
      }
      if (urlStr === "/api/tracks") {
        fetchTracksCalled = true;
        return new Response(JSON.stringify([{ id: "trk_err_400", title: "Test", status: "error", error_message: "YouTube bot challenge" }]), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }) as any;

    try {
      const ok = await usePlayerStore.getState().retryTrack("trk_err_400");
      expect(ok).toBe(false);
      expect(fetchTracksCalled).toBe(true);
      expect(usePlayerStore.getState().retryingTrackIds["trk_err_400"]).toBeUndefined();
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("addTracksToPlaylistBatch sends POST to batch endpoint and refreshes active playlist", async () => {
    const origFetch = globalThis.fetch;
    let batchPayload: any = null;
    let playlistRefreshed = false;

    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = url.toString();
      if (urlStr.includes("/api/playlists/pl_1/items/batch") && init?.method === "POST") {
        batchPayload = JSON.parse(init.body as string);
        return new Response(JSON.stringify({ success: true, count: 2 }), { status: 200 });
      }
      if (urlStr === "/api/playlists") {
        return new Response(JSON.stringify([{ id: "pl_1", name: "P1", created_at: 1, updated_at: 1 }]), { status: 200 });
      }
      if (urlStr.includes("/api/playlists/pl_1")) {
        playlistRefreshed = true;
        return new Response(JSON.stringify({ id: "pl_1", name: "P1", items: [] }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }) as any;

    try {
      usePlayerStore.setState({ activePlaylistId: "pl_1" });
      const ok = await usePlayerStore.getState().addTracksToPlaylistBatch("pl_1", ["trk_1", "trk_2"]);
      expect(ok).toBe(true);
      expect(batchPayload).toEqual({ trackIds: ["trk_1", "trk_2"] });
      expect(playlistRefreshed).toBe(true);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("deleteTracksBatch sends POST to batch-delete and purges queue and fetches tracks", async () => {
    const origFetch = globalThis.fetch;
    let batchPayload: any = null;
    let fetchTracksCalled = false;

    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = url.toString();
      if (urlStr.includes("/api/tracks/batch-delete") && init?.method === "POST") {
        batchPayload = JSON.parse(init.body as string);
        return new Response(JSON.stringify({ success: true, count: 2 }), { status: 200 });
      }
      if (urlStr === "/api/tracks") {
        fetchTracksCalled = true;
        return new Response(JSON.stringify([{ ...dummyTrack, id: "trk_keep", status: "ready", duration: 100 }]), { status: 200 });
      }
      if (urlStr === "/api/segments") {
        return new Response(JSON.stringify([{ id: "s2", track_id: "trk_keep", name: "S2", start_time: 0, end_time: 10 }]), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }) as any;

    try {
      usePlayerStore.setState({
        queue: [
          { track: { ...dummyTrack, id: "trk_del_1" }, segment: { id: "s1", track_id: "trk_del_1", name: "S1", start_time: 0, end_time: 10 } },
          { track: { ...dummyTrack, id: "trk_keep", status: "ready", duration: 100 }, segment: { id: "s2", track_id: "trk_keep", name: "S2", start_time: 0, end_time: 10 } },
        ],
        queueIndex: 0,
      });

      const ok = await usePlayerStore.getState().deleteTracksBatch(["trk_del_1"]);
      expect(ok).toBe(true);
      expect(batchPayload).toEqual({ ids: ["trk_del_1"] });
      expect(fetchTracksCalled).toBe(true);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("removePlaylistItemsBatch removes items, unloads audio on active item deletion, and deselects items", async () => {
    const origFetch = globalThis.fetch;
    const { useSelectionStore } = await import("./useSelectionStore");
    let batchPayload: any = null;

    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = url.toString();
      if (urlStr.includes("/api/playlists/pl_1/items/batch-delete") && init?.method === "POST") {
        batchPayload = JSON.parse(init.body as string);
        return new Response(JSON.stringify({ success: true, count: 1 }), { status: 200 });
      }
      if (urlStr === "/api/playlists") {
        return new Response(JSON.stringify([mockPlaylist]), { status: 200 });
      }
      if (urlStr.includes("/api/playlists/pl_1")) {
        return new Response(JSON.stringify({ ...mockPlaylist, items: [mockItem2] }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }) as any;

    try {
      const q1 = {
        track: dummyTrack,
        segment: { id: "seg_1", track_id: "trk_1", name: "S1", start_time: 0, end_time: 30 },
        queueItemId: "item_1",
      };
      const q2 = {
        track: dummyTrack,
        segment: { id: "seg_2", track_id: "trk_1", name: "S2", start_time: 30, end_time: 60 },
        queueItemId: "item_2",
      };

      // Select item_1 in selection store
      useSelectionStore.getState().selectTracks(["item_1", "other_item"]);

      usePlayerStore.setState({
        activePlaylistId: "pl_1",
        activePlaylistPlayingId: "pl_1",
        activePlaylistItems: [mockItem1, mockItem2],
        activePlaylistOriginalQueue: [q1, q2],
        queue: [q1, q2],
        queueIndex: 0, // item_1 is actively playing
        activeTrack: dummyTrack,
        activeSegment: q1.segment,
        isPlaying: false,
      });

      const ok = await usePlayerStore.getState().removePlaylistItemsBatch("pl_1", ["item_1"]);
      expect(ok).toBe(true);
      expect(batchPayload).toEqual({ itemIds: ["item_1"] });

      // Selection must be cleared for item_1
      expect(useSelectionStore.getState().selectedTrackIds.has("item_1")).toBe(false);
      expect(useSelectionStore.getState().selectedTrackIds.has("other_item")).toBe(true);

      // Queue state should advance to item_2
      const state = usePlayerStore.getState();
      expect(state.queue.length).toBe(1);
      expect(state.queue[0].queueItemId).toBe("item_2");
      expect(state.queueIndex).toBe(0);
      expect(state.activeSegment?.id).toBe("seg_2");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("addItemsToPlaylistBatch appends items to queue and activePlaylistOriginalQueue when playlist is playing", async () => {
    const origFetch = globalThis.fetch;
    let batchPayload: any = null;

    const newItem3: PlaylistItemWithDetails = {
      id: "item_3",
      playlist_id: "pl_1",
      track_id: "trk_1",
      segment_id: "seg_1",
      sort_order: 2,
      added_at: 1002,
      track: dummyTrack,
      segment: dummySegment,
    };

    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = url.toString();
      if (urlStr.includes("/api/playlists/pl_1/items/batch") && init?.method === "POST") {
        batchPayload = JSON.parse(init.body as string);
        return new Response(JSON.stringify({ success: true, count: 1, items: [newItem3] }), { status: 200 });
      }
      if (urlStr === "/api/playlists") {
        return new Response(JSON.stringify([mockPlaylist]), { status: 200 });
      }
      if (urlStr.includes("/api/playlists/pl_1")) {
        return new Response(JSON.stringify({ ...mockPlaylist, items: [mockItem1, newItem3] }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }) as any;

    try {
      const q1 = {
        track: dummyTrack,
        segment: { id: "seg_full_trk_1", track_id: "trk_1", name: "Full", start_time: 0, end_time: 180 },
        queueItemId: "item_1",
      };

      usePlayerStore.setState({
        tracks: [dummyTrack],
        activePlaylistId: "pl_1",
        activePlaylistPlayingId: "pl_1",
        queue: [q1],
        activePlaylistOriginalQueue: [q1],
      });

      const ok = await usePlayerStore.getState().addItemsToPlaylistBatch("pl_1", [
        { track_id: "trk_1", segment_id: "seg_1" },
      ]);
      expect(ok).toBe(true);
      expect(batchPayload).toEqual({ items: [{ track_id: "trk_1", segment_id: "seg_1" }] });

      const state = usePlayerStore.getState();
      expect(state.queue.length).toBe(2);
      expect(state.queue[1].queueItemId).toBe("item_3");
      expect(state.queue[1].segment.id).toBe("seg_1");
      expect(state.activePlaylistOriginalQueue.length).toBe(2);
      expect(state.activePlaylistOriginalQueue[1].queueItemId).toBe("item_3");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("deleteSegmentsBatch sends POST to segments batch-delete and purges queue and deselects items", async () => {
    const origFetch = globalThis.fetch;
    const { useSelectionStore } = await import("./useSelectionStore");
    let batchPayload: any = null;
    let fetchTracksCalled = false;

    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = url.toString();
      if (urlStr.includes("/api/segments/batch-delete") && init?.method === "POST") {
        batchPayload = JSON.parse(init.body as string);
        return new Response(JSON.stringify({ success: true, count: 1 }), { status: 200 });
      }
      if (urlStr === "/api/tracks") {
        fetchTracksCalled = true;
        return new Response(JSON.stringify([dummyTrack]), { status: 200 });
      }
      if (urlStr === "/api/segments") {
        return new Response(JSON.stringify([{ id: "seg_keep", track_id: "trk_1", name: "Keep Me", start_time: 10, end_time: 20 }]), { status: 200 });
      }
      if (urlStr === "/api/playlists") {
        return new Response(JSON.stringify([mockPlaylist]), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }) as any;

    try {
      useSelectionStore.getState().selectTracks(["seg_del_1", "seg_keep"]);
      usePlayerStore.setState({
        playbackMode: "slices_only",
        queue: [
          { track: dummyTrack, segment: { id: "seg_del_1", track_id: "trk_1", name: "Delete Me", start_time: 0, end_time: 10 } },
          { track: dummyTrack, segment: { id: "seg_keep", track_id: "trk_1", name: "Keep Me", start_time: 10, end_time: 20 } },
        ],
        queueIndex: 0,
        activeSegment: { id: "seg_del_1", track_id: "trk_1", name: "Delete Me", start_time: 0, end_time: 10 },
      });

      const ok = await usePlayerStore.getState().deleteSegmentsBatch(["seg_del_1"]);
      expect(ok).toBe(true);
      expect(batchPayload).toEqual({ ids: ["seg_del_1"] });
      expect(useSelectionStore.getState().selectedTrackIds.has("seg_del_1")).toBe(false);
      expect(useSelectionStore.getState().selectedTrackIds.has("seg_keep")).toBe(true);
      expect(fetchTracksCalled).toBe(true);
      expect(usePlayerStore.getState().queue.length).toBe(1);
      expect(usePlayerStore.getState().queue[0].segment.id).toBe("seg_keep");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("retryAllErrors sends POST to /api/tracks/retry-all and refreshes tracks", async () => {
    const origFetch = globalThis.fetch;
    let retryAllCalled = false;
    let retryAllPayload: any = null;
    let fetchTracksCalled = false;

    globalThis.fetch = ((url: any, options?: RequestInit) => {
      const urlStr = String(url);
      if (urlStr === "/api/tracks/retry-all" && options?.method === "POST") {
        retryAllCalled = true;
        retryAllPayload = options.body ? JSON.parse(String(options.body)) : null;
        return new Response(JSON.stringify({ success: true, requeued: 5 }), { status: 200 });
      }
      if (urlStr === "/api/tracks") {
        fetchTracksCalled = true;
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }) as any;

    try {
      usePlayerStore.setState({ isRetryingAll: false });
      const ok = await usePlayerStore.getState().retryAllErrors();
      expect(ok).toBe(true);
      expect(retryAllCalled).toBe(true);
      expect(retryAllPayload).toEqual({});
      expect(fetchTracksCalled).toBe(true);
      expect(usePlayerStore.getState().isRetryingAll).toBe(false);

      // Pass specific track IDs
      const ok2 = await usePlayerStore.getState().retryAllErrors(["err_1", "err_2"]);
      expect(ok2).toBe(true);
      expect(retryAllPayload).toEqual({ track_ids: ["err_1", "err_2"] });
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("retryAllErrors guards against concurrent execution", async () => {
    const origFetch = globalThis.fetch;
    let callCount = 0;

    globalThis.fetch = ((url: any) => {
      const urlStr = String(url);
      if (urlStr === "/api/tracks/retry-all") {
        callCount++;
        return new Promise((resolve) => {
          setTimeout(() => resolve(new Response(JSON.stringify({ success: true, requeued: 1 }), { status: 200 })), 20);
        });
      }
      return new Response("[]", { status: 200 });
    }) as any;

    try {
      usePlayerStore.setState({ isRetryingAll: false });
      const p1 = usePlayerStore.getState().retryAllErrors();
      const p2 = usePlayerStore.getState().retryAllErrors();
      const [res1, res2] = await Promise.all([p1, p2]);
      expect(res1).toBe(true);
      expect(res2).toBe(false);
      expect(callCount).toBe(1);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});


