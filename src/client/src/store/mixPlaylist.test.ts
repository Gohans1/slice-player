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
import type { Track, PlaylistItemWithDetails } from "@/server/types";

const track = (id: string): Track => ({
  id,
  title: `Song ${id}`,
  duration: 120,
  source_type: "local",
  source_uri: `C:/music/${id}.mp3`,
  status: "ready",
});

const item = (id: string, playlistId: string, trackId: string): PlaylistItemWithDetails => ({
  id,
  playlist_id: playlistId,
  track_id: trackId,
  segment_id: null,
  sort_order: 0,
  added_at: 1000,
  track: track(trackId),
  segment: null,
});

const plA = { id: "pl_a", name: "Chill", created_at: 0, updated_at: 0, item_count: 1 };
const plB = { id: "pl_b", name: "Gym", created_at: 0, updated_at: 0, item_count: 1 };
const mix = { id: "mix_1", name: "Chill + Gym", created_at: 0, updated_at: 0, item_count: 2, is_mix: true, source_ids: ["pl_a", "pl_b"] };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("usePlayerStore mix playlists", () => {
  const origFetch = globalThis.fetch;

  beforeEach(() => {
    usePlayerStore.setState({
      playlists: [plA, plB, mix],
      tracks: [track("t1"), track("t2")],
      activePlaylistId: null,
      activePlaylistPlayingId: null,
      activePlaylistItems: [],
      activePlaylistOriginalQueue: [],
      queue: [],
    });
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
    usePlayerStore.setState({ activePlaylistId: null, activePlaylistPlayingId: null, activePlaylistItems: [], queue: [] });
  });

  it("createMixPlaylist sends the name and ordered sources to the mix endpoint", async () => {
    let sent: any = null;
    globalThis.fetch = mock(async (url: any, init?: RequestInit) => {
      if (String(url) === "/api/playlists/mix" && init?.method === "POST") {
        sent = JSON.parse(init.body as string);
        return json({ ...mix, id: "mix_new" }, 201);
      }
      return json([plA, plB, mix]);
    }) as any;

    const created = await usePlayerStore.getState().createMixPlaylist("Gym + Chill", ["pl_b", "pl_a"]);

    expect(sent).toEqual({ name: "Gym + Chill", source_ids: ["pl_b", "pl_a"] });
    expect(created?.id).toBe("mix_new");
  });

  it("setMixSources replaces the sources of a mix", async () => {
    let sent: any = null;
    globalThis.fetch = mock(async (url: any, init?: RequestInit) => {
      if (String(url) === "/api/playlists/mix_1/sources" && init?.method === "PUT") {
        sent = JSON.parse(init.body as string);
        return json(mix);
      }
      return json([plA, plB, mix]);
    }) as any;

    const ok = await usePlayerStore.getState().setMixSources("mix_1", ["pl_b", "pl_a"]);

    expect(ok).toBe(true);
    expect(sent).toEqual({ source_ids: ["pl_b", "pl_a"] });
  });

  it("refreshes the open mix when a song is added to one of its sources", async () => {
    globalThis.fetch = mock(async (url: any, init?: RequestInit) => {
      const u = String(url);
      if (u === "/api/playlists/pl_a/items" && init?.method === "POST") return json(item("i2", "pl_a", "t2"), 201);
      if (u === "/api/playlists/mix_1") return json({ ...mix, items: [item("i1", "pl_a", "t1"), item("i2", "pl_a", "t2")] });
      return json([plA, plB, mix]);
    }) as any;
    usePlayerStore.setState({ activePlaylistId: "mix_1", activePlaylistItems: [item("i1", "pl_a", "t1")] });

    await usePlayerStore.getState().addToPlaylist("pl_a", "t2", null);

    expect(usePlayerStore.getState().activePlaylistItems.map((entry) => entry.id)).toEqual(["i1", "i2"]);
  });

  it("appends a song added to a source to the queue of the playing mix", async () => {
    globalThis.fetch = mock(async (url: any, init?: RequestInit) => {
      if (String(url) === "/api/playlists/pl_b/items" && init?.method === "POST") return json(item("i2", "pl_b", "t2"), 201);
      return json([plA, plB, mix]);
    }) as any;
    const playing = { track: track("t1"), segment: { id: "fallback_t1", track_id: "t1", name: "Full", start_time: 0, end_time: 120 }, queueItemId: "i1" };
    usePlayerStore.setState({ activePlaylistPlayingId: "mix_1", queue: [playing], activePlaylistOriginalQueue: [playing] });

    await usePlayerStore.getState().addToPlaylist("pl_b", "t2", null);

    expect(usePlayerStore.getState().queue.map((q) => q.queueItemId)).toEqual(["i1", "i2"]);
  });

  it("does not queue a song twice when the playing mix already has it from another source", async () => {
    globalThis.fetch = mock(async (url: any, init?: RequestInit) => {
      if (String(url) === "/api/playlists/pl_b/items" && init?.method === "POST") return json(item("i9", "pl_b", "t1"), 201);
      return json([plA, plB, mix]);
    }) as any;
    const playing = { track: track("t1"), segment: { id: "fallback_t1", track_id: "t1", name: "Full", start_time: 0, end_time: 120 }, queueItemId: "i1" };
    usePlayerStore.setState({ activePlaylistPlayingId: "mix_1", queue: [playing], activePlaylistOriginalQueue: [playing] });

    await usePlayerStore.getState().addToPlaylist("pl_b", "t1", null);

    expect(usePlayerStore.getState().queue).toHaveLength(1);
  });
});
