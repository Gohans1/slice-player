import { create } from "zustand";
import { audioEngine } from "../lib/audio";
import { createDefaultFullSegment } from "../lib/utils";
import type { Track, Segment } from "@/server/types";

export interface QueueItem {
  segment: Segment;
  track: Track;
}

export type PlaybackMode = "mixed" | "slices_only" | "original_only";

interface PlayerState {
  tracks: Track[];
  isLoadingTracks: boolean;
  activeTrack: Track | null;
  activeSegment: Segment | null;
  isPlaying: boolean;
  isShuffle: boolean;
  playbackMode: PlaybackMode;
  currentTime: number;
  volume: number;
  queue: QueueItem[];
  queueIndex: number;
  sliceStudioTrack: Track | null;

  // Actions
  fetchTracks: (reconcileSegments?: boolean) => Promise<void>;
  playSegment: (segment: Segment, track: Track, overrideIndex?: number) => Promise<void>;
  pause: () => void;
  togglePlay: () => Promise<void>;
  nextSegment: () => void;
  prevSegment: () => void;
  toggleShuffle: () => void;
  setPlaybackMode: (mode: PlaybackMode) => Promise<void>;
  setVolume: (vol: number) => void;
  setCurrentTime: (t: number) => void;
  seek: (seconds: number) => void;
  removeTrackFromQueue: (trackId: string) => void;
  removeSegmentFromQueue: (segmentId: string) => void;
  openSliceStudio: (track: Track) => void;
  closeSliceStudio: () => void;
  buildShuffleQueue: (allSegments: Segment[], allTracks: Track[], modeOverride?: PlaybackMode) => void;
  syncUpdatedSegment: (seg: Segment) => void;
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  tracks: [],
  isLoadingTracks: false,
  activeTrack: null,
  activeSegment: null,
  isPlaying: false,
  isShuffle: true, // Default to shuffle segments!
  playbackMode: "mixed",
  currentTime: 0,
  volume: 0.8,
  queue: [],
  queueIndex: -1,
  sliceStudioTrack: null,

  fetchTracks: async (reconcileSegments = true) => {
    if (get().tracks.length === 0) {
      set({ isLoadingTracks: true });
    }
    try {
      const res = await fetch("/api/tracks");
      if (res.ok) {
        const tracks: Track[] = await res.json();
        const trackMap = new Map(tracks.map((t) => [t.id, t]));
        const { activeTrack, activeSegment, sliceStudioTrack, queue, queueIndex } = get();

        const currentItem = queueIndex >= 0 ? queue[queueIndex] : null;

        if (!reconcileSegments) {
          // Fast path for polling: only update track list and prune deleted tracks from queue
          const validQueue = queue.filter((item) => trackMap.has(item.track.id));
          const updates: Partial<PlayerState> = { tracks };
          if (validQueue.length !== queue.length) {
            const newIdx = validQueue.length === 0
              ? -1
              : currentItem
                ? validQueue.findIndex((it) => it.segment.id === currentItem.segment.id)
                : Math.max(0, Math.min(queueIndex, validQueue.length - 1));
            updates.queue = validQueue;
            updates.queueIndex = newIdx >= 0 ? newIdx : 0;
          }
          set(updates);
          return;
        }

        // Full reconciliation path: fetch segments to purge deleted segments across tabs
        let validSegments: Segment[] = [];
        try {
          const segRes = await fetch("/api/segments");
          if (segRes.ok) validSegments = await segRes.json();
        } catch {}
        const segmentMap = new Set(validSegments.map((s) => s.id));
        const segmentObjMap = new Map(validSegments.map((s) => [s.id, s]));

        // Reconcile queue: replace fallback_ with real slices or retain both in mixed mode
        const validQueue = queue.flatMap((item) => {
          if (!trackMap.has(item.track.id)) return [];
          if (item.segment.id.startsWith("fallback_")) {
            const trackSlices = validSegments.filter((s) => s.track_id === item.track.id);
            if (trackSlices.length > 0) {
              if (get().playbackMode === "mixed") {
                return [item, ...trackSlices.map((s) => ({ segment: s, track: item.track }))];
              }
              return trackSlices.map((s) => ({ segment: s, track: item.track }));
            }
            return [item];
          }
          if (!segmentMap.has(item.segment.id)) return [];
          const freshSeg = segmentObjMap.get(item.segment.id);
          return freshSeg ? [{ ...item, segment: freshSeg }] : [item];
        });

        if (validQueue.length !== queue.length) {
          const newIdx = validQueue.length === 0
            ? -1
            : currentItem
              ? validQueue.findIndex((it) => it.segment.id === currentItem.segment.id)
              : Math.max(0, Math.min(queueIndex, validQueue.length - 1));
          set({ queue: validQueue, queueIndex: newIdx >= 0 ? newIdx : 0 });
        }

        if (activeTrack && !trackMap.has(activeTrack.id)) {
          get().removeTrackFromQueue(activeTrack.id);
        }
        if (activeSegment && !activeSegment.id.startsWith("fallback_") && !segmentMap.has(activeSegment.id)) {
          get().removeSegmentFromQueue(activeSegment.id);
        }
        if (sliceStudioTrack && !trackMap.has(sliceStudioTrack.id)) {
          set({ sliceStudioTrack: null });
        }
        set({ tracks });
      }
    } catch (e) {
      console.error("[Store] Failed to fetch tracks", e);
    } finally {
      set({ isLoadingTracks: false });
    }
  },

