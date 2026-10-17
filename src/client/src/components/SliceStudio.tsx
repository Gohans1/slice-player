import * as React from "react";
import WaveSurfer from "wavesurfer.js";
import RegionsPlugin, { type Region } from "wavesurfer.js/dist/plugins/regions.esm.js";
import TimelinePlugin from "wavesurfer.js/dist/plugins/timeline.esm.js";
import { Play, Pause, Plus, Trash2, Scissors, Check, X, RotateCcw, RotateCw, Volume2, VolumeX, ZoomIn, ZoomOut } from "lucide-react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { ButtonGroup, ButtonGroupText } from "./ui/button-group";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "./ui/item";
import { EmptyState } from "./EmptyState";
import { VolumeSlider } from "./VolumeSlider";
import { formatTime, formatDuration, cn, DEFAULT_SLICE_COLOR } from "../lib/utils";
import { outputGain } from "../lib/audio";
import { useTranslation } from "react-i18next";
import { useFormatNumber } from "../hooks/use-format-number";
import { usePlayerStore, normalizeTrackVolume, flushTrackVolume } from "../store/usePlayerStore";
import { AddToPlaylistPopover } from "./AddToPlaylistPopover";
import { NowPlayingEqualizer } from "./NowPlayingEqualizer";
import type { Track, Segment } from "@/server/types";

// Staggers the loading bars' pulse so the placeholder ripples like a waveform
const LOADING_BAR_DELAYS = ["delay-0", "delay-120", "delay-240", "delay-360", "delay-480"];

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

// WaveSurfer paints on a canvas, which can't read CSS variables, so the theme's colours are read up front
function readThemeColor(element: Element, property: string): string | undefined {
  return getComputedStyle(element).getPropertyValue(property).trim() || undefined;
}

// A slice's region is tinted with its colour, more strongly while it's the one being edited
function regionColor(color: string | undefined, isSelected: boolean): string {
  const base = color || DEFAULT_SLICE_COLOR;
  return /^#[0-9a-f]{6}$/i.test(base) ? base + (isSelected ? "4D" : "26") : base;
}

// What a slice's region shows: its name and, around the one being edited, Voice Memos' yellow trim frame. WaveSurfer
// renders in a shadow root, so index.css styles these through their part names.
function regionContent(name: string, isSelected: boolean): HTMLElement {
  const content = document.createElement("div");
  const label = document.createElement("span");
  label.setAttribute("part", "slice-label");
  label.textContent = name;
  content.append(label);
  if (isSelected) {
    const frame = document.createElement("span");
    frame.setAttribute("part", "slice-trim-frame");
    content.append(frame);
  }
  return content;
}

// Only the slice being edited can be dragged and trimmed; the others are there to pick
function syncRegionLook(region: Region, slice: Segment, isSelected: boolean) {
  const color = regionColor(slice.color, isSelected);
  const isFramed = Boolean(region.content?.querySelector("[part='slice-trim-frame']"));
  if (
    region.color !== color ||
    region.drag !== isSelected ||
    region.resize !== isSelected ||
    region.content?.textContent !== slice.name ||
    isFramed !== isSelected
  ) {
    region.setOptions({ color, drag: isSelected, resize: isSelected, content: regionContent(slice.name, isSelected) });
  }
}

interface TrimStepperProps {
  label: string;
  time: number;
  backLabel: string;
  forwardLabel: string;
  onNudge: (delta: number) => void;
}

// One end of the slice being edited, nudged a tenth of a second at a time
function TrimStepper({ label, time, backLabel, forwardLabel, onNudge }: TrimStepperProps) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <ButtonGroup>
        <Button variant="outline" size="xs" onClick={() => onNudge(-0.1)} aria-label={backLabel} title={backLabel}>
          −0.1s
        </Button>
        <ButtonGroupText>
          <span className="tabular-nums">{formatTime(time)}</span>
        </ButtonGroupText>
        <Button variant="outline" size="xs" onClick={() => onNudge(0.1)} aria-label={forwardLabel} title={forwardLabel}>
          +0.1s
        </Button>
      </ButtonGroup>
    </div>
  );
}

