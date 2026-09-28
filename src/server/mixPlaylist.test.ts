import { describe, it, expect, beforeEach, afterAll } from "bun:test";
import {
  initDatabase, closeDatabase, getDb, createTrack, createSegment,
  createPlaylist, getPlaylist, listPlaylists, deletePlaylist, setPlaylistCover,
  getPlaylistItems, addPlaylistItem, addPlaylistItemsBatch,
  createMixPlaylist, setMixSources,
} from "./db";
import { getSortedPlaylistItems } from "../client/src/lib/playlistSort";
import { unlinkSync, existsSync } from "node:fs";

const TEST_DB_PATH = "./data/test_mix_playlist.db";

function addTrack(id: string, title = id) {
  return createTrack({
    id,
    source_type: "local",
    source_uri: `C:/music/${id}.mp3`,
    title,
    artist: "",
    duration: 120,
    thumbnail_url: `https://img.test/${id}.jpg`,
    status: "ready",
  });
}

const batch = (...trackIds: string[]) => trackIds.map((trackId) => ({ trackId }));

function setAddedAt(playlistId: string, trackId: string, addedAt: number) {
  getDb()
    .query("UPDATE playlist_items SET added_at = $at WHERE playlist_id = $pl AND track_id = $t")
    .run({ $at: addedAt, $pl: playlistId, $t: trackId });
}

const titles = (items: { track: { title: string } }[]) => items.map((entry) => entry.track.title);