  playSegment: async (segment: Segment, track: Track, overrideIndex?: number) => {
    const streamUrl = `/api/tracks/${track.id}/stream`;
    const { queue, queueIndex } = get();
    let newIndex = queueIndex;
    let newQueue = queue;

    if (overrideIndex !== undefined && overrideIndex >= 0 && overrideIndex < queue.length) {
      newIndex = overrideIndex;
    } else if (queueIndex >= 0 && queue[queueIndex]?.segment.id === segment.id) {
      newIndex = queueIndex;
    } else {
      const existingIndex = queue.findIndex((item) => item.segment.id === segment.id);
      if (existingIndex !== -1) {
        newIndex = existingIndex;
      } else {
        newQueue = [...queue, { segment, track }];
        newIndex = newQueue.length - 1;
      }
    }

    set({
      activeTrack: track,
      activeSegment: segment,
      isPlaying: true,
      currentTime: segment.start_time,
      queue: newQueue,
      queueIndex: newIndex >= 0 ? newIndex : 0,
    });

    try {
      await audioEngine.playSegment(
        streamUrl,
        segment.start_time,
        segment.end_time,
        () => {
          // Callback on segment end -> auto advance
          get().nextSegment();
        },
        (time) => {
          set({ currentTime: time });
        }
      );
    } catch (e) {
      console.warn("[Store] Playback error or superseded:", e);
      if (get().activeSegment?.id === segment.id) {
        set({ isPlaying: false });
      }
    }
  },

  pause: () => {
    audioEngine.pause();
    set({ isPlaying: false });
  },

  togglePlay: async () => {
    const { isPlaying, activeSegment, activeTrack, queue, queueIndex } = get();

    if (!activeSegment || !activeTrack) {
      // If queue has items, play first item
      if (queue.length > 0) {
        const item = queue[Math.max(0, queueIndex)];
        await get().playSegment(item.segment, item.track);
        return;
      }
      return;
    }

    if (isPlaying) {
      audioEngine.pause();
      set({ isPlaying: false });
    } else {
      const ok = await audioEngine.resume();
      if (ok) {
        set({ isPlaying: true });
      }
    }
  },

  nextSegment: () => {
    const { queue, queueIndex } = get();
    if (queue.length === 0) return;

    const nextIdx = (queueIndex + 1) % queue.length;
    const nextItem = queue[nextIdx];
    if (!nextItem) return;
    set({ queueIndex: nextIdx });
    get().playSegment(nextItem.segment, nextItem.track, nextIdx);
  },

  prevSegment: () => {
    const { queue, queueIndex, currentTime, activeSegment, activeTrack } = get();
    if (!activeSegment || !activeTrack) return;

    // If played more than 3s, restart current segment
    if (currentTime - activeSegment.start_time > 3) {
      get().seek(activeSegment.start_time);
      return;
    }

    if (queue.length === 0) return;

    let prevIdx = queueIndex - 1;
    if (prevIdx < 0) {
      prevIdx = queue.length - 1;
    }

    const prevItem = queue[prevIdx];
    set({ queueIndex: prevIdx });
    get().playSegment(prevItem.segment, prevItem.track, prevIdx);
  },

