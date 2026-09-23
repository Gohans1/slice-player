import { create } from "zustand";
import { audioEngine } from "../lib/audio";
import { createDefaultFullSegment } from "../lib/utils";
import { pickSmartRandomItem } from "../lib/shufflePicker";
import { logClientInfo, logClientError } from "./useLogStore";
import { useSelectionStore } from "./useSelectionStore";
import type { Track, Segment, Playlist, PlaylistItem, PlaylistItemWithDetails } from "@/server/types";
export type { Track, Segment, Playlist, PlaylistItem, PlaylistItemWithDetails };


export interface QueueItem {
  queueItemId?: string;
  segment: Segment;
  track: Track;
}

let nextQueueItemCounter = 0;
export function createQueueItem(segment: Segment, track: Track, queueItemId?: string): QueueItem {
  return {
    queueItemId:
      queueItemId ||
      (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `qi_${Date.now()}_${++nextQueueItemCounter}`),
    segment,
    track,
  };
}

export type PlaybackMode = "mixed" | "slices_only" | "original_only";
export type SystemCategory = PlaybackMode | "downloading_only" | "error_only";

export function isPlaybackMode(cat: unknown): cat is PlaybackMode {
  return cat === "mixed" || cat === "slices_only" || cat === "original_only";
}

let consecutivePlaybackFailures = 0;
export const dismissedSegmentIdsByMode: Record<PlaybackMode, Set<string>> = {
  mixed: new Set<string>(),
  slices_only: new Set<string>(),
  original_only: new Set<string>(),
};

export const dismissedTrackIdsByMode: Record<PlaybackMode, Set<string>> = {
  mixed: new Set<string>(),
  slices_only: new Set<string>(),
  original_only: new Set<string>(),
};

const inFlightEnsureModeFetches = new Set<PlaybackMode>();

export function clearDismissedSegments(mode?: PlaybackMode) {
  if (mode) {
    dismissedSegmentIdsByMode[mode].clear();
    dismissedTrackIdsByMode[mode].clear();
  } else {
    dismissedSegmentIdsByMode.mixed.clear();
    dismissedSegmentIdsByMode.slices_only.clear();
    dismissedSegmentIdsByMode.original_only.clear();
    dismissedTrackIdsByMode.mixed.clear();
    dismissedTrackIdsByMode.slices_only.clear();
    dismissedTrackIdsByMode.original_only.clear();
  }
}

export const shuffleHistory = new Map<string, number>();
export let shuffleTurnCounter = 0;
export function clearShuffleHistory() {
  shuffleHistory.clear();
  shuffleTurnCounter = 0;
}

let activeInitiationCount = 0;
let autoSkipTimer: ReturnType<typeof setTimeout> | null = null;
let latestPlaybackModeRequestId = 0;
let latestFetchTracksRequestId = 0;

export function normalizeTrackVolume(vol: unknown, fallback = 0.5): number {
  const safeFallback = typeof fallback === "number" && Number.isFinite(fallback)
    ? Math.max(0, Math.min(1, fallback))
    : 0.5;
  return typeof vol === "number" && Number.isFinite(vol)
    ? Math.max(0, Math.min(1, vol))
    : safeFallback;
}

interface DebounceRecord {
  timer: ReturnType<typeof setTimeout>;
  resolve: () => void;
  volume: number;
}

const trackVolumeDebounceTimers = new Map<string, DebounceRecord>();

