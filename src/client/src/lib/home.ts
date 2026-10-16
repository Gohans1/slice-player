import type { HomeSummary, Playlist, Track } from "@/server/types";
import type { PlaybackMode } from "../store/usePlayerStore";

type ListedPlaylist = Playlist & { item_count: number };

export type RecentlyPlayed = { type: "playlist"; playlist: ListedPlaylist } | { type: "page"; mode: PlaybackMode };

export interface HomeShelves {
  recentlyPlayed: RecentlyPlayed[];
  heavyRotation: { track: Track; plays: number }[];
  topPlaylists: ListedPlaylist[];
  recentlyAdded: Track[];
}

const RECENTLY_ADDED_SIZE = 25;

// Home's shelves from its listening history and the library; anything since deleted, or that can't play, is left out
export function homeShelvesOf(summary: HomeSummary | null, tracks: Track[], playlists: ListedPlaylist[]): HomeShelves {
  const playlistById = new Map(playlists.map((playlist) => [playlist.id, playlist]));
  const playable = tracks.filter((track) => track.status === "ready");
  const playableById = new Map(playable.map((track) => [track.id, track]));

  const recentlyPlayed: RecentlyPlayed[] = [];
  for (const { source_type, playlist_id } of summary?.recently_played ?? []) {
    if (source_type !== "playlist") {
      recentlyPlayed.push({ type: "page", mode: source_type });
      continue;
    }
    const playlist = playlist_id ? playlistById.get(playlist_id) : undefined;
    if (playlist) recentlyPlayed.push({ type: "playlist", playlist });
  }

  return {
    recentlyPlayed,
    heavyRotation: (summary?.heavy_rotation ?? []).flatMap(({ track_id, plays }) => {
      const track = playableById.get(track_id);
      return track ? [{ track, plays }] : [];
    }),
    topPlaylists: (summary?.top_playlists ?? []).flatMap(({ playlist_id }) => playlistById.get(playlist_id) ?? []),
    recentlyAdded: playable.toSorted((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0)).slice(0, RECENTLY_ADDED_SIZE),
  };
}