  toggleShuffle: () => {
    const { queue, activeSegment, isShuffle } = get();
    const nextShuffle = !isShuffle;
    if (queue.length <= 1) {
      set({ isShuffle: nextShuffle });
      return;
    }

    const newQueue = [...queue];
    if (nextShuffle) {
      // Fisher-Yates shuffle
      for (let i = newQueue.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [newQueue[i], newQueue[j]] = [newQueue[j], newQueue[i]];
      }
    } else {
      // Sequential order: by track title, then segment start_time
      newQueue.sort((a, b) => {
        const titleCmp = (a.track.title || "").localeCompare(b.track.title || "");
        if (titleCmp !== 0) return titleCmp;
        return a.segment.start_time - b.segment.start_time;
      });
    }

    let newIndex = 0;
    if (activeSegment) {
      const found = newQueue.findIndex((item) => item.segment.id === activeSegment.id);
      if (found >= 0) newIndex = found;
    }

    set({ isShuffle: nextShuffle, queue: newQueue, queueIndex: newIndex });
  },

  setVolume: (vol: number) => {
    audioEngine.setVolume(vol);
    set({ volume: vol });
  },

  setCurrentTime: (t: number) => {
    set({ currentTime: t });
  },

  seek: (seconds: number) => {
    audioEngine.seek(seconds);
    set({ currentTime: seconds });
  },

  removeTrackFromQueue: (trackId: string) => {
    const { queue, queueIndex, activeTrack } = get();
    const removedBeforeCurrent = queueIndex > 0
      ? queue.slice(0, queueIndex).filter((item) => item.track.id === trackId).length
      : 0;
    const newQueue = queue.filter((item) => item.track.id !== trackId);

    if (activeTrack?.id === trackId) {
      const wasPlaying = get().isPlaying;
      audioEngine.unload();
      if (newQueue.length === 0) {
        set({ queue: [], queueIndex: -1, activeTrack: null, activeSegment: null, isPlaying: false });
        return;
      }
      const nextIdx = Math.max(0, Math.min(queueIndex - removedBeforeCurrent, newQueue.length - 1));
      const nextItem = newQueue[nextIdx];
      set({ queue: newQueue, queueIndex: nextIdx, activeTrack: nextItem.track, activeSegment: nextItem.segment, isPlaying: false });
      if (wasPlaying) {
        get().playSegment(nextItem.segment, nextItem.track, nextIdx);
      } else {
        audioEngine.setSource(`/api/tracks/${nextItem.track.id}/stream`);
        audioEngine.seek(nextItem.segment.start_time);
        audioEngine.updateCurrentSegmentBounds(nextItem.segment.start_time, nextItem.segment.end_time);
        set({ currentTime: nextItem.segment.start_time });
      }
      return;
    }

    let newIndex = queueIndex;
    if (newQueue.length === 0) {
      newIndex = -1;
    } else {
      newIndex = queueIndex === -1 ? -1 : Math.max(0, Math.min(queueIndex - removedBeforeCurrent, newQueue.length - 1));
    }
    set({ queue: newQueue, queueIndex: newIndex });
  },

  removeSegmentFromQueue: (segmentId: string) => {
    const { queue, queueIndex, activeSegment } = get();
    const removedBeforeCurrent = queueIndex > 0
      ? queue.slice(0, queueIndex).filter((item) => item.segment.id === segmentId).length
      : 0;
    const newQueue = queue.filter((item) => item.segment.id !== segmentId);

    if (activeSegment?.id === segmentId) {
      const wasPlaying = get().isPlaying;
      audioEngine.unload();
      if (newQueue.length === 0) {
        set({ queue: [], queueIndex: -1, activeTrack: null, activeSegment: null, isPlaying: false });
        return;
      }
      const nextIdx = Math.max(0, Math.min(queueIndex - removedBeforeCurrent, newQueue.length - 1));
      const nextItem = newQueue[nextIdx];
      set({ queue: newQueue, queueIndex: nextIdx, activeTrack: nextItem.track, activeSegment: nextItem.segment, isPlaying: false });
      if (wasPlaying) {
        get().playSegment(nextItem.segment, nextItem.track, nextIdx);
      } else {
        audioEngine.setSource(`/api/tracks/${nextItem.track.id}/stream`);
        audioEngine.seek(nextItem.segment.start_time);
        audioEngine.updateCurrentSegmentBounds(nextItem.segment.start_time, nextItem.segment.end_time);
        set({ currentTime: nextItem.segment.start_time });
      }
      return;
    }

    let newIndex = queueIndex;
    if (newQueue.length === 0) {
      newIndex = -1;
    } else {
      newIndex = queueIndex === -1 ? -1 : Math.max(0, Math.min(queueIndex - removedBeforeCurrent, newQueue.length - 1));
    }
    set({ queue: newQueue, queueIndex: newIndex });
  },

