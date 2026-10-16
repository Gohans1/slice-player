import { describe, expect, it } from "bun:test";
import { homeShelvesOf } from "./home";
import type { HomeSummary, Playlist, Track } from "@/server/types";

const track = (id: string, created_at: number, status: Track["status"] = "ready"): Track => ({
  id,
  title: id,
  duration: 200,
  source_type: "youtube",
  source_uri: id,
  status,
  created_at,
});
const playlist = (id: string): Playlist & { item_count: number } => ({ id, name: id, created_at: 1, updated_at: 1, item_count: 2 });

const tracks = [track("old", 1), track("new", 3), track("failed", 4, "error"), track("mid", 2)];
const playlists = [playlist("road"), playlist("gym")];
const noPlays: HomeSummary = { recently_played: [], heavy_rotation: [], top_playlists: [] };

describe("homeShelvesOf", () => {
  it("fills the shelves from listening history, leaving out what has gone from the library", () => {
    const shelves = homeShelvesOf(
      {
        recently_played: [
          { source_type: "playlist", playlist_id: "gone" },
          { source_type: "original_only", playlist_id: null },
          { source_type: "playlist", playlist_id: "gym" },
        ],
        heavy_rotation: [
          { track_id: "mid", plays: 4 },
          { track_id: "deleted", plays: 3 },
          { track_id: "old", plays: 1 },
        ],
        top_playlists: [
          { playlist_id: "road", plays: 5 },
          { playlist_id: "gone", plays: 2 },
        ],
      },
      tracks,
      playlists
    );

    expect(shelves.recentlyPlayed).toEqual([
      { type: "page", mode: "original_only" },
      { type: "playlist", playlist: playlists[1] },
    ]);
    expect(shelves.heavyRotation.map((song) => [song.track.id, song.plays])).toEqual([
      ["mid", 4],
      ["old", 1],
    ]);
    expect(shelves.topPlaylists).toEqual([playlists[0]]);
  });

  it("lists the songs added last that can play, newest first", () => {
    const { recentlyAdded } = homeShelvesOf(noPlays, tracks, playlists);

    expect(recentlyAdded.map((song) => song.id)).toEqual(["new", "mid", "old"]);
  });

  it("keeps Recently Added to 25 songs", () => {
    const many = Array.from({ length: 30 }, (_, i) => track(`t${i}`, i));

    expect(homeShelvesOf(noPlays, many, []).recentlyAdded).toHaveLength(25);
  });

  it("has no history to show before Home has loaded it", () => {
    const shelves = homeShelvesOf(null, tracks, playlists);

    expect([shelves.recentlyPlayed, shelves.heavyRotation, shelves.topPlaylists]).toEqual([[], [], []]);
    expect(shelves.recentlyAdded).toHaveLength(3);
  });
});
