import type { Playlist } from "@/server/types";

/** True when the playlist shown as `viewId` displays items stored in `changedId` (itself, or a mix sourcing it). */
export function showsItemsOf(viewId: string | null | undefined, changedId: string, playlists: Playlist[]): boolean {
  if (!viewId) return false;
  if (viewId === changedId) return true;
  return Boolean(playlists.find((p) => p.id === viewId)?.source_ids?.includes(changedId));
}

/** A mix plays two or more playlists that aren't mixes themselves. */
export function canStartMix(playlists: Playlist[]): boolean {
  return playlists.filter((p) => !p.is_mix).length >= 2;
}

export function defaultMixName(names: string[]): string {
  const [first = "", second = ""] = names;
  const rest = names.length > 2 ? ` + ${names.length - 2}` : "";
  return `${first} + ${second}${rest}`.slice(0, 100);
}
