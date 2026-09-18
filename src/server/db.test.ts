import { describe, it, expect, beforeEach, afterAll } from "bun:test";
import {
  initDatabase, closeDatabase, createTrack, getTrack, updateTrack, deleteTrack, deleteTracksBatch,
  listTracks, createSegment, listSegmentsByTrack, updateSegment, deleteSegment, deleteSegmentsBatch, validateVolume,
  createPlaylist, getPlaylist, listPlaylists, updatePlaylist, deletePlaylist,
  getPlaylistItems, addPlaylistItem, addPlaylistItemsBatch, removePlaylistItem, removePlaylistItemsBatch, reorderPlaylistItems,
  getPlaylistMemberships
} from "./db";
import { unlinkSync, existsSync } from "node:fs";

const TEST_DB_PATH = "./data/test_music.db";

describe("Database layer (bun:sqlite)", () => {
  beforeEach(() => {
    const db = initDatabase(TEST_DB_PATH);
    db.run("DELETE FROM playlist_items; DELETE FROM playlists; DELETE FROM segments; DELETE FROM tracks;");
  });

  afterAll(() => {
    closeDatabase();
    if (existsSync(TEST_DB_PATH)) {
      try {
        unlinkSync(TEST_DB_PATH);
        if (existsSync(`${TEST_DB_PATH}-wal`)) unlinkSync(`${TEST_DB_PATH}-wal`);
        if (existsSync(`${TEST_DB_PATH}-shm`)) unlinkSync(`${TEST_DB_PATH}-shm`);
      } catch {
        // ignore on windows lock
      }
    }
  });

  it("should create and retrieve a track", () => {
    const track = createTrack({
      id: "track-1",
      source_type: "youtube",
      source_uri: "https://youtube.com/watch?v=123",
      title: "Test Track",
      artist: "Test Artist",
      duration: 180,
      thumbnail_url: "https://img.youtube.com/vi/123/0.jpg",
      file_path: "./data/cache/audio/123.m4a",
      peaks_json: JSON.stringify([0.1, 0.5, 0.9]),
      status: "ready",
    });

    expect(track.id).toBe("track-1");
    expect(track.title).toBe("Test Track");

    const fetched = getTrack("track-1");
    expect(fetched).not.toBeNull();
    expect(fetched?.duration).toBe(180);
  });

  it("should create, list and cascade delete segments", () => {
    createTrack({
      id: "track-2",
      source_type: "local",
      source_uri: "C:/music/test.flac",
      title: "Local FLAC",
      artist: "FLAC Artist",
      duration: 240,
      status: "ready",
    });

    createSegment({
      id: "seg-1",
      track_id: "track-2",
      name: "Intro Hook",
      start_time: 15.5,
      end_time: 30.0,
      color: "#4385BE",
    });

    createSegment({
      id: "seg-2",
      track_id: "track-2",
      name: "Guitar Solo",
      start_time: 120.0,
      end_time: 150.0,
      color: "#879A39",
    });

    const segments = listSegmentsByTrack("track-2");
    expect(segments.length).toBe(2);
    expect(segments[0].name).toBe("Intro Hook");
    expect(segments[1].name).toBe("Guitar Solo");

    // Update segment
    updateSegment("seg-1", { name: "Intro Hook Updated", end_time: 32.5 });
    const updatedSegments = listSegmentsByTrack("track-2");
    expect(updatedSegments.find((s) => s.id === "seg-1")?.name).toBe("Intro Hook Updated");
    expect(updatedSegments.find((s) => s.id === "seg-1")?.end_time).toBe(32.5);

    // Delete track should CASCADE delete all segments
    deleteTrack("track-2");
    const remainingSegments = listSegmentsByTrack("track-2");
    expect(remainingSegments.length).toBe(0);
  });

  it("should persist and update per-track volume", () => {
    // 1. Explicit volume
    const track = createTrack({
      id: "track-vol",
      source_type: "youtube",
      source_uri: "https://youtube.com/watch?v=vol",
      title: "Volume Test",
      duration: 120,
      status: "ready",
      volume: 0.45,
    });

    expect(track.volume).toBe(0.45);
    const fetched = getTrack("track-vol");
    expect(fetched?.volume).toBe(0.45);

    updateTrack("track-vol", { volume: 0.25 });
    const updated = getTrack("track-vol");
    expect(updated?.volume).toBe(0.25);

    // 2. Default volume when omitted is 0.5
    const defaultTrack = createTrack({
      id: "track-default-vol",
      source_type: "youtube",
      source_uri: "https://youtube.com/watch?v=def",
      title: "Default Volume Test",
      duration: 60,
      status: "ready",
    });
    expect(defaultTrack.volume).toBe(0.5);
    expect(getTrack("track-default-vol")?.volume).toBe(0.5);

    // 3. Boundary & clamping checks
    updateTrack("track-vol", { volume: 0.0 });
    expect(getTrack("track-vol")?.volume).toBe(0.0);

    updateTrack("track-vol", { volume: 1.0 });
    expect(getTrack("track-vol")?.volume).toBe(1.0);

    updateTrack("track-vol", { volume: 1.5 }); // clamped to 1.0
    expect(getTrack("track-vol")?.volume).toBe(1.0);

    updateTrack("track-vol", { volume: -0.5 }); // clamped to 0.0
    expect(getTrack("track-vol")?.volume).toBe(0.0);

    // 4. Clamping on createTrack
    const clampedHigh = createTrack({
      id: "track-clamp-high",
      source_type: "youtube",
      source_uri: "https://youtube.com/watch?v=chigh",
      title: "Clamp High",
      duration: 50,
      status: "ready",
      volume: 1.5,
    });
    expect(clampedHigh.volume).toBe(1.0);
    expect(getTrack("track-clamp-high")?.volume).toBe(1.0);

    const clampedLow = createTrack({
      id: "track-clamp-low",
      source_type: "youtube",
      source_uri: "https://youtube.com/watch?v=clow",
      title: "Clamp Low",
      duration: 50,
      status: "ready",
      volume: -0.5,
    });
    expect(clampedLow.volume).toBe(0.0);
    expect(getTrack("track-clamp-low")?.volume).toBe(0.0);

    const explicitZero = createTrack({
      id: "track-zero",
      source_type: "youtube",
      source_uri: "https://youtube.com/watch?v=zero",
      title: "Zero Volume",
      duration: 50,
      status: "ready",
      volume: 0.0,
    });
    expect(explicitZero.volume).toBe(0.0);
    expect(getTrack("track-zero")?.volume).toBe(0.0);

    // 5. Projection in listTracks
    const allTracks = listTracks();
    const listed = allTracks.find((t) => t.id === "track-default-vol");
    expect(listed).toBeDefined();
    expect(listed?.volume).toBe(0.5);
  });

  it("should validate volume boundaries and types correctly", () => {
    expect(validateVolume(0.5)).toBe(true);
    expect(validateVolume(0.0)).toBe(true);
    expect(validateVolume(1.0)).toBe(true);
    expect(validateVolume(-0.1)).toBe(false);
    expect(validateVolume(1.01)).toBe(false);
    expect(validateVolume(NaN)).toBe(false);
    expect(validateVolume(Infinity)).toBe(false);
    expect(validateVolume(-Infinity)).toBe(false);
    expect(validateVolume("0.5")).toBe(false);
    expect(validateVolume(null)).toBe(false);
    expect(validateVolume(undefined)).toBe(false);
    expect(validateVolume({})).toBe(false);
  });

  it("should upgrade legacy default volume from 0.8 to 0.5 in migration v2", () => {
    const db = initDatabase(TEST_DB_PATH);
    // Simulate legacy state: user_version 1 with a track having volume 0.8
    db.run("INSERT OR REPLACE INTO tracks (id, source_type, source_uri, title, duration, volume) VALUES ('legacy-v1-track', 'youtube', 'https://youtube.com', 'Legacy Track', 100, 0.8);");
    db.run("INSERT OR REPLACE INTO tracks (id, source_type, source_uri, title, duration, volume) VALUES ('custom-v1-track', 'youtube', 'https://youtube.com', 'Custom Track', 100, 0.9);");
    db.run("PRAGMA user_version = 1;");

    // Re-initialize to trigger migration v2
    const finalDb = initDatabase(TEST_DB_PATH);

    const legacyTrack = getTrack("legacy-v1-track");
    expect(legacyTrack?.volume).toBe(0.5);

    const customTrack = getTrack("custom-v1-track");
    expect(customTrack?.volume).toBe(0.9);

    const versionRow = finalDb.query("PRAGMA user_version;").get() as { user_version: number };
    expect(versionRow.user_version).toBe(3);
  });

  describe("Playlist operations", () => {
    it("should create, get, list, update and delete a playlist", () => {
      const pl = createPlaylist("Nhạc Buồn");
      expect(pl.id).toStartWith("pl_");
      expect(pl.name).toBe("Nhạc Buồn");
      expect(pl.item_count).toBe(0);

      const fetched = getPlaylist(pl.id);
      expect(fetched).not.toBeNull();
      expect(fetched?.name).toBe("Nhạc Buồn");

      const all = listPlaylists();
      expect(all.length).toBe(1);
      expect(all[0].id).toBe(pl.id);

      const updated = updatePlaylist(pl.id, "Nhạc Buồn 3AM");
      expect(updated).not.toBeNull();
      expect(updated?.name).toBe("Nhạc Buồn 3AM");

      const deleted = deletePlaylist(pl.id);
      expect(deleted).toBe(true);
      expect(getPlaylist(pl.id)).toBeNull();
    });

    it("should reject empty playlist names", () => {
      expect(() => createPlaylist("   ")).toThrow("Playlist name cannot be empty");
      const pl = createPlaylist("Valid");
      expect(() => updatePlaylist(pl.id, "")).toThrow("Playlist name cannot be empty");
    });

    it("should add both full tracks and individual slices to playlist", () => {
      const track = createTrack({
        id: "trk-1",
        source_type: "youtube",
        source_uri: "https://youtube.com/watch?v=abc",
        title: "Song 1",
        duration: 200,
        status: "ready",
      });

      const seg = createSegment({
        id: "seg-1",
        track_id: "trk-1",
        name: "Chorus",
        start_time: 30,
        end_time: 60,
      });

      const pl = createPlaylist("My Mix");

      // Add full track (segment_id = null)
      const item1 = addPlaylistItem(pl.id, track.id);
      expect(item1.playlist_id).toBe(pl.id);
      expect(item1.track_id).toBe(track.id);
      expect(item1.segment_id).toBeNull();
      expect(item1.track.title).toBe("Song 1");
      expect(item1.segment).toBeNull();

      // Add specific slice
      const item2 = addPlaylistItem(pl.id, track.id, seg.id);
      expect(item2.segment_id).toBe(seg.id);
      expect(item2.segment?.name).toBe("Chorus");

      const items = getPlaylistItems(pl.id);
      expect(items.length).toBe(2);
      expect(items[0].id).toBe(item1.id);
      expect(items[1].id).toBe(item2.id);

      // Re-adding identical item should return existing item (idempotent)
      const dup = addPlaylistItem(pl.id, track.id, seg.id);
      expect(dup.id).toBe(item2.id);
      expect(getPlaylistItems(pl.id).length).toBe(2);
    });

    it("should remove item and reorder playlist items", () => {
      const track = createTrack({
        id: "trk-10",
        source_type: "local",
        source_uri: "C:/music/1.flac",
        title: "Track 10",
        duration: 100,
        status: "ready",
      });

      const pl = createPlaylist("Reorder Test");
      const item1 = addPlaylistItem(pl.id, track.id);
      const seg = createSegment({ id: "seg-10", track_id: "trk-10", name: "Solo", start_time: 10, end_time: 20 });
      const item2 = addPlaylistItem(pl.id, track.id, seg.id);

      // Reorder items
      expect(reorderPlaylistItems(pl.id, [item2.id, item1.id])).toBe(true);
      const reordered = getPlaylistItems(pl.id);
      expect(reordered[0].id).toBe(item2.id);
      expect(reordered[1].id).toBe(item1.id);

      // Remove an item
      expect(removePlaylistItem(pl.id, item1.id)).toBe(true);
      const remaining = getPlaylistItems(pl.id);
      expect(remaining.length).toBe(1);
      expect(remaining[0].id).toBe(item2.id);
    });

    it("should cascade delete playlist items when track, segment, or playlist is deleted", () => {
      const track = createTrack({
        id: "trk-del",
        source_type: "youtube",
        source_uri: "https://youtube.com/watch?v=del",
        title: "Delete Me",
        duration: 150,
        status: "ready",
      });

      const seg = createSegment({ id: "seg-del", track_id: "trk-del", name: "Part", start_time: 0, end_time: 30 });

      const pl = createPlaylist("Cascade Test");
      addPlaylistItem(pl.id, track.id);
      addPlaylistItem(pl.id, track.id, seg.id);

      expect(getPlaylistItems(pl.id).length).toBe(2);

      // Deleting segment should cascade delete only the segment item, leaving full-track item
      deleteSegment(seg.id);
      const itemsAfterSegDel = getPlaylistItems(pl.id);
      expect(itemsAfterSegDel.length).toBe(1);
      expect(itemsAfterSegDel[0].segment_id).toBeNull();

      // Deleting track should cascade delete remaining playlist items referencing it
      deleteTrack(track.id);
      expect(getPlaylistItems(pl.id).length).toBe(0);

      // Deleting playlist should remove the playlist itself cleanly
      deletePlaylist(pl.id);
      expect(getPlaylist(pl.id)).toBeNull();
    });

    it("deleteTracksBatch should delete multiple tracks atomically", () => {
      createTrack({ id: "trk-b1", source_type: "local", source_uri: "f1", title: "T1", duration: 100, status: "ready" });
      createTrack({ id: "trk-b2", source_type: "local", source_uri: "f2", title: "T2", duration: 100, status: "ready" });
      createTrack({ id: "trk-b3", source_type: "local", source_uri: "f3", title: "T3", duration: 100, status: "ready" });

      const count = deleteTracksBatch(["trk-b1", "trk-b2"]);
      expect(count).toBe(2);
      expect(getTrack("trk-b1")).toBeNull();
      expect(getTrack("trk-b2")).toBeNull();
      expect(getTrack("trk-b3")).not.toBeNull();
    });

    it("addPlaylistItemsBatch should insert multiple tracks with correct sort order and skip duplicates", () => {
      const pl = createPlaylist("Batch Playlist");
      createTrack({ id: "trk-bp1", source_type: "local", source_uri: "f1", title: "T1", duration: 100, status: "ready" });
      createTrack({ id: "trk-bp2", source_type: "local", source_uri: "f2", title: "T2", duration: 100, status: "ready" });

      const added = addPlaylistItemsBatch(pl.id, [
        { trackId: "trk-bp1" },
        { trackId: "trk-bp2" },
        { trackId: "trk-bp1" }, // Duplicate in same batch
      ]);

      expect(added.length).toBe(3); // returns 3 items (2 new, 1 existing)
      const items = getPlaylistItems(pl.id);
      expect(items.length).toBe(2); // DB only has 2 unique items
      expect(items[0].track_id).toBe("trk-bp1");
      expect(items[1].track_id).toBe("trk-bp2");
      expect(items[0].sort_order).toBe(0);
      expect(items[1].sort_order).toBe(1);
    });

    it("removePlaylistItemsBatch removes multiple items atomically", () => {
      const track = createTrack({ id: "trk-rb1", title: "Track RB", duration: 100, file_path: "p", source_type: "local", source_uri: "local://p", status: "ready" });
      const pl = createPlaylist("PL Batch Remove");
      const i1 = addPlaylistItem(pl.id, track.id);
      const seg = createSegment({ id: "seg-rb1", track_id: track.id, name: "Seg", start_time: 0, end_time: 10, color: "c", sort_order: 0 });
      const i2 = addPlaylistItem(pl.id, track.id, seg.id);

      expect(getPlaylistItems(pl.id).length).toBe(2);

      const deletedCount = removePlaylistItemsBatch(pl.id, [i1.id, i2.id]);
      expect(deletedCount).toBe(2);
      expect(getPlaylistItems(pl.id).length).toBe(0);
    });
  });

  describe("deleteSegmentsBatch", () => {
    it("deletes multiple segments atomically", () => {
      const track = createTrack({ id: "trk-sb1", title: "Track SB", duration: 100, file_path: "p", source_type: "local", source_uri: "local://p", status: "ready" });
      const s1 = createSegment({ id: "seg-sb1", track_id: track.id, name: "S1", start_time: 0, end_time: 10, color: "c", sort_order: 0 });
      const s2 = createSegment({ id: "seg-sb2", track_id: track.id, name: "S2", start_time: 10, end_time: 20, color: "c", sort_order: 1 });
      const s3 = createSegment({ id: "seg-sb3", track_id: track.id, name: "S3", start_time: 20, end_time: 30, color: "c", sort_order: 2 });

      expect(listSegmentsByTrack(track.id).length).toBe(3);

      const count = deleteSegmentsBatch([s1.id, s3.id]);
      expect(count).toBe(2);

      const remaining = listSegmentsByTrack(track.id);
      expect(remaining.length).toBe(1);
      expect(remaining[0].id).toBe(s2.id);
    });
  });

  describe("getPlaylistMemberships", () => {
    it("returns correct playlist memberships for tracks and segments", () => {
      const track1 = createTrack({ id: "trk-m1", title: "Track M1", duration: 100, file_path: "p", source_type: "local", source_uri: "local://p", status: "ready" });
      const track2 = createTrack({ id: "trk-m2", title: "Track M2", duration: 100, file_path: "p", source_type: "local", source_uri: "local://p", status: "ready" });
      const seg1 = createSegment({ id: "seg-m1", track_id: track1.id, name: "Seg M1", start_time: 0, end_time: 10, color: "c", sort_order: 0 });

      const pl1 = createPlaylist("PL Alpha");
      const pl2 = createPlaylist("PL Beta");

      // Track 1 (full track) in pl1
      const item1 = addPlaylistItem(pl1.id, track1.id);
      // Track 1 (seg 1) in pl2
      const item2 = addPlaylistItem(pl2.id, track1.id, seg1.id);

      const membershipsTrack1 = getPlaylistMemberships(track1.id);
      expect(membershipsTrack1.length).toBe(1);
      expect(membershipsTrack1[0].playlist_id).toBe(pl1.id);
      expect(membershipsTrack1[0].item_id).toBe(item1.id);

      const membershipsSeg1 = getPlaylistMemberships(track1.id, seg1.id);
      expect(membershipsSeg1.length).toBe(1);
      expect(membershipsSeg1[0].playlist_id).toBe(pl2.id);
      expect(membershipsSeg1[0].item_id).toBe(item2.id);

      // Track 2 is not in any playlist
      const membershipsTrack2 = getPlaylistMemberships(track2.id);
      expect(membershipsTrack2.length).toBe(0);
    });
  });
});

