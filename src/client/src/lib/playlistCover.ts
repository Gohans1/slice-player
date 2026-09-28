import type { Playlist } from "@/server/types";

export type PlaylistCover =
  | { kind: "single"; url: string }
  | { kind: "mosaic"; urls: string[] }
  | { kind: "empty" };

export function resolvePlaylistCover(playlist: Pick<Playlist, "cover_url" | "mosaic_urls">): PlaylistCover {
  if (playlist.cover_url) return { kind: "single", url: playlist.cover_url };
  const urls = playlist.mosaic_urls ?? [];
  if (urls.length >= 4) return { kind: "mosaic", urls: urls.slice(0, 4) };
  if (urls.length > 0) return { kind: "single", url: urls[0] };
  return { kind: "empty" };
}
