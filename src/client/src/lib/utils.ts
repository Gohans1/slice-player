import type { Track, Segment } from "@/server/types";
import i18n from "../i18n";

export { cn } from "cn";

// Flexoki blue, shown for slices saved without a color of their own
export const DEFAULT_SLICE_COLOR = "#4385BE";

// Hidden until hover on mouse and trackpad; touch screens can't hover, so they always show.
// A menu opened from inside keeps it visible: the pointer has moved into the popup, so it no longer hovers the row.
export const REVEAL_ON_HOVER =
  "transition-opacity pointer-fine:opacity-0 group-hover:opacity-100 focus-within:opacity-100 has-data-popup-open:opacity-100";

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00.0";
  const totalTenths = Math.round(seconds * 10);
  const mins = Math.floor(totalTenths / 600);
  const secs = Math.floor((totalTenths % 600) / 10);
  const tenths = totalTenths % 10;
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}.${tenths}`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function createDefaultFullSegment(track: Track): Segment {
  const validDuration = Math.max(0.5, track.duration || 0);
  return {
    id: `fallback_${track.id}`,
    track_id: track.id,
    name: i18n.t("table.fullTrack", "Full Track"),
    start_time: 0,
    end_time: validDuration,
    color: "#4385BE",
    sort_order: 0,
  };
}

// No segment, or the synthetic `fallback_` one, means the whole track is playing rather than one of its slices
export function isFullTrackSegment(segment: Pick<Segment, "id"> | null | undefined): boolean {
  return !segment || segment.id.startsWith("fallback_");
}

export function compareDownloadingTracks(a: Track, b: Track): number {
  if (a.status === "downloading" && b.status !== "downloading") return -1;
  if (b.status === "downloading" && a.status !== "downloading") return 1;
  const idxA = typeof a.download_index === "number" && Number.isFinite(a.download_index) ? a.download_index : Number.MAX_SAFE_INTEGER;
  const idxB = typeof b.download_index === "number" && Number.isFinite(b.download_index) ? b.download_index : Number.MAX_SAFE_INTEGER;
  if (idxA !== idxB) {
    return idxA - idxB;
  }
  const timeA = a.created_at || 0;
  const timeB = b.created_at || 0;
  if (timeA !== timeB) return timeA - timeB;
  return a.id.localeCompare(b.id);
}
