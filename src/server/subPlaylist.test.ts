import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { unlinkSync, existsSync } from "node:fs";
import {
  initDatabase,
  closeDatabase,
  createPlaylist,
  getPlaylist,
  listPlaylists,
  deletePlaylist,
  addPlaylistItem,
  addPlaylistItemsBatch,
  getPlaylistItems,
  removePlaylistItem,
  removePlaylistItemsBatch,
  createTrack,
  getDb,
} from "./db";
import type { Track } from "./types";

const TEST_DB = "./data/test_sub_playlist.db";

describe("Sub-Playlists (1-level nested playlists)", () => {
  beforeEach(() => {
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
    initDatabase(TEST_DB);
  });

  afterEach(() => {
    closeDatabase();
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
  });

  it("should create a child playlist with parent_id and list it with parent_id", () => {
    const parent = createPlaylist("Parent Playlist");
    expect(parent.id).toBeDefined();
    expect(parent.parent_id).toBeNull();

    const child = createPlaylist("Child Playlist", undefined, parent.id);
    expect(child.id).toBeDefined();
    expect(child.parent_id).toBe(parent.id);

    const retrievedChild = getPlaylist(child.id);
    expect(retrievedChild).not.toBeNull();
    expect(retrievedChild?.parent_id).toBe(parent.id);

    const all = listPlaylists();
    const listedChild = all.find((p) => p.id === child.id);
    expect(listedChild).toBeDefined();
    expect(listedChild?.parent_id).toBe(parent.id);
  });

  it("should enforce strict 1-level nesting: cannot create a child of a child", () => {
    const parent = createPlaylist("Grandparent");
    const child = createPlaylist("Parent", undefined, parent.id);

    expect(() => {
      createPlaylist("Grandchild", undefined, child.id);
    }).toThrow("cannot nest beyond 1 level");
  });

  it("should reject parent_id referencing non-existent playlist or a mix playlist", () => {
    expect(() => {
      createPlaylist("Child", undefined, "non_existent_id");
    }).toThrow();
  });

  it("should auto-bubble track to parent playlist when added to child playlist", () => {
    const track = createTrack({
      id: "track_1",
      source_type: "local",
      source_uri: "local://song1.mp3",
      title: "Song 1",
      duration: 180,
      status: "ready",
    });

    const parent = createPlaylist("Parent Playlist");
    const child = createPlaylist("Child Playlist", undefined, parent.id);

    // Track is not in parent yet. Adding to child should auto-bubble to parent!
    addPlaylistItem(child.id, track.id);

    const childItems = getPlaylistItems(child.id);
    expect(childItems.length).toBe(1);
    expect(childItems[0].track_id).toBe(track.id);

    const parentItems = getPlaylistItems(parent.id);
    expect(parentItems.length).toBe(1);
    expect(parentItems[0].track_id).toBe(track.id);
  });

  it("should add track to child without duplicating in parent if already in parent", () => {
    const track = createTrack({
      id: "track_1",
      source_type: "local",
      source_uri: "local://song1.mp3",
      title: "Song 1",
      duration: 180,
      status: "ready",
    });

    const parent = createPlaylist("Parent Playlist");
    addPlaylistItem(parent.id, track.id);

    const child = createPlaylist("Child Playlist", undefined, parent.id);
    addPlaylistItem(child.id, track.id);

    const childItems = getPlaylistItems(child.id);
    expect(childItems.length).toBe(1);

    const parentItems = getPlaylistItems(parent.id);
    expect(parentItems.length).toBe(1);
  });

  it("should cascade-delete track from child playlists when removed from parent playlist", () => {
    const track = createTrack({
      id: "track_1",
      source_type: "local",
      source_uri: "local://song1.mp3",
      title: "Song 1",
      duration: 180,
      status: "ready",
    });

    const parent = createPlaylist("Parent Playlist");
    const child1 = createPlaylist("Child 1", undefined, parent.id);
    const child2 = createPlaylist("Child 2", undefined, parent.id);

    addPlaylistItem(child1.id, track.id);
    addPlaylistItem(child2.id, track.id);

    const parentItem = getPlaylistItems(parent.id)[0];
    expect(parentItem).toBeDefined();

    // Removing item from parent must cascade remove from child1 and child2
    removePlaylistItem(parent.id, parentItem.id);

    expect(getPlaylistItems(parent.id).length).toBe(0);
    expect(getPlaylistItems(child1.id).length).toBe(0);
    expect(getPlaylistItems(child2.id).length).toBe(0);
  });

  it("should delete parent and cascade delete all child playlists when keepChildren is false", () => {
    const parent = createPlaylist("Parent Playlist");
    const child = createPlaylist("Child Playlist", undefined, parent.id);

    const success = deletePlaylist(parent.id, false);
    expect(success).toBe(true);

    expect(getPlaylist(parent.id)).toBeNull();
    expect(getPlaylist(child.id)).toBeNull();
  });

  it("should promote child playlists to root playlists when keepChildren is true", () => {
    const parent = createPlaylist("Parent Playlist");
    const child = createPlaylist("Child Playlist", undefined, parent.id);

    const success = deletePlaylist(parent.id, true);
    expect(success).toBe(true);

    expect(getPlaylist(parent.id)).toBeNull();
    const promotedChild = getPlaylist(child.id);
    expect(promotedChild).not.toBeNull();
    expect(promotedChild?.parent_id).toBeNull();
  });

  it("should batch auto-bubble tracks and segments to parent playlist when added to child in batch", () => {
    const t1 = createTrack({
      id: "track_b1",
      source_type: "local",
      source_uri: "local://b1.mp3",
      title: "Batch 1",
      duration: 100,
      status: "ready",
    });
    const t2 = createTrack({
      id: "track_b2",
      source_type: "local",
      source_uri: "local://b2.mp3",
      title: "Batch 2",
      duration: 120,
      status: "ready",
    });

    const parent = createPlaylist("Parent Batch");
    const child = createPlaylist("Child Batch", undefined, parent.id);

    // Batch add to child
    addPlaylistItemsBatch(child.id, [
      { trackId: t1.id },
      { trackId: t2.id },
    ]);

    const childItems = getPlaylistItems(child.id);
    expect(childItems.length).toBe(2);

    const parentItems = getPlaylistItems(parent.id);
    expect(parentItems.length).toBe(2);
    expect(parentItems.some((i) => i.track_id === t1.id)).toBe(true);
    expect(parentItems.some((i) => i.track_id === t2.id)).toBe(true);
  });

  it("should batch cascade-delete items from child playlists when removed from parent playlist in batch", () => {
    const t1 = createTrack({
      id: "track_c1",
      source_type: "local",
      source_uri: "local://c1.mp3",
      title: "Cascade 1",
      duration: 100,
      status: "ready",
    });
    const t2 = createTrack({
      id: "track_c2",
      source_type: "local",
      source_uri: "local://c2.mp3",
      title: "Cascade 2",
      duration: 120,
      status: "ready",
    });

    const parent = createPlaylist("Parent Batch Remove");
    const child = createPlaylist("Child Batch Remove", undefined, parent.id);

    addPlaylistItemsBatch(child.id, [
      { trackId: t1.id },
      { trackId: t2.id },
    ]);

    const parentItems = getPlaylistItems(parent.id);
    expect(parentItems.length).toBe(2);

    // Batch remove both from parent
    const removedCount = removePlaylistItemsBatch(parent.id, parentItems.map((i) => i.id));
    expect(removedCount).toBe(2);

    expect(getPlaylistItems(parent.id).length).toBe(0);
    expect(getPlaylistItems(child.id).length).toBe(0);
  });
});