  syncUpdatedSegment: (seg: Segment) => {
    const { queue, activeSegment } = get();
    const newQueue = queue.map((item) =>
      item.segment.id === seg.id ? { ...item, segment: seg } : item
    );
    const updates: Partial<PlayerState> = { queue: newQueue };
    if (activeSegment?.id === seg.id) {
      updates.activeSegment = seg;
      audioEngine.updateCurrentSegmentBounds(seg.start_time, seg.end_time);
    }
    set(updates);
  },

  openSliceStudio: (track: Track) => {
    set({ sliceStudioTrack: track });
  },

  closeSliceStudio: () => {
    set({ sliceStudioTrack: null });
  },

  setPlaybackMode: async (mode: PlaybackMode) => {
    set({ playbackMode: mode });
    try {
      const res = await fetch("/api/segments");
      const segments: Segment[] = res.ok ? await res.json() : [];
      get().buildShuffleQueue(segments, get().tracks, mode);
    } catch (e) {
      console.error("[Store] Failed to update queue on mode change", e);
    }
  },

  buildShuffleQueue: (allSegments: Segment[], allTracks: Track[], modeOverride?: PlaybackMode) => {
    const mode = modeOverride || get().playbackMode;
    const trackMap = new Map<string, Track>();
    for (const t of allTracks) {
      if (t.status === "ready" && t.duration > 0) {
        trackMap.set(t.id, t);
      }
    }

    const items: QueueItem[] = [];

    if (mode === "slices_only") {
      // Only include custom slices (exclude fallback_)
      for (const seg of allSegments) {
        if (!seg.id.startsWith("fallback_")) {
          const trk = trackMap.get(seg.track_id);
          if (trk) {
            items.push({ segment: seg, track: trk });
          }
        }
      }
      // If no custom slices exist at all in library, fallback to full tracks so queue isn't blank
      if (items.length === 0) {
        for (const trk of trackMap.values()) {
          items.push({ segment: createDefaultFullSegment(trk), track: trk });
        }
      }
    } else if (mode === "original_only") {
      // Only full original tracks
      for (const trk of trackMap.values()) {
        items.push({ segment: createDefaultFullSegment(trk), track: trk });
      }
    } else {
      // "mixed": include both custom slices AND full tracks
      for (const seg of allSegments) {
        if (!seg.id.startsWith("fallback_")) {
          const trk = trackMap.get(seg.track_id);
          if (trk) {
            items.push({ segment: seg, track: trk });
          }
        }
      }
      for (const trk of trackMap.values()) {
        items.push({ segment: createDefaultFullSegment(trk), track: trk });
      }
    }

    // Shuffle or sort sequentially based on isShuffle
    if (get().isShuffle) {
      for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [items[i], items[j]] = [items[j], items[i]];
      }
    } else {
      items.sort((a, b) => {
        const titleCmp = (a.track.title || "").localeCompare(b.track.title || "");
        if (titleCmp !== 0) return titleCmp;
        return a.segment.start_time - b.segment.start_time;
      });
    }

    let currentIndex = -1;
    const { activeSegment } = get();
    if (activeSegment) {
      const foundIdx = items.findIndex((item) => item.segment.id === activeSegment.id);
      if (foundIdx >= 0) currentIndex = foundIdx;
    }

    set({ queue: items, queueIndex: items.length > 0 ? currentIndex : -1 });
  },
}));
