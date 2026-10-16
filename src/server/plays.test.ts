import { describe, it, expect, beforeEach, afterAll } from "bun:test";
import { initDatabase, closeDatabase, getDb, createTrack, createSegment, createPlaylist, deletePlaylist, deleteTrack, deleteSegment } from "./db";
import { getHomeSummary, parsePlayRecord, recordPlay } from "./plays";
import type { PlayRecord, Track } from "./types";
import { unlinkSync, existsSync } from "node:fs";

const TEST_DB_PATH = "./data/test_plays.db";
const DAY = 24 * 60 * 60;
const NOW = 1_800_000_000;

function addTrack(id: string, status: Track["status"] = "ready") {
  return createTrack({ id, source_type: "local", source_uri: `C:/music/${id}.mp3`, title: id, artist: "", duration: 200, status });
}

// A play of the whole song from the Tracks page, unless told otherwise
function play(trackId: string, daysAgo = 0, overrides: Partial<PlayRecord> = {}) {
  const recorded = recordPlay({ track_id: trackId, segment_id: null, source_type: "original_only", playlist_id: null, via_home: false, ...overrides });
  getDb().query("UPDATE plays SET played_at = $at WHERE id = (SELECT MAX(id) FROM plays)").run({ $at: NOW - daysAgo * DAY });
  return recorded;
}

const fromPlaylist = (playlistId: string): Partial<PlayRecord> => ({ source_type: "playlist", playlist_id: playlistId });

describe("Play history for Home", () => {
  beforeEach(() => {
    const db = initDatabase(TEST_DB_PATH);
    db.run("DELETE FROM plays; DELETE FROM playlist_sources; DELETE FROM playlist_items; DELETE FROM playlists; DELETE FROM segments; DELETE FROM tracks;");
    for (const id of ["t1", "t2", "t3"]) addTrack(id);
    createSegment({ id: "s1", track_id: "t1", name: "Chorus", start_time: 30, end_time: 90 });
  });

  afterAll(() => {
    closeDatabase();
    for (const suffix of ["", "-wal", "-shm"]) {
      if (existsSync(TEST_DB_PATH + suffix)) unlinkSync(TEST_DB_PATH + suffix);
    }
  });

  it("counts a slice's plays toward its song in Heavy Rotation", () => {
    play("t1");
    play("t1", 0, { segment_id: "s1", source_type: "slices_only" });
    play("t2");

    expect(getHomeSummary(NOW).heavy_rotation).toEqual([
      { track_id: "t1", plays: 2 },
      { track_id: "t2", plays: 1 },
    ]);
  });

  it("ranks Heavy Rotation by plays in the past 30 days only", () => {
    for (let i = 0; i < 3; i++) play("t1", 31);
    play("t2", 1);
    play("t2", 2);
    play("t3", 29);

    expect(getHomeSummary(NOW).heavy_rotation.map((song) => song.track_id)).toEqual(["t2", "t3"]);
  });

  it("keeps Heavy Rotation to 25 songs", () => {
    for (let i = 0; i < 26; i++) {
      addTrack(`many${i}`);
      play(`many${i}`);
    }

    expect(getHomeSummary(NOW).heavy_rotation).toHaveLength(25);
  });

  it("leaves songs that can't play out of Heavy Rotation", () => {
    play("t1");
    getDb().run("UPDATE tracks SET status = 'error' WHERE id = 't1'");

    expect(getHomeSummary(NOW).heavy_rotation).toEqual([]);
  });

  it("lists each playlist or library page once in Recently Played, latest first, without Home's own lists", () => {
    const road = createPlaylist("Road");
    play("t1", 3, fromPlaylist(road.id));
    play("t2", 2);
    play("t3", 1, fromPlaylist(road.id));
    play("t1", 0, { source_type: "home", via_home: true });

    expect(getHomeSummary(NOW).recently_played).toEqual([
      { source_type: "playlist", playlist_id: road.id },
      { source_type: "original_only", playlist_id: null },
    ]);
  });

  it("ranks Top Playlists by plays in the past 30 days", () => {
    const road = createPlaylist("Road");
    const gym = createPlaylist("Gym");
    play("t1", 1, fromPlaylist(road.id));
    play("t1", 1, fromPlaylist(gym.id));
    play("t2", 2, fromPlaylist(gym.id));
    for (let i = 0; i < 3; i++) play("t3", 40, fromPlaylist(road.id));
    play("t2", 0);

    expect(getHomeSummary(NOW).top_playlists).toEqual([
      { playlist_id: gym.id, plays: 2 },
      { playlist_id: road.id, plays: 1 },
    ]);
  });

  it("drops a deleted playlist from the shelves but still counts its plays for the songs", () => {
    const road = createPlaylist("Road");
    play("t1", 0, fromPlaylist(road.id));
    deletePlaylist(road.id);

    const summary = getHomeSummary(NOW);
    expect(summary.recently_played).toEqual([]);
    expect(summary.top_playlists).toEqual([]);
    expect(summary.heavy_rotation).toEqual([{ track_id: "t1", plays: 1 }]);
  });

  it("still counts a slice deleted while it played, for its song", () => {
    deleteSegment("s1");
    expect(play("t1", 0, { segment_id: "s1", source_type: "slices_only" })).toBe(true);

    expect(getHomeSummary(NOW).heavy_rotation).toEqual([{ track_id: "t1", plays: 1 }]);
  });

  it("forgets a deleted song's plays, and records none for a song that's gone", () => {
    play("t1");
    deleteTrack("t1");

    expect(play("t1")).toBe(false);
    expect(getDb().query("SELECT COUNT(*) AS n FROM plays").get()).toEqual({ n: 0 });
  });
});

describe("parsePlayRecord", () => {
  const valid = { track_id: "t1", segment_id: "s1", source_type: "playlist", playlist_id: "p1", via_home: true };

  it("accepts a play as the client sends it", () => {
    expect(parsePlayRecord(valid)).toEqual(valid as PlayRecord);
  });

  it("rejects a source it doesn't know, or a playlist play without its playlist", () => {
    expect(parsePlayRecord({ ...valid, source_type: "radio" })).toBeNull();
    expect(parsePlayRecord({ ...valid, playlist_id: null })).toBeNull();
    expect(parsePlayRecord({ ...valid, track_id: 1 })).toBeNull();
    expect(parsePlayRecord(null)).toBeNull();
  });

  it("keeps a playlist only on plays credited to one", () => {
    expect(parsePlayRecord({ ...valid, source_type: "mixed" })).toEqual({ ...valid, source_type: "mixed", playlist_id: null } as PlayRecord);
  });
});
