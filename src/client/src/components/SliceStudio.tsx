import * as React from "react";
import WaveSurfer from "wavesurfer.js";
import RegionsPlugin from "wavesurfer.js/dist/plugins/regions.esm.js";
import { Play, Pause, Plus, Trash2, Scissors, Check, X, RotateCcw } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { formatTime, formatDuration } from "../lib/utils";
import { usePlayerStore } from "../store/usePlayerStore";
import type { Track, Segment } from "@/server/types";

const FLEXOKI_COLORS = [
  "#4385BE", // Blue
  "#3AA99F", // Cyan
  "#879A39", // Green
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
  const { playSegment } = usePlayerStore();
  const containerRef = React.useRef<HTMLDivElement>(null);
  const wavesurferRef = React.useRef<WaveSurfer | null>(null);
  const regionsRef = React.useRef<ReturnType<typeof RegionsPlugin.create> | null>(null);

  const [segments, setSegments] = React.useState<Segment[]>([]);
  const [isPlayingWave, setIsPlayingWave] = React.useState(false);
  const [currentPlayTime, setCurrentPlayTime] = React.useState(0);
  const [activeSegmentId, setActiveSegmentId] = React.useState<string | null>(null);
  const [saveStatus, setSaveStatus] = React.useState<string | null>(null);

  const pause = usePlayerStore((s) => s.pause);
  const removeSegmentFromQueue = usePlayerStore((s) => s.removeSegmentFromQueue);
  const isInternalUpdateRef = React.useRef(false);
  const saveDebounceTimersRef = React.useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const pendingUpdatesRef = React.useRef<Record<string, Partial<Segment>>>({});

  // Flush pending updates on unmount and cleanup timers
  React.useEffect(() => {
    return () => {
      // Immediate flush of dirty debounced saves
      for (const [id, payload] of Object.entries(pendingUpdatesRef.current)) {
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
  }, []);

  const debouncedSaveSegment = React.useCallback((id: string, updates: Partial<Segment>, statusMsg: string = "Đã lưu") => {
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
          setSaveStatus(statusMsg);
          setTimeout(() => setSaveStatus(null), 1500);
        } else {
          console.warn("[SliceStudio] Save segment rejected by server");
        }
      } catch (e) {
        console.error(e);
      }
    }, 400);
  }, []);

  // Fetch existing segments for this track
  const fetchSegments = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/tracks/${track.id}/segments`);
      if (res.ok) {
        const data: Segment[] = await res.json();
        setSegments(data);
      }
    } catch (e) {
      console.error("[SliceStudio] Fetch segments error", e);
    }
  }, [track.id]);

  React.useEffect(() => {
    fetchSegments();
  }, [fetchSegments]);

  // Initialize WaveSurfer with precomputed peaks
  React.useEffect(() => {
    if (!containerRef.current) return;

    // Parse precomputed peaks from database
    let peaks: number[][] | undefined = undefined;
    if (track.peaks_json) {
      try {
        const rawPeaks = JSON.parse(track.peaks_json);
        if (Array.isArray(rawPeaks) && rawPeaks.length > 0) {
          peaks = [rawPeaks];
        }
      } catch (e) {
        console.warn("[SliceStudio] Could not parse peaks_json", e);
      }
    }

    const wsRegions = RegionsPlugin.create();
    regionsRef.current = wsRegions;

    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: "#403e3c", // flexoki-base-200
      progressColor: "#d14d41", // flexoki-red
      cursorColor: "#ce5d97", // flexoki-magenta
      cursorWidth: 2,
      height: 128,
      normalize: true,
      url: `/api/tracks/${track.id}/stream`,
      peaks: peaks,
      duration: track.duration,
      plugins: [wsRegions],
    });

    wavesurferRef.current = ws;

    ws.on("play", () => {
      pause(); // Pause global player so both don't play simultaneously
      setIsPlayingWave(true);
    });
    ws.on("pause", () => setIsPlayingWave(false));
    ws.on("timeupdate", (time) => setCurrentPlayTime(time));

    // Region drag / resize handlers
    wsRegions.on("region-updated", (region) => {
      const segId = region.id;
      const start = Number(region.start.toFixed(2));
      const end = Number(region.end.toFixed(2));

      isInternalUpdateRef.current = true;
      setSegments((prev) =>
        prev.map((s) => (s.id === segId ? { ...s, start_time: start, end_time: end } : s))
      );

      debouncedSaveSegment(segId, { start_time: start, end_time: end }, "Đã lưu mốc cắt");
    });

    return () => {
      ws.destroy();
    };
  }, [track.id, track.duration, track.peaks_json, debouncedSaveSegment]);

  // Sync segments with WaveSurfer regions
  React.useEffect(() => {
    const wsRegions = regionsRef.current;
    if (!wsRegions) return;

    if (isInternalUpdateRef.current) {
      isInternalUpdateRef.current = false;
      return;
    }

    // Only rebuild regions if region count, start_times, end_times or colors changed
    const currentRegions = wsRegions.getRegions();
    const isMismatch =
      currentRegions.length !== segments.length ||
      segments.some((seg) => {
        const r = currentRegions.find((reg) => reg.id === seg.id);
        return !r || Math.abs(r.start - seg.start_time) > 0.05 || Math.abs(r.end - seg.end_time) > 0.05;
      });

    if (!isMismatch) return;

    wsRegions.clearRegions();

    for (const seg of segments) {
      wsRegions.addRegion({
        id: seg.id,
        start: seg.start_time,
        end: seg.end_time,
        color: seg.color ? `${seg.color}33` : "rgba(67, 133, 190, 0.2)",
        drag: true,
        resize: true,
      });
    }
  }, [segments]);

  // Handle Add New Segment at current playhead
  const handleAddNewSegment = async () => {
    const start = Math.max(0, Number(currentPlayTime.toFixed(2)));
    const end = Math.min(track.duration, Number((start + 20).toFixed(2))); // default 20s slice
    if (end <= start) return;

    const newIndex = segments.length + 1;
    const color = FLEXOKI_COLORS[(newIndex - 1) % FLEXOKI_COLORS.length];

    try {
      const res = await fetch(`/api/tracks/${track.id}/segments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `Đoạn ${newIndex}`,
          start_time: start,
          end_time: end,
          color: color,
        }),
      });

      if (res.ok) {
        const created: Segment = await res.json();
        setSegments((prev) => [...prev, created]);
        setSaveStatus("Đã tạo đoạn mới");
        setTimeout(() => setSaveStatus(null), 1500);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Delete segment
  const handleDeleteSegment = async (id: string) => {
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
    debouncedSaveSegment(id, { name }, "Đã đổi tên đoạn");
  };

  // Preview segment in studio
  const handlePreviewSegment = (seg: Segment) => {
    wavesurferRef.current?.pause();
    setActiveSegmentId(seg.id);
    playSegment(seg, track);
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
              <h2 className="text-lg font-bold text-foreground">Studio Cắt Đoạn</h2>
              {saveStatus && (
                <span className="flex items-center gap-1 text-xs text-flexoki-green animate-in fade-in">
                  <Check className="h-3.5 w-3.5" />
                  <span>{saveStatus}</span>
                </span>
              )}
            </div>
            <p className="text-sm text-foreground/90 font-medium mt-1">{track.title}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Thời lượng: {formatDuration(track.duration)} • Dùng chuột kéo thả mốc màu trên sóng âm để vi chỉnh.
            </p>
          </div>

          <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full">
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Waveform Card */}
        <div className="mt-6 rounded-xl border border-border bg-card p-5 shadow-lg">
          <div className="flex items-center justify-between mb-3 text-xs text-muted-foreground">
            <span>Biểu đồ sóng âm (Waveform)</span>
            <span className="font-mono text-foreground font-semibold">
              {formatTime(currentPlayTime)} / {formatTime(track.duration)}
            </span>
          </div>

          {/* Waveform Canvas Container */}
          <div ref={containerRef} className="rounded-lg bg-background p-2 border border-border/50 cursor-pointer" />

          {/* Controls below waveform */}
          <div className="mt-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => wavesurferRef.current?.playPause()}
                className="gap-1.5"
              >
                {isPlayingWave ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                <span>{isPlayingWave ? "Tạm dừng" : "Phát sóng âm"}</span>
              </Button>

              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  wavesurferRef.current?.seekTo(0);
                }}
                className="gap-1 text-xs text-muted-foreground"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Về đầu (0:00)</span>
              </Button>
            </div>

            <Button
              variant="default"
              size="sm"
              onClick={handleAddNewSegment}
              className="gap-1.5 bg-flexoki-blue text-primary-foreground shadow-md"
            >
              <Plus className="h-4 w-4" />
              <span>+ Tạo đoạn tại mốc này</span>
            </Button>
          </div>
        </div>

        {/* Segments Management List */}
        <div className="mt-6 flex-1 flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-sm text-foreground flex items-center gap-2">
              <span>Danh sách các đoạn đã cắt</span>
              <span className="rounded-full bg-accent px-2 py-0.5 text-xs text-accent-foreground font-mono">
                {segments.length}
              </span>
            </h3>
            <span className="text-xs text-muted-foreground">
              Mỗi đoạn này sẽ là 1 "bài" độc lập khi chạy Shuffle ngẫu nhiên
            </span>
          </div>

          {segments.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-8 rounded-xl border border-dashed border-border text-center">
              <Scissors className="h-8 w-8 text-muted-foreground/50 mb-2" />
              <p className="text-sm font-medium text-muted-foreground">Chưa có đoạn nào được tạo</p>
              <p className="text-xs text-muted-foreground/70 mt-1 max-w-sm">
                Bấm vào sóng âm để chọn vị trí, sau đó bấm "+ Tạo đoạn tại mốc này" để cắt đoạn đầu tiên.
              </p>
              <Button size="sm" onClick={handleAddNewSegment} className="mt-4 gap-1.5">
                <Plus className="h-4 w-4" />
                <span>Tạo đoạn ngay</span>
              </Button>
            </div>
          ) : (
            <div className="grid gap-2.5">
              {segments.map((seg, idx) => {
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
                        title="Nghe thử đoạn này"
                      >
                        <Play className="h-4 w-4 fill-current" />
                      </Button>

                      <div className="flex-1 min-w-0">
                        <Input
                          value={seg.name}
                          onChange={(e) => handleUpdateName(seg.id, e.target.value)}
                          className="h-8 text-xs font-medium bg-background/50 max-w-xs"
                          placeholder="Tên đoạn (ví dụ: Điệp khúc 1)"
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-3 w-full sm:w-auto border-t sm:border-t-0 pt-2 sm:pt-0 border-border">
                      <div className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
                        <span className="text-foreground font-medium">{formatTime(seg.start_time)}</span>
                        <span>→</span>
                        <span className="text-foreground font-medium">{formatTime(seg.end_time)}</span>
                        <span className="text-[11px] text-flexoki-cyan">
                          ({duration.toFixed(1)}s)
                        </span>
                      </div>

                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDeleteSegment(seg.id)}
                        className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        title="Xóa đoạn này"
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
          <Button onClick={onClose} className="px-6">
            Xong & Đóng Studio
          </Button>
        </div>
      </div>
    </div>
  );
}
