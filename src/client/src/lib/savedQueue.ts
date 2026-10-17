import type { PlaySource, Segment, Track } from "@/server/types";
import type { PlayerState, QueueItem } from "../store/usePlayerStore";
import { createDefaultFullSegment } from "./utils";

// Like Music on Mac, the queue outlives the app: the songs, where they play from, and how far into the current one
const SAVED_QUEUE_KEY = "slice_player_queue";

type QueueState = Pick<
  PlayerState,
  | "playbackMode"
  | "queueOrigin"
  | "activePlaylistPlayingId"
  | "isShuffle"
  | "isLoopQueue"
  | "isLoopTrack"
  | "queue"
  | "activePlaylistOriginalQueue"
  | "queueIndex"
  | "currentTime"
>;

// An entry by ids: the songs and slices themselves are the library's, read again on startup
interface SavedEntry {
  id?: string;
  trackId: string;
  segmentId: string;
  userQueued?: boolean;
  source?: PlaySource;
}

type SavedQueue = Omit<QueueState, "queue" | "activePlaylistOriginalQueue"> & {
  queue: SavedEntry[];
  activePlaylistOriginalQueue: SavedEntry[];
};

export type RestoredQueue = QueueState & Pick<PlayerState, "activeTrack" | "activeSegment">;

function toEntry({ queueItemId, track, segment, userQueued, source }: QueueItem): SavedEntry {
  return { id: queueItemId, trackId: track.id, segmentId: segment.id, userQueued, source };
}

export function saveQueue(state: QueueState): void {
  const saved: SavedQueue = {
    playbackMode: state.playbackMode,
    queueOrigin: state.queueOrigin,
    activePlaylistPlayingId: state.activePlaylistPlayingId,
    isShuffle: state.isShuffle,
    isLoopQueue: state.isLoopQueue,
    isLoopTrack: state.isLoopTrack,
    queue: state.queue.map(toEntry),
    activePlaylistOriginalQueue: state.activePlaylistOriginalQueue.map(toEntry),
    queueIndex: state.queueIndex,
    currentTime: state.currentTime,
  };
  try {
    window.localStorage.setItem(SAVED_QUEUE_KEY, JSON.stringify(saved));
  } catch {
    // Storage full or blocked: the queue just isn't kept for next time
  }
}

function readSavedQueue(): SavedQueue | null {
  try {
    const raw = window.localStorage.getItem(SAVED_QUEUE_KEY);
    const saved: unknown = raw ? JSON.parse(raw) : null;
    // Written by saveQueue, so a save with its entries is taken as one
    return typeof saved === "object" && saved !== null && "queue" in saved && Array.isArray(saved.queue) ? (saved as SavedQueue) : null;
  } catch {
    return null;
  }
}

// The saved queue against the library as it is now: songs deleted since are left out. When the current song is gone,
// the one after it is next, from its start
export function loadSavedQueue(tracks: Track[], segments: Segment[]): RestoredQueue | null {
  const saved = readSavedQueue();
  if (!saved) return null;

  const playable = new Map(tracks.filter((t) => t.status === "ready" && t.duration > 0).map((t) => [t.id, t]));
  const slices = new Map(segments.map((s) => [s.id, s]));
  const toItem = ({ id, trackId, segmentId, userQueued, source }: SavedEntry): QueueItem | null => {
    const track = playable.get(trackId);
    const segment = segmentId.startsWith("fallback_") ? track && createDefaultFullSegment(track) : slices.get(segmentId);
    if (!track || !segment) return null;
    return { queueItemId: id, segment, track, ...(userQueued ? { userQueued, source } : {}) };
  };

  const queue: QueueItem[] = [];
  let queueIndex = -1;
  let isSameSong = false;
  saved.queue.forEach((savedEntry, i) => {
    const item = toItem(savedEntry);
    if (!item) return;
    if (queueIndex === -1 && saved.queueIndex >= 0 && i >= saved.queueIndex) {
      queueIndex = queue.length;
      isSameSong = i === saved.queueIndex;
    }
    queue.push(item);
  });
  if (queue.length === 0) return null;
  // The current song and every one after it are gone: the last one left is current
  if (queueIndex === -1 && saved.queueIndex >= 0) queueIndex = queue.length - 1;

  const current = queue[queueIndex];
  const segment = current?.segment ?? null;
  const isTimeInSlice = segment && isSameSong && saved.currentTime >= segment.start_time && saved.currentTime < segment.end_time;
  return {
    playbackMode: saved.playbackMode,
    queueOrigin: saved.queueOrigin,
    activePlaylistPlayingId: saved.activePlaylistPlayingId,
    isShuffle: saved.isShuffle,
    isLoopQueue: saved.isLoopQueue,
    isLoopTrack: saved.isLoopTrack,
    queue,
    activePlaylistOriginalQueue: (saved.activePlaylistOriginalQueue ?? []).flatMap((it) => toItem(it) ?? []),
    queueIndex,
    activeTrack: current?.track ?? null,
    activeSegment: segment,
    currentTime: isTimeInSlice ? saved.currentTime : (segment?.start_time ?? 0),
  };
}
