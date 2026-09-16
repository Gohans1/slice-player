import * as React from "react";
import { Scissors, Play, Trash2, Disc, Loader2, AlertCircle } from "lucide-react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { formatDuration, createDefaultFullSegment } from "../lib/utils";
import { usePlayerStore } from "../store/usePlayerStore";
import type { Track, Segment } from "@/server/types";

function YoutubeIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
  );
}

interface TrackCardProps {
  track: Track;
  onDelete: (id: string) => void;
}

export function TrackCardComponent({ track, onDelete }: TrackCardProps) {
  const openSliceStudio = usePlayerStore((s) => s.openSliceStudio);
  const playSegment = usePlayerStore((s) => s.playSegment);
  const playbackMode = usePlayerStore((s) => s.playbackMode);

  const [segments, setSegments] = React.useState<Segment[] | null>(null);

  React.useEffect(() => {
    setSegments(null);
  }, [track.segment_count]);

  const isPlayBusyRef = React.useRef(false);

  const handlePlayFirst = async () => {
    if (isPlayBusyRef.current) return;
    if (track.status !== "ready" || track.duration <= 0) return;
    isPlayBusyRef.current = true;
    setTimeout(() => {
      isPlayBusyRef.current = false;
    }, 400);

    if (playbackMode === "original_only") {
      playSegment(createDefaultFullSegment(track), track);
      return;
    }

    // Check if player store queue already has custom slices for this track
    const queue = usePlayerStore.getState().queue;
    const queuedTrackSlices = queue
      .filter((it) => it.track.id === track.id && !it.segment.id.startsWith("fallback_"))
      .map((it) => it.segment);
    if (queuedTrackSlices.length > 0) {
      playSegment(queuedTrackSlices[0], track);
      return;
    }

    let segList = segments;
    if (!segList) {
      try {
        const res = await fetch(`/api/tracks/${track.id}/segments`);
        if (res.ok) {
          segList = await res.json();
          setSegments(segList);
        }
      } catch (e) {
        console.error(e);
      }
    }

    if (segList && segList.length > 0) {
      playSegment(segList[0], track);
    } else {
      // Create a default full-length segment if none exists
      playSegment(createDefaultFullSegment(track), track);
    }
  };

  return (
    <div className="group relative flex flex-col rounded-xl border border-border bg-card p-4 transition-all hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5">
      {/* Thumbnail */}
      <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-muted">
        {track.thumbnail_url ? (
          <img
            src={track.thumbnail_url}
            alt={track.title}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <Disc className="h-10 w-10 opacity-40 animate-pulse" />
          </div>
        )}

        {/* Source Badge */}
        <div className="absolute top-2 left-2">
          {track.source_type === "youtube" ? (
            <Badge variant="destructive" className="flex items-center gap-1 text-[10px] py-0.5">
              <YoutubeIcon className="h-3 w-3" />
              <span>YouTube</span>
            </Badge>
          ) : (
            <Badge variant="cyan" className="flex items-center gap-1 text-[10px] py-0.5">
              <Disc className="h-3 w-3" />
              <span>FLAC Local</span>
            </Badge>
          )}
        </div>

        {/* Duration badge */}
        <div className="absolute bottom-2 right-2 rounded bg-black/80 px-1.5 py-0.5 text-[10px] font-mono font-medium text-white backdrop-blur-xs">
          {formatDuration(track.duration)}
        </div>

        {/* Quick play overlay */}
        {track.status === "ready" && (
          <button
            onClick={handlePlayFirst}
            className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xl transition-transform hover:scale-110">
              <Play className="h-6 w-6 fill-current translate-x-0.5" />
            </div>
          </button>
        )}

        {/* Status Indicator */}
        {track.status === "downloading" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 backdrop-blur-xs gap-2">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <span className="text-xs font-medium text-primary">Đang tải audio...</span>
          </div>
        )}

        {track.status === "error" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 p-3 text-center">
            <AlertCircle className="h-6 w-6 text-destructive mb-1" />
            <span className="text-xs text-destructive font-medium">Lỗi tải audio</span>
            <span className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">
              {track.error_message || "Không xác định"}
            </span>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="mt-3 flex-1 flex flex-col">
        <h3 className="font-semibold text-sm leading-snug line-clamp-2 text-foreground group-hover:text-primary transition-colors">
          {track.title}
        </h3>
        {track.artist && (
          <p className="text-xs text-muted-foreground mt-1 truncate">
            {track.artist}
          </p>
        )}

        {/* Segment badge & actions */}
        <div className="mt-4 pt-3 border-t border-border flex items-center justify-between gap-2">
          <Badge variant="secondary" className="font-mono text-[11px] font-normal">
            {`${track.segment_count ?? (segments ? segments.length : 0)} đoạn`}
          </Badge>

          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => openSliceStudio(track)}
              disabled={track.status !== "ready"}
              className="h-8 text-xs gap-1.5 border-primary/30 hover:bg-primary/10 hover:text-primary"
            >
              <Scissors className="h-3.5 w-3.5" />
              <span>Cắt đoạn</span>
            </Button>

            <Button
              variant="ghost"
              size="icon"
              onClick={() => onDelete(track.id)}
              className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              title="Xóa bài hát"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export const TrackCard = React.memo(TrackCardComponent);
