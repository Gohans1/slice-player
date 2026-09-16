import { create } from "zustand";
import { audioEngine } from "../lib/audio";
import { createDefaultFullSegment } from "../lib/utils";
import type { Track, Segment } from "@/server/types";

export interface QueueItem {
  segment: Segment;
  track: Track;
}

interface PlayerState {
  tracks: Track[];
  isLoadingTracks: boolean;
  activeTrack: Track | null;
  activeSegment: Segment | null;
  isPlaying: boolean;
  isShuffle: boolean;
  currentTime: number;
  volume: number;
  queue: QueueItem[];
  queueIndex: number;
  sliceStudioTrack: Track | null;

  // Actions
  fetchTracks: () => Promise<void>;
  playSegment: (segment: Segment, track: Track, overrideIndex?: number) => Promise<void>;
  pause: () => void;
  togglePlay: () => Promise<void>;
  nextSegment: () => void;
  prevSegment: () => void;
  toggleShuffle: () => void;
  setVolume: (vol: number) => void;
  setCurrentTime: (t: number) => void;
  seek: (seconds: number) => void;
  removeTrackFromQueue: (trackId: string) => void;
  removeSegmentFromQueue: (segmentId: string) => void;
  openSliceStudio: (track: Track) => void;
  closeSliceStudio: () => void;
  buildShuffleQueue: (allSegments: Segment[], allTracks: Track[]) => void;
  syncUpdatedSegment: (seg: Segment) => void;
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  tracks: [],
  isLoadingTracks: false,
  activeTrack: null,
  activeSegment: null,
  isPlaying: false,
  isShuffle: true, // Default to shuffle segments!
  currentTime: 0,
  volume: 0.8,
  queue: [],
  queueIndex: -1,
  sliceStudioTrack: null,

  fetchTracks: async () => {
    if (get().tracks.length === 0) {
      set({ isLoadingTracks: true });
    }
    try {
      const res = await fetch("/api/tracks");
      if (res.ok) {
        const tracks: Track[] = await res.json();
        const trackMap = new Map(tracks.map((t) => [t.id, t]));
        const { activeTrack, sliceStudioTrack, queue, queueIndex } = get();

        // Concurrently fetch segments to purge deleted segments across tabs
        let validSegments: Segment[] = [];
        try {
          const segRes = await fetch("/api/segments");
          if (segRes.ok) validSegments = await segRes.json();
        } catch {}
        const segmentMap = new Set(validSegments.map((s) => s.id));

        // Purge queue items whose parent track or segment no longer exists in DB
        const validQueue = queue.filter(
          (item) => trackMap.has(item.track.id) && (item.segment.id.startsWith("fallback_") || segmentMap.has(item.segment.id))
        );
        if (validQueue.length !== queue.length) {
          const newIdx = validQueue.length === 0 ? -1 : Math.max(0, Math.min(queueIndex, validQueue.length - 1));
          set({ queue: validQueue, queueIndex: newIdx });
        }

        if (activeTrack && !trackMap.has(activeTrack.id)) {
          get().removeTrackFromQueue(activeTrack.id);
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
    get().playSegment(nextItem.segment, nextItem.track);
  },

  prevSegment: () => {
    const { queue, queueIndex, currentTime, activeSegment, activeTrack } = get();
    if (!activeSegment || !activeTrack) return;

    // If played more than 3s, restart current segment
    if (currentTime - activeSegment.start_time > 3) {
      audioEngine.seek(activeSegment.start_time);
      return;
    }

    if (queue.length === 0) return;

    let prevIdx = queueIndex - 1;
    if (prevIdx < 0) {
      prevIdx = queue.length - 1;
    }

    const prevItem = queue[prevIdx];
    set({ queueIndex: prevIdx });
    get().playSegment(prevItem.segment, prevItem.track);
  },

  toggleShuffle: () => {
    const nextShuffle = !get().isShuffle;
    set({ isShuffle: nextShuffle });
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

  buildShuffleQueue: (allSegments: Segment[], allTracks: Track[]) => {
    const trackMap = new Map<string, Track>();
    for (const t of allTracks) trackMap.set(t.id, t);

    const items: QueueItem[] = [];
    for (const seg of allSegments) {
      const trk = trackMap.get(seg.track_id);
      if (trk && trk.status === "ready") {
        items.push({ segment: seg, track: trk });
      }
    }

    // Fallback: If no segments exist yet, create virtual full-track segments
    if (items.length === 0) {
      for (const t of allTracks) {
        if (t.status === "ready") {
          items.push({
            segment: createDefaultFullSegment(t),
            track: t,
          });
        }
      }
    }

    // Fisher-Yates shuffle
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }

    let currentIndex = 0;
    const { activeSegment } = get();
    if (activeSegment) {
      const foundIdx = items.findIndex((item) => item.segment.id === activeSegment.id);
      if (foundIdx >= 0) currentIndex = foundIdx;
    }

    set({ queue: items, queueIndex: items.length > 0 ? currentIndex : -1 });
  },
}));
