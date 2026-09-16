import { describe, it, expect, beforeEach, afterAll } from "bun:test";
import { initDatabase, closeDatabase, createTrack, getTrack, updateTrack, deleteTrack, listTracks, createSegment, listSegmentsByTrack, updateSegment, validateVolume } from "./db";
import { unlinkSync, existsSync } from "node:fs";

const TEST_DB_PATH = "./data/test_music.db";

describe("Database layer (bun:sqlite)", () => {
  beforeEach(() => {
    const db = initDatabase(TEST_DB_PATH);
    db.run("DELETE FROM segments; DELETE FROM tracks;");
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

    // 2. Default volume when omitted is 0.8
    const defaultTrack = createTrack({
      id: "track-default-vol",
      source_type: "youtube",
      source_uri: "https://youtube.com/watch?v=def",
      title: "Default Volume Test",
      duration: 60,
      status: "ready",
    });
    expect(defaultTrack.volume).toBe(0.8);
    expect(getTrack("track-default-vol")?.volume).toBe(0.8);

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
    expect(listed?.volume).toBe(0.8);
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
});

