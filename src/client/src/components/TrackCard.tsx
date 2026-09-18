import * as React from "react";
import { Scissors, Play, Trash2, Disc, Loader2, AlertCircle, RotateCcw, Clock, Check } from "lucide-react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { formatDuration, createDefaultFullSegment } from "../lib/utils";
import { TrackThumbnail } from "./TrackThumbnail";
import { usePlayerStore, isPlaybackMode } from "../store/usePlayerStore";
import { useIsTrackSelected, useSelectionStore } from "../store/useSelectionStore";
import { useTranslation } from "react-i18next";
import { AddToPlaylistPopover } from "./AddToPlaylistPopover";
import type { Track, Segment } from "@/server/types";

function YoutubeIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
  );
}

import type { SelectedItem } from "../store/useSelectionStore";

interface TrackCardProps {
  track: Track;
  onDelete: (id: string) => void;
  deleteTitle?: string;
  visibleTrackIds?: (string | SelectedItem)[];
}

export function TrackCardComponent({ track, onDelete, deleteTitle, visibleTrackIds }: TrackCardProps) {
  const { t } = useTranslation();
  const openSliceStudio = usePlayerStore((s) => s.openSliceStudio);
  const retryTrack = usePlayerStore((s) => s.retryTrack);
  const isRetrying = usePlayerStore((s) => Boolean(s.retryingTrackIds?.[track.id]));
  const isSelected = useIsTrackSelected(track.id);
  const toggleTrack = useSelectionStore((s) => s.toggleTrack);
  const isCurrentPlaying = usePlayerStore((s) => s.isPlaying && s.activeTrack?.id === track.id);

  const [segments, setSegments] = React.useState<Segment[] | null>(null);

  const handleRetry = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    await retryTrack(track.id);
  };

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

    const { activeSystemCategory, playbackMode, playSegmentInMode } = usePlayerStore.getState();
    const targetMode = isPlaybackMode(activeSystemCategory) ? activeSystemCategory : playbackMode;

    if (targetMode === "original_only" || targetMode === "mixed") {
      playSegmentInMode(targetMode, createDefaultFullSegment(track), track);
      return;
    }

    // Check if player store queue already has custom slices for this track
    const state = usePlayerStore.getState();
    const queue = state.queuesByMode[targetMode] || state.queue;
    const queuedTrackSlices = queue
      .filter((it) => it.track.id === track.id && !it.segment.id.startsWith("fallback_"))
      .map((it) => it.segment);
    if (queuedTrackSlices.length > 0) {
      playSegmentInMode(targetMode, queuedTrackSlices[0], track);
      return;
    }

    let segList = segments;
    if (!segList) {
      try {
        const res = await fetch(`/api/tracks/${encodeURIComponent(track.id)}/segments`);
        if (res.ok) {
          segList = await res.json();
          setSegments(segList);
        }
      } catch (e) {
        console.error(e);
      }
    }

    if (segList && segList.length > 0) {
      playSegmentInMode(targetMode, segList[0], track);
    } else {
      // Create a default full-length segment if none exists
      playSegmentInMode(targetMode, createDefaultFullSegment(track), track);
    }
  };

  const isReady = track.status === "ready" && track.duration > 0;

  return (
    <div
      className={`group relative flex flex-col rounded-xl border bg-card p-4 transition-all hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5 ${
        isSelected
          ? "ring-2 ring-primary border-primary bg-primary/5 shadow-md shadow-primary/10"
          : isCurrentPlaying
          ? "border-primary ring-1 ring-primary/40 bg-primary/5 shadow-md shadow-primary/10"
          : !isReady ? "opacity-85 border-border" : "border-border"
      }`}
    >
      {/* Thumbnail */}
      <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-muted">
        <TrackThumbnail
          src={track.thumbnail_url}
          alt={track.title}
          className={`h-full w-full object-cover transition-transform duration-300 ${
            !isReady ? "opacity-70 brightness-90" : "group-hover:scale-105"
          }`}
          fallback={
            <div className="flex h-full w-full items-center justify-center text-muted-foreground">
              <Disc className="h-10 w-10 opacity-40" />
            </div>
          }
        />

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
              <span>{t("trackCard.flacLocal", "FLAC Local")}</span>
            </Badge>
          )}
        </div>

        {/* Selection Checkbox */}
        <button
          type="button"
          role="checkbox"
          aria-checked={isSelected}
          aria-label={t("trackCard.selectTrack", { title: track.title, defaultValue: `Select ${track.title}` })}
          onClick={(e) => {
            e.stopPropagation();
            toggleTrack(track.id, visibleTrackIds, e.shiftKey, {
              id: track.id,
              type: "track",
              trackId: track.id,
              title: track.title,
            });
          }}
          className={`absolute top-2 right-2 z-20 flex h-6 w-6 items-center justify-center rounded-md transition-all cursor-pointer ${
            isSelected
              ? "bg-primary text-primary-foreground shadow-md opacity-100 ring-2 ring-background"
              : "bg-black/60 text-white/80 hover:bg-black/80 hover:text-white backdrop-blur-xs opacity-40 group-hover:opacity-100 focus:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
          }`}
        >
          {isSelected ? (
            <Check className="h-3.5 w-3.5 stroke-[3]" />
          ) : (
            <div className="h-3.5 w-3.5 rounded-xs border-2 border-white/70" />
          )}
        </button>

        {/* Duration badge */}
        <div className="absolute bottom-2 right-2 rounded bg-black/80 px-1.5 py-0.5 text-[10px] font-mono font-medium text-white backdrop-blur-xs">
          {formatDuration(track.duration)}
        </div>

        {/* Active Playing Equalizer Badge */}
        {isCurrentPlaying && (
          <div className="absolute bottom-2 left-2 z-10 flex items-center gap-1 rounded bg-primary px-1.5 py-0.5 text-[10px] font-mono font-semibold text-primary-foreground shadow-sm">
            <span className="flex items-end gap-0.5 h-3">
              <span className="w-0.5 h-3 bg-current motion-safe:animate-pulse" />
              <span className="w-0.5 h-1.5 bg-current motion-safe:animate-pulse delay-75" />
              <span className="w-0.5 h-2.5 bg-current motion-safe:animate-pulse delay-150" />
            </span>
            <span className="uppercase text-[10px] tracking-wider font-sans">{t("player.nowPlaying", "Playing")}</span>
          </div>
        )}

        {/* Quick play overlay */}
        {isReady && (
          <button
            type="button"
            onClick={handlePlayFirst}
            className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100 cursor-pointer"
            title={t("trackCard.playTitle", { title: track.title, defaultValue: `Play ${track.title}` })}
            aria-label={t("trackCard.playTitle", { title: track.title, defaultValue: `Play ${track.title}` })}
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xl transition-transform hover:scale-110">
              <Play className="h-6 w-6 fill-current translate-x-0.5" />
            </div>
          </button>
        )}

        {/* Status Indicator */}
        {track.status === "queued" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-xs gap-1.5 p-2 text-center">
            <Clock className="h-6 w-6 text-primary/90 animate-pulse" />
            <span className="text-xs font-medium text-primary-foreground/90">{t("trackCard.queued", "Queued...")}</span>
            <span className="text-[10px] text-muted-foreground">{t("trackCard.inQueue", "In download queue")}</span>
          </div>
        )}

        {track.status === "downloading" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 backdrop-blur-xs gap-2">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <span className="text-xs font-medium text-primary">{t("trackCard.downloading", "Downloading audio...")}</span>
          </div>
        )}

        {track.status === "error" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/85 p-3 text-center z-10">
            <AlertCircle className="h-5 w-5 text-destructive mb-1 shrink-0" />
            <span className="text-xs text-destructive font-semibold">{t("trackCard.error", "Download failed")}</span>
            <span className="text-[10px] text-muted-foreground mt-0.5 mb-2 line-clamp-2" title={track.error_message || ""}>
              {track.error_message || t("trackCard.unknownError", "Unknown error")}
            </span>
            <Button
              size="sm"
              variant="destructive"
              onClick={handleRetry}
              disabled={isRetrying}
              className="h-7 text-xs px-3 gap-1.5 shadow-md cursor-pointer hover:bg-destructive/90"
            >
              <RotateCcw className={`h-3 w-3 ${isRetrying ? "animate-spin" : ""}`} />
              <span>{isRetrying ? t("trackCard.retrying", "Retrying...") : t("trackCard.retry", "Retry")}</span>
            </Button>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="mt-3 flex-1 flex flex-col">
        <h3 className={`font-semibold text-sm leading-snug line-clamp-2 transition-colors ${
          isCurrentPlaying ? "text-primary" : "text-foreground group-hover:text-primary"
        }`}>
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
            {t("trackCard.slicesCount", {
              count: track.segment_count ?? segments?.length ?? 0,
              defaultValue: `${track.segment_count ?? segments?.length ?? 0} slices`,
            })}
          </Badge>

          <div className="flex items-center gap-1.5">
            {track.status === "error" ? (
              <Badge variant="destructive" className="h-8 text-xs gap-1.5 border-destructive/40 font-normal">
                <AlertCircle className="h-3.5 w-3.5" />
                <span>{t("table.downloadError", "Error")}</span>
              </Badge>
            ) : track.status === "downloading" ? (
              <Badge variant="outline" className="h-8 text-xs gap-1.5 border-primary/30 text-primary px-2.5 font-normal">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>{t("table.downloading", "Downloading...")}</span>
              </Badge>
            ) : track.status === "queued" ? (
              <Badge variant="outline" className="h-8 text-xs gap-1.5 border-border text-muted-foreground px-2.5 font-normal">
                <Clock className="h-3.5 w-3.5 text-primary/80" />
                <span>{t("table.queued", "Queued...")}</span>
              </Badge>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => openSliceStudio(track)}
                disabled={!isReady}
                className="h-8 text-xs gap-1.5 border-primary/30 hover:bg-primary/10 hover:text-primary cursor-pointer"
              >
                <Scissors className="h-3.5 w-3.5" />
                <span>{t("trackCard.slice", "Slice")}</span>
              </Button>
            )}

            <div className="flex items-center gap-1 opacity-90 sm:opacity-60 sm:group-hover:opacity-100 sm:focus-within:opacity-100 transition-opacity duration-150">
              {isReady && <AddToPlaylistPopover trackId={track.id} disabled={!isReady} />}

              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => onDelete(track.id)}
                className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 cursor-pointer focus-visible:ring-1 focus-visible:ring-destructive focus-visible:opacity-100"
                title={deleteTitle || t("trackCard.delete", "Delete track")}
                aria-label={deleteTitle || t("trackCard.delete", "Delete track")}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export const TrackCard = React.memo(TrackCardComponent);
