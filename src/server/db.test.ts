import { describe, it, expect, beforeEach, afterAll } from "bun:test";
import { initDatabase, createTrack, getTrack, deleteTrack, createSegment, listSegmentsByTrack, updateSegment } from "./db";
import { unlinkSync, existsSync } from "node:fs";

const TEST_DB_PATH = "./data/test_music.db";

describe("Database layer (bun:sqlite)", () => {
  beforeEach(() => {
    const db = initDatabase(TEST_DB_PATH);
    db.run("DELETE FROM segments; DELETE FROM tracks;");
  });

  afterAll(() => {
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
});
