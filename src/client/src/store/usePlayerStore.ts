import { create } from "zustand";
import { audioEngine } from "../lib/audio";
import { createDefaultFullSegment } from "../lib/utils";
import type { Track, Segment } from "@/server/types";

export interface QueueItem {
  segment: Segment;
  track: Track;
}

export type PlaybackMode = "mixed" | "slices_only" | "original_only";

let consecutivePlaybackFailures = 0;
const dismissedSegmentIds = new Set<string>();

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
  removeQueueItemAtIndex: (index: number) => void;
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
        const prevTracks = get().tracks;
        const prevTrackMap = new Map(prevTracks.map((t) => [t.id, t]));
        const stabilizedTracks = tracks.map((fresh) => {
          const prev = prevTrackMap.get(fresh.id);
          if (!prev) return fresh;
          const isSame =
            prev.status === fresh.status &&
            prev.segment_count === fresh.segment_count &&
            prev.duration === fresh.duration &&
            prev.title === fresh.title &&
            prev.artist === fresh.artist &&
            prev.file_path === fresh.file_path &&
            prev.thumbnail_url === fresh.thumbnail_url &&
            prev.error_message === fresh.error_message;
          return isSame ? prev : fresh;
        });
        const trackMap = new Map(stabilizedTracks.map((t) => [t.id, t]));
        const { activeTrack, activeSegment, sliceStudioTrack, queue, queueIndex } = get();
        const prevReadyTrackIds = new Set(prevTracks.filter((t) => t.status === "ready").map((t) => t.id));

        if (!reconcileSegments) {
          const currentItem = queueIndex >= 0 ? queue[queueIndex] : null;
          // Fast path for polling: only update track list and prune deleted tracks from queue
          const validQueue = queue.filter((item) => trackMap.has(item.track.id)).map((item) => ({
            ...item,
            track: trackMap.get(item.track.id) || item.track,
          }));
          const updates: Partial<PlayerState> = { tracks: stabilizedTracks };
          if (validQueue.length !== queue.length) {
            const newIdx = validQueue.length === 0
              ? -1
              : currentItem
                ? validQueue.findIndex((it) => it.segment.id === currentItem.segment.id)
                : Math.max(0, Math.min(queueIndex, validQueue.length - 1));
            updates.queue = validQueue;
            updates.queueIndex = validQueue.length === 0 ? -1 : (newIdx >= 0 ? newIdx : 0);
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

        const freshState = get();
        const currentQueue = freshState.queue;
        const currentQueueIndex = freshState.queueIndex;
        const currentActiveSegment = freshState.activeSegment;
        const currentItem = currentQueueIndex >= 0 ? currentQueue[currentQueueIndex] : null;
        const wasQueueEmpty = currentQueue.length === 0;
        const currentMode = freshState.playbackMode;
        const validQueue: QueueItem[] = [];
        const seenSegmentIds = new Set<string>();

        // Reconcile existing queue items without duplicate expansion
        for (const item of currentQueue) {
          if (!trackMap.has(item.track.id)) continue;
          const freshTrack = trackMap.get(item.track.id)!;
          const isFallback = item.segment.id.startsWith("fallback_");

          if (isFallback) {
            if (currentMode === "slices_only") {
              const trackSlices = validSegments.filter((s) => s.track_id === item.track.id);
              if (trackSlices.length > 0) {
                for (const s of trackSlices) {
                  if (!seenSegmentIds.has(s.id) && !dismissedSegmentIds.has(s.id)) {
                    seenSegmentIds.add(s.id);
                    validQueue.push({ segment: s, track: freshTrack });
                  }
                }
                continue;
              }
              // If other tracks have custom slices, exclude fallback tracks without slices in slices_only mode UNLESS actively playing
              const hasAnyCustomSlices = validSegments.some((s) => !s.id.startsWith("fallback_"));
              if (hasAnyCustomSlices && item.segment.id !== currentActiveSegment?.id) {
                continue;
              }
            }
            // Preserve fallback item in original_only or mixed (or if no custom slices exist in library)
            if (!dismissedSegmentIds.has(item.segment.id) || item.segment.id === currentActiveSegment?.id) {
              seenSegmentIds.add(item.segment.id);
              validQueue.push({ ...item, track: freshTrack });
            }
          } else {
            // Slices should not be in original_only mode unless actively playing
            if (currentMode === "original_only" && item.segment.id !== currentActiveSegment?.id) continue;
            if (!segmentMap.has(item.segment.id) || (dismissedSegmentIds.has(item.segment.id) && item.segment.id !== currentActiveSegment?.id)) continue;
            const freshSeg = segmentObjMap.get(item.segment.id) || item.segment;
            if (!seenSegmentIds.has(freshSeg.id)) {
              seenSegmentIds.add(freshSeg.id);
              validQueue.push({ segment: freshSeg, track: freshTrack });
            }
          }
        }

        // Ingestion queue starvation fix: append tracks that newly transitioned to "ready"
        const newlyReadyTracks = stabilizedTracks.filter((t) => t.status === "ready" && !prevReadyTrackIds.has(t.id));
        if (newlyReadyTracks.length > 0) {
          for (const newTrack of newlyReadyTracks) {
            const trackSlices = validSegments.filter((s) => s.track_id === newTrack.id);
            if (currentMode === "original_only") {
              validQueue.push({ segment: createDefaultFullSegment(newTrack), track: newTrack });
            } else if (currentMode === "slices_only") {
              if (trackSlices.length > 0) {
                for (const s of trackSlices) {
                  if (!seenSegmentIds.has(s.id) && !dismissedSegmentIds.has(s.id)) {
                    seenSegmentIds.add(s.id);
                    validQueue.push({ segment: s, track: newTrack });
                  }
                }
              } else if (validQueue.length === 0) {
                validQueue.push({ segment: createDefaultFullSegment(newTrack), track: newTrack });
              }
            } else {
              // mixed
              if (trackSlices.length > 0) {
                for (const s of trackSlices) {
                  if (!seenSegmentIds.has(s.id) && !dismissedSegmentIds.has(s.id)) {
                    seenSegmentIds.add(s.id);
                    validQueue.push({ segment: s, track: newTrack });
                  }
                }
              }
              validQueue.push({ segment: createDefaultFullSegment(newTrack), track: newTrack });
            }
          }
        }

        // Slices addition starvation fix: append newly cut slices for existing tracks
        if (currentMode !== "original_only") {
          for (const seg of validSegments) {
            if (!seg.id.startsWith("fallback_") && !seenSegmentIds.has(seg.id) && !dismissedSegmentIds.has(seg.id)) {
              const parentTrack = trackMap.get(seg.track_id);
              if (parentTrack && parentTrack.status === "ready") {
                seenSegmentIds.add(seg.id);
                validQueue.push({ segment: seg, track: parentTrack });
              }
            }
          }
        }

        // Initial queue shuffle / sort if app launched with empty queue
        if (wasQueueEmpty && validQueue.length > 0) {
          if (get().isShuffle) {
            for (let i = validQueue.length - 1; i > 0; i--) {
              const j = Math.floor(Math.random() * (i + 1));
              [validQueue[i], validQueue[j]] = [validQueue[j], validQueue[i]];
            }
          } else {
            validQueue.sort((a, b) => {
              const titleCmp = (a.track.title || "").localeCompare(b.track.title || "");
              if (titleCmp !== 0) return titleCmp;
              return a.segment.start_time - b.segment.start_time;
            });
          }
        }

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
        const fallbackIdx = Math.max(0, Math.min(queueIndex, validQueue.length - 1));
        const settledIdx = validQueue.length === 0 ? -1 : (newIdx >= 0 ? newIdx : fallbackIdx);
        set({ tracks: stabilizedTracks, queue: validQueue, queueIndex: settledIdx });

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

        if (activeTrack && !trackMap.has(activeTrack.id)) {
          get().removeTrackFromQueue(activeTrack.id);
        }
        if (activeSegment && !activeSegment.id.startsWith("fallback_") && !segmentMap.has(activeSegment.id)) {
          get().removeSegmentFromQueue(activeSegment.id);
        }
        if (sliceStudioTrack) {
          if (!trackMap.has(sliceStudioTrack.id)) {
            set({ sliceStudioTrack: null });
          } else {
            set({ sliceStudioTrack: trackMap.get(sliceStudioTrack.id)! });
          }
        }
      }
    } catch (e) {
      console.error("[Store] Failed to fetch tracks", e);
    } finally {
      set({ isLoadingTracks: false });
    }
  },

  playSegment: async (segment: Segment, track: Track, overrideIndex?: number) => {
    dismissedSegmentIds.delete(segment.id);
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
      consecutivePlaybackFailures = 0;
    } catch (e) {
      console.warn("[Store] Playback error or superseded:", e);
      if (get().activeSegment?.id === segment.id) {
        set({ isPlaying: false });
        consecutivePlaybackFailures++;
        const isUserGestureError = (e as any)?.name === "NotAllowedError";
        const { queue, nextSegment } = get();
        if (!isUserGestureError && queue.length > 1 && consecutivePlaybackFailures < Math.min(3, queue.length)) {
          setTimeout(() => {
            if (!get().isPlaying && get().activeSegment?.id === segment.id) {
              nextSegment();
            }
          }, 500);
        } else if (consecutivePlaybackFailures >= Math.min(3, queue.length)) {
          console.warn("[Store] Consecutive playback failures reached limit, stopping auto-skip loop");
          consecutivePlaybackFailures = 0;
        }
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

    let newIndex = activeSegment ? 0 : get().queueIndex;
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
    for (const item of queue) {
      if (item.track.id === trackId) {
        dismissedSegmentIds.add(item.segment.id);
      }
    }
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
        audioEngine.setOnSegmentEnd(() => get().nextSegment());
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
    dismissedSegmentIds.add(segmentId);
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
        audioEngine.setOnSegmentEnd(() => get().nextSegment());
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

  removeQueueItemAtIndex: (index: number) => {
    const { queue, queueIndex } = get();
    if (index < 0 || index >= queue.length) return;
    const itemToRemove = queue[index];
    if (itemToRemove) {
      dismissedSegmentIds.add(itemToRemove.segment.id);
    }
    const isCurrent = index === queueIndex;
    const newQueue = queue.filter((_, idx) => idx !== index);

    if (isCurrent) {
      const wasPlaying = get().isPlaying;
      audioEngine.unload();
      if (newQueue.length === 0) {
        set({ queue: [], queueIndex: -1, activeTrack: null, activeSegment: null, isPlaying: false });
        return;
      }
      const nextIdx = Math.max(0, Math.min(index, newQueue.length - 1));
      const nextItem = newQueue[nextIdx];
      set({ queue: newQueue, queueIndex: nextIdx, activeTrack: nextItem.track, activeSegment: nextItem.segment, isPlaying: false });
      if (wasPlaying) {
        get().playSegment(nextItem.segment, nextItem.track, nextIdx);
      } else {
        audioEngine.setSource(`/api/tracks/${nextItem.track.id}/stream`);
        audioEngine.seek(nextItem.segment.start_time);
        audioEngine.updateCurrentSegmentBounds(nextItem.segment.start_time, nextItem.segment.end_time);
        audioEngine.setOnSegmentEnd(() => get().nextSegment());
        set({ currentTime: nextItem.segment.start_time });
      }
      return;
    }

    let newIndex = queueIndex;
    if (newQueue.length === 0) {
      newIndex = -1;
    } else if (index < queueIndex) {
      newIndex = Math.max(0, queueIndex - 1);
    } else {
      newIndex = Math.min(queueIndex, newQueue.length - 1);
    }
    set({ queue: newQueue, queueIndex: newIndex });
  },

  syncUpdatedSegment: (seg: Segment) => {
    dismissedSegmentIds.delete(seg.id);
    const { queue, activeSegment } = get();
    const newQueue = queue.map((item) =>
      item.segment.id === seg.id ? { ...item, segment: seg } : item
    );
    const updates: Partial<PlayerState> = { queue: newQueue };
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
    set({ sliceStudioTrack: track });
  },

  closeSliceStudio: () => {
    set({ sliceStudioTrack: null });
  },

  setPlaybackMode: async (mode: PlaybackMode) => {
    set({ playbackMode: mode });
    try {
      const res = await fetch("/api/segments");
      if (get().playbackMode !== mode) return;
      const segments: Segment[] = res.ok ? await res.json() : [];
      if (get().playbackMode !== mode) return;
      get().buildShuffleQueue(segments, get().tracks, mode);
    } catch (e) {
      console.error("[Store] Failed to update queue on mode change", e);
    }
  },

  buildShuffleQueue: (allSegments: Segment[], allTracks: Track[], modeOverride?: PlaybackMode) => {
    dismissedSegmentIds.clear();
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
    let updatedActiveSegment = activeSegment;
    if (activeSegment) {
      let foundIdx = items.findIndex((item) => item.segment.id === activeSegment.id);
      if (foundIdx < 0) {
        foundIdx = items.findIndex((item) => item.track.id === activeSegment.track_id);
      }
      if (foundIdx >= 0) {
        currentIndex = foundIdx;
        if (activeSegment.id !== items[foundIdx].segment.id) {
          updatedActiveSegment = items[foundIdx].segment;
          audioEngine.updateCurrentSegmentBounds(
            updatedActiveSegment.start_time,
            updatedActiveSegment.end_time
          );
          const curTime = audioEngine.getCurrentTime();
          if (curTime < updatedActiveSegment.start_time || curTime > updatedActiveSegment.end_time) {
            audioEngine.seek(updatedActiveSegment.start_time);
          }
        }
      }
    }

    set({
      queue: items,
      queueIndex: items.length > 0 ? (currentIndex >= 0 ? currentIndex : 0) : -1,
      activeSegment: updatedActiveSegment,
    });
  },
}));

// Mid-stream audio element error listener to prevent UI lockup
audioEngine.setOnErrorCallback((err) => {
  console.warn("[Store] Mid-stream audio element error:", err);
  const { isPlaying, queue, nextSegment, activeSegment } = usePlayerStore.getState();
  if (isPlaying) {
    usePlayerStore.setState({ isPlaying: false });
    if (queue.length > 1 && consecutivePlaybackFailures < Math.min(3, queue.length)) {
      consecutivePlaybackFailures++;
      setTimeout(() => {
        const state = usePlayerStore.getState();
        if (!state.isPlaying && state.activeSegment?.id === activeSegment?.id) {
          nextSegment();
        }
      }, 1000);
    }
  }
});

