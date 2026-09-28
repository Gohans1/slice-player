import { describe, it, expect, beforeEach, afterAll } from "bun:test";
import {
  initDatabase,
  closeDatabase,
  createTrack,
  createPlaylist,
  createSegment,
  addPlaylistItemsBatch,
  deleteTracksBatch,
  removePlaylistItemsBatch,
  getPlaylistItems,
  getTracksBatch,
  listSegmentsByTrackIds,
  listTracks,
} from "./db";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const TEST_DIR = "./data/test_perf_sandbox";
const TEST_DB = join(TEST_DIR, "music.db");

describe("Batch Operations & Database Performance", () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
    mkdirSync(TEST_DIR, { recursive: true });
    const db = initDatabase(TEST_DB);
    db.run("DELETE FROM playlist_items; DELETE FROM playlists; DELETE FROM segments; DELETE FROM tracks;");
  });

  afterAll(() => {
    closeDatabase();
    if (existsSync(TEST_DIR)) {
      try { rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
    }
  });

  it("should batch insert 500 playlist items efficiently without individual N+1 lookups", () => {
    const pl = createPlaylist("Perf Playlist");
    expect(pl).not.toBeNull();

    // Create 100 tracks
    for (let i = 0; i < 100; i++) {
      createTrack({
        id: `trk_perf_${i}`,
        source_type: "local",
        source_uri: `file:///music/track_${i}.mp3`,
        title: `Track ${i}`,
        artist: "Perf Artist",
        duration: 120,
        status: "ready",
      });
    }

    const itemsToAdd = Array.from({ length: 500 }, (_, i) => ({
      trackId: `trk_perf_${i % 100}`,
      segmentId: null,
    }));

    const start = performance.now();
    const result = addPlaylistItemsBatch(pl!.id, itemsToAdd);
    const duration = performance.now() - start;

    expect(result.length).toBe(500); // 500 items processed
    expect(duration).toBeLessThan(1000); // Must be fast (< 1s for 500 items)

    const plItems = getPlaylistItems(pl!.id);
    expect(plItems.length).toBe(100); // 100 unique items in DB
  });

  it("should batch delete 200 tracks in chunked queries efficiently", () => {
    const trackIds: string[] = [];
    for (let i = 0; i < 200; i++) {
      const id = `trk_del_${i}`;
      trackIds.push(id);
      createTrack({
        id,
        source_type: "local",
        source_uri: `file:///music/track_del_${i}.mp3`,
        title: `Track Del ${i}`,
        duration: 120,
        status: "ready",
      });
    }

    const start = performance.now();
    const deletedCount = deleteTracksBatch(trackIds);
    const duration = performance.now() - start;

    expect(deletedCount).toBe(200);
    expect(duration).toBeLessThan(500); // Must complete quickly in chunked batch
  });

  it("should have indexes on tracks(created_at DESC) and tracks(status) to accelerate polling and sorting", () => {
    const db = initDatabase(TEST_DB);
    const indexes = db.query("PRAGMA index_list(tracks);").all() as { name: string }[];
    const indexNames = indexes.map((idx) => idx.name);

    expect(indexNames).toContain("idx_tracks_created_at");
    expect(indexNames).toContain("idx_tracks_status");

    // Verify query plan uses index for ORDER BY created_at
    const plan = db.query("EXPLAIN QUERY PLAN SELECT id FROM tracks ORDER BY created_at DESC;").all() as { detail: string }[];
    const usesIndex = plan.some((p) => p.detail.includes("idx_tracks_created_at") || p.detail.includes("USING INDEX"));
    expect(usesIndex).toBe(true);
  });

  it("should bulk prefetch tracks and segments via getTracksBatch and listSegmentsByTrackIds in chunks", () => {
    const trackIds: string[] = [];
    for (let i = 0; i < 50; i++) {
      const id = `trk_batch_fetch_${i}`;
      trackIds.push(id);
      createTrack({
        id,
        source_type: "local",
        source_uri: `file:///music/batch_${i}.mp3`,
        title: `Batch Track ${i}`,
        duration: 180,
        status: "ready",
      });
      createSegment({
        id: `seg_a_${i}`,
        track_id: id,
        name: `Seg A ${i}`,
        start_time: 10,
        end_time: 20,
      });
      createSegment({
        id: `seg_b_${i}`,
        track_id: id,
        name: `Seg B ${i}`,
        start_time: 30,
        end_time: 40,
      });
    }


    const fetchedTracks = getTracksBatch(trackIds);
    expect(fetchedTracks.length).toBe(50);
    expect(fetchedTracks[0].file_path).toBeDefined();

    const fetchedSegments = listSegmentsByTrackIds(trackIds);
    expect(fetchedSegments.length).toBe(100);
    expect(fetchedSegments[0].track_id).toBeDefined();
  });

  it("should execute listTracks() without temporary B-tree sorting using idx_tracks_created_at", () => {
    const db = initDatabase(TEST_DB);
    const plan = db.query(`
      EXPLAIN QUERY PLAN
      SELECT tracks.id, tracks.source_type, tracks.source_uri, tracks.title,
             tracks.artist, tracks.duration, tracks.thumbnail_url, tracks.file_path,
             tracks.status, tracks.error_message, tracks.volume, tracks.created_at,
             (SELECT COUNT(*) FROM segments WHERE segments.track_id = tracks.id) AS segment_count
      FROM tracks
      ORDER BY tracks.created_at DESC
    `).all() as { detail: string }[];

    const hasTempBTree = plan.some((p) => p.detail.includes("USE TEMP B-TREE"));
    const usesCreatedAtIndex = plan.some((p) => p.detail.includes("idx_tracks_created_at"));

    expect(hasTempBTree).toBe(false);
    expect(usesCreatedAtIndex).toBe(true);
  });
});

