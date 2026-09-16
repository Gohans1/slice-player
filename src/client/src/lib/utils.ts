import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Track, Segment } from "@/server/types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}.${ms}`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function createDefaultFullSegment(track: Track): Segment {
  return {
    id: `fallback_${track.id}`,
    track_id: track.id,
    name: "Toàn bài",
    start_time: 0,
    end_time: track.duration,
    color: "#4385BE",
    sort_order: 0,
  };
}
