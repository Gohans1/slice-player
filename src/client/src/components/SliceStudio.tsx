import * as React from "react";
import WaveSurfer from "wavesurfer.js";
import RegionsPlugin from "wavesurfer.js/dist/plugins/regions.esm.js";
import { Play, Pause, Plus, Trash2, Scissors, Check, X, RotateCcw, Volume2, VolumeX, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { VolumeSlider } from "./ui/VolumeSlider";
import { formatTime, formatDuration } from "../lib/utils";
import { volumeToGain } from "../lib/audio";
import { useTranslation } from "react-i18next";
import { usePlayerStore, normalizeTrackVolume, flushTrackVolume } from "../store/usePlayerStore";
import { AddToPlaylistPopover } from "./AddToPlaylistPopover";
import type { Track, Segment } from "@/server/types";

const FLEXOKI_COLORS = [
  "#4385BE", // Blue
  "#3AA99F", // Cyan
  "#879A39", // Green
  "#D0A215", // Yellow
  "#DA702C", // Orange
  "#8B7EC8", // Purple
  "#D14D41", // Red
  "#CE5D97", // Magenta
];

interface SliceStudioProps {
  track: Track;
  onClose: () => void;
}

export function SliceStudio({ track, onClose }: SliceStudioProps) {
  const { t } = useTranslation();
  const syncUpdatedSegment = usePlayerStore((s) => s.syncUpdatedSegment);
  const pause = usePlayerStore((s) => s.pause);
  const removeSegmentFromQueue = usePlayerStore((s) => s.removeSegmentFromQueue);
  const setTrackVolume = usePlayerStore((s) => s.setTrackVolume);
  const isGlobalPlaying = usePlayerStore((s) => s.isPlaying);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const wavesurferRef = React.useRef<WaveSurfer | null>(null);
  const regionsRef = React.useRef<ReturnType<typeof RegionsPlugin.create> | null>(null);

  const [trackDetail, setTrackDetail] = React.useState<Track>(track);
  const [isDetailLoaded, setIsDetailLoaded] = React.useState(!!track.peaks_json);
  const [isWaveSurferReady, setIsWaveSurferReady] = React.useState(false);
  const [segments, setSegments] = React.useState<Segment[]>([]);
  const [isPlayingWave, setIsPlayingWave] = React.useState(false);
  const [currentPlayTime, setCurrentPlayTime] = React.useState(0);
  const [activeSegmentId, setActiveSegmentId] = React.useState<string | null>(null);
  const [saveStatus, setSaveStatus] = React.useState<string | null>(null);
  const [zoomLevel, setZoomLevel] = React.useState(0);
  const zoomLevelRef = React.useRef(0);
  zoomLevelRef.current = zoomLevel;

  const getTrackDuration = React.useCallback(() => {
    const wsDur = wavesurferRef.current?.getDuration();
    if (typeof wsDur === "number" && Number.isFinite(wsDur) && wsDur > 0) return wsDur;
    const detailDur = trackDetail?.duration;
    if (typeof detailDur === "number" && Number.isFinite(detailDur) && detailDur > 0) return detailDur;
    const fallbackDur = track?.duration;
    if (typeof fallbackDur === "number" && Number.isFinite(fallbackDur) && fallbackDur > 0) return fallbackDur;
    return 0;
  }, [trackDetail?.duration, track?.duration]);

  const handleZoomChange = React.useCallback((level: number) => {
    const clamped = Math.max(0, Math.min(200, level));
    setZoomLevel(clamped);
    try {
      wavesurferRef.current?.zoom(clamped);
    } catch {
      // WaveSurfer throws if audio is not decoded yet
    }
  }, []);

  const storeTrack = usePlayerStore((s) =>
    s.sliceStudioTrack?.id === track.id
      ? s.sliceStudioTrack
      : s.tracks.find((t) => t.id === track.id)
  );
  const currentTrack = storeTrack || track;
  const volume = normalizeTrackVolume(currentTrack.volume, 0.5);
  const isMuted = volume === 0;
  const prevVolumeRef = React.useRef(volume > 0 ? volume : 0.5);

  const isInternalUpdateRef = React.useRef(false);
  const isDraggingRef = React.useRef(false);
  const saveDebounceTimersRef = React.useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const pendingUpdatesRef = React.useRef<Record<string, Partial<Segment>>>({});
  const previewEndRef = React.useRef<number | null>(null);
  const activeSegmentIdRef = React.useRef<string | null>(null);

  // Pause global player bar audio when opening Slice Studio
  React.useEffect(() => {
    pause();
  }, [pause]);

  // Fetch full track detail for precomputed peaks if not loaded in listTracks
  React.useEffect(() => {
    prevVolumeRef.current = volume > 0 ? volume : 0.5;
    setTrackDetail((prev) => ({
      ...track,
      peaks_json: prev?.peaks_json || track.peaks_json,
    }));

    let isMounted = true;
    if (!track.peaks_json) {
      fetch(`/api/tracks/${track.id}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data: Track | null) => {
          if (isMounted) {
            if (data?.peaks_json) {
              setTrackDetail((prev) => ({
                ...prev,
                peaks_json: data.peaks_json,
              }));
            }
            setIsDetailLoaded(true);
          }
        })
        .catch(() => {
          if (isMounted) setIsDetailLoaded(true);
        });
    } else {
      setIsDetailLoaded(true);
    }
    return () => {
      isMounted = false;
    };
  }, [track.id]);

  // Sync WaveSurfer gain whenever track volume changes
  React.useEffect(() => {
    if (volume > 0) {
      prevVolumeRef.current = volume;
    }
    if (wavesurferRef.current) {
      wavesurferRef.current.setVolume(volumeToGain(volume));
    }
  }, [volume]);

  const segmentsRef = React.useRef(segments);
  segmentsRef.current = segments;

  const isMountedRef = React.useRef(true);
  React.useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      void flushTrackVolume(track.id);
    };
  }, [track.id]);

  const safeSetSaveStatus = React.useCallback((status: string | null) => {
    if (isMountedRef.current) {
      setSaveStatus(status);
    }
  }, []);

  const flushPendingSaves = React.useCallback(async () => {
    await flushTrackVolume(track.id);

    for (const t of Object.values(saveDebounceTimersRef.current)) {
      clearTimeout(t);
    }
    saveDebounceTimersRef.current = {};

    const entries = Object.entries(pendingUpdatesRef.current);
    if (entries.length === 0) return;
    pendingUpdatesRef.current = {};

    const promises = entries.map(async ([id, payload]) => {
      const seg = segmentsRef.current.find((s) => s.id === id);
      if (seg) {
        syncUpdatedSegment({ ...seg, ...payload });
      }
      try {
        const res = await fetch(`/api/segments/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          const updated: Segment = await res.json();
          syncUpdatedSegment(updated);
        }
      } catch (e) {
        console.error("[SliceStudio] Flush error:", e);
      }
    });

    await Promise.all(promises);
  }, [track.id, syncUpdatedSegment]);

  const handleCloseStudio = React.useCallback(async () => {
    await flushPendingSaves();
    onClose();
  }, [flushPendingSaves, onClose]);

  const clearSegmentPreview = React.useCallback(() => {
    previewEndRef.current = null;
    activeSegmentIdRef.current = null;
    setActiveSegmentId(null);
  }, []);

  const handleToggleWavePlay = React.useCallback(() => {
    clearSegmentPreview();
    wavesurferRef.current?.playPause()?.catch(() => {});
  }, [clearSegmentPreview]);

  const handleCloseStudioRef = React.useRef(handleCloseStudio);
  handleCloseStudioRef.current = handleCloseStudio;
  const handleToggleWavePlayRef = React.useRef(handleToggleWavePlay);
  const clearSegmentPreviewRef = React.useRef(clearSegmentPreview);
  clearSegmentPreviewRef.current = clearSegmentPreview;
  const getTrackDurationRef = React.useRef(getTrackDuration);
  getTrackDurationRef.current = getTrackDuration;
  const handleZoomChangeRef = React.useRef(handleZoomChange);
  handleZoomChangeRef.current = handleZoomChange;

  // Handle keyboard shortcuts (Escape to close, Space to toggle play/pause, Arrow keys to nudge playhead)
  React.useEffect(() => {
    const isInteractiveTarget = (el: EventTarget | null): boolean => {
      if (!el) return false;
      const element = el instanceof Element ? el : (el as Node | null)?.parentElement;
      if (!element) return false;
      return Boolean(
        element.closest?.(
          "button, select, input, textarea, summary, a[href], [role='button'], [role*='menuitem'], [role='checkbox'], [role='switch'], [role='radio'], [role='tab'], [role='combobox'], [role='option'], [role='slider'], [role='spinbutton'], [role='textbox'], [role='searchbox'], [contenteditable]:not([contenteditable='false'])"
        ) || (element as HTMLElement).isContentEditable
      );
    };

    const isTextInputTarget = (el: EventTarget | null): boolean => {
      if (!el) return false;
      const element = el instanceof Element ? el : (el as Node | null)?.parentElement;
      if (!element) return false;
      return Boolean(
        element.closest?.(
          "input:not([type='button']):not([type='submit']):not([type='reset']):not([type='checkbox']):not([type='radio']), textarea, select, [role='textbox'], [role='searchbox'], [role='slider'], [role='spinbutton'], [role='combobox'], [contenteditable]:not([contenteditable='false'])"
        ) || (element as HTMLElement).isContentEditable
      );
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;

      if (e.key === "Escape") {
        handleCloseStudioRef.current();
        return;
      }

      if (e.code === "Space" || e.key === " " || e.key === "Spacebar") {
        if (e.repeat || e.isComposing || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) {
          return;
        }

        if (isInteractiveTarget(e.target) || isInteractiveTarget(document.activeElement)) {
          return;
        }

        e.preventDefault();
        handleToggleWavePlayRef.current();
        return;
      }

      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        if (e.isComposing || e.ctrlKey || e.altKey || e.metaKey) {
          return;
        }

        if (isTextInputTarget(e.target) || isTextInputTarget(document.activeElement)) {
          return;
        }

        e.preventDefault();
        const ws = wavesurferRef.current;
        if (!ws) return;
        const step = e.shiftKey ? 1.0 : 0.1;
        const delta = e.key === "ArrowLeft" ? -step : step;
        const trackDur = getTrackDurationRef.current();
        const curTime = ws.getCurrentTime();
        const safeCurTime = Number.isFinite(curTime) && curTime >= 0 ? curTime : 0;
        const rawNext = safeCurTime + delta;
        const clampedNext = Math.max(0, Math.min(trackDur > 0 ? trackDur : 1800, rawNext));
        const nextTime = Number(clampedNext.toFixed(2));
        clearSegmentPreviewRef.current();
        ws.setTime(nextTime);
        setCurrentPlayTime(nextTime);
        return;
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  // Ctrl + Wheel / Trackpad pinch to zoom waveform
  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 20 : -20;
        const next = Math.max(0, Math.min(200, zoomLevelRef.current + delta));
        handleZoomChangeRef.current(next);
      }
    };

    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", handleWheel);
    };
  }, []);

  // Flush pending updates on unmount and cleanup timers
  React.useEffect(() => {
    return () => {
      // Immediate flush of dirty debounced saves and sync to player store
      for (const [id, payload] of Object.entries(pendingUpdatesRef.current)) {
        const seg = segmentsRef.current.find((s) => s.id === id);
        if (seg) {
          syncUpdatedSegment({ ...seg, ...payload });
        }
        try {
          fetch(`/api/segments/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            keepalive: true,
          }).catch(() => {});
        } catch {
          // ignore unmount flush network errors
        }
      }
      for (const t of Object.values(saveDebounceTimersRef.current)) {
        clearTimeout(t);
      }
    };
  }, [syncUpdatedSegment]);

  const debouncedSaveSegment = React.useCallback((id: string, updates: Partial<Segment>, statusMsg?: string) => {
    pendingUpdatesRef.current[id] = { ...pendingUpdatesRef.current[id], ...updates };
    if (saveDebounceTimersRef.current[id]) {
      clearTimeout(saveDebounceTimersRef.current[id]);
    }
    saveDebounceTimersRef.current[id] = setTimeout(async () => {
      const payload = pendingUpdatesRef.current[id] || updates;
      delete pendingUpdatesRef.current[id];
      try {
        const res = await fetch(`/api/segments/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          const updated: Segment = await res.json();
          syncUpdatedSegment(updated);
          safeSetSaveStatus(statusMsg || t("studio.toastSaved"));
          setTimeout(() => safeSetSaveStatus(null), 1500);
        } else {
          safeSetSaveStatus(t("studio.toastSaveError"));
          setTimeout(() => safeSetSaveStatus(null), 2500);
        }
      } catch (e) {
        console.error(e);
      }
    }, 400);
  }, [syncUpdatedSegment, safeSetSaveStatus, t]);

  // Fetch existing segments for this track
  const fetchSegments = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/tracks/${track.id}/segments`);
      if (res.ok) {
        const data: Segment[] = await res.json();
        setSegments(
          data.map((seg) => {
            const pending = pendingUpdatesRef.current[seg.id];
            return pending ? { ...seg, ...pending } : seg;
          })
        );
      }
    } catch (e) {
      console.error("[SliceStudio] Fetch segments error", e);
    }
  }, [track.id]);

  React.useEffect(() => {
    fetchSegments();
    const handleUpdate = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.reason === "volume") return;
      if (detail && (detail.trackId === track.id || detail.trackId === trackDetail.id)) {
        fetchSegments();
      }
    };
    window.addEventListener("app:track_updated", handleUpdate);
    window.addEventListener("app:segment_updated", handleUpdate);
    return () => {
      window.removeEventListener("app:track_updated", handleUpdate);
      window.removeEventListener("app:segment_updated", handleUpdate);
    };
  }, [fetchSegments, track.id, trackDetail.id]);

  // Initialize WaveSurfer with precomputed peaks
  React.useEffect(() => {
    if (!containerRef.current || !isDetailLoaded) return;

    // Parse precomputed peaks from database
    let peaks: number[][] | undefined = undefined;
    if (trackDetail.peaks_json) {
      try {
        const rawPeaks = JSON.parse(trackDetail.peaks_json);
        if (Array.isArray(rawPeaks) && rawPeaks.length > 0) {
          peaks = [rawPeaks];
        }
      } catch (e) {
        console.warn("[SliceStudio] Could not parse peaks_json", e);
      }
    }
    if (!peaks) {
      // Fallback synthetic peaks to prevent client-side 600MB decodeAudioData crash
      peaks = [Array.from({ length: 1000 }, () => 0.1)];
    }

    const wsRegions = RegionsPlugin.create();
    regionsRef.current = wsRegions;

    const currentVol = volume;
    const isDark = typeof document !== "undefined" && document.documentElement.classList.contains("dark");
    const waveColor = isDark ? "#403e3c" : "#dad8ce"; // base-800 (Dark) vs base-150 (Light)
    const progressColor = isDark ? "#d14d41" : "#af3029"; // red-400 (Dark) vs red-600 (Light)
    const cursorColor = isDark ? "#ce5d97" : "#a02f6f"; // magenta-400 (Dark) vs magenta-600 (Light)

    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor,
      progressColor,
      cursorColor,
      cursorWidth: 2,
      height: 128,
      normalize: true,
      url: `/api/tracks/${trackDetail.id}/stream`,
      peaks: peaks,
      duration: trackDetail.duration,
      plugins: [wsRegions],
      dragToSeek: true,
      autoScroll: true,
      autoCenter: true,
      minPxPerSec: zoomLevelRef.current,
    });

    ws.setVolume(volumeToGain(currentVol));
    wavesurferRef.current = ws;
    setIsWaveSurferReady(true);

    let isWaveDragging = false;

    ws.on("play", () => {
      pause(); // Pause global player so both don't play simultaneously
      setIsPlayingWave(true);
    });
    ws.on("pause", () => {
      setIsPlayingWave(false);
      clearSegmentPreview();
      const cur = ws.getCurrentTime();
      if (Number.isFinite(cur) && cur >= 0) {
        setCurrentPlayTime(cur);
      }
    });

    ws.on("dragstart", () => {
      isWaveDragging = true;
      clearSegmentPreview();
    });

    ws.on("interaction", (newTime?: number) => {
      clearSegmentPreview();
      if (isWaveDragging) return;
      const time =
        typeof newTime === "number" && Number.isFinite(newTime) && newTime >= 0
          ? newTime
          : ws.getCurrentTime();
      if (Number.isFinite(time) && time >= 0) {
        setCurrentPlayTime(time);
      }
    });

    let lastDragUpdate = 0;
    ws.on("drag", (relativeX) => {
      if (typeof relativeX !== "number" || !Number.isFinite(relativeX)) return;
      const now = performance.now();
      if (now - lastDragUpdate < 35) return;
      lastDragUpdate = now;
      const clampedX = Math.max(0, Math.min(1, relativeX));
      const trackDur = getTrackDuration();
      setCurrentPlayTime(clampedX * trackDur);
    });

    ws.on("dragend", (relativeX) => {
      isWaveDragging = false;
      const trackDur = getTrackDuration();
      const validX = typeof relativeX === "number" && Number.isFinite(relativeX) ? relativeX : undefined;
      const clampedX = validX !== undefined ? Math.max(0, Math.min(1, validX)) : (ws.getCurrentTime() / (trackDur || 1));
      const safeClampedX = Math.max(0, Math.min(1, Number.isFinite(clampedX) ? clampedX : 0));
      setCurrentPlayTime(safeClampedX * trackDur);
      ws.seekTo(safeClampedX);
    });

    let lastTimeUpdate = 0;
    ws.on("timeupdate", (time) => {
      if (isWaveDragging) return;
      if (previewEndRef.current !== null && time >= previewEndRef.current) {
        setCurrentPlayTime(previewEndRef.current);
        clearSegmentPreview();
        ws.pause();
        return;
      }
      const now = performance.now();
      if (now - lastTimeUpdate >= 100) {
        lastTimeUpdate = now;
        setCurrentPlayTime(time);
      }
    });

    const maxTrackDur = trackDetail?.duration || 1800;

    // Region drag / resize handlers throttled to prevent React render thrashing
    let lastRegionUpdate = 0;
    wsRegions.on("region-update", (region) => {
      isDraggingRef.current = true;
      const now = performance.now();
      if (now - lastRegionUpdate < 40) return;
      lastRegionUpdate = now;

      const segId = region.id;
      const start = Math.max(0, Number(region.start.toFixed(2)));
      const end = Math.min(maxTrackDur, Number(region.end.toFixed(2)));

      if (activeSegmentIdRef.current === segId) {
        previewEndRef.current = end;
      }

      isInternalUpdateRef.current = true;
      setSegments((prev) =>
        prev.map((s) => (s.id === segId ? { ...s, start_time: start, end_time: end } : s))
      );
    });

    // Capture exact settled coordinates upon drag/resize release
    wsRegions.on("region-updated", (region) => {
      isDraggingRef.current = false;
      const segId = region.id;
      let start = Math.max(0, Number(region.start.toFixed(2)));
      let end = Math.min(maxTrackDur, Number(region.end.toFixed(2)));
      if (end - start < 0.5) {
        if (start + 0.5 <= maxTrackDur) {
          end = Number((start + 0.5).toFixed(2));
        } else {
          start = Math.max(0, Number((end - 0.5).toFixed(2)));
        }
        region.setOptions({ start, end });
      }

      if (activeSegmentIdRef.current === segId) {
        previewEndRef.current = end;
      }

      isInternalUpdateRef.current = true;
      setSegments((prev) =>
        prev.map((s) => (s.id === segId ? { ...s, start_time: start, end_time: end } : s))
      );

      debouncedSaveSegment(segId, { start_time: start, end_time: end }, t("studio.toastSaved"));
    });

    return () => {
      setIsWaveSurferReady(false);
      try { wsRegions.unAll(); } catch {}
      try { ws.destroy(); } catch {}
      wavesurferRef.current = null;
      regionsRef.current = null;
    };
  }, [isDetailLoaded, trackDetail.id, trackDetail.duration, trackDetail.peaks_json, debouncedSaveSegment, pause, clearSegmentPreview]);

  // Sync segments with WaveSurfer regions without destructive full teardowns
  React.useEffect(() => {
    const wsRegions = regionsRef.current;
    if (!wsRegions || !isWaveSurferReady || isDraggingRef.current) return;

    if (isInternalUpdateRef.current) {
      isInternalUpdateRef.current = false;
      return;
    }

    const currentRegions = wsRegions.getRegions();
    const segmentMap = new Map(segments.map((s) => [s.id, s]));

    // Remove deleted regions
    for (const r of currentRegions) {
      if (!segmentMap.has(r.id)) {
        r.remove();
      }
    }

    // Add new regions or update existing if changed externally
    const getRegionColor = (c?: string) => (c ? (c.length === 7 ? `${c}33` : c) : "rgba(67, 133, 190, 0.2)");

    for (const seg of segments) {
      const existing = currentRegions.find((r) => r.id === seg.id);
      const expectedColor = getRegionColor(seg.color);
      if (!existing) {
        wsRegions.addRegion({
          id: seg.id,
          start: seg.start_time,
          end: seg.end_time,
          color: expectedColor,
          drag: true,
          resize: true,
          minLength: 0.5,
        });
      } else {
        if (
          Math.abs(existing.start - seg.start_time) > 0.05 ||
          Math.abs(existing.end - seg.end_time) > 0.05 ||
          existing.color !== expectedColor
        ) {
          existing.setOptions({
            start: seg.start_time,
            end: seg.end_time,
            color: expectedColor,
          });
        }
      }
    }
  }, [segments, isWaveSurferReady]);

  // Pause local WaveSurfer if global player starts
  React.useEffect(() => {
    if (isGlobalPlaying && wavesurferRef.current?.isPlaying()) {
      wavesurferRef.current.pause();
    }
  }, [isGlobalPlaying]);

  // Handle Add New Segment at current playhead
  const handleAddNewSegment = async () => {
    const trackDur = trackDetail.duration > 0 ? trackDetail.duration : track.duration;
    let start = Math.max(0, Number(currentPlayTime.toFixed(2)));
    if (trackDur > 0 && start > trackDur - 0.5) {
      start = Math.max(0, trackDur - 20);
    }
    const end = Math.min(trackDur, Number((start + 20).toFixed(2)));
    if (end - start < 0.5) {
      safeSetSaveStatus(t("studio.toastTooShort"));
      setTimeout(() => safeSetSaveStatus(null), 2000);
      return;
    }

    const existingNums = segments.map((s) => {
      const m = s.name.match(/^(?:Đoạn|Slice)\s+(\d+)$/i);
      return m ? parseInt(m[1], 10) : 0;
    });
    const newIndex = (existingNums.length > 0 ? existingNums.reduce((max, val) => Math.max(max, val), 0) : 0) + 1;
    const color = FLEXOKI_COLORS[(newIndex - 1) % FLEXOKI_COLORS.length];

    try {
      const res = await fetch(`/api/tracks/${track.id}/segments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: t("studio.defaultName", { index: newIndex }),
          start_time: start,
          end_time: end,
          color: color,
        }),
      });

      if (res.ok) {
        const created: Segment = await res.json();
        setSegments((prev) => [...prev, created]);
        safeSetSaveStatus(t("studio.toastCreated"));
        setTimeout(() => safeSetSaveStatus(null), 1500);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Delete segment
  const handleDeleteSegment = async (id: string) => {
    if (saveDebounceTimersRef.current[id]) {
      clearTimeout(saveDebounceTimersRef.current[id]);
      delete saveDebounceTimersRef.current[id];
    }
    delete pendingUpdatesRef.current[id];

    if (activeSegmentIdRef.current === id || activeSegmentId === id) {
      wavesurferRef.current?.pause();
      clearSegmentPreview();
    }

    try {
      const res = await fetch(`/api/segments/${id}`, { method: "DELETE" });
      if (res.ok) {
        removeSegmentFromQueue(id);
        setSegments((prev) => prev.filter((s) => s.id !== id));
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Update segment name
  const handleUpdateName = (id: string, name: string) => {
    setSegments((prev) => prev.map((s) => (s.id === id ? { ...s, name } : s)));
    debouncedSaveSegment(id, { name }, t("studio.toastRenamed"));
  };

  // Nudge segment start or end boundary by delta (e.g. ±0.1s)
  const handleNudgeSegment = (segId: string, edge: "start" | "end", delta: number) => {
    const seg = segments.find((s) => s.id === segId);
    if (!seg) return;
    const maxTrackDur = getTrackDuration();
    let newStart = seg.start_time;
    let newEnd = seg.end_time;

    if (edge === "start") {
      newStart = Math.max(0, Math.min(newEnd - 0.5, Number((newStart + delta).toFixed(2))));
    } else {
      newEnd = Math.max(newStart + 0.5, Math.min(maxTrackDur > 0 ? maxTrackDur : 1800, Number((newEnd + delta).toFixed(2))));
    }

    const region = regionsRef.current?.getRegions().find((r) => r.id === segId);
    if (region) {
      region.setOptions({ start: newStart, end: newEnd });
    }

    if (activeSegmentIdRef.current === segId) {
      previewEndRef.current = newEnd;
    }

    isInternalUpdateRef.current = true;
    setSegments((prev) =>
      prev.map((s) => (s.id === segId ? { ...s, start_time: newStart, end_time: newEnd } : s))
    );
    debouncedSaveSegment(segId, { start_time: newStart, end_time: newEnd }, t("studio.toastSaved"));
  };

  // Preview segment in studio
  const handlePreviewSegment = (seg: Segment) => {
    setActiveSegmentId(seg.id);
    activeSegmentIdRef.current = seg.id;
    previewEndRef.current = seg.end_time;
    pause(); // pause global queue playback
    const ws = wavesurferRef.current;
    if (ws) {
      const regions = regionsRef.current?.getRegions() || [];
      const region = regions.find((r) => r.id === seg.id);
      if (region) {
        region.play();
      } else {
        ws.setTime(seg.start_time);
        ws.play();
      }
    }
  };

  const handleVolumeChange = (newVol: number) => {
    const safe = normalizeTrackVolume(newVol, 0.5);
    if (safe > 0) {
      prevVolumeRef.current = safe;
    }
    if (wavesurferRef.current) {
      wavesurferRef.current.setVolume(volumeToGain(safe));
    }
    setTrackVolume(track.id, safe);
  };

  const handleToggleMute = () => {
    if (volume === 0) {
      const restore = prevVolumeRef.current > 0 ? prevVolumeRef.current : 0.5;
      handleVolumeChange(restore);
    } else {
      prevVolumeRef.current = volume;
      handleVolumeChange(0);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background/95 backdrop-blur-md p-4 sm:p-6 overflow-y-auto">
      <div className="max-w-5xl mx-auto w-full flex-1 flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 pb-4 border-b border-border">
          <div>
            <div className="flex items-center gap-2">
              <span className="p-1 rounded bg-primary/20 text-primary">
                <Scissors className="h-4 w-4" />
              </span>
              <h2 className="text-lg font-bold text-foreground">{t("studio.title")}</h2>
              {saveStatus && (
                <span className="flex items-center gap-1 text-xs text-flexoki-green animate-in fade-in">
                  <Check className="h-3.5 w-3.5" />
                  <span>{saveStatus}</span>
                </span>
              )}
            </div>
            <p className="text-sm text-foreground/90 font-medium mt-1">{track.title}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t("studio.duration", { duration: formatDuration(track.duration) })}
            </p>
          </div>

          <Button
            variant="ghost"
            size="icon"
            onClick={handleCloseStudio}
            aria-label={t("studio.doneButton")}
            className="rounded-full"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Waveform Card */}
        <div className="mt-6 rounded-xl border border-border bg-card p-5 shadow-lg">
          <div className="flex items-center justify-between mb-3 text-xs text-muted-foreground">
            <span className="font-medium">{t("studio.waveform")}</span>
            <div className="flex items-center gap-3">
              {/* Zoom Controls */}
              <div className="flex items-center gap-0.5 bg-secondary/50 rounded-lg p-0.5 border border-border/50">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleZoomChange(zoomLevel - 20)}
                  disabled={!isWaveSurferReady || zoomLevel <= 0}
                  className="h-6 w-6 text-muted-foreground hover:text-foreground disabled:opacity-30"
                  aria-label={t("studio.zoomOut")}
                  title={t("studio.zoomOut")}
                >
                  <ZoomOut className="h-3.5 w-3.5" />
                </Button>
                <button
                  type="button"
                  onClick={() => handleZoomChange(zoomLevel === 0 ? 40 : 0)}
                  disabled={!isWaveSurferReady}
                  className="px-1.5 py-0.5 text-[11px] font-mono text-muted-foreground hover:text-foreground rounded transition-colors disabled:opacity-30"
                  title={t("studio.zoomFit")}
                  aria-label={t("studio.zoomFit")}
                >
                  {zoomLevel === 0 ? "1x" : `${Math.round(1 + zoomLevel / 20)}x`}
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleZoomChange(zoomLevel + 20)}
                  disabled={!isWaveSurferReady || zoomLevel >= 200}
                  className="h-6 w-6 text-muted-foreground hover:text-foreground disabled:opacity-30"
                  aria-label={t("studio.zoomIn")}
                  title={t("studio.zoomIn")}
                >
                  <ZoomIn className="h-3.5 w-3.5" />
                </Button>
              </div>

              <span className="font-mono text-foreground font-semibold">
                {formatTime(currentPlayTime)} / {formatTime(track.duration)}
              </span>
            </div>
          </div>

          {/* Waveform Canvas Container */}
          <div ref={containerRef} className="rounded-lg bg-background p-2 border border-border/50 cursor-pointer select-none" />

          {/* Controls below waveform */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleToggleWavePlay}
                className="gap-1.5"
              >
                {isPlayingWave ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                <span>{isPlayingWave ? t("studio.pause") : t("studio.playWaveform")}</span>
              </Button>

              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  clearSegmentPreview();
                  setCurrentPlayTime(0);
                  wavesurferRef.current?.seekTo(0);
                }}
                className="gap-1 text-xs text-muted-foreground"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>{t("studio.reset")}</span>
              </Button>
            </div>

            {/* Volume Control */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-secondary/50 border border-border/50">
              <Button
                variant="ghost"
                size="icon"
                onClick={handleToggleMute}
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                aria-label={isMuted ? t("player.unmute") : t("player.mute")}
                title={isMuted ? t("player.unmute") : t("player.mute")}
              >
                {isMuted ? (
                  <VolumeX className="h-4 w-4 text-destructive" />
                ) : (
                  <Volume2 className="h-4 w-4 text-foreground" />
                )}
              </Button>
              <VolumeSlider
                value={volume}
                onChange={handleVolumeChange}
                aria-label={t("studio.trackVolume")}
                title={t("studio.trackVolumeTooltip", { percent: Math.round(volume * 100) })}
                className="w-24 sm:w-28"
                sliderClassName="h-1.5"
              />
              <span className="font-mono text-xs text-muted-foreground w-9 text-right select-none">
                {Math.round(volume * 100)}%
              </span>
            </div>

            <Button
              variant="default"
              size="sm"
              onClick={handleAddNewSegment}
              className="gap-1.5 shadow-md"
            >
              <Plus className="h-4 w-4" />
              <span>{t("studio.addSlice")}</span>
            </Button>
          </div>
        </div>

        {/* Segments Management List */}
        <div className="mt-6 flex-1 flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-sm text-foreground flex items-center gap-2">
              <span>{t("studio.slicesHeader")}</span>
              <span className="rounded-full bg-accent px-2 py-0.5 text-xs text-accent-foreground font-mono">
                {segments.length}
              </span>
            </h3>
            <span className="text-xs text-muted-foreground">
              {t("studio.slicesSub")}
            </span>
          </div>

          {segments.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-8 rounded-xl border border-dashed border-border text-center">
              <Scissors className="h-8 w-8 text-muted-foreground/50 mb-2" />
              <p className="text-sm font-medium text-muted-foreground">{t("studio.empty")}</p>
              <p className="text-xs text-muted-foreground/70 mt-1 max-w-sm">
                {t("studio.emptyHint")}
              </p>
              <Button size="sm" onClick={handleAddNewSegment} className="mt-4 gap-1.5">
                <Plus className="h-4 w-4" />
                <span>{t("studio.addFirst")}</span>
              </Button>
            </div>
          ) : (
            <div className="grid gap-2.5">
              {segments.map((seg) => {
                const duration = seg.end_time - seg.start_time;
                const isActive = activeSegmentId === seg.id;

                return (
                  <div
                    key={seg.id}
                    className={`flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3 rounded-lg border transition-all ${
                      isActive
                        ? "border-primary bg-primary/5 shadow-sm"
                        : "border-border bg-card hover:border-border/80"
                    }`}
                  >
                    <div className="flex items-center gap-3 flex-1 w-full sm:w-auto">
                      <div
                        className="w-3 h-8 rounded-full shrink-0"
                        style={{ backgroundColor: seg.color || "#4385BE" }}
                      />

                      <Button
                        variant={isActive ? "default" : "outline"}
                        size="icon"
                        onClick={() => handlePreviewSegment(seg)}
                        className="h-8 w-8 shrink-0"
                        title={t("studio.preview")}
                        aria-label={t("studio.preview")}
                      >
                        <Play className="h-4 w-4 fill-current" />
                      </Button>

                      <div className="flex-1 min-w-0">
                        <Input
                          value={seg.name}
                          onChange={(e) => handleUpdateName(seg.id, e.target.value)}
                          className="h-8 text-xs font-medium bg-background/50 max-w-xs"
                          placeholder={t("studio.slicePlaceholder")}
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-3 w-full sm:w-auto border-t sm:border-t-0 pt-2 sm:pt-0 border-border">
                      <div className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
                        <div className="flex items-center gap-0.5">
                          <button
                            type="button"
                            onClick={() => handleNudgeSegment(seg.id, "start", -0.1)}
                            title="-0.1s"
                            aria-label={t("studio.nudgeStartBack", "-0.1s start")}
                            className="h-5 px-1 rounded text-[10px] bg-secondary/80 hover:bg-secondary text-muted-foreground hover:text-foreground cursor-pointer transition-colors border border-border/40"
                          >
                            -0.1s
                          </button>
                          <span className="text-foreground font-medium px-1">{formatTime(seg.start_time)}</span>
                          <button
                            type="button"
                            onClick={() => handleNudgeSegment(seg.id, "start", 0.1)}
                            title="+0.1s"
                            aria-label={t("studio.nudgeStartForward", "+0.1s start")}
                            className="h-5 px-1 rounded text-[10px] bg-secondary/80 hover:bg-secondary text-muted-foreground hover:text-foreground cursor-pointer transition-colors border border-border/40"
                          >
                            +0.1s
                          </button>
                        </div>
                        <span>→</span>
                        <div className="flex items-center gap-0.5">
                          <button
                            type="button"
                            onClick={() => handleNudgeSegment(seg.id, "end", -0.1)}
                            title="-0.1s"
                            aria-label={t("studio.nudgeEndBack", "-0.1s end")}
                            className="h-5 px-1 rounded text-[10px] bg-secondary/80 hover:bg-secondary text-muted-foreground hover:text-foreground cursor-pointer transition-colors border border-border/40"
                          >
                            -0.1s
                          </button>
                          <span className="text-foreground font-medium px-1">{formatTime(seg.end_time)}</span>
                          <button
                            type="button"
                            onClick={() => handleNudgeSegment(seg.id, "end", 0.1)}
                            title="+0.1s"
                            aria-label={t("studio.nudgeEndForward", "+0.1s end")}
                            className="h-5 px-1 rounded text-[10px] bg-secondary/80 hover:bg-secondary text-muted-foreground hover:text-foreground cursor-pointer transition-colors border border-border/40"
                          >
                            +0.1s
                          </button>
                        </div>
                        <span className="text-[11px] text-flexoki-cyan">
                          ({duration.toFixed(1)}s)
                        </span>
                      </div>

                      <AddToPlaylistPopover
                        trackId={track.id}
                        segmentId={seg.id}
                        variant="ghost"
                        size="icon"
                        showText={false}
                      />

                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDeleteSegment(seg.id)}
                        className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        title={t("studio.delete")}
                        aria-label={t("studio.delete")}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="mt-8 pt-4 border-t border-border flex justify-end">
          <Button onClick={handleCloseStudio} className="px-6">
            {t("studio.doneButton")}
          </Button>
        </div>
      </div>
    </div>
  );
}