describe("Mix playlists (live view over source playlists)", () => {
  beforeEach(() => {
    const db = initDatabase(TEST_DB_PATH);
    db.run("DELETE FROM playlist_sources; DELETE FROM playlist_items; DELETE FROM playlists; DELETE FROM segments; DELETE FROM tracks;");
    for (const n of [1, 2, 3, 4, 5, 6, 7]) addTrack(`t${n}`, `Song ${n}`);
  });

  afterAll(() => {
    closeDatabase();
    for (const f of [TEST_DB_PATH, `${TEST_DB_PATH}-wal`, `${TEST_DB_PATH}-shm`]) {
      try { if (existsSync(f)) unlinkSync(f); } catch {}
    }
  });

  it("creates a mix that remembers its sources in the chosen order", () => {
    const a = createPlaylist("A");
    const b = createPlaylist("B");

    const mix = createMixPlaylist("A + B", [b.id, a.id]);

    const fetched = getPlaylist(mix.id);
    expect(fetched?.is_mix).toBe(true);
    expect(fetched?.source_ids).toEqual([b.id, a.id]);
  });

  it("lists the items of the first source, then the second (123456 in manual order)", () => {
    const a = createPlaylist("A");
    const b = createPlaylist("B");
    addPlaylistItemsBatch(a.id, batch("t1", "t2", "t3"));
    addPlaylistItemsBatch(b.id, batch("t4", "t5", "t6"));
    const mix = createMixPlaylist("A + B", [a.id, b.id]);

    const items = getPlaylistItems(mix.id);
    const manual = getSortedPlaylistItems(items, "manual", undefined, getPlaylist(mix.id)?.is_custom_ordered);

    expect(titles(manual)).toEqual([
      ...titles(getPlaylistItems(a.id)),
      ...titles(getPlaylistItems(b.id)),
    ]);
    expect(manual).toHaveLength(6);
  });

  it("shows a song added to a source afterwards, without touching the mix", () => {
    const a = createPlaylist("A");
    const b = createPlaylist("B");
    addPlaylistItem(a.id, "t1");
    addPlaylistItem(b.id, "t2");
    const mix = createMixPlaylist("A + B", [a.id, b.id]);

    addPlaylistItem(a.id, "t7");

    expect(titles(getPlaylistItems(mix.id))).toContain("Song 7");
    expect(getPlaylist(mix.id)?.item_count).toBe(3);
  });

  it("keeps a song present in two sources only once, at its first position", () => {
    const a = createPlaylist("A");
    const b = createPlaylist("B");
    addPlaylistItem(a.id, "t1");
    addPlaylistItem(b.id, "t1");
    addPlaylistItem(b.id, "t2");
    const mix = createMixPlaylist("A + B", [a.id, b.id]);

    const items = getPlaylistItems(mix.id);

    expect(titles(items)).toEqual(["Song 1", "Song 2"]);
    expect(items[0].playlist_id).toBe(a.id);
  });

  it("treats a slice and its full track as different songs", () => {
    const a = createPlaylist("A");
    const b = createPlaylist("B");
    const seg = createSegment({ id: "s1", track_id: "t1", name: "Chorus", start_time: 10, end_time: 20 });
    addPlaylistItem(a.id, "t1");
    addPlaylistItem(b.id, "t1", seg.id);
    const mix = createMixPlaylist("A + B", [a.id, b.id]);

    expect(getPlaylistItems(mix.id)).toHaveLength(2);
  });

  it("sorts newest/oldest by the date each song was added to its source", () => {
    const a = createPlaylist("A");
    const b = createPlaylist("B");
    addPlaylistItemsBatch(a.id, batch("t1", "t2"));
    addPlaylistItemsBatch(b.id, batch("t3", "t4"));
    setAddedAt(a.id, "t1", 1000);
    setAddedAt(b.id, "t3", 2000);
    setAddedAt(a.id, "t2", 3000);
    setAddedAt(b.id, "t4", 4000);
    const mix = createMixPlaylist("A + B", [a.id, b.id]);

    const newest = getSortedPlaylistItems(getPlaylistItems(mix.id), "newest");

    expect(titles(newest)).toEqual(["Song 4", "Song 2", "Song 3", "Song 1"]);
  });

  it("rejects fewer than two distinct sources", () => {
    const a = createPlaylist("A");

    expect(() => createMixPlaylist("Solo", [a.id])).toThrow();
    expect(() => createMixPlaylist("Twice", [a.id, a.id])).toThrow();
  });

  it("rejects an unknown source", () => {
    const a = createPlaylist("A");

    expect(() => createMixPlaylist("Ghost", [a.id, "pl_missing"])).toThrow(/not found/);
  });

  it("rejects a mix as a source, so mixes can never form a cycle", () => {
    const a = createPlaylist("A");
    const b = createPlaylist("B");
    const c = createPlaylist("C");
    const mix = createMixPlaylist("A + B", [a.id, b.id]);

    expect(() => createMixPlaylist("Nested", [mix.id, c.id])).toThrow(/mix/);
  });

  it("refuses to store items directly in a mix", () => {
    const a = createPlaylist("A");
    const b = createPlaylist("B");
    const mix = createMixPlaylist("A + B", [a.id, b.id]);

    expect(() => addPlaylistItem(mix.id, "t1")).toThrow(/mix/);
    expect(() => addPlaylistItemsBatch(mix.id, batch("t1"))).toThrow(/mix/);
  });

  it("drops a deleted source but keeps the mix and its other sources", () => {
    const a = createPlaylist("A");
    const b = createPlaylist("B");
    addPlaylistItem(a.id, "t1");
    addPlaylistItem(b.id, "t2");
    const mix = createMixPlaylist("A + B", [a.id, b.id]);

    deletePlaylist(a.id);

    expect(getPlaylist(mix.id)?.source_ids).toEqual([b.id]);
    expect(titles(getPlaylistItems(mix.id))).toEqual(["Song 2"]);
  });

  it("reorders sources when they are replaced", () => {
    const a = createPlaylist("A");
    const b = createPlaylist("B");
    addPlaylistItem(a.id, "t1");
    addPlaylistItem(b.id, "t2");
    const mix = createMixPlaylist("A + B", [a.id, b.id]);

    setMixSources(mix.id, [b.id, a.id]);

    expect(titles(getPlaylistItems(mix.id))).toEqual(["Song 2", "Song 1"]);
  });

  it("reports item count, sources and a mosaic for the mix in the playlist list", () => {
    const a = createPlaylist("A");
    const b = createPlaylist("B");
    addPlaylistItem(a.id, "t1");
    addPlaylistItem(b.id, "t1");
    addPlaylistItem(b.id, "t2");
    const mix = createMixPlaylist("A + B", [a.id, b.id]);

    const listed = listPlaylists().find((p) => p.id === mix.id);

    expect(listed?.item_count).toBe(2);
    expect(listed?.source_ids).toEqual([a.id, b.id]);
    expect(listed?.mosaic_urls).toEqual(["https://img.test/t1.jpg", "https://img.test/t2.jpg"]);
  });

  it("accepts a cover taken from any song shown in the mix", () => {
    const a = createPlaylist("A");
    const b = createPlaylist("B");
    addPlaylistItem(b.id, "t2");
    const mix = createMixPlaylist("A + B", [a.id, b.id]);

    setPlaylistCover(mix.id, "t2");

    expect(listPlaylists().find((p) => p.id === mix.id)?.cover_url).toBe("https://img.test/t2.jpg");
  });
});
