import { create } from "zustand";
import { audioEngine } from "../lib/audio";
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
  playSegment: (segment: Segment, track: Track) => Promise<void>;
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
    set({ isLoadingTracks: true });
    try {
      const res = await fetch("/api/tracks");
      if (res.ok) {
        const tracks: Track[] = await res.json();
        set({ tracks });
      }
    } catch (e) {
      console.error("[Store] Failed to fetch tracks", e);
    } finally {
      set({ isLoadingTracks: false });
    }
  },

  playSegment: async (segment: Segment, track: Track) => {
    const streamUrl = `/api/tracks/${track.id}/stream`;
    const { queue } = get();
    const existingIndex = queue.findIndex((item) => item.segment.id === segment.id);
    let newIndex = existingIndex;
    let newQueue = queue;

    if (existingIndex !== -1) {
      newIndex = existingIndex;
    } else {
      newQueue = [...queue, { segment, track }];
      newIndex = newQueue.length - 1;
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
      set({ isPlaying: false });
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
      await audioEngine.resume();
      set({ isPlaying: true });
    }
  },

  nextSegment: () => {
    const { queue, queueIndex, isShuffle } = get();
    if (queue.length === 0) return;

    let nextIdx = queueIndex + 1;
    if (isShuffle && queue.length > 1) {
      do {
        nextIdx = Math.floor(Math.random() * queue.length);
      } while (nextIdx === queueIndex && queue.length > 1);
    } else if (nextIdx >= queue.length) {
      nextIdx = 0; // loop queue
    }

    const nextItem = queue[nextIdx];
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
    const removedBeforeCurrent = queue.slice(0, queueIndex).filter((item) => item.track.id === trackId).length;
    const newQueue = queue.filter((item) => item.track.id !== trackId);

    if (activeTrack?.id === trackId) {
      audioEngine.pause();
      if (newQueue.length === 0) {
        set({ queue: [], queueIndex: -1, activeTrack: null, activeSegment: null, isPlaying: false });
        return;
      }
      const nextIdx = Math.max(0, Math.min(queueIndex - removedBeforeCurrent, newQueue.length - 1));
      const nextItem = newQueue[nextIdx];
      set({ queue: newQueue, queueIndex: nextIdx });
      get().playSegment(nextItem.segment, nextItem.track);
      return;
    }

    let newIndex = queueIndex;
    if (newQueue.length === 0) {
      newIndex = -1;
    } else {
      newIndex = Math.max(0, Math.min(queueIndex - removedBeforeCurrent, newQueue.length - 1));
    }
    set({ queue: newQueue, queueIndex: newIndex });
  },

  removeSegmentFromQueue: (segmentId: string) => {
    const { queue, queueIndex, activeSegment } = get();
    const removedBeforeCurrent = queue.slice(0, queueIndex).filter((item) => item.segment.id === segmentId).length;
    const newQueue = queue.filter((item) => item.segment.id !== segmentId);

    if (activeSegment?.id === segmentId) {
      audioEngine.pause();
      if (newQueue.length === 0) {
        set({ queue: [], queueIndex: -1, activeTrack: null, activeSegment: null, isPlaying: false });
        return;
      }
      const nextIdx = Math.max(0, Math.min(queueIndex - removedBeforeCurrent, newQueue.length - 1));
      const nextItem = newQueue[nextIdx];
      set({ queue: newQueue, queueIndex: nextIdx });
      get().playSegment(nextItem.segment, nextItem.track);
      return;
    }

    let newIndex = queueIndex;
    if (newQueue.length === 0) {
      newIndex = -1;
    } else {
      newIndex = Math.max(0, Math.min(queueIndex - removedBeforeCurrent, newQueue.length - 1));
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

    // Fisher-Yates shuffle
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }

    set({ queue: items, queueIndex: 0 });
  },
}));