interface SliceStudioProps {
  track: Track;
  onClose: () => void;
}

export function SliceStudio({ track, onClose }: SliceStudioProps) {
  const { t } = useTranslation();
  const formatNumber = useFormatNumber();
  const syncUpdatedSegment = usePlayerStore((s) => s.syncUpdatedSegment);
  const pause = usePlayerStore((s) => s.pause);
  const removeSegmentFromQueue = usePlayerStore((s) => s.removeSegmentFromQueue);
  const setTrackVolume = usePlayerStore((s) => s.setTrackVolume);
  const masterVolume = usePlayerStore((s) => s.masterVolume);
  const isGlobalPlaying = usePlayerStore((s) => s.isPlaying);
  // State rather than a ref: the dialog mounts its content after the Studio itself, and WaveSurfer needs the element
  const [waveformContainer, setWaveformContainer] = React.useState<HTMLDivElement | null>(null);
  const wavesurferRef = React.useRef<WaveSurfer | null>(null);
  const regionsRef = React.useRef<ReturnType<typeof RegionsPlugin.create> | null>(null);

  const [trackDetail, setTrackDetail] = React.useState<Track>(track);
  const [isDetailLoaded, setIsDetailLoaded] = React.useState(!!track.peaks_json);
  const [isWaveSurferReady, setIsWaveSurferReady] = React.useState(false);
  const [segments, setSegments] = React.useState<Segment[]>([]);
  const [isPlayingWave, setIsPlayingWave] = React.useState(false);
  const [currentPlayTime, setCurrentPlayTime] = React.useState(0);
  const [activeSegmentId, setActiveSegmentId] = React.useState<string | null>(null);
  const [pickedSliceId, setPickedSliceId] = React.useState<string | null>(null);
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

  // Sync WaveSurfer gain whenever track or master volume changes
  React.useEffect(() => {
    if (volume > 0) {
      prevVolumeRef.current = volume;
    }
    if (wavesurferRef.current) {
      wavesurferRef.current.setVolume(outputGain(volume, masterVolume));
    }
  }, [volume, masterVolume]);

  const segmentsRef = React.useRef(segments);
  segmentsRef.current = segments;

  // The slice being edited: the one picked last, or the first until one is
  const selectedSlice = segments.find((s) => s.id === pickedSliceId) ?? segments[0] ?? null;
  const selectedSliceId = selectedSlice?.id ?? null;

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

  const [isOpen, setIsOpen] = React.useState(true);
  const slicesHeadingId = React.useId();
  const isClosingRef = React.useRef(false);
  const popupRef = React.useRef<HTMLDivElement>(null);

  // Saves what's still pending before the Studio closes, so whoever opened it reloads what was saved. onClose runs
  // once the dialog has finished animating out.
  const handleCloseStudio = React.useCallback(async () => {
    if (isClosingRef.current) return;
    isClosingRef.current = true;
    await flushPendingSaves();
    setIsOpen(false);
  }, [flushPendingSaves]);

  const clearSegmentPreview = React.useCallback(() => {
    previewEndRef.current = null;
    activeSegmentIdRef.current = null;
    setActiveSegmentId(null);
  }, []);

  const handleToggleWavePlay = React.useCallback(() => {
    clearSegmentPreview();
    wavesurferRef.current?.playPause()?.catch(() => {});
  }, [clearSegmentPreview]);

  // Moves the playhead by delta seconds, within the track
  const seekBy = React.useCallback((delta: number) => {
    const ws = wavesurferRef.current;
    if (!ws) return;
    const trackDur = getTrackDuration();
    const curTime = ws.getCurrentTime();
    const safeCurTime = Number.isFinite(curTime) && curTime >= 0 ? curTime : 0;
    const clampedNext = Math.max(0, Math.min(trackDur > 0 ? trackDur : 1800, safeCurTime + delta));
    const nextTime = Number(clampedNext.toFixed(2));
    clearSegmentPreview();
    ws.setTime(nextTime);
    setCurrentPlayTime(nextTime);
  }, [getTrackDuration, clearSegmentPreview]);

  const handleToggleWavePlayRef = React.useRef(handleToggleWavePlay);
  const seekByRef = React.useRef(seekBy);
  seekByRef.current = seekBy;
  const handleZoomChangeRef = React.useRef(handleZoomChange);
  handleZoomChangeRef.current = handleZoomChange;

  // Handle keyboard shortcuts (Space to toggle play/pause, Arrow keys to nudge playhead). The dialog handles Escape.
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
        const step = e.shiftKey ? 1.0 : 0.1;
        seekByRef.current(e.key === "ArrowLeft" ? -step : step);
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
    const el = waveformContainer;
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
  }, [waveformContainer]);

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
    if (!waveformContainer || !isDetailLoaded) return;

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

    // Drawn like Voice Memos: thin bars, brighter once played, a blue playhead and a time ruler underneath
    const ws = WaveSurfer.create({
      container: waveformContainer,
      waveColor: readThemeColor(waveformContainer, "--muted-foreground"),
      progressColor: readThemeColor(waveformContainer, "--foreground"),
      cursorColor: readThemeColor(waveformContainer, "--flexoki-bl"),
      cursorWidth: 2,
      height: 128,
      barWidth: 2,
      barGap: 2,
      barRadius: 2,
      normalize: true,
      url: `/api/tracks/${trackDetail.id}/stream`,
      peaks: peaks,
      duration: trackDetail.duration,
      plugins: [wsRegions, TimelinePlugin.create({ height: 18, formatTimeCallback: formatDuration })],
      dragToSeek: true,
      autoScroll: true,
      autoCenter: true,
      minPxPerSec: zoomLevelRef.current,
    });

    ws.setVolume(outputGain(currentVol, usePlayerStore.getState().masterVolume));
    wavesurferRef.current = ws;
    // Regions and zoom need the track's length, which WaveSurfer knows once it's ready. Regions added before then
    // are clamped into zero-length markers at the start.
    ws.on("ready", () => setIsWaveSurferReady(true));

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

    wsRegions.on("region-clicked", (region) => setPickedSliceId(region.id));

    return () => {
      setIsWaveSurferReady(false);
      try { wsRegions.unAll(); } catch {}
      try { ws.destroy(); } catch {}
      wavesurferRef.current = null;
      regionsRef.current = null;
    };
  }, [waveformContainer, isDetailLoaded, trackDetail.id, trackDetail.duration, trackDetail.peaks_json, debouncedSaveSegment, pause, clearSegmentPreview]);

  // Sync segments with WaveSurfer regions without destructive full teardowns
  React.useEffect(() => {
    const wsRegions = regionsRef.current;
    if (!wsRegions || !isWaveSurferReady || isDraggingRef.current) return;

    if (isInternalUpdateRef.current) {
      isInternalUpdateRef.current = false;
      return;
    }

    const segmentMap = new Map(segments.map((s) => [s.id, s]));

    // Remove deleted regions
    for (const r of wsRegions.getRegions()) {
      if (!segmentMap.has(r.id)) {
        r.remove();
      }
    }

    // Add new regions, move ones changed elsewhere, and keep each one's look in step with its slice
    for (const seg of segments) {
      const isSelected = seg.id === selectedSliceId;
      const existing = wsRegions.getRegions().find((r) => r.id === seg.id);
      if (!existing) {
        wsRegions.addRegion({
          id: seg.id,
          start: seg.start_time,
          end: seg.end_time,
          color: regionColor(seg.color, isSelected),
          content: regionContent(seg.name, isSelected),
          drag: isSelected,
          resize: isSelected,
          minLength: 0.5,
        });
      } else {
        if (Math.abs(existing.start - seg.start_time) > 0.05 || Math.abs(existing.end - seg.end_time) > 0.05) {
          existing.setOptions({ start: seg.start_time, end: seg.end_time });
        }
        syncRegionLook(existing, seg, isSelected);
      }
    }
  }, [segments, selectedSliceId, isWaveSurferReady]);

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
        setPickedSliceId(created.id);
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
    setPickedSliceId(seg.id);
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
      wavesurferRef.current.setVolume(outputGain(safe, masterVolume));
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

  const closeLabel = t("common.close", "Close");
  const zoomLabel = zoomLevel === 0 ? "1x" : `${Math.round(1 + zoomLevel / 20)}x`;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) void handleCloseStudio();
      }}
      onOpenChangeComplete={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        ref={popupRef}
        // Focus starts on the Studio itself rather than its first button, so Space plays and pauses straight away
        initialFocus={popupRef}
        showCloseButton={false}
        className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-6xl md:h-[min(40rem,calc(100svh-2rem))] md:grid-rows-[auto_minmax(0,1fr)_auto]"
      >
        {/* The margin keeps the header clear of the close button */}
        <DialogHeader className="mr-8">
          <DialogTitle>{t("studio.title")}</DialogTitle>
          <DialogDescription>{t("studio.hint")}</DialogDescription>
        </DialogHeader>

        {/* The editor, and the track's slices beside it like Voice Memos' recordings */}
        <div className="grid min-h-0 gap-6 md:grid-cols-[minmax(0,1fr)_17rem]">
          <div className="flex min-w-0 flex-col gap-4">
            <div className="min-w-0">
              <p className="truncate text-2xl font-bold tracking-tight text-foreground">{track.title}</p>
              <p className="truncate text-sm text-muted-foreground">
                {track.artist ? `${track.artist} · ` : ""}
                <span className="tabular-nums">{formatDuration(track.duration)}</span>
              </p>
            </div>

            <div className="relative min-h-36 overflow-hidden rounded-xl bg-muted/40 px-2 pt-2 select-none">
              <div ref={setWaveformContainer} data-slot="studio-waveform" className="cursor-pointer" />
              {!isWaveSurferReady && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-background/80 backdrop-blur-xs animate-in fade-in duration-150 pointer-events-none">
                  <div className="flex items-center gap-1.5 h-12 w-48 justify-center mb-2">
                    {Array.from({ length: 24 }).map((_, i) => (
                      <div
                        key={i}
                        className={cn("h-(--bar-height) w-1 animate-pulse rounded-full bg-primary/40", LOADING_BAR_DELAYS[i % LOADING_BAR_DELAYS.length])}
                        style={{ "--bar-height": `${40 + Math.sin(i * 0.5) * 60}%` }}
                      />
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground animate-pulse">{t("studio.loadingWaveform", "Loading audio waveform…")}</p>
                </div>
              )}
            </div>

            {/* The playhead's time, and the transport under it */}
            <div className="flex flex-col items-center gap-3">
              <p className="text-4xl font-semibold tracking-tight tabular-nums text-foreground">{formatTime(currentPlayTime)}</p>
              <div className="flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-3 sm:grid sm:grid-cols-[1fr_auto_1fr]">
                {/* First on narrow screens, where zoom and volume wrap onto the row below */}
                <div className="flex w-full items-center justify-center gap-2 sm:col-start-2 sm:row-start-1 sm:w-auto">
                  <Button variant="ghost" size="icon-lg" onClick={() => seekBy(-15)} aria-label={t("studio.back15")} title={t("studio.back15")}>
                    <RotateCcw />
                  </Button>
                  <Button
                    size="icon-lg"
                    onClick={handleToggleWavePlay}
                    aria-label={isPlayingWave ? t("studio.pause") : t("studio.play")}
                    title={isPlayingWave ? t("studio.pause") : t("studio.play")}
                  >
                    {isPlayingWave ? <Pause className="fill-current" /> : <Play className="fill-current" />}
                  </Button>
                  <Button variant="ghost" size="icon-lg" onClick={() => seekBy(15)} aria-label={t("studio.forward15")} title={t("studio.forward15")}>
                    <RotateCw />
                  </Button>
                </div>

                <ButtonGroup className="sm:col-start-1 sm:row-start-1 sm:justify-self-start">
                  <Button
                    variant="outline"
                    size="icon-sm"
                    onClick={() => handleZoomChange(zoomLevel - 20)}
                    disabled={!isWaveSurferReady || zoomLevel <= 0}
                    aria-label={t("studio.zoomOut")}
                    title={t("studio.zoomOut")}
                  >
                    <ZoomOut />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleZoomChange(zoomLevel === 0 ? 40 : 0)}
                    disabled={!isWaveSurferReady}
                    title={t("studio.zoomFit")}
                    aria-label={t("studio.zoomFit")}
                  >
                    <span className="tabular-nums">{zoomLabel}</span>
                  </Button>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    onClick={() => handleZoomChange(zoomLevel + 20)}
                    disabled={!isWaveSurferReady || zoomLevel >= 200}
                    aria-label={t("studio.zoomIn")}
                    title={t("studio.zoomIn")}
                  >
                    <ZoomIn />
                  </Button>
                </ButtonGroup>

                <div className="flex items-center gap-1 sm:col-start-3 sm:row-start-1 sm:justify-self-end">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={handleToggleMute}
                    aria-label={isMuted ? t("player.unmute") : t("player.mute")}
                    title={isMuted ? t("player.unmute") : t("player.mute")}
                  >
                    {isMuted ? <VolumeX className="text-destructive" /> : <Volume2 />}
                  </Button>
                  <VolumeSlider
                    value={volume}
                    onChange={handleVolumeChange}
                    aria-label={t("studio.trackVolume")}
                    title={t("studio.trackVolumeTooltip", { percent: Math.round(volume * 100) })}
                    className="w-20 sm:w-24"
                  />
                </div>
              </div>
            </div>

            {/* The slice being edited, like Voice Memos' trim controls */}
            {selectedSlice ? (
              <section aria-label={t("studio.selectedSlice")} className="flex flex-col gap-3 rounded-xl border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    data-slot="slice-color"
                    className="size-3 shrink-0 rounded-full bg-(--slice-color)"
                    style={{ "--slice-color": selectedSlice.color || DEFAULT_SLICE_COLOR }}
                  />
                  <Input
                    value={selectedSlice.name}
                    onChange={(e) => handleUpdateName(selectedSlice.id, e.target.value)}
                    aria-label={t("studio.sliceName")}
                    placeholder={t("studio.slicePlaceholder")}
                    className="max-w-xs flex-1"
                  />
                  <div className="ml-auto flex items-center gap-1">
                    <Button variant="outline" size="sm" onClick={() => handlePreviewSegment(selectedSlice)}>
                      <Play data-icon="inline-start" className="fill-current" />
                      {t("studio.playSlice")}
                    </Button>
                    <AddToPlaylistPopover trackId={track.id} segmentId={selectedSlice.id} />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDeleteSegment(selectedSlice.id)}
                      title={t("studio.delete")}
                      aria-label={t("studio.delete")}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                  <TrimStepper
                    label={t("studio.start")}
                    time={selectedSlice.start_time}
                    backLabel={t("studio.nudgeStartBack")}
                    forwardLabel={t("studio.nudgeStartForward")}
                    onNudge={(delta) => handleNudgeSegment(selectedSlice.id, "start", delta)}
                  />
                  <TrimStepper
                    label={t("studio.end")}
                    time={selectedSlice.end_time}
                    backLabel={t("studio.nudgeEndBack")}
                    forwardLabel={t("studio.nudgeEndForward")}
                    onNudge={(delta) => handleNudgeSegment(selectedSlice.id, "end", delta)}
                  />
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {t("studio.length", { length: formatTime(selectedSlice.end_time - selectedSlice.start_time) })}
                  </span>
                </div>
              </section>
            ) : (
              <EmptyState icon={Scissors} title={t("studio.empty")} description={t("studio.emptyHint")}>
                <Button size="sm" onClick={handleAddNewSegment}>
                  <Plus data-icon="inline-start" />
                  {t("studio.addSlice")}
                </Button>
              </EmptyState>
            )}
          </div>

          <section aria-labelledby={slicesHeadingId} className="flex min-h-0 flex-col gap-3 md:border-l md:pl-6">
            <div className="flex items-center justify-between gap-2">
              <h3 id={slicesHeadingId} className="flex items-center gap-2 text-sm font-semibold text-foreground">
                {t("studio.slicesHeader")}
                <Badge variant="secondary">{formatNumber(segments.length)}</Badge>
              </h3>
              <Button size="sm" onClick={handleAddNewSegment}>
                <Plus data-icon="inline-start" />
                {t("studio.addSlice")}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t("studio.slicesSub")}</p>
            {segments.length > 0 && (
              <ItemGroup className="min-h-0 overflow-y-auto">
                {segments.map((seg) => {
                  const isSelected = seg.id === selectedSliceId;
                  return (
                    // A slice made with New Slice mounts already picked, so it alone slides in; @starting-style
                    // only applies as an element first renders, so opening the Studio or picking a row doesn't animate
                    <div
                      key={seg.id}
                      role="listitem"
                      className={
                        seg.id === pickedSliceId
                          ? "transition duration-200 ease-out starting:translate-y-1 starting:opacity-0"
                          : undefined
                      }
                    >
                      <Item
                        size="xs"
                        variant={isSelected ? "muted" : "default"}
                        render={
                          <button
                            type="button"
                            aria-current={isSelected || undefined}
                            onClick={() => setPickedSliceId(seg.id)}
                            // Double-clicking plays it, as in a list of songs
                            onDoubleClick={() => handlePreviewSegment(seg)}
                          />
                        }
                      >
                        <ItemMedia>
                          <span
                            data-slot="slice-color"
                            className="size-2.5 rounded-full bg-(--slice-color)"
                            style={{ "--slice-color": seg.color || DEFAULT_SLICE_COLOR }}
                          />
                        </ItemMedia>
                        <ItemContent className="min-w-0">
                          <ItemTitle>{seg.name}</ItemTitle>
                          <ItemDescription>
                            <span className="tabular-nums">
                              {formatTime(seg.start_time)} – {formatTime(seg.end_time)}
                            </span>
                          </ItemDescription>
                        </ItemContent>
                        <ItemActions>
                          {activeSegmentId === seg.id && isPlayingWave ? (
                            <NowPlayingEqualizer isAnimated className="text-primary" />
                          ) : (
                            <span className="text-xs text-muted-foreground tabular-nums">
                              {formatDuration(seg.end_time - seg.start_time)}
                            </span>
                          )}
                        </ItemActions>
                      </Item>
                    </div>
                  );
                })}
              </ItemGroup>
            )}
          </section>
        </div>

        <DialogFooter>
          {/* Mounted throughout, so screen readers announce each save */}
          <span role="status" className="flex items-center gap-1 text-xs text-flexoki-green sm:mr-auto">
            {/* Each new status settles in. It leaves at once: a copy kept to fade out would linger for screen readers */}
            {saveStatus && (
              <span
                key={saveStatus}
                className="flex items-center gap-1 transition duration-150 ease-out starting:translate-y-0.5 starting:opacity-0"
              >
                <Check className="size-3.5" />
                {saveStatus}
              </span>
            )}
          </span>
          <Button onClick={() => void handleCloseStudio()}>{t("studio.doneButton")}</Button>
        </DialogFooter>
        <DialogClose
          aria-label={closeLabel}
          title={closeLabel}
          render={<Button variant="ghost" size="icon-sm" className="absolute top-2 right-2" />}
        >
          <X />
        </DialogClose>
      </DialogContent>
    </Dialog>
  );
}