export async function flushTrackVolume(trackId: string): Promise<void> {
  const existing = trackVolumeDebounceTimers.get(trackId);
  if (existing) {
    clearTimeout(existing.timer);
    existing.resolve();
    const vol = existing.volume;
    try {
      await fetch(`/api/tracks/${encodeURIComponent(trackId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ volume: vol }),
        keepalive: true,
      });
    } catch (e) {
      console.error("[Store] Failed to flush track volume:", e);
    } finally {
      trackVolumeDebounceTimers.delete(trackId);
    }
  }
}

function patchTrackVolumeDebounced(trackId: string, volume: number): Promise<void> {
  const existing = trackVolumeDebounceTimers.get(trackId);
  if (existing) {
    clearTimeout(existing.timer);
    existing.resolve();
    trackVolumeDebounceTimers.delete(trackId);
  }

  const safe = normalizeTrackVolume(volume, 0.5);
  const delay = typeof process !== "undefined" && process.env?.NODE_ENV === "test" ? 15 : 300;

  return new Promise((resolve) => {
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/tracks/${encodeURIComponent(trackId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ volume: safe }),
          keepalive: true,
        });
        if (!res.ok) {
          console.warn(`[Store] Server rejected track volume update (status ${res.status})`);
        }
      } catch (e) {
        console.error("[Store] Failed to update track volume:", e);
      } finally {
        trackVolumeDebounceTimers.delete(trackId);
        resolve();
      }
    }, delay);
    trackVolumeDebounceTimers.set(trackId, { timer, resolve, volume: safe });
  });
}

interface PlayerState {
  tracks: Track[];
  isLoadingTracks: boolean;
  activeTrack: Track | null;
  activeSegment: Segment | null;
  isPlaying: boolean;
  isBuffering: boolean;
  isShuffle: boolean;
  isLoopQueue: boolean;
  isLoopTrack: boolean;
  playbackMode: PlaybackMode;
  queuesByMode: Record<PlaybackMode, QueueItem[]>;
  shuffleByMode: Record<PlaybackMode, boolean>;
  initializedModes: Record<PlaybackMode, boolean>;
  currentTime: number;
  volume: number;
  queue: QueueItem[];
  queueIndex: number;
  sliceStudioTrack: Track | null;

  // Custom Playlists & View Mode
  playlists: (Playlist & { item_count: number })[];
  activePlaylistId: string | null;
  activePlaylistPlayingId: string | null;
  activePlaylistItems: PlaylistItemWithDetails[];
  activePlaylistOriginalQueue: QueueItem[];
  viewMode: "grid" | "list";
  activeSystemCategory: SystemCategory;
  retryingTrackIds: Record<string, boolean>;
  isRetryingAll: boolean;

  // Actions
  fetchTracks: (reconcileSegments?: boolean) => Promise<void>;
  retryTrack: (trackId: string) => Promise<boolean>;
  retryAllErrors: (trackIds?: string[]) => Promise<boolean>;
  playSegment: (segment: Segment, track: Track, overrideIndex?: number, seekTime?: number) => Promise<void>;
  pause: () => void;
  setBuffering: (isBuffering: boolean) => void;
  resume: () => Promise<void>;
  togglePlay: () => Promise<void>;
  nextSegment: (isAutoAdvance?: boolean) => void;
  prevSegment: () => void;
  toggleShuffle: () => void;
  toggleLoopQueue: () => void;
  toggleLoopTrack: () => void;
  setPlaybackMode: (mode: PlaybackMode) => Promise<boolean>;
  setActiveSystemCategory: (cat: SystemCategory) => void;
  playModeQueue: (mode: PlaybackMode, startIndex?: number, forceShuffle?: boolean) => Promise<void>;
  playSegmentInMode: (mode: PlaybackMode, segment: Segment, track: Track) => Promise<void>;
  setVolume: (vol: number) => void;
  setTrackVolume: (trackId: string, volume: number) => Promise<void>;
  setCurrentTime: (t: number) => void;
  seek: (seconds: number) => void;
  removeTrackFromQueue: (trackId: string) => void;
  removeSegmentFromQueue: (segmentId: string) => void;
  removeQueueItemAtIndex: (index: number, modeOverride?: PlaybackMode) => void;
  reorderQueue: (fromIndex: number, toIndex: number, modeOverride?: PlaybackMode) => void;
  openSliceStudio: (track: Track) => void;
  closeSliceStudio: () => void;
  buildShuffleQueue: (allSegments: Segment[], allTracks: Track[], modeOverride?: PlaybackMode, forceShuffle?: boolean) => void;
  reshuffleCurrentQueue: (modeOverride?: PlaybackMode) => void;
  quickShufflePlay: (allSegmentsOverride?: Segment[]) => Promise<void>;
  ensureModeQueue: (mode: PlaybackMode) => Promise<void>;
  syncUpdatedSegment: (seg: Segment) => void;

  // Playlist Actions
  fetchPlaylists: () => Promise<void>;
  setActivePlaylist: (id: string | null, force?: boolean) => Promise<void>;
  createPlaylist: (name: string) => Promise<Playlist | null>;
  deletePlaylist: (id: string) => Promise<boolean>;
  renamePlaylist: (id: string, name: string) => Promise<boolean>;
  addToPlaylist: (playlistId: string, trackId: string, segmentId?: string | null) => Promise<boolean>;
  addTracksToPlaylistBatch: (playlistId: string, itemsOrTrackIds: (string | { track_id: string; segment_id?: string | null })[]) => Promise<boolean>;
  addItemsToPlaylistBatch: (playlistId: string, itemsOrTrackIds: (string | { track_id: string; segment_id?: string | null })[]) => Promise<boolean>;
  deleteTracksBatch: (trackIds: string[]) => Promise<boolean>;
  deleteSegmentsBatch: (segmentIds: string[]) => Promise<boolean>;
  removePlaylistItemsBatch: (playlistId: string, itemIds: string[]) => Promise<boolean>;
  removeFromPlaylist: (playlistId: string, itemId: string) => Promise<boolean>;
  reorderPlaylist: (playlistId: string, itemIds: string[]) => Promise<boolean>;
  setViewMode: (mode: "grid" | "list") => void;
  buildPlaylistQueue: (playlistId: string, forceShuffle?: boolean, startIndexOrItemId?: number | string, keepCurrentTrack?: boolean) => Promise<void>;
  playPlaylistItemAtIndex: (playlistId: string, indexOrItemId: number | string) => Promise<void>;
}

function shuffleArray<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function generateModeQueueItems(
  mode: PlaybackMode,
  allSegments: Segment[],
  allTracks: Track[],
  modeDismissedSegs?: Set<string>,
  modeDismissedTracks?: Set<string>
): QueueItem[] {
  const dismissedSegs = modeDismissedSegs || dismissedSegmentIdsByMode[mode] || new Set<string>();
  const dismissedTracks = modeDismissedTracks || dismissedTrackIdsByMode[mode] || new Set<string>();

  const trackMap = new Map<string, Track>();
  const safeTracks = Array.isArray(allTracks) ? allTracks : [];
  for (const t of safeTracks) {
    if (t && t.status === "ready" && t.duration > 0 && !dismissedTracks.has(t.id)) {
      trackMap.set(t.id, t);
    }
  }

  const items: QueueItem[] = [];

  const safeSegments = Array.isArray(allSegments) ? allSegments : [];

  if (mode === "slices_only") {
    const seenSegIds = new Set<string>();
    for (const seg of safeSegments) {
      if (!seg.id.startsWith("fallback_") && !dismissedSegs.has(seg.id) && !dismissedTracks.has(seg.track_id)) {
        if (!seenSegIds.has(seg.id)) {
          seenSegIds.add(seg.id);
          const trk = trackMap.get(seg.track_id);
          if (trk) items.push(createQueueItem(seg, trk));
        }
      }
    }
  } else if (mode === "original_only") {
    for (const trk of trackMap.values()) {
      const fallbackId = `fallback_${trk.id}`;
      if (!dismissedSegs.has(fallbackId)) {
        items.push(createQueueItem(createDefaultFullSegment(trk), trk));
      }
    }
  } else {
    // "mixed"
    const seenSegIds = new Set<string>();
    for (const seg of safeSegments) {
      if (!seg.id.startsWith("fallback_") && !dismissedSegs.has(seg.id) && !dismissedTracks.has(seg.track_id)) {
        if (!seenSegIds.has(seg.id)) {
          seenSegIds.add(seg.id);
          const trk = trackMap.get(seg.track_id);
          if (trk) items.push(createQueueItem(seg, trk));
        }
      }
    }
    for (const trk of trackMap.values()) {
      const fallbackId = `fallback_${trk.id}`;
      if (!dismissedSegs.has(fallbackId)) {
        items.push(createQueueItem(createDefaultFullSegment(trk), trk));
      }
    }
  }

  return sortQueueItems(items);
}

export function sortQueueItems(items: QueueItem[]): QueueItem[] {
  return [...items].sort((a, b) => {
    const titleCmp = (a.track.title || "").localeCompare(b.track.title || "");
    if (titleCmp !== 0) return titleCmp;
    return a.segment.start_time - b.segment.start_time;
  });
}

export function reconcileSingleModeQueue(
  mode: PlaybackMode,
  existingQueue: QueueItem[],
  validSegments: Segment[],
  tracks: Track[],
  trackMap: Map<string, Track>,
  segmentMap: Set<string>,
  segmentObjMap: Map<string, Segment>,
  currentActiveSegment: Segment | null,
  newlyReadyTracks: Track[],
  isShuffle: boolean,
  modeDismissed: Set<string> = dismissedSegmentIdsByMode[mode] || new Set<string>(),
  modeDismissedTracks: Set<string> = dismissedTrackIdsByMode[mode] || new Set<string>()
): QueueItem[] {
  // 0. If there are newly ready tracks, un-dismiss them and their slices first so they can be indexed
  if (newlyReadyTracks.length > 0) {
    const newlyReadyIds = new Set(newlyReadyTracks.map((t) => t.id));
    for (const newTrack of newlyReadyTracks) {
      modeDismissedTracks.delete(newTrack.id);
      modeDismissed.delete(`fallback_${newTrack.id}`);
    }
    for (const s of validSegments) {
      if (newlyReadyIds.has(s.track_id)) {
        modeDismissed.delete(s.id);
      }
    }
  }

  if (!existingQueue || existingQueue.length === 0) {
    let items = generateModeQueueItems(mode, validSegments, tracks, modeDismissed, modeDismissedTracks);
    if (isShuffle) items = shuffleArray(items);
    return items;
  }

  // Pre-index slices by track_id for O(1) lookups instead of O(N*M) nested filters
  const slicesByTrackId = new Map<string, Segment[]>();
  for (const s of validSegments) {
    if (
      !s.id.startsWith("fallback_") &&
      trackMap.has(s.track_id) &&
      !modeDismissedTracks.has(s.track_id) &&
      !modeDismissed.has(s.id)
    ) {
      let list = slicesByTrackId.get(s.track_id);
      if (!list) {
        list = [];
        slicesByTrackId.set(s.track_id, list);
      }
      list.push(s);
    }
  }

  const validQueue: QueueItem[] = [];
  const seenSegmentIds = new Set<string>();

  // 1. Reconcile existing queue items
  for (const item of existingQueue) {
    if (!trackMap.has(item.track.id) || modeDismissedTracks.has(item.track.id)) continue;
    const freshTrack = trackMap.get(item.track.id)!;
    if (freshTrack.status !== "ready" || freshTrack.duration <= 0) continue;
    const isFallback = item.segment.id.startsWith("fallback_");

    if (isFallback) {
      if (mode === "slices_only") {
        continue;
      }
      if (!seenSegmentIds.has(item.segment.id) && (!modeDismissed.has(item.segment.id) || item.segment.id === currentActiveSegment?.id)) {
        seenSegmentIds.add(item.segment.id);
        const fallbackSeg =
          item.segment.start_time === 0 &&
          item.segment.end_time === freshTrack.duration &&
          item.segment.id === `fallback_${freshTrack.id}`
            ? item.segment
            : createDefaultFullSegment(freshTrack);
        validQueue.push(createQueueItem(fallbackSeg, freshTrack, item.queueItemId));
      }
    } else {
      if (mode === "original_only" && item.segment.id !== currentActiveSegment?.id) continue;
      if (!segmentMap.has(item.segment.id) || (modeDismissed.has(item.segment.id) && item.segment.id !== currentActiveSegment?.id)) continue;
      const freshSeg = segmentObjMap.get(item.segment.id) || item.segment;
      if (!seenSegmentIds.has(freshSeg.id)) {
        seenSegmentIds.add(freshSeg.id);
        validQueue.push(createQueueItem(freshSeg, freshTrack, item.queueItemId));
      }
    }
  }

  // 2. Append newly ready tracks
  if (newlyReadyTracks.length > 0) {
    for (const newTrack of newlyReadyTracks) {
      const trackSlices = slicesByTrackId.get(newTrack.id) || [];
      if (mode === "original_only") {
        if (!seenSegmentIds.has(`fallback_${newTrack.id}`) && !modeDismissed.has(`fallback_${newTrack.id}`)) {
          seenSegmentIds.add(`fallback_${newTrack.id}`);
          validQueue.push(createQueueItem(createDefaultFullSegment(newTrack), newTrack));
        }
      } else if (mode === "slices_only") {
        if (trackSlices.length > 0) {
          for (const s of trackSlices) {
            if (!seenSegmentIds.has(s.id) && !modeDismissed.has(s.id)) {
              seenSegmentIds.add(s.id);
              validQueue.push(createQueueItem(s, newTrack));
            }
          }
        }
      } else {
        // mixed
        if (trackSlices.length > 0) {
          for (const s of trackSlices) {
            if (!seenSegmentIds.has(s.id) && !modeDismissed.has(s.id)) {
              seenSegmentIds.add(s.id);
              validQueue.push(createQueueItem(s, newTrack));
            }
          }
        }
        if (!seenSegmentIds.has(`fallback_${newTrack.id}`) && !modeDismissed.has(`fallback_${newTrack.id}`)) {
          seenSegmentIds.add(`fallback_${newTrack.id}`);
          validQueue.push(createQueueItem(createDefaultFullSegment(newTrack), newTrack));
        }
      }
    }
  }

  // 3. Append newly cut slices for existing tracks (respecting modeDismissed)
  if (mode !== "original_only") {
    for (const seg of validSegments) {
      if (!seg.id.startsWith("fallback_") && !seenSegmentIds.has(seg.id) && !modeDismissed.has(seg.id) && !modeDismissedTracks.has(seg.track_id)) {
        const parentTrack = trackMap.get(seg.track_id);
        if (parentTrack && parentTrack.status === "ready") {
          seenSegmentIds.add(seg.id);
          validQueue.push(createQueueItem(seg, parentTrack));
        }
      }
    }
  }

  return validQueue;
}

function transitionActiveItemOnRemoval(
  set: (partial: Partial<PlayerState>) => void,
  get: () => PlayerState,
  newQueue: QueueItem[],
  targetIdx: number,
  wasPlaying: boolean,
  updatedQueuesByMode: Record<PlaybackMode, QueueItem[]>
) {
  const isPlayingPlaylist = Boolean(get().activePlaylistPlayingId);
  const finalQueuesByMode = isPlayingPlaylist ? get().queuesByMode : updatedQueuesByMode;
  audioEngine.unload();
  if (newQueue.length === 0) {
    set({
      queue: [],
      queueIndex: -1,
      activeTrack: null,
      activeSegment: null,
      isPlaying: false,
      currentTime: 0,
      activePlaylistPlayingId: null,
      activePlaylistOriginalQueue: [],
      queuesByMode: finalQueuesByMode,
      initializedModes: isPlayingPlaylist ? get().initializedModes : {
        ...get().initializedModes,
        [get().playbackMode]: true,
      },
    });
    return;
  }
  const nextIdx = Math.max(0, Math.min(targetIdx, newQueue.length - 1));
  const nextItem = newQueue[nextIdx];
  const trackGain = normalizeTrackVolume(nextItem.track.volume, 0.5);
  audioEngine.setVolume(trackGain);

  set({
    queue: newQueue,
    queueIndex: nextIdx,
    activeTrack: nextItem.track,
    activeSegment: nextItem.segment,
    isPlaying: false,
    currentTime: nextItem.segment.start_time,
    volume: trackGain,
    queuesByMode: finalQueuesByMode,
    initializedModes: isPlayingPlaylist ? get().initializedModes : {
      ...get().initializedModes,
      [get().playbackMode]: true,
    },
    ...(isPlayingPlaylist
      ? {
          activePlaylistOriginalQueue: (() => {
            const validKeys = new Set(
              newQueue.map((nq) => nq.queueItemId || `${nq.track.id}:${nq.segment.id}`)
            );
            return get().activePlaylistOriginalQueue.filter((it) =>
              validKeys.has(it.queueItemId || `${it.track.id}:${it.segment.id}`)
            );
          })(),
        }
      : {}),
  });

  if (wasPlaying) {
    get().playSegment(nextItem.segment, nextItem.track, nextIdx);
  }
}

function getStoredViewMode(): "grid" | "list" {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      return window.localStorage.getItem("slice_player_view") === "list" ? "list" : "grid";
    }
  } catch {}
  return "grid";
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  tracks: [],
  isLoadingTracks: false,
  activeTrack: null,
  activeSegment: null,
  isPlaying: false,
  isBuffering: false,
  isShuffle: false, // Default to sequential order! Only shuffle when user clicks shuffle!
  isLoopQueue: true,
  isLoopTrack: false,
  playbackMode: "mixed",
  queuesByMode: {
    mixed: [],
    slices_only: [],
    original_only: [],
  },
  shuffleByMode: {
    mixed: false,
    slices_only: false,
    original_only: false,
  },
  initializedModes: {
    mixed: false,
    slices_only: false,
    original_only: false,
  },
  currentTime: 0,
  volume: 0.5,
  queue: [],
  queueIndex: -1,
  sliceStudioTrack: null,

  playlists: [],
  activePlaylistId: null,
  activePlaylistPlayingId: null,
  activePlaylistItems: [],
  activePlaylistOriginalQueue: [],
  viewMode: getStoredViewMode(),
  activeSystemCategory: "mixed",
  setActiveSystemCategory: (cat: SystemCategory) => {
    set({ activeSystemCategory: cat, activePlaylistId: null });
  },
  retryingTrackIds: {},
  isRetryingAll: false,
  retryAllErrors: async (trackIds?: string[]) => {
    if (get().isRetryingAll) return false;
    set({ isRetryingAll: true });
    try {
      const res = await fetch("/api/tracks/retry-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(trackIds ? { track_ids: trackIds } : {}),
      });
      await get().fetchTracks(true);
      return res.ok;
    } catch (err) {
      console.error("[Store] Failed to retry all error tracks:", err);
      return false;
    } finally {
      set({ isRetryingAll: false });
    }
  },
  retryTrack: async (trackId: string) => {
    if (get().retryingTrackIds[trackId]) return false;
    set((state) => ({
      retryingTrackIds: { ...state.retryingTrackIds, [trackId]: true },
    }));
    try {
      const res = await fetch(`/api/tracks/${encodeURIComponent(trackId)}/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      // Even on HTTP 400 (e.g. YouTube rejection recorded in DB), fetchTracks to sync updated error_message
      await get().fetchTracks(true);
      return res.ok;
    } catch (err) {
      console.error(`[Store] Failed to retry track "${trackId}":`, err);
      return false;
    } finally {
      set((state) => {
        const next = { ...state.retryingTrackIds };
        delete next[trackId];
        return { retryingTrackIds: next };
      });
    }
  },

  fetchTracks: async (reconcileSegments = true) => {
    const fetchId = ++latestFetchTracksRequestId;
    if (get().tracks.length === 0) {
      set({ isLoadingTracks: true });
    }
    try {
      const res = await fetch("/api/tracks");
      if (fetchId !== latestFetchTracksRequestId) return;
      if (res.ok) {
        const tracks: Track[] = await res.json();
        if (!Array.isArray(tracks)) return;
        const prevTracks = get().tracks;
        const prevTrackMap = new Map(prevTracks.map((t) => [t.id, t]));
        const stabilizedTracks = tracks.map((fresh) => {
          const prev = prevTrackMap.get(fresh.id);
          if (!prev) return fresh;
          const isVolumePending = trackVolumeDebounceTimers.has(fresh.id);
          const effectiveFreshVolume = isVolumePending ? prev.volume : fresh.volume;
          const isSame =
            prev.status === fresh.status &&
            prev.segment_count === fresh.segment_count &&
            prev.duration === fresh.duration &&
            prev.title === fresh.title &&
            prev.artist === fresh.artist &&
            prev.file_path === fresh.file_path &&
            prev.thumbnail_url === fresh.thumbnail_url &&
            prev.error_message === fresh.error_message &&
            prev.download_index === fresh.download_index &&
            prev.volume === effectiveFreshVolume;
          if (isSame) return prev;
          return isVolumePending ? { ...fresh, volume: prev.volume } : fresh;
        });
        const isTracksIdentical =
          stabilizedTracks.length === prevTracks.length &&
          stabilizedTracks.every((t, idx) => t === prevTracks[idx]);
        const finalTracks = isTracksIdentical ? prevTracks : stabilizedTracks;
        const trackMap = new Map(finalTracks.map((t) => [t.id, t]));
        const { activeTrack, activeSegment, sliceStudioTrack, queue, queueIndex } = get();
        const prevReadyTrackIds = new Set(prevTracks.filter((t) => t.status === "ready").map((t) => t.id));
        const hasNewlyReady = finalTracks.some((t) => t.status === "ready" && !prevReadyTrackIds.has(t.id));

        if (!reconcileSegments) {
          if (hasNewlyReady) {
            return get().fetchTracks(true);
          }
          const currentItem = queueIndex >= 0 ? queue[queueIndex] : null;
          const { queuesByMode, playbackMode } = get();
          const updateQueueList = (list: QueueItem[], mode: PlaybackMode) => {
            if (!list || list.length === 0) return list;
            let listChanged = false;
            const dismissedTracks = dismissedTrackIdsByMode[mode];
            const filtered = list.filter((item) => {
              const t = trackMap.get(item.track.id);
              return t && t.status === "ready" && t.duration > 0 && !dismissedTracks?.has(item.track.id);
            });
            if (filtered.length !== list.length) listChanged = true;
            const updated = (listChanged ? filtered : list).map((item) => {
              const fresh = trackMap.get(item.track.id);
              if (fresh && fresh !== item.track) {
                listChanged = true;
                let segment = item.segment;
                if (item.segment.id.startsWith("fallback_") && item.segment.end_time !== fresh.duration) {
                  segment = createDefaultFullSegment(fresh);
                }
                return { ...item, track: fresh, segment };
              }
              return item;
            });
            return listChanged ? updated : list;
          };
          const nextMixed = updateQueueList(queuesByMode.mixed, "mixed");
          const nextSlices = updateQueueList(queuesByMode.slices_only, "slices_only");
          const nextOriginal = updateQueueList(queuesByMode.original_only, "original_only");
          const hasQueuesMapChanged =
            nextMixed !== queuesByMode.mixed ||
            nextSlices !== queuesByMode.slices_only ||
            nextOriginal !== queuesByMode.original_only;
          const nextQueuesByMode: Record<PlaybackMode, QueueItem[]> = hasQueuesMapChanged
            ? { mixed: nextMixed, slices_only: nextSlices, original_only: nextOriginal }
            : queuesByMode;
          const updatePlaylistQueue = (list: QueueItem[]) => {
            if (!list || list.length === 0) return list;
            let listChanged = false;
            const filtered = list.filter((item) => {
              const t = trackMap.get(item.track.id);
              return t && t.status === "ready" && t.duration > 0;
            });
            if (filtered.length !== list.length) listChanged = true;
            const updated = (listChanged ? filtered : list).map((item) => {
              const fresh = trackMap.get(item.track.id);
              if (fresh && fresh !== item.track) {
                listChanged = true;
                let segment = item.segment;
                if (item.segment.id.startsWith("fallback_") && item.segment.end_time !== fresh.duration) {
                  segment = createDefaultFullSegment(fresh);
                }
                return { ...item, track: fresh, segment };
              }
              return item;
            });
            return listChanged ? updated : list;
          };

          const isPlayingPlaylist = Boolean(get().activePlaylistPlayingId);
          const validQueue = nextQueuesByMode[playbackMode];
          const playlistQueue = isPlayingPlaylist ? updatePlaylistQueue(queue) : queue;
          const finalQueue = isPlayingPlaylist
            ? (playlistQueue === queue ? queue : playlistQueue)
            : (validQueue === queue ? queue : validQueue);

          const updates: Partial<PlayerState> = {
            tracks: finalTracks,
            queue: finalQueue,
            queuesByMode: nextQueuesByMode,
          };
          if (isPlayingPlaylist) {
            const nextOrig = updatePlaylistQueue(get().activePlaylistOriginalQueue);
            if (nextOrig !== get().activePlaylistOriginalQueue) {
              updates.activePlaylistOriginalQueue = nextOrig;
            }
            if (playlistQueue.length !== queue.length) {
              if (playlistQueue.length === 0) {
                audioEngine.unload();
                updates.queueIndex = -1;
                updates.activeTrack = null;
                updates.activeSegment = null;
                updates.isPlaying = false;
                updates.currentTime = 0;
                updates.activePlaylistPlayingId = null;
                updates.activePlaylistOriginalQueue = [];
              } else {
                const activeItemIndex = currentItem
                  ? playlistQueue.findIndex((it) => it.queueItemId ? it.queueItemId === currentItem.queueItemId : it.segment.id === currentItem.segment.id)
                  : -1;
                const newIdx = activeItemIndex !== -1 ? activeItemIndex : Math.max(0, Math.min(queueIndex, playlistQueue.length - 1));
                updates.queueIndex = newIdx;
                if (activeItemIndex === -1) {
                  const nextItem = playlistQueue[newIdx];
                  updates.activeTrack = nextItem.track;
                  updates.activeSegment = nextItem.segment;
                  if (get().isPlaying) {
                    get().playSegment(nextItem.segment, nextItem.track, newIdx);
                  } else {
                    audioEngine.unload();
                  }
                }
              }
            }
          }
          const freshActive = activeTrack ? trackMap.get(activeTrack.id) : null;
          if (freshActive && activeTrack && freshActive !== activeTrack) {
            updates.activeTrack = freshActive;
            if (!trackVolumeDebounceTimers.has(freshActive.id) && freshActive.volume !== activeTrack.volume) {
              const trackGain = normalizeTrackVolume(freshActive.volume, 0.5);
              audioEngine.setVolume(trackGain);
              updates.volume = trackGain;
            }
          }
          const freshStudio = sliceStudioTrack ? trackMap.get(sliceStudioTrack.id) : null;
          if (freshStudio && freshStudio !== sliceStudioTrack) {
            updates.sliceStudioTrack = freshStudio;
          }
          if (!isPlayingPlaylist && validQueue.length !== queue.length) {
            const newIdx = validQueue.length === 0
              ? -1
              : currentItem
                ? validQueue.findIndex((it) => it.segment.id === currentItem.segment.id)
                : (queueIndex === -1 ? -1 : Math.max(0, Math.min(queueIndex, validQueue.length - 1)));
            const fallbackIdx = queueIndex === -1 ? -1 : Math.max(0, Math.min(queueIndex, validQueue.length - 1));
            updates.queueIndex = validQueue.length === 0 ? -1 : (newIdx >= 0 ? newIdx : fallbackIdx);
          }
          set(updates);

          if (activeTrack && (!trackMap.has(activeTrack.id) || trackMap.get(activeTrack.id)!.status !== "ready")) {
            get().removeTrackFromQueue(activeTrack.id);
          }
          return;
        }

        // Full reconciliation path: fetch segments to purge deleted segments across tabs
        let fetchedSegments: Segment[] = [];
        try {
          const segRes = await fetch("/api/segments");
          if (fetchId !== latestFetchTracksRequestId) return;
          if (!segRes.ok) {
            console.warn(`[Store] /api/segments returned ${segRes.status}; aborting segment purge to prevent queue wipe.`);
            return;
          }
          fetchedSegments = await segRes.json();
          if (fetchId !== latestFetchTracksRequestId) return;
          if (!Array.isArray(fetchedSegments)) return;
        } catch (e) {
          console.warn("[Store] Network error fetching segments; aborting segment purge:", e);
          return;
        }

        const prevSegmentsMap = new Map<string, Segment>();
        for (const it of get().queue) {
          prevSegmentsMap.set(it.segment.id, it.segment);
        }
        for (const m of ["mixed", "slices_only", "original_only"] as PlaybackMode[]) {
          for (const it of get().queuesByMode[m] || []) {
            prevSegmentsMap.set(it.segment.id, it.segment);
          }
        }
        const validSegments = fetchedSegments.map((fresh) => {
          const prev = prevSegmentsMap.get(fresh.id);
          if (!prev) return fresh;
          const isSame =
            prev.track_id === fresh.track_id &&
            prev.name === fresh.name &&
            prev.start_time === fresh.start_time &&
            prev.end_time === fresh.end_time &&
            prev.color === fresh.color;
          return isSame ? prev : fresh;
        });

        const segmentMap = new Set(validSegments.map((s) => s.id));
        const segmentObjMap = new Map(validSegments.map((s) => [s.id, s]));

        const freshState = get();
        const currentQueue = freshState.queue;
        const currentQueueIndex = freshState.queueIndex;
        const currentActiveSegment = freshState.activeSegment;
        const currentItem = currentQueueIndex >= 0 ? currentQueue[currentQueueIndex] : null;
        const currentMode = freshState.playbackMode;
        const newlyReadyTracks = stabilizedTracks.filter((t) => t.status === "ready" && !prevReadyTrackIds.has(t.id));
        const modesToReconcile: PlaybackMode[] = ["mixed", "slices_only", "original_only"];
        const nextQueuesByMode: Record<PlaybackMode, QueueItem[]> = { ...freshState.queuesByMode };

        for (const m of modesToReconcile) {
          const prevQueue = freshState.queuesByMode[m] || [];
          const reconciled = reconcileSingleModeQueue(
            m,
            prevQueue,
            validSegments,
            finalTracks,
            trackMap,
            segmentMap,
            segmentObjMap,
            m === currentMode ? currentActiveSegment : null,
            newlyReadyTracks,
            freshState.shuffleByMode[m]
          );
          const isIdentical =
            reconciled.length === prevQueue.length &&
            reconciled.every((it, idx) => it.track === prevQueue[idx].track && it.segment === prevQueue[idx].segment);
          nextQueuesByMode[m] = isIdentical ? prevQueue : reconciled;
        }

        const validQueue = nextQueuesByMode[currentMode];
        let newIdx = -1;
        if (validQueue.length > 0 && currentItem) {
          const segIdx = validQueue.findIndex((it) => it.segment.id === currentItem.segment.id);
          if (segIdx !== -1) {
            newIdx = segIdx;
          } else {
            const trkIdx = validQueue.findIndex((it) => it.track.id === currentItem.track.id);
            if (trkIdx !== -1) {
              newIdx = trkIdx;
            }
          }
        }
        const fallbackIdx = currentQueueIndex === -1 ? -1 : Math.max(0, Math.min(currentQueueIndex, validQueue.length - 1));
        const settledIdx = validQueue.length === 0 ? -1 : (newIdx >= 0 ? newIdx : fallbackIdx);

        const isPlayingPlaylist = Boolean(get().activePlaylistPlayingId);
        const updatePlaylistQueueFull = (list: QueueItem[]) => {
          if (!list || list.length === 0) return list;
          let listChanged = false;
          const filtered = list.filter((item) => {
            const t = trackMap.get(item.track.id);
            if (!t || t.status !== "ready" || t.duration <= 0) return false;
            if (!item.segment.id.startsWith("fallback_") && !segmentMap.has(item.segment.id)) {
              return false;
            }
            return true;
          });
          if (filtered.length !== list.length) listChanged = true;
          const updated = (listChanged ? filtered : list).map((item) => {
            const freshTrack = trackMap.get(item.track.id)!;
            const freshSeg = !item.segment.id.startsWith("fallback_") ? segmentObjMap.get(item.segment.id) : null;
            let segment = item.segment;
            if (item.segment.id.startsWith("fallback_") && item.segment.end_time !== freshTrack.duration) {
              segment = createDefaultFullSegment(freshTrack);
              listChanged = true;
            } else if (freshSeg && freshSeg !== item.segment) {
              segment = freshSeg;
              listChanged = true;
            }
            if (freshTrack !== item.track || segment !== item.segment) {
              listChanged = true;
              return { ...item, track: freshTrack, segment };
            }
            return item;
          });
          return listChanged ? updated : list;
        };

        let finalPlaylistQueue = currentQueue;
        let finalPlaylistQueueIndex = currentQueueIndex;
        const playlistUpdates: Partial<PlayerState> = {};
        if (isPlayingPlaylist) {
          finalPlaylistQueue = updatePlaylistQueueFull(currentQueue);
          const nextOrig = updatePlaylistQueueFull(get().activePlaylistOriginalQueue);
          playlistUpdates.activePlaylistOriginalQueue = nextOrig;
          if (finalPlaylistQueue.length !== currentQueue.length) {
            if (finalPlaylistQueue.length === 0) {
              audioEngine.unload();
              playlistUpdates.queueIndex = -1;
              playlistUpdates.activeTrack = null;
              playlistUpdates.activeSegment = null;
              playlistUpdates.isPlaying = false;
              playlistUpdates.currentTime = 0;
              playlistUpdates.activePlaylistPlayingId = null;
              playlistUpdates.activePlaylistOriginalQueue = [];
            } else {
              const activeItemIndex = currentItem
                ? finalPlaylistQueue.findIndex((it) => it.queueItemId ? it.queueItemId === currentItem.queueItemId : it.segment.id === currentItem.segment.id)
                : -1;
              finalPlaylistQueueIndex = activeItemIndex !== -1 ? activeItemIndex : Math.max(0, Math.min(currentQueueIndex, finalPlaylistQueue.length - 1));
              if (activeItemIndex === -1) {
                const nextItem = finalPlaylistQueue[finalPlaylistQueueIndex];
                playlistUpdates.activeTrack = nextItem.track;
                playlistUpdates.activeSegment = nextItem.segment;
                if (get().isPlaying) {
                  get().playSegment(nextItem.segment, nextItem.track, finalPlaylistQueueIndex);
                } else {
                  audioEngine.unload();
                }
              }
            }
          }
        }

        const reconcileUpdates: Partial<PlayerState> = {
          tracks: finalTracks,
          queue: isPlayingPlaylist ? finalPlaylistQueue : validQueue,
          queuesByMode: nextQueuesByMode,
          queueIndex: isPlayingPlaylist ? (playlistUpdates.queueIndex !== undefined ? playlistUpdates.queueIndex : finalPlaylistQueueIndex) : settledIdx,
          initializedModes: {
            mixed: true,
            slices_only: true,
            original_only: true,
          },
          ...playlistUpdates,
        };
        const freshActiveTrack = activeTrack ? trackMap.get(activeTrack.id) : null;
        if (freshActiveTrack && activeTrack && freshActiveTrack !== activeTrack) {
          reconcileUpdates.activeTrack = freshActiveTrack;
          if (!trackVolumeDebounceTimers.has(freshActiveTrack.id) && freshActiveTrack.volume !== activeTrack.volume) {
            const trackGain = normalizeTrackVolume(freshActiveTrack.volume, 0.5);
            audioEngine.setVolume(trackGain);
            reconcileUpdates.volume = trackGain;
          }
        }
        if (sliceStudioTrack) {
          if (!trackMap.has(sliceStudioTrack.id)) {
            reconcileUpdates.sliceStudioTrack = null;
          } else {
            const freshStudioTrack = trackMap.get(sliceStudioTrack.id)!;
            if (freshStudioTrack !== sliceStudioTrack) {
              reconcileUpdates.sliceStudioTrack = freshStudioTrack;
            }
          }
        }
        set(reconcileUpdates);

        // Synchronize activeSegment boundaries if segment was edited externally / trimmed on server
        if (activeSegment && segmentObjMap.has(activeSegment.id)) {
          const freshActive = segmentObjMap.get(activeSegment.id)!;
          if (
            freshActive.start_time !== activeSegment.start_time ||
            freshActive.end_time !== activeSegment.end_time ||
            freshActive.name !== activeSegment.name ||
            freshActive.color !== activeSegment.color
          ) {
            set({ activeSegment: freshActive });
            audioEngine.updateCurrentSegmentBounds(freshActive.start_time, freshActive.end_time);
            const curTime = audioEngine.getCurrentTime();
            if (curTime < freshActive.start_time || curTime > freshActive.end_time) {
              audioEngine.seek(freshActive.start_time);
              set({ currentTime: freshActive.start_time });
            }
          }
        }

        const latestActiveTrack = get().activeTrack;
        if (latestActiveTrack && (!trackMap.has(latestActiveTrack.id) || trackMap.get(latestActiveTrack.id)!.status !== "ready")) {
          get().removeTrackFromQueue(latestActiveTrack.id);
        }
        const latestActiveSegment = get().activeSegment;
        if (latestActiveSegment && !latestActiveSegment.id.startsWith("fallback_") && !segmentMap.has(latestActiveSegment.id)) {
          get().removeSegmentFromQueue(latestActiveSegment.id);
        }
      }
    } catch (e) {
      console.error("[Store] Failed to fetch tracks", e);
    } finally {
      set({ isLoadingTracks: false });
    }
  },

  playSegment: async (segment: Segment, track: Track, overrideIndex?: number, seekTime?: number) => {
    const currentMode = get().playbackMode;
    dismissedSegmentIdsByMode[currentMode].delete(segment.id);
    if (segment.id.startsWith("fallback_")) {
      dismissedSegmentIdsByMode[currentMode].delete(`fallback_${track.id}`);
    }
    dismissedTrackIdsByMode[currentMode].delete(track.id);
    const currentQ = get().queue;
    for (const item of currentQ) {
      if (item.track.id === track.id) {
        dismissedSegmentIdsByMode[currentMode].delete(item.segment.id);
      }
    }
    const streamUrl = `/api/tracks/${encodeURIComponent(track.id)}/stream`;
    const { queue, queueIndex, activePlaylistPlayingId } = get();
    const wasPlayingPlaylist = Boolean(activePlaylistPlayingId);
    let baseQueue = queue;
    if (wasPlayingPlaylist && overrideIndex === undefined) {
      baseQueue = get().queuesByMode[currentMode] || [];
    }
    let newIndex = queueIndex;
    let newQueue = baseQueue;

    if (overrideIndex !== undefined && overrideIndex >= 0 && overrideIndex < queue.length) {
      if (queue[overrideIndex]?.segment.id === segment.id) {
        newIndex = overrideIndex;
      } else {
        const existingIndex = queue.findIndex((item) => item.segment.id === segment.id);
        newIndex = existingIndex !== -1 ? existingIndex : overrideIndex;
      }
    } else if (!wasPlayingPlaylist && queueIndex >= 0 && queue[queueIndex]?.segment.id === segment.id) {
      newIndex = queueIndex;
    } else {
      const existingIndex = baseQueue.findIndex((item) => item.segment.id === segment.id);
      if (existingIndex !== -1) {
        newIndex = existingIndex;
      } else if (currentMode === "slices_only" && segment.id.startsWith("fallback_")) {
        newQueue = baseQueue;
        newIndex = -1;
      } else if (currentMode === "original_only" && !segment.id.startsWith("fallback_")) {
        newQueue = baseQueue;
        newIndex = -1;
      } else {
        newQueue = [...baseQueue, createQueueItem(segment, track)];
        newIndex = newQueue.length - 1;
      }
    }

    const trackGain = normalizeTrackVolume(track.volume, 0.5);
    audioEngine.setVolume(trackGain);

    const { playbackMode, queuesByMode, initializedModes } = get();
    const isPlayingPlaylist = Boolean(activePlaylistPlayingId);
    const isFromPlaylistQueue = isPlayingPlaylist && overrideIndex !== undefined;

    const updatedQueuesByMode = (!isFromPlaylistQueue && newQueue !== (queuesByMode[playbackMode] || [])) ? {
      ...queuesByMode,
      [playbackMode]: newQueue,
    } : queuesByMode;

    const initialTime = typeof seekTime === "number" && Number.isFinite(seekTime) && seekTime >= segment.start_time && seekTime < segment.end_time
      ? seekTime
      : segment.start_time;

    set({
      activeTrack: track,
      activeSegment: segment,
      isPlaying: true,
      currentTime: initialTime,
      volume: trackGain,
      queue: newQueue,
      queueIndex: newIndex >= 0 ? newIndex : (newQueue.length > 0 ? Math.max(0, queueIndex) : -1),
      queuesByMode: updatedQueuesByMode,
      activePlaylistPlayingId: isFromPlaylistQueue ? activePlaylistPlayingId : null,
      activePlaylistOriginalQueue: isFromPlaylistQueue ? get().activePlaylistOriginalQueue : [],
      initializedModes: {
        ...initializedModes,
        [playbackMode]: true,
      },
    });

    if (autoSkipTimer) {
      clearTimeout(autoSkipTimer);
      autoSkipTimer = null;
    }

    activeInitiationCount++;
    try {
      const isSlice = !segment.id.startsWith("fallback_");
      const title = track.title || "Unknown Title";
      const desc = isSlice
        ? `slice "${segment.name}" (${segment.start_time.toFixed(1)}s - ${segment.end_time.toFixed(1)}s) from [${title}]`
        : `track [${title}] (${Math.round(track.duration)}s)`;
      logClientInfo("playback", `Started playback: ${desc}`, { trackId: track.id, segmentId: segment.id });

      set({ isBuffering: true });
      await audioEngine.playSegment(
        streamUrl,
        initialTime,
        segment.end_time,
        () => {
          // Callback on segment end -> auto advance
          get().nextSegment(true);
        },
        (time) => {
          set({ currentTime: time });
        },
        segment.start_time
      );
      set({ isBuffering: false });
      consecutivePlaybackFailures = 0;
    } catch (e) {
      set({ isBuffering: false, isPlaying: false });
      // AbortError happens when the play request is interrupted by user skipping or pausing - this is normal
      const isAbort = (e as any)?.name === "AbortError";
      if (isAbort) {
        return;
      }
      consecutivePlaybackFailures++;
      logClientError("playback", `Playback failed for [${track.title || "Unknown"}]: ${(e as any)?.message || String(e)}`, {
        error: e,
        trackId: track.id,
        segmentId: segment.id,
        consecutiveFailures: consecutivePlaybackFailures,
      });

      // Avoid infinite skip loop by limiting consecutive skips to queue length
      const queue = get().queue;
      if (consecutivePlaybackFailures < Math.min(3, queue.length)) {
        console.warn(`[Store] Auto-skipping unplayable segment (failure ${consecutivePlaybackFailures}/${Math.min(3, queue.length)})`);
        if (autoSkipTimer) clearTimeout(autoSkipTimer);
        autoSkipTimer = setTimeout(() => {
          autoSkipTimer = null;
          const state = get();
          // Double check player is still trying to play the failed segment
          if (!state.isPlaying && state.activeSegment?.id === segment.id) {
            state.nextSegment();
          }
        }, 500);
      } else if (consecutivePlaybackFailures >= Math.min(3, queue.length)) {
        console.warn("[Store] Consecutive playback failures reached limit, stopping auto-skip loop");
        logClientError("playback", `Playback stopped after ${consecutivePlaybackFailures} consecutive failures`);
        consecutivePlaybackFailures = 0;
      }
    } finally {
      set({ isBuffering: false });
      activeInitiationCount = Math.max(0, activeInitiationCount - 1);
    }
  },

  setBuffering: (isBuffering: boolean) => set({ isBuffering }),

  pause: () => {
    if (autoSkipTimer) {
      clearTimeout(autoSkipTimer);
      autoSkipTimer = null;
    }
    logClientInfo("playback", "Playback paused");
    audioEngine.pause();
    set({ isPlaying: false, isBuffering: false });
  },

  resume: async () => {
    if (get().isPlaying) return;
    const { activeSegment, activeTrack, queueIndex, currentTime } = get();
    if (!activeSegment || !activeTrack) return;

    if (currentTime >= activeSegment.end_time - 0.05 || currentTime < activeSegment.start_time) {
      await get().playSegment(activeSegment, activeTrack, queueIndex >= 0 ? queueIndex : undefined);
      return;
    }

    audioEngine.updateCurrentSegmentBounds(activeSegment.start_time, activeSegment.end_time);
    audioEngine.setOnSegmentEnd(() => get().nextSegment(true));

    const ok = await audioEngine.resume();
    if (ok) {
      set({ isPlaying: true });
    } else {
      await get().playSegment(activeSegment, activeTrack, queueIndex >= 0 ? queueIndex : undefined, currentTime);
    }
  },

  togglePlay: async () => {
    const { isPlaying, activeSegment, activeTrack, queue, queueIndex } = get();

    if (!activeSegment || !activeTrack) {
      // If queue has items, play first item
      if (queue.length > 0) {
        const item = queue[Math.max(0, queueIndex)];
        await get().playSegment(item.segment, item.track, Math.max(0, queueIndex));
        return;
      }
      return;
    }

    if (isPlaying) {
      get().pause();
    } else {
      await get().resume();
    }
  },

  nextSegment: (isAutoAdvance = false) => {
    const { queue, queueIndex, activeSegment, activeTrack, isLoopQueue, isLoopTrack } = get();
    if (queue.length === 0) return;

    // 1. If auto-advancing on segment end and loop track is active, repeat current track/slice
    if (isAutoAdvance && isLoopTrack && activeSegment && activeTrack && consecutivePlaybackFailures === 0) {
      get().playSegment(activeSegment, activeTrack, queueIndex >= 0 ? queueIndex : undefined);
      return;
    }

    // 2. If activeSegment was an out-of-mode transitional segment that doesn't match the current queue item
    if (queueIndex >= 0 && activeSegment && queue[queueIndex] && queue[queueIndex].segment.id !== activeSegment.id) {
      const nextItem = queue[queueIndex];
      if (nextItem) {
        get().playSegment(nextItem.segment, nextItem.track, queueIndex);
        return;
      }
    }

    const isLastItem = queueIndex >= queue.length - 1;
    if (isLastItem) {
      if (!isLoopQueue) {
        audioEngine.pause();
        set({ isPlaying: false });
        return;
      }
      const firstItem = queue[0];
      if (!firstItem) return;
      set({ queueIndex: 0 });
      get().playSegment(firstItem.segment, firstItem.track, 0);
      return;
    }

    const nextIdx = queueIndex + 1;
    const nextItem = queue[nextIdx];
    if (!nextItem) return;
    set({ queueIndex: nextIdx });
    get().playSegment(nextItem.segment, nextItem.track, nextIdx);
  },

  prevSegment: () => {
    const { queue, queueIndex, currentTime, activeSegment, activeTrack, isLoopQueue } = get();
    if (!activeSegment || !activeTrack) return;

    if (queue.length === 0) return;

    // If activeSegment was an out-of-mode transitional segment, immediately target current queueIndex
    if (queueIndex >= 0 && queue[queueIndex] && queue[queueIndex].segment.id !== activeSegment.id) {
      const targetItem = queue[queueIndex];
      set({ queueIndex });
      get().playSegment(targetItem.segment, targetItem.track, queueIndex);
      return;
    }

    // If played more than threshold (adaptive for micro-slices < 3s), restart current segment
    const restartThreshold = Math.min(3, Math.max(0.5, (activeSegment.end_time - activeSegment.start_time) * 0.4));
    if (currentTime - activeSegment.start_time > restartThreshold) {
      get().seek(activeSegment.start_time);
      return;
    }

    let prevIdx = queueIndex - 1;
    if (prevIdx < 0) {
      if (!isLoopQueue) {
        get().seek(activeSegment.start_time);
        return;
      }
      prevIdx = queue.length - 1;
    }

    const prevItem = queue[prevIdx];
    if (!prevItem) return;
    set({ queueIndex: prevIdx });
    get().playSegment(prevItem.segment, prevItem.track, prevIdx);
  },

  toggleLoopQueue: () => {
    set((state) => ({ isLoopQueue: !state.isLoopQueue }));
  },

  toggleLoopTrack: () => {
    set((state) => ({ isLoopTrack: !state.isLoopTrack }));
  },

  toggleShuffle: () => {
    const { queue, activeSegment, activeTrack, playbackMode, queuesByMode, shuffleByMode, initializedModes } = get();
    const isPlayingPlaylist = Boolean(get().activePlaylistPlayingId);

    if (isPlayingPlaylist) {
      const nextShuffle = !get().isShuffle;
      if (queue.length <= 1) {
        set({ isShuffle: nextShuffle });
        return;
      }
      let newQueue = [...queue];
      if (nextShuffle) {
        newQueue = shuffleArray(newQueue);
      } else {
        const origQueue = get().activePlaylistOriginalQueue;
        if (origQueue && origQueue.length > 0) {
          const orderMap = new Map(origQueue.map((it, idx) => [it.queueItemId || it.segment.id, idx]));
          newQueue.sort(
            (a, b) =>
              (orderMap.get(a.queueItemId || a.segment.id) ?? 999999) -
              (orderMap.get(b.queueItemId || b.segment.id) ?? 999999)
          );
        } else if (get().activePlaylistId && get().activePlaylistId === get().activePlaylistPlayingId) {
          const plItems = get().activePlaylistItems;
          if (plItems.length > 0) {
            const orderMap = new Map(plItems.map((it, idx) => [it.id, idx]));
            newQueue.sort(
              (a, b) =>
                (orderMap.get(a.queueItemId || "") ?? 999999) -
                (orderMap.get(b.queueItemId || "") ?? 999999)
            );
          } else {
            newQueue = sortQueueItems(newQueue);
          }
        } else {
          newQueue = sortQueueItems(newQueue);
        }
      }
      let newIndex = -1;
      const currentQItem = queue[get().queueIndex];
      if (currentQItem?.queueItemId) {
        const found = newQueue.findIndex((item) => item.queueItemId === currentQItem.queueItemId);
        if (found >= 0) newIndex = found;
      }
      if (newIndex === -1 && activeSegment) {
        const found = newQueue.findIndex((item) => item.segment.id === activeSegment.id);
        if (found >= 0) newIndex = found;
      }
      if (newIndex === -1 && get().queueIndex >= 0) {
        newIndex = Math.min(get().queueIndex, newQueue.length - 1);
      }
      set({
        queue: newQueue,
        queueIndex: newIndex,
        isShuffle: nextShuffle,
      });
      return;
    }

    const nextShuffle = !shuffleByMode[playbackMode];
    const currentQueue = queuesByMode[playbackMode] ?? queue;

    if (currentQueue.length <= 1) {
      set({
        isShuffle: nextShuffle,
        shuffleByMode: {
          ...shuffleByMode,
          [playbackMode]: nextShuffle,
        },
        initializedModes: {
          ...initializedModes,
          [playbackMode]: true,
        },
      });
      return;
    }

    let newQueue = [...currentQueue];
    if (nextShuffle) {
      newQueue = shuffleArray(newQueue);
    } else {
      newQueue = sortQueueItems(newQueue);
    }

    let newIndex = -1;
    if (activeSegment) {
      const found = newQueue.findIndex((item) => item.segment.id === activeSegment.id);
      if (found >= 0) {
        newIndex = found;
      } else if (activeTrack) {
        const foundTrk = newQueue.findIndex((item) => item.track.id === activeTrack.id);
        if (foundTrk >= 0) newIndex = foundTrk;
      }
    } else if (get().queueIndex >= 0) {
      newIndex = Math.min(get().queueIndex, newQueue.length - 1);
    }

    set({
      isShuffle: nextShuffle,
      shuffleByMode: {
        ...shuffleByMode,
        [playbackMode]: nextShuffle,
      },
      initializedModes: {
        ...initializedModes,
        [playbackMode]: true,
      },
      queuesByMode: {
        ...queuesByMode,
        [playbackMode]: newQueue,
      },
      queue: newQueue,
      queueIndex: newIndex,
    });
  },

  setVolume: (vol: number) => {
    const safeVol = normalizeTrackVolume(vol, 0.5);
    const { activeTrack } = get();
    if (activeTrack) {
      get().setTrackVolume(activeTrack.id, safeVol);
    } else {
      set({ volume: safeVol });
      audioEngine.setVolume(safeVol);
    }
  },

  setTrackVolume: async (trackId: string, volume: number) => {
    const safeVol = normalizeTrackVolume(volume, 0.5);
    const { tracks, activeTrack, queue, sliceStudioTrack, playbackMode, queuesByMode } = get();
    const updatedTracks = tracks.map((t) => (t.id === trackId ? { ...t, volume: safeVol } : t));
    const updateTrackInList = (list: QueueItem[]) => {
      if (!list || !list.some((item) => item.track.id === trackId)) return list;
      return list.map((item) =>
        item.track.id === trackId ? { ...item, track: { ...item.track, volume: safeVol } } : item
      );
    };
    const updatedQueuesByMode: Record<PlaybackMode, QueueItem[]> = {
      mixed: updateTrackInList(queuesByMode.mixed),
      slices_only: updateTrackInList(queuesByMode.slices_only),
      original_only: updateTrackInList(queuesByMode.original_only),
    };
    const isPlayingPlaylist = Boolean(get().activePlaylistPlayingId);
    const updatedQueue = isPlayingPlaylist ? updateTrackInList(queue) : (updatedQueuesByMode[playbackMode] || updateTrackInList(queue));
    const updates: Partial<PlayerState> = {
      tracks: updatedTracks,
      queue: updatedQueue,
      queuesByMode: updatedQueuesByMode,
    };
    if (activeTrack?.id === trackId) {
      updates.activeTrack = { ...activeTrack, volume: safeVol };
      updates.volume = safeVol;
      audioEngine.setVolume(safeVol);
    }
    if (sliceStudioTrack?.id === trackId) {
      updates.sliceStudioTrack = { ...sliceStudioTrack, volume: safeVol };
    }
    set(updates);

    await patchTrackVolumeDebounced(trackId, safeVol);
  },

  setCurrentTime: (t: number) => {
    set({ currentTime: t });
  },

  seek: (seconds: number) => {
    if (!Number.isFinite(seconds) || seconds < 0) return;
    const { activeSegment } = get();
    let target = seconds;
    if (activeSegment) {
      target = Math.max(activeSegment.start_time, Math.min(activeSegment.end_time, seconds));
      audioEngine.updateCurrentSegmentBounds(activeSegment.start_time, activeSegment.end_time);
      audioEngine.setOnSegmentEnd(() => get().nextSegment(true));
    }
    audioEngine.seek(target);
    set({ currentTime: target });
  },

  removeTrackFromQueue: (trackId: string) => {
    const { queue, queueIndex, activeTrack, playbackMode, queuesByMode } = get();
    const segmentIdsToDismiss = new Set<string>([`fallback_${trackId}`]);
    for (const otherMode of ["mixed", "slices_only", "original_only"] as PlaybackMode[]) {
      for (const item of queuesByMode[otherMode] || []) {
        if (item.track.id === trackId) {
          segmentIdsToDismiss.add(item.segment.id);
        }
      }
    }
    for (const item of queue) {
      if (item.track.id === trackId) {
        segmentIdsToDismiss.add(item.segment.id);
      }
    }
    for (const m of ["mixed", "slices_only", "original_only"] as PlaybackMode[]) {
      dismissedTrackIdsByMode[m].add(trackId);
      for (const sid of segmentIdsToDismiss) {
        dismissedSegmentIdsByMode[m].add(sid);
      }
    }
    const isPlayingPlaylist = Boolean(get().activePlaylistPlayingId);
    const removedBeforeCurrent = queueIndex > 0
      ? queue.slice(0, queueIndex).filter((item) => item.track.id === trackId).length
      : 0;
    const updatedQueuesByMode: Record<PlaybackMode, QueueItem[]> = {
      mixed: (queuesByMode.mixed || []).filter((item) => item.track.id !== trackId),
      slices_only: (queuesByMode.slices_only || []).filter((item) => item.track.id !== trackId),
      original_only: (queuesByMode.original_only || []).filter((item) => item.track.id !== trackId),
    };
    const newQueue = isPlayingPlaylist
      ? queue.filter((item) => item.track.id !== trackId)
      : updatedQueuesByMode[playbackMode];

    if (activeTrack?.id === trackId) {
      const wasPlaying = get().isPlaying;
      transitionActiveItemOnRemoval(
        set,
        get,
        newQueue,
        queueIndex - removedBeforeCurrent,
        wasPlaying,
        updatedQueuesByMode
      );
      return;
    }

    let newIndex = queueIndex;
    if (newQueue.length === 0) {
      newIndex = -1;
    } else {
      newIndex = queueIndex === -1 ? -1 : Math.max(0, Math.min(queueIndex - removedBeforeCurrent, newQueue.length - 1));
    }
    set({
      queue: newQueue,
      queueIndex: newIndex,
      activePlaylistOriginalQueue: isPlayingPlaylist
        ? get().activePlaylistOriginalQueue.filter((item) => item.track.id !== trackId)
        : get().activePlaylistOriginalQueue,
      activePlaylistPlayingId: isPlayingPlaylist && newQueue.length === 0 ? null : get().activePlaylistPlayingId,
      queuesByMode: isPlayingPlaylist ? queuesByMode : updatedQueuesByMode,
      initializedModes: isPlayingPlaylist ? get().initializedModes : {
        ...get().initializedModes,
        [playbackMode]: true,
      },
    });
  },

  removeSegmentFromQueue: (segmentId: string) => {
    for (const m of ["mixed", "slices_only", "original_only"] as PlaybackMode[]) {
      dismissedSegmentIdsByMode[m].add(segmentId);
    }
    const { queue, queueIndex, activeSegment, playbackMode, queuesByMode } = get();
    const isPlayingPlaylist = Boolean(get().activePlaylistPlayingId);
    const removedBeforeCurrent = queueIndex > 0
      ? queue.slice(0, queueIndex).filter((item) => item.segment.id === segmentId).length
      : 0;
    const updatedQueuesByMode: Record<PlaybackMode, QueueItem[]> = {
      mixed: (queuesByMode.mixed || []).filter((item) => item.segment.id !== segmentId),
      slices_only: (queuesByMode.slices_only || []).filter((item) => item.segment.id !== segmentId),
      original_only: (queuesByMode.original_only || []).filter((item) => item.segment.id !== segmentId),
    };
    const newQueue = isPlayingPlaylist
      ? queue.filter((item) => item.segment.id !== segmentId)
      : updatedQueuesByMode[playbackMode];

    if (activeSegment?.id === segmentId) {
      const wasPlaying = get().isPlaying;
      transitionActiveItemOnRemoval(
        set,
        get,
        newQueue,
        queueIndex - removedBeforeCurrent,
        wasPlaying,
        updatedQueuesByMode
      );
      return;
    }

    let newIndex = queueIndex;
    if (newQueue.length === 0) {
      newIndex = -1;
    } else {
      newIndex = queueIndex === -1 ? -1 : Math.max(0, Math.min(queueIndex - removedBeforeCurrent, newQueue.length - 1));
    }
    set({
      queue: newQueue,
      queueIndex: newIndex,
      activePlaylistOriginalQueue: isPlayingPlaylist
        ? get().activePlaylistOriginalQueue.filter((item) => item.segment.id !== segmentId)
        : get().activePlaylistOriginalQueue,
      activePlaylistPlayingId: isPlayingPlaylist && newQueue.length === 0 ? null : get().activePlaylistPlayingId,
      queuesByMode: isPlayingPlaylist ? queuesByMode : updatedQueuesByMode,
      initializedModes: isPlayingPlaylist ? get().initializedModes : {
        ...get().initializedModes,
        [playbackMode]: true,
      },
    });
  },

  removeQueueItemAtIndex: (index: number, modeOverride?: PlaybackMode) => {
    const { queue, queueIndex, playbackMode, queuesByMode, activeSegment, activeTrack, activePlaylistPlayingId } = get();
    const isPlayingPlaylist = Boolean(activePlaylistPlayingId);
    const targetMode = modeOverride || playbackMode;
    const targetQueue = targetMode === playbackMode ? queue : (queuesByMode[targetMode] || []);

    if (!Number.isInteger(index) || index < 0 || index >= targetQueue.length) return;
    const itemToRemove = targetQueue[index];
    if (itemToRemove && !isPlayingPlaylist) {
      dismissedSegmentIdsByMode[targetMode].add(itemToRemove.segment.id);
    }

    const newTargetQueue = targetQueue.filter((_, idx) => idx !== index);
    const updatedQueuesByMode: Record<PlaybackMode, QueueItem[]> = {
      ...queuesByMode,
      [targetMode]: newTargetQueue,
    };

    if (targetMode !== playbackMode) {
      set({
        queuesByMode: updatedQueuesByMode,
        initializedModes: {
          ...get().initializedModes,
          [targetMode]: true,
        },
      });
      return;
    }

    const isCurrent =
      activeSegment !== null &&
      itemToRemove !== undefined &&
      itemToRemove.segment.id === activeSegment.id &&
      (queueIndex === -1 || index === queueIndex);

    if (isCurrent) {
      const wasPlaying = get().isPlaying;
      transitionActiveItemOnRemoval(
        set,
        get,
        newTargetQueue,
        index,
        wasPlaying,
        updatedQueuesByMode
      );
      return;
    }

    let newIndex = queueIndex;
    if (newTargetQueue.length === 0) {
      newIndex = -1;
    } else if (queueIndex === -1) {
      newIndex = -1;
    } else if (index < queueIndex) {
      newIndex = Math.max(0, queueIndex - 1);
    } else {
      newIndex = Math.min(queueIndex, newTargetQueue.length - 1);
    }

    const removedItemId = itemToRemove?.queueItemId;
    const nextOrigQueue = isPlayingPlaylist
      ? get().activePlaylistOriginalQueue.filter((it) =>
          removedItemId
            ? it.queueItemId !== removedItemId
            : !(it.track.id === itemToRemove?.track.id && it.segment.id === itemToRemove?.segment.id)
        )
      : get().activePlaylistOriginalQueue;

    set({
      queue: newTargetQueue,
      queueIndex: newIndex,
      activePlaylistOriginalQueue: nextOrigQueue,
      activePlaylistPlayingId: isPlayingPlaylist && newTargetQueue.length === 0 ? null : get().activePlaylistPlayingId,
      queuesByMode: isPlayingPlaylist ? queuesByMode : updatedQueuesByMode,
      initializedModes: isPlayingPlaylist ? get().initializedModes : {
        ...get().initializedModes,
        [targetMode]: true,
      },
    });
  },

  reorderQueue: (fromIndex: number, toIndex: number, modeOverride?: PlaybackMode) => {
    const { queue, queueIndex, playbackMode, queuesByMode, initializedModes } = get();
    const targetMode = modeOverride || playbackMode;
    const targetQueue = targetMode === playbackMode ? queue : (queuesByMode[targetMode] || []);

    if (
      !Number.isInteger(fromIndex) ||
      !Number.isInteger(toIndex) ||
      fromIndex < 0 ||
      fromIndex >= targetQueue.length ||
      toIndex < 0 ||
      toIndex >= targetQueue.length ||
      fromIndex === toIndex
    ) {
      return;
    }

    const nextQueue = [...targetQueue];
    const [movedItem] = nextQueue.splice(fromIndex, 1);
    nextQueue.splice(toIndex, 0, movedItem);

    if (targetMode !== playbackMode) {
      set({
        queuesByMode: {
          ...queuesByMode,
          [targetMode]: nextQueue,
        },
        initializedModes: {
          ...initializedModes,
          [targetMode]: true,
        },
      });
      return;
    }

    let newIndex = queueIndex;
    if (queueIndex >= 0) {
      if (queueIndex === fromIndex) {
        newIndex = toIndex;
      } else if (fromIndex < queueIndex && toIndex >= queueIndex) {
        newIndex = queueIndex - 1;
      } else if (fromIndex > queueIndex && toIndex <= queueIndex) {
        newIndex = queueIndex + 1;
      }
    }

    const isPlayingPlaylist = Boolean(get().activePlaylistPlayingId);
    set({
      queue: nextQueue,
      queueIndex: newIndex,
      activePlaylistOriginalQueue:
        isPlayingPlaylist && !get().isShuffle
          ? nextQueue
          : get().activePlaylistOriginalQueue,
      queuesByMode: isPlayingPlaylist
        ? queuesByMode
        : {
            ...queuesByMode,
            [playbackMode]: nextQueue,
          },
      initializedModes: isPlayingPlaylist
        ? initializedModes
        : {
            ...initializedModes,
            [playbackMode]: true,
          },
    });
  },

  syncUpdatedSegment: (seg: Segment) => {
    for (const m of ["mixed", "slices_only", "original_only"] as PlaybackMode[]) {
      dismissedSegmentIdsByMode[m].delete(seg.id);
    }
    const { activeSegment, queuesByMode, playbackMode } = get();
    const updateSeg = (list: QueueItem[]) => {
      if (!list || !list.some((item) => item.segment.id === seg.id)) return list;
      return list.map((item) => (item.segment.id === seg.id ? { ...item, segment: seg } : item));
    };
    const updatedQueuesByMode: Record<PlaybackMode, QueueItem[]> = {
      mixed: updateSeg(queuesByMode.mixed),
      slices_only: updateSeg(queuesByMode.slices_only),
      original_only: updateSeg(queuesByMode.original_only),
    };
    const isPlayingPlaylist = Boolean(get().activePlaylistPlayingId);
    const newQueue = isPlayingPlaylist ? updateSeg(get().queue) : updatedQueuesByMode[playbackMode];
    const updates: Partial<PlayerState> = {
      queue: newQueue,
      queuesByMode: updatedQueuesByMode,
    };
    if (activeSegment?.id === seg.id) {
      updates.activeSegment = seg;
      audioEngine.updateCurrentSegmentBounds(seg.start_time, seg.end_time);
      const curTime = audioEngine.getCurrentTime();
      if (curTime < seg.start_time || curTime > seg.end_time) {
        audioEngine.seek(seg.start_time);
        updates.currentTime = seg.start_time;
      }
    }
    set(updates);
  },

  openSliceStudio: (track: Track) => {
    const freshTrack = get().tracks.find((t) => t.id === track.id) || track;
    set({ sliceStudioTrack: freshTrack });
  },

  closeSliceStudio: () => {
    set({ sliceStudioTrack: null });
  },

  setPlaybackMode: async (mode: PlaybackMode): Promise<boolean> => {
    if (mode === get().playbackMode) return true;
    const requestId = ++latestPlaybackModeRequestId;

    const { queuesByMode, initializedModes } = get();
    let targetQueue = queuesByMode[mode];
    const isInitialized = initializedModes[mode] || (targetQueue && targetQueue.length > 0);
    let didFetchSucceed = true;

    // If queue for this mode hasn't been created yet, populate it sequentially
    if (!isInitialized && (!targetQueue || targetQueue.length === 0)) {
      let segments: Segment[] = [];
      if (mode !== "original_only") {
        try {
          const res = await fetch("/api/segments");
          if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data)) {
              segments = data;
            } else {
              didFetchSucceed = false;
            }
          } else {
            didFetchSucceed = false;
          }
        } catch {
          didFetchSucceed = false;
        }
        // Guard against stale switch if another tab was clicked during network fetch
        if (requestId !== latestPlaybackModeRequestId) return false;

        if (!didFetchSucceed) {
          console.warn(`[Store] Failed to fetch segments for mode "${mode}"; aborting mode queue generation.`);
          return false;
        }
      }

      const freshTracks = get().tracks;
      targetQueue = generateModeQueueItems(mode, segments, freshTracks);
      if (get().shuffleByMode[mode]) {
        targetQueue = shuffleArray(targetQueue);
      }
    }

    if (requestId !== latestPlaybackModeRequestId) return false;

    const currentActiveSegment = get().activeSegment;
    const currentActiveTrack = get().activeTrack;
    let newIndex = -1;
    let newActiveSegment = currentActiveSegment;

    if (currentActiveSegment) {
      const foundIdx = targetQueue.findIndex((item) => item.segment.id === currentActiveSegment.id);
      if (foundIdx >= 0) {
        newIndex = foundIdx;
      }
    }
    if (newIndex === -1 && currentActiveTrack) {
      const foundTrkIdx = targetQueue.findIndex((item) => item.track.id === currentActiveTrack.id);
      if (foundTrkIdx >= 0) {
        newIndex = foundTrkIdx;
        const targetItem = targetQueue[foundTrkIdx];
        if (mode === "original_only" && targetItem.segment.id.startsWith("fallback_")) {
          newActiveSegment = targetItem.segment;
          audioEngine.updateCurrentSegmentBounds(targetItem.segment.start_time, targetItem.segment.end_time);
        }
      }
    }

    set({
      playbackMode: mode,
      activePlaylistPlayingId: null,
      initializedModes: {
        ...get().initializedModes,
        [mode]: true,
      },
      queuesByMode: {
        ...get().queuesByMode,
        [mode]: targetQueue,
      },
      activeSegment: newActiveSegment,
      queue: targetQueue,
      queueIndex: newIndex,
      isShuffle: get().shuffleByMode[mode],
    });
    return true;
  },

  buildShuffleQueue: (
    allSegments: Segment[],
    allTracks: Track[],
    modeOverride?: PlaybackMode,
    forceShuffle?: boolean
  ) => {
    const mode = modeOverride || get().playbackMode;
    clearDismissedSegments(mode);
    const { queuesByMode, shuffleByMode, activeSegment, activeTrack, initializedModes } = get();
    const shouldShuffle = forceShuffle !== undefined ? forceShuffle : shuffleByMode[mode];

    let items = generateModeQueueItems(mode, allSegments, allTracks);
    if (shouldShuffle) {
      items = shuffleArray(items);
    }

    let currentIndex = -1;
    if (activeSegment) {
      const foundIdx = items.findIndex((item) => item.segment.id === activeSegment.id);
      if (foundIdx >= 0) {
        currentIndex = foundIdx;
      } else if (activeTrack) {
        const foundTrkIdx = items.findIndex((item) => item.track.id === activeTrack.id);
        if (foundTrkIdx >= 0) {
          currentIndex = foundTrkIdx;
        }
      }
    } else if (get().queueIndex >= 0 && items.length > 0) {
      currentIndex = Math.min(get().queueIndex, items.length - 1);
    }

    let finalQueueIndex = -1;
    if (items.length > 0 && currentIndex >= 0) {
      finalQueueIndex = currentIndex;
    }

    const updatedQueuesByMode = {
      ...queuesByMode,
      [mode]: items,
    };
    const updatedShuffleByMode = {
      ...shuffleByMode,
      [mode]: shouldShuffle,
    };
    const updatedInitializedModes = {
      ...initializedModes,
      [mode]: true,
    };

    if (mode === get().playbackMode) {
      set({
        queuesByMode: updatedQueuesByMode,
        shuffleByMode: updatedShuffleByMode,
        initializedModes: updatedInitializedModes,
        queue: items,
        queueIndex: finalQueueIndex,
        isShuffle: shouldShuffle,
        activePlaylistPlayingId: null,
      });
    } else {
      set({
        queuesByMode: updatedQueuesByMode,
        shuffleByMode: updatedShuffleByMode,
        initializedModes: updatedInitializedModes,
      });
    }
  },

  reshuffleCurrentQueue: (modeOverride?: PlaybackMode) => {
    const { queue, playbackMode, queuesByMode, shuffleByMode, initializedModes } = get();
    const isPlayingPlaylist = Boolean(get().activePlaylistPlayingId);

    if (isPlayingPlaylist && !modeOverride) {
      if (queue.length <= 1) {
        set({ isShuffle: true });
        return;
      }
      const shuffled = shuffleArray(queue);
      const origQueue = get().activePlaylistOriginalQueue;
      const firstItem = shuffled[0];
      set({
        queue: shuffled,
        queueIndex: 0,
        isShuffle: true,
        activePlaylistOriginalQueue: origQueue && origQueue.length > 0 ? origQueue : [...queue],
        ...(firstItem ? { activeSegment: firstItem.segment, activeTrack: firstItem.track, currentTime: firstItem.segment.start_time } : {}),
      });
      if (firstItem) {
        void get().playSegment(firstItem.segment, firstItem.track, 0);
      }
      return;
    }

    const targetMode = modeOverride || playbackMode;
    const targetQueue = targetMode === playbackMode ? (queuesByMode[playbackMode]?.length ? queuesByMode[playbackMode] : queue) : (queuesByMode[targetMode] || []);

    if (targetQueue.length <= 1) {
      set({
        isShuffle: targetMode === playbackMode ? true : get().isShuffle,
        shuffleByMode: { ...shuffleByMode, [targetMode]: true },
        initializedModes: { ...initializedModes, [targetMode]: true },
      });
      return;
    }

    const shuffled = shuffleArray(targetQueue);

    if (targetMode !== playbackMode) {
      set({
        queuesByMode: {
          ...queuesByMode,
          [targetMode]: shuffled,
        },
        shuffleByMode: {
          ...shuffleByMode,
          [targetMode]: true,
        },
        initializedModes: {
          ...initializedModes,
          [targetMode]: true,
        },
      });
      return;
    }

    const firstItem = shuffled[0];
    set({
      queue: shuffled,
      queueIndex: 0,
      isShuffle: true,
      queuesByMode: {
        ...queuesByMode,
        [playbackMode]: shuffled,
      },
      shuffleByMode: {
        ...shuffleByMode,
        [playbackMode]: true,
      },
      initializedModes: {
        ...initializedModes,
        [playbackMode]: true,
      },
      ...(firstItem ? { activeSegment: firstItem.segment, activeTrack: firstItem.track, currentTime: firstItem.segment.start_time } : {}),
    });
    if (firstItem) {
      void get().playSegment(firstItem.segment, firstItem.track, 0);
    }
  },

  quickShufflePlay: async (allSegmentsOverride?: Segment[]) => {
    const activePlId = get().activePlaylistId;
    if (activePlId) {
      await get().buildPlaylistQueue(activePlId, true);
      return;
    }

    const requestedMode = get().playbackMode;
    let currentQueue = get().queuesByMode[requestedMode] || [];

    if (currentQueue.length === 0) {
      let segments: Segment[] = allSegmentsOverride || [];
      if (segments.length === 0 && requestedMode !== "original_only") {
        try {
          const res = await fetch("/api/segments");
          if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data)) {
              segments = data;
            }
          }
        } catch (e) {
          console.warn("[Store] Failed to fetch segments in quickShufflePlay:", e);
        }
      }

      const freshState = get();
      currentQueue = generateModeQueueItems(requestedMode, segments, freshState.tracks);
      if (currentQueue.length > 0) {
        set({
          queuesByMode: {
            ...freshState.queuesByMode,
            [requestedMode]: currentQueue,
          },
          queue: freshState.playbackMode === requestedMode ? currentQueue : freshState.queue,
          initializedModes: {
            ...freshState.initializedModes,
            [requestedMode]: true,
          },
        });
      }
    }

    if (currentQueue.length === 0) {
      // Fallback if the requested mode has no items (e.g. slices_only with no custom slices)
      const fallbackMode: PlaybackMode = requestedMode === "slices_only" ? "mixed" : "original_only";
      let fallbackQueue = get().queuesByMode[fallbackMode] || [];
      if (fallbackQueue.length === 0) {
        fallbackQueue = generateModeQueueItems(fallbackMode, [], get().tracks);
      }
      if (fallbackQueue.length > 0) {
        currentQueue = fallbackQueue;
      }
    }

    if (currentQueue.length === 0) return;

    shuffleTurnCounter++;

    // Always penalize the currently active segment (treated as just played at turn - 1) so it is never immediately re-picked
    const currentActiveSegment = get().activeSegment;
    if (currentActiveSegment) {
      shuffleHistory.set(currentActiveSegment.id, shuffleTurnCounter - 1);
    }

    // Prune stale history entries older than 30 turns when map grows
    if (shuffleHistory.size > 50) {
      for (const [id, turn] of shuffleHistory.entries()) {
        if (shuffleTurnCounter - turn > 30) {
          shuffleHistory.delete(id);
        }
      }
    }

    const pickResult = pickSmartRandomItem(
      currentQueue,
      (item) => item.segment.id,
      shuffleHistory,
      shuffleTurnCounter
    );

    if (!pickResult) return;

    const { item, index } = pickResult;
    shuffleHistory.set(item.segment.id, shuffleTurnCounter);

    // Sync target index with current mode's active queue
    const activeModeQueue = get().queuesByMode[get().playbackMode] || [];
    const targetIdx = activeModeQueue.findIndex((qItem) => qItem.segment.id === item.segment.id);

    await get().playSegment(item.segment, item.track, targetIdx >= 0 ? targetIdx : undefined);
  },

  ensureModeQueue: async (mode: PlaybackMode) => {
    const { queuesByMode, initializedModes } = get();
    if (initializedModes[mode] || (queuesByMode[mode] && queuesByMode[mode].length > 0)) {
      return;
    }
    if (inFlightEnsureModeFetches.has(mode)) {
      return;
    }
    inFlightEnsureModeFetches.add(mode);

    let segments: Segment[] = [];
    let didFetchSucceed = mode === "original_only";
    try {
      if (mode !== "original_only") {
        try {
          const res = await fetch("/api/segments");
          if (res.ok) {
            segments = await res.json();
            didFetchSucceed = true;
          } else {
            console.warn(`[Store] ensureModeQueue: /api/segments returned ${res.status} for mode "${mode}"; aborting initialization.`);
            return;
          }
        } catch (e) {
          console.warn(`[Store] ensureModeQueue: failed to fetch segments for "${mode}":`, e);
          return;
        }
      }

      if (!didFetchSucceed) {
        return;
      }

      // Guard against race conditions if setPlaybackMode or fetchTracks ran while fetch was pending
      if (get().initializedModes[mode] || (get().queuesByMode[mode] && get().queuesByMode[mode].length > 0)) {
        return;
      }

      const freshTracks = get().tracks;
      let targetQueue = generateModeQueueItems(mode, segments, freshTracks);
      if (get().shuffleByMode[mode]) {
        targetQueue = shuffleArray(targetQueue);
      }
      const isCurrentMode = mode === get().playbackMode;
      let newIndex = get().queueIndex;
      if (isCurrentMode) {
        const currentActiveSegment = get().activeSegment;
        const currentActiveTrack = get().activeTrack;
        if (currentActiveSegment) {
          const foundIdx = targetQueue.findIndex((item) => item.segment.id === currentActiveSegment.id);
          if (foundIdx >= 0) newIndex = foundIdx;
        }
        if (newIndex === -1 && currentActiveTrack) {
          const foundTrkIdx = targetQueue.findIndex((item) => item.track.id === currentActiveTrack.id);
          if (foundTrkIdx >= 0) newIndex = foundTrkIdx;
        }
      }

      set({
        queuesByMode: {
          ...get().queuesByMode,
          [mode]: targetQueue,
        },
        ...(isCurrentMode ? { queue: targetQueue, queueIndex: newIndex } : {}),
        initializedModes: {
          ...get().initializedModes,
          [mode]: true,
        },
      });
    } finally {
      inFlightEnsureModeFetches.delete(mode);
    }
  },

  fetchPlaylists: async () => {
    try {
      const res = await fetch("/api/playlists");
      if (res.ok) {
        const playlists = await res.json();
        if (Array.isArray(playlists)) {
          set({ playlists });
        }
      }
    } catch (e) {
      console.error("[Store] Failed to fetch playlists:", e);
    }
  },

  setActivePlaylist: async (id: string | null, force = false) => {
    if (!force && get().activePlaylistId === id) return;
    if (get().activePlaylistId !== id) {
      set({ activePlaylistId: id, activePlaylistItems: [] });
    }
    if (!id) return;
    try {
      const res = await fetch(`/api/playlists/${encodeURIComponent(id)}`);
      if (res.ok) {
        const data = await res.json();
        if (get().activePlaylistId === id) {
          set({ activePlaylistItems: data.items || [] });
        }
      }
    } catch (e) {
      console.error("[Store] Failed to fetch playlist details:", e);
    }
  },

  createPlaylist: async (name: string) => {
    try {
      const res = await fetch("/api/playlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        const pl: Playlist = await res.json();
        await get().fetchPlaylists();
        return pl;
      }
    } catch (e) {
      console.error("[Store] Failed to create playlist:", e);
    }
    return null;
  },

  deletePlaylist: async (id: string) => {
    try {
      const res = await fetch(`/api/playlists/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (res.ok) {
        const updates: Partial<PlayerState> = {};
        if (get().activePlaylistId === id) {
          updates.activePlaylistId = null;
          updates.activePlaylistItems = [];
        }
        if (get().activePlaylistPlayingId === id) {
          audioEngine.unload();
          updates.activePlaylistPlayingId = null;
          updates.activePlaylistOriginalQueue = [];
          updates.activeTrack = null;
          updates.activeSegment = null;
          updates.isPlaying = false;
          updates.currentTime = 0;
          const curMode = get().playbackMode;
          const fallbackQueue = get().queuesByMode[curMode] || [];
          updates.queue = fallbackQueue;
          updates.queueIndex = fallbackQueue.length > 0 ? 0 : -1;
        }
        if (Object.keys(updates).length > 0) {
          set(updates);
        }
        try {
          const selState = useSelectionStore.getState();
          const toDeselect: string[] = [];
          for (const [itemId, it] of selState.selectedItems) {
            if (it.playlistId === id) toDeselect.push(itemId);
          }
          if (toDeselect.length > 0) {
            selState.deselectTracks(toDeselect);
          }
        } catch {}
        await get().fetchPlaylists();
        return true;
      }
    } catch (e) {
      console.error("[Store] Failed to delete playlist:", e);
    }
    return false;
  },

  renamePlaylist: async (id: string, name: string) => {
    try {
      const res = await fetch(`/api/playlists/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        await get().fetchPlaylists();
        return true;
      }
    } catch (e) {
      console.error("[Store] Failed to rename playlist:", e);
    }
    return false;
  },

  addToPlaylist: async (playlistId: string, trackId: string, segmentId?: string | null) => {
    try {
      const res = await fetch(`/api/playlists/${encodeURIComponent(playlistId)}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ track_id: trackId, segment_id: segmentId ?? null }),
      });
      if (res.ok) {
        try {
          const newItem = await res.json();
          if (newItem && get().activePlaylistPlayingId === playlistId) {
            const isAlreadyInQueue = get().queue.some((it) => it.queueItemId === newItem.id);
            if (!isAlreadyInQueue) {
              const track = newItem.track || get().tracks.find((t) => t.id === trackId);
              if (track) {
                const seg = (newItem.segment_id && newItem.segment)
                  ? newItem.segment
                  : createDefaultFullSegment(track);
                const queueItem = createQueueItem(seg, track, newItem.id);
                set({
                  queue: [...get().queue, queueItem],
                  activePlaylistOriginalQueue: [...get().activePlaylistOriginalQueue, queueItem],
                });
              }
            }
          }
        } catch {}
        await get().fetchPlaylists();
        if (get().activePlaylistId === playlistId) {
          await get().setActivePlaylist(playlistId, true);
        }
        return true;
      }
    } catch (e) {
      console.error("[Store] Failed to add item to playlist:", e);
    }
    return false;
  },

  addItemsToPlaylistBatch: async (playlistId: string, itemsOrTrackIds: (string | { track_id: string; segment_id?: string | null })[]) => {
    if (!playlistId || !itemsOrTrackIds || itemsOrTrackIds.length === 0) return false;
    try {
      const payload = typeof itemsOrTrackIds[0] === "string"
        ? { trackIds: itemsOrTrackIds as string[] }
        : { items: itemsOrTrackIds };
      const res = await fetch(`/api/playlists/${encodeURIComponent(playlistId)}/items/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        try {
          const data = await res.json();
          const newItems: PlaylistItemWithDetails[] = Array.isArray(data?.items) ? data.items : [];
          if (newItems.length > 0 && get().activePlaylistPlayingId === playlistId) {
            const currentQueue = get().queue;
            const existingQueueItemIds = new Set(currentQueue.map((it) => it.queueItemId).filter(Boolean));
            const itemsToAdd: QueueItem[] = [];

            for (const newItem of newItems) {
              if (existingQueueItemIds.has(newItem.id)) continue;
              const track = newItem.track || get().tracks.find((t) => t.id === newItem.track_id);
              if (track) {
                const seg = newItem.segment_id && newItem.segment
                  ? newItem.segment
                  : createDefaultFullSegment(track);
                const queueItem = createQueueItem(seg, track, newItem.id);
                itemsToAdd.push(queueItem);
                existingQueueItemIds.add(newItem.id);
              }
            }

            if (itemsToAdd.length > 0) {
              set({
                queue: [...get().queue, ...itemsToAdd],
                activePlaylistOriginalQueue: [...get().activePlaylistOriginalQueue, ...itemsToAdd],
              });
            }
          }
        } catch {}
        await get().fetchPlaylists();
        if (get().activePlaylistId === playlistId) {
          await get().setActivePlaylist(playlistId, true);
        }
        return true;
      }
    } catch (e) {
      console.error("[Store] Failed to batch add items to playlist:", e);
    }
    return false;
  },

  addTracksToPlaylistBatch: async (playlistId: string, itemsOrTrackIds: (string | { track_id: string; segment_id?: string | null })[]) => {
    return get().addItemsToPlaylistBatch(playlistId, itemsOrTrackIds);
  },

  deleteTracksBatch: async (trackIds: string[]) => {
    if (!trackIds || trackIds.length === 0) return false;
    try {
      const res = await fetch("/api/tracks/batch-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: trackIds }),
      });
      if (res.ok) {
        useSelectionStore.getState().deselectTracks(trackIds);
        const delSet = new Set(trackIds);
        const { queue, queueIndex, activeTrack, playbackMode, queuesByMode } = get();

        // Dismiss tracks and their segments from modes
        for (const tid of trackIds) {
          for (const m of ["mixed", "slices_only", "original_only"] as PlaybackMode[]) {
            dismissedTrackIdsByMode[m].add(tid);
            dismissedSegmentIdsByMode[m].add(`fallback_${tid}`);
          }
        }
        for (const otherMode of ["mixed", "slices_only", "original_only"] as PlaybackMode[]) {
          for (const item of queuesByMode[otherMode] || []) {
            if (delSet.has(item.track.id)) {
              for (const m of ["mixed", "slices_only", "original_only"] as PlaybackMode[]) {
                dismissedSegmentIdsByMode[m].add(item.segment.id);
              }
            }
          }
        }

        const isPlayingPlaylist = Boolean(get().activePlaylistPlayingId);
        const updatedQueuesByMode: Record<PlaybackMode, QueueItem[]> = {
          mixed: (queuesByMode.mixed || []).filter((item) => !delSet.has(item.track.id)),
          slices_only: (queuesByMode.slices_only || []).filter((item) => !delSet.has(item.track.id)),
          original_only: (queuesByMode.original_only || []).filter((item) => !delSet.has(item.track.id)),
        };

        const currentItem = queue[queueIndex];
        const isRemovingActive = activeTrack && delSet.has(activeTrack.id);
        const newQueue = isPlayingPlaylist
          ? queue.filter((item) => !delSet.has(item.track.id))
          : (queuesByMode[playbackMode] && queuesByMode[playbackMode].length > 0)
          ? updatedQueuesByMode[playbackMode]
          : queue.filter((item) => !delSet.has(item.track.id));

        const removedBeforeCurrent = queueIndex > 0
          ? queue.slice(0, queueIndex).filter((item) => delSet.has(item.track.id)).length
          : 0;

        if (isRemovingActive) {
          const wasPlaying = get().isPlaying;
          transitionActiveItemOnRemoval(
            set,
            get,
            newQueue,
            queueIndex - removedBeforeCurrent,
            wasPlaying,
            updatedQueuesByMode
          );
        } else {
          let newIndex = queueIndex;
          if (newQueue.length === 0) {
            newIndex = -1;
          } else if (queueIndex !== -1) {
            const activeItemIndex = currentItem
              ? newQueue.findIndex((it) => it.queueItemId === currentItem.queueItemId && it.segment.id === currentItem.segment.id)
              : -1;
            newIndex = activeItemIndex !== -1
              ? activeItemIndex
              : Math.max(0, Math.min(queueIndex - removedBeforeCurrent, newQueue.length - 1));
          }

          set({
            queue: newQueue,
            queueIndex: newIndex,
            activePlaylistOriginalQueue: isPlayingPlaylist
              ? get().activePlaylistOriginalQueue.filter((item) => !delSet.has(item.track.id))
              : get().activePlaylistOriginalQueue,
            activePlaylistPlayingId: isPlayingPlaylist && newQueue.length === 0 ? null : get().activePlaylistPlayingId,
            queuesByMode: isPlayingPlaylist ? queuesByMode : updatedQueuesByMode,
            initializedModes: isPlayingPlaylist ? get().initializedModes : {
              ...get().initializedModes,
              [playbackMode]: true,
            },
          });
        }

        await get().fetchTracks(true);
        await get().fetchPlaylists();
        if (get().activePlaylistId) {
          await get().setActivePlaylist(get().activePlaylistId, true);
        }
        return true;
      }
    } catch (e) {
      console.error("[Store] Failed to batch delete tracks:", e);
    }
    return false;
  },

  deleteSegmentsBatch: async (segmentIds: string[]) => {
    if (!segmentIds || segmentIds.length === 0) return false;
    try {
      const res = await fetch("/api/segments/batch-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: segmentIds }),
      });
      if (res.ok) {
        useSelectionStore.getState().deselectTracks(segmentIds);
        const delSet = new Set(segmentIds);
        for (const sid of segmentIds) {
          for (const m of ["mixed", "slices_only", "original_only"] as PlaybackMode[]) {
            dismissedSegmentIdsByMode[m].add(sid);
          }
        }
        const { queue, queueIndex, activeSegment, playbackMode, queuesByMode } = get();
        const isPlayingPlaylist = Boolean(get().activePlaylistPlayingId);
        const updatedQueuesByMode: Record<PlaybackMode, QueueItem[]> = {
          mixed: (queuesByMode.mixed || []).filter((item) => !delSet.has(item.segment.id)),
          slices_only: (queuesByMode.slices_only || []).filter((item) => !delSet.has(item.segment.id)),
          original_only: (queuesByMode.original_only || []).filter((item) => !delSet.has(item.segment.id)),
        };

        const currentItem = queue[queueIndex];
        const isRemovingActive = activeSegment && delSet.has(activeSegment.id);
        const newQueue = isPlayingPlaylist
          ? queue.filter((item) => !delSet.has(item.segment.id))
          : (queuesByMode[playbackMode] && queuesByMode[playbackMode].length > 0)
          ? updatedQueuesByMode[playbackMode]
          : queue.filter((item) => !delSet.has(item.segment.id));

        const removedBeforeCurrent = queueIndex > 0
          ? queue.slice(0, queueIndex).filter((item) => delSet.has(item.segment.id)).length
          : 0;

        if (isRemovingActive) {
          const wasPlaying = get().isPlaying;
          transitionActiveItemOnRemoval(
            set,
            get,
            newQueue,
            queueIndex - removedBeforeCurrent,
            wasPlaying,
            updatedQueuesByMode
          );
        } else {
          let newIndex = queueIndex;
          if (newQueue.length === 0) {
            newIndex = -1;
          } else if (queueIndex !== -1) {
            const activeItemIndex = currentItem
              ? newQueue.findIndex((it) => it.queueItemId === currentItem.queueItemId && it.segment.id === currentItem.segment.id)
              : -1;
            newIndex = activeItemIndex !== -1
              ? activeItemIndex
              : Math.max(0, Math.min(queueIndex - removedBeforeCurrent, newQueue.length - 1));
          }

          set({
            queue: newQueue,
            queueIndex: newIndex,
            activePlaylistOriginalQueue: isPlayingPlaylist
              ? get().activePlaylistOriginalQueue.filter((item) => !delSet.has(item.segment.id))
              : get().activePlaylistOriginalQueue,
            activePlaylistPlayingId: isPlayingPlaylist && newQueue.length === 0 ? null : get().activePlaylistPlayingId,
            queuesByMode: isPlayingPlaylist ? queuesByMode : updatedQueuesByMode,
            initializedModes: isPlayingPlaylist ? get().initializedModes : {
              ...get().initializedModes,
              [playbackMode]: true,
            },
          });
        }

        await get().fetchTracks(true);
        await get().fetchPlaylists();
        if (get().activePlaylistId) {
          await get().setActivePlaylist(get().activePlaylistId, true);
        }
        return true;
      }
    } catch (e) {
      console.error("[Store] Failed to batch delete segments:", e);
    }
    return false;
  },

  removePlaylistItemsBatch: async (playlistId: string, itemIds: string[]) => {
    if (!playlistId || !itemIds || itemIds.length === 0) return false;
    const prevItems = get().activePlaylistItems;
    if (get().activePlaylistId === playlistId) {
      const removeSet = new Set(itemIds);
      set({ activePlaylistItems: prevItems.filter((it) => !removeSet.has(it.id)) });
    }
    try {
      const res = await fetch(`/api/playlists/${encodeURIComponent(playlistId)}/items/batch-delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemIds }),
      });
      if (res.ok) {
        useSelectionStore.getState().deselectTracks(itemIds);
        if (get().activePlaylistPlayingId === playlistId) {
          const removeSet = new Set(itemIds);
          const currentItem = get().queue[get().queueIndex];
          const isRemovingActive = currentItem?.queueItemId ? removeSet.has(currentItem.queueItemId) : false;
          const updatedQ = get().queue.filter((it) => !it.queueItemId || !removeSet.has(it.queueItemId));
          const updatedOrig = get().activePlaylistOriginalQueue.filter((it) => !it.queueItemId || !removeSet.has(it.queueItemId));

          let newQIdx: number;
          if (updatedQ.length === 0) {
            newQIdx = -1;
          } else if (isRemovingActive) {
            newQIdx = Math.max(0, Math.min(get().queueIndex, updatedQ.length - 1));
          } else {
            const activeItemIndex = currentItem
              ? updatedQ.findIndex((it) => it.queueItemId === currentItem.queueItemId)
              : -1;
            newQIdx =
              get().queueIndex === -1
                ? -1
                : activeItemIndex !== -1
                ? activeItemIndex
                : Math.max(0, Math.min(get().queueIndex, updatedQ.length - 1));
          }

          if (isRemovingActive) {
            if (updatedQ.length === 0) {
              audioEngine.unload();
              set({
                queue: [],
                queueIndex: -1,
                activeTrack: null,
                activeSegment: null,
                isPlaying: false,
                currentTime: 0,
                activePlaylistPlayingId: null,
                activePlaylistOriginalQueue: [],
              });
            } else {
              const nextItem = updatedQ[newQIdx];
              const trackGain = normalizeTrackVolume(nextItem.track.volume, 0.5);
              audioEngine.setVolume(trackGain);
              set({
                queue: updatedQ,
                queueIndex: newQIdx,
                activeTrack: nextItem.track,
                activeSegment: nextItem.segment,
                currentTime: nextItem.segment.start_time,
                volume: trackGain,
                activePlaylistOriginalQueue: updatedOrig,
              });
              audioEngine.unload();
              if (get().isPlaying) {
                get().playSegment(nextItem.segment, nextItem.track, newQIdx);
              }
            }
          } else {
            if (updatedQ.length === 0) {
              audioEngine.unload();
            }
            set({
              queue: updatedQ,
              queueIndex: newQIdx,
              activePlaylistOriginalQueue: updatedQ.length === 0 ? [] : updatedOrig,
              activePlaylistPlayingId: updatedQ.length === 0 ? null : get().activePlaylistPlayingId,
              ...(updatedQ.length === 0 ? { activeTrack: null, activeSegment: null, isPlaying: false, currentTime: 0 } : {}),
            });
          }
        }
        await get().fetchPlaylists();
        if (get().activePlaylistId === playlistId) {
          await get().setActivePlaylist(playlistId, true);
        }
        return true;
      } else {
        if (get().activePlaylistId === playlistId) {
          set({ activePlaylistItems: prevItems });
        }
      }
    } catch (e) {
      console.error("[Store] Failed to batch remove playlist items:", e);
      if (get().activePlaylistId === playlistId) {
        set({ activePlaylistItems: prevItems });
      }
    }
    return false;
  },

  removeFromPlaylist: async (playlistId: string, itemId: string) => {
    const prevItems = get().activePlaylistItems;
    if (get().activePlaylistId === playlistId) {
      set({ activePlaylistItems: prevItems.filter((it) => it.id !== itemId) });
    }
    try {
      const res = await fetch(`/api/playlists/${encodeURIComponent(playlistId)}/items/${encodeURIComponent(itemId)}`, {
        method: "DELETE",
      });
      if (res.ok) {
        useSelectionStore.getState().deselectTracks([itemId]);
        if (get().activePlaylistPlayingId === playlistId) {
          const currentItem = get().queue[get().queueIndex];
          const isRemovingActive = currentItem?.queueItemId === itemId;
          const updatedQ = get().queue.filter((it) => it.queueItemId !== itemId);
          let newQIdx: number;
          if (updatedQ.length === 0) {
            newQIdx = -1;
          } else if (isRemovingActive) {
            newQIdx = Math.max(0, Math.min(get().queueIndex, updatedQ.length - 1));
          } else {
            const activeItemIndex = currentItem
              ? updatedQ.findIndex((it) => it.queueItemId === currentItem.queueItemId)
              : -1;
            newQIdx =
              get().queueIndex === -1
                ? -1
                : activeItemIndex !== -1
                ? activeItemIndex
                : Math.max(0, Math.min(get().queueIndex, updatedQ.length - 1));
          }

          if (isRemovingActive) {
            if (updatedQ.length === 0) {
              audioEngine.unload();
              set({
                queue: [],
                queueIndex: -1,
                activeTrack: null,
                activeSegment: null,
                isPlaying: false,
                currentTime: 0,
                activePlaylistPlayingId: null,
                activePlaylistOriginalQueue: [],
              });
            } else {
              const nextItem = updatedQ[newQIdx];
              const trackGain = normalizeTrackVolume(nextItem.track.volume, 0.5);
              audioEngine.setVolume(trackGain);
              set({
                queue: updatedQ,
                queueIndex: newQIdx,
                activeTrack: nextItem.track,
                activeSegment: nextItem.segment,
                currentTime: nextItem.segment.start_time,
                volume: trackGain,
                activePlaylistOriginalQueue: get().activePlaylistOriginalQueue.filter((it) => it.queueItemId !== itemId),
              });
              audioEngine.unload();
              if (get().isPlaying) {
                get().playSegment(nextItem.segment, nextItem.track, newQIdx);
              }
            }
          } else {
            if (updatedQ.length === 0) {
              audioEngine.unload();
            }
            set({
              queue: updatedQ,
              queueIndex: newQIdx,
              activePlaylistOriginalQueue: updatedQ.length === 0 ? [] : get().activePlaylistOriginalQueue.filter((it) => it.queueItemId !== itemId),
              activePlaylistPlayingId: updatedQ.length === 0 ? null : get().activePlaylistPlayingId,
              ...(updatedQ.length === 0 ? { activeTrack: null, activeSegment: null, isPlaying: false, currentTime: 0 } : {}),
            });
          }
        }
        await get().fetchPlaylists();
        if (get().activePlaylistId === playlistId) {
          await get().setActivePlaylist(playlistId, true);
        }
        return true;
      } else {
        if (get().activePlaylistId === playlistId) {
          set({ activePlaylistItems: prevItems });
        }
      }
    } catch (e) {
      console.error("[Store] Failed to remove item from playlist:", e);
      if (get().activePlaylistId === playlistId) {
        set({ activePlaylistItems: prevItems });
      }
    }
    return false;
  },

  reorderPlaylist: async (playlistId: string, itemIds: string[]) => {
    const currentItems = get().activePlaylistItems;
    const prevQueue = get().queue;
    const prevQueueIndex = get().queueIndex;
    const prevOrigQueue = get().activePlaylistOriginalQueue;

    if (get().activePlaylistId === playlistId) {
      const itemMap = new Map(currentItems.map((it) => [it.id, it]));
      const optimistic = itemIds.map((id) => itemMap.get(id)!).filter(Boolean);
      set({ activePlaylistItems: optimistic });
    }
    if (get().activePlaylistPlayingId === playlistId) {
      const orderMap = new Map(itemIds.map((id, idx) => [id, idx]));
      const reorderedOrig = [...get().activePlaylistOriginalQueue].sort(
        (a, b) => (orderMap.get(a.queueItemId || "") ?? 999999) - (orderMap.get(b.queueItemId || "") ?? 999999)
      );
      if (!get().isShuffle) {
        const currentItemId = get().queue[get().queueIndex]?.queueItemId;
        const reorderedQ = [...get().queue].sort(
          (a, b) => (orderMap.get(a.queueItemId || "") ?? 999999) - (orderMap.get(b.queueItemId || "") ?? 999999)
        );
        const newIdx = reorderedQ.findIndex((it) => it.queueItemId === currentItemId);
        set({
          queue: reorderedQ,
          queueIndex: newIdx >= 0 ? newIdx : get().queueIndex,
          activePlaylistOriginalQueue: reorderedOrig,
        });
      } else {
        set({ activePlaylistOriginalQueue: reorderedOrig });
      }
    }

    const rollback = () => {
      const updates: Partial<PlayerState> = {};
      if (get().activePlaylistId === playlistId) {
        updates.activePlaylistItems = currentItems;
      }
      if (get().activePlaylistPlayingId === playlistId) {
        updates.queue = prevQueue;
        updates.queueIndex = prevQueueIndex;
        updates.activePlaylistOriginalQueue = prevOrigQueue;
      }
      if (Object.keys(updates).length > 0) {
        set(updates);
      }
    };

    try {
      const res = await fetch(`/api/playlists/${encodeURIComponent(playlistId)}/reorder`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemIds }),
      });
      if (res.ok) {
        return true;
      } else {
        rollback();
      }
    } catch (e) {
      console.error("[Store] Failed to reorder playlist:", e);
      rollback();
    }
    return false;
  },

  setViewMode: (mode: "grid" | "list") => {
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.setItem("slice_player_view", mode);
      }
    } catch {}
    set({ viewMode: mode });
  },

  buildPlaylistQueue: async (
    playlistId: string,
    forceShuffle = false,
    startIndexOrItemId: number | string = 0,
    keepCurrentTrack = false
  ) => {
    try {
      let items: PlaylistItemWithDetails[] = [];
      if (playlistId === get().activePlaylistId && get().activePlaylistItems.length > 0) {
        items = get().activePlaylistItems;
      } else {
        const res = await fetch(`/api/playlists/${encodeURIComponent(playlistId)}`);
        if (!res.ok) return;
        const data = await res.json();
        items = data.items || [];
      }
      const validItems = items.filter(
        (it) => it.track && it.track.status === "ready" && it.track.duration > 0
      );
      if (validItems.length === 0) return;

      const rawQueueItems: QueueItem[] = validItems.map((item) => {
        const seg = item.segment || createDefaultFullSegment(item.track);
        return createQueueItem(seg, item.track, item.id);
      });

      let queueItems = [...rawQueueItems];
      let targetIndex = 0;

      if (keepCurrentTrack && get().activeTrack) {
        const curTrackId = get().activeTrack!.id;
        const curSegId = get().activeSegment?.id;

        // Prefer matching exact slice if playing a non-fallback segment, otherwise match track
        let matchIdx = -1;
        if (curSegId && !curSegId.startsWith("fallback_")) {
          matchIdx = queueItems.findIndex((it) => it.segment.id === curSegId);
        }
        if (matchIdx === -1) {
          matchIdx = queueItems.findIndex((it) => it.track.id === curTrackId);
        }

        if (matchIdx !== -1) {
          const matchedItem = queueItems[matchIdx];
          const remainingItems = queueItems.filter((_, idx) => idx !== matchIdx);
          const finalRest = forceShuffle ? shuffleArray(remainingItems) : remainingItems;
          queueItems = [matchedItem, ...finalRest];
          targetIndex = 0;

          set({
            queue: queueItems,
            queueIndex: 0,
            isShuffle: forceShuffle,
            activePlaylistPlayingId: playlistId,
            activePlaylistOriginalQueue: rawQueueItems,
          });

          // If current track and segment are already actively playing, do not call playSegment to avoid restarting audio
          const isCurrentlyPlayingThis =
            get().isPlaying &&
            get().activeTrack?.id === matchedItem.track.id &&
            get().activeSegment?.id === matchedItem.segment.id;

          if (!isCurrentlyPlayingThis) {
            await get().playSegment(matchedItem.segment, matchedItem.track, 0);
          }
          return;
        }
      }

      if (typeof startIndexOrItemId === "string") {
        const found = queueItems.findIndex((it) => it.queueItemId === startIndexOrItemId);
        if (found !== -1) {
          targetIndex = found;
        }
      } else {
        targetIndex = Math.max(0, Math.min(startIndexOrItemId, queueItems.length - 1));
      }

      if (forceShuffle) {
        queueItems = shuffleArray(queueItems);
        targetIndex = 0;
      }

      set({
        queue: queueItems,
        queueIndex: targetIndex,
        isShuffle: forceShuffle,
        activePlaylistPlayingId: playlistId,
        activePlaylistOriginalQueue: rawQueueItems,
      });

      if (queueItems.length > 0) {
        const target = queueItems[targetIndex];
        await get().playSegment(target.segment, target.track, targetIndex);
      }
    } catch (e) {
      console.error("[Store] Failed to build playlist queue:", e);
    }
  },

  playPlaylistItemAtIndex: async (playlistId: string, indexOrItemId: number | string) => {
    await get().buildPlaylistQueue(playlistId, false, indexOrItemId);
  },

  playModeQueue: async (mode: PlaybackMode, startIndex = 0, forceShuffle = false) => {
    try {
      let modeItems = get().queuesByMode[mode] || [];
      if (modeItems.length === 0) {
        let segments: Segment[] = [];
        if (mode !== "original_only") {
          try {
            const res = await fetch("/api/segments");
            if (res.ok) segments = await res.json();
          } catch {}
        }
        modeItems = generateModeQueueItems(mode, segments, get().tracks);
      }
      if (modeItems.length === 0) return;

      let queueItems = [...modeItems];
      if (forceShuffle) {
        queueItems = shuffleArray(queueItems);
        startIndex = 0;
      }
      const clampedIndex = Math.max(0, Math.min(startIndex, queueItems.length - 1));
      set({
        queue: queueItems,
        queueIndex: clampedIndex,
        isShuffle: forceShuffle,
        playbackMode: mode,
        activePlaylistPlayingId: null,
        queuesByMode: {
          ...get().queuesByMode,
          [mode]: queueItems,
        },
        initializedModes: {
          ...get().initializedModes,
          [mode]: true,
        },
      });
      const target = queueItems[clampedIndex];
      if (target) {
        await get().playSegment(target.segment, target.track, clampedIndex);
      }
    } catch (e) {
      console.error(`[Store] Failed to play mode queue for "${mode}":`, e);
    }
  },

  playSegmentInMode: async (mode: PlaybackMode, segment: Segment, track: Track) => {
    try {
      let modeItems = get().queuesByMode[mode] || [];
      if (modeItems.length === 0) {
        let segments: Segment[] = [];
        if (mode !== "original_only") {
          try {
            const res = await fetch("/api/segments");
            if (res.ok) segments = await res.json();
          } catch {}
        }
        modeItems = generateModeQueueItems(mode, segments, get().tracks);
      }
      let idx = modeItems.findIndex((it) => it.segment.id === segment.id);
      if (idx === -1) {
        const newItem = createQueueItem(segment, track);
        modeItems = [newItem, ...modeItems];
        idx = 0;
      }
      set({
        queue: modeItems,
        queueIndex: idx,
        playbackMode: mode,
        activePlaylistPlayingId: null,
        queuesByMode: {
          ...get().queuesByMode,
          [mode]: modeItems,
        },
        initializedModes: {
          ...get().initializedModes,
          [mode]: true,
        },
      });
      await get().playSegment(segment, track, idx);
    } catch (e) {
      console.error(`[Store] Failed to play segment in mode "${mode}":`, e);
    }
  },
}));

// Mid-stream audio element error listener to prevent UI lockup
audioEngine.setOnErrorCallback((err) => {
  if (activeInitiationCount > 0) {
    // Ignored here because playSegment catch block is already handling the initial load error
    return;
  }
  console.warn("[Store] Mid-stream audio element error:", err);
  const { isPlaying, queue, nextSegment, activeSegment, activeTrack } = usePlayerStore.getState();
  const trackTitle = activeTrack?.title || "Unknown Title";
  logClientError("playback", `Mid-stream playback error for [${trackTitle}]: error code ${err?.code ?? "unknown"}`, {
    code: err?.code,
    message: err?.message,
    segmentId: activeSegment?.id,
  });

  if (isPlaying) {
    usePlayerStore.setState({ isPlaying: false });
    if (queue.length > 1 && consecutivePlaybackFailures < Math.min(3, queue.length)) {
      consecutivePlaybackFailures++;
      if (autoSkipTimer) clearTimeout(autoSkipTimer);
      autoSkipTimer = setTimeout(() => {
        autoSkipTimer = null;
        const state = usePlayerStore.getState();
        if (!state.isPlaying && state.activeSegment?.id === activeSegment?.id) {
          nextSegment();
        }
      }, 1000);
    } else {
      consecutivePlaybackFailures = 0;
    }
  }
});

// Audio element buffering listener for loading spinner feedback
audioEngine.setOnBufferingCallback((isBuffering) => {
  usePlayerStore.setState({ isBuffering });
});

