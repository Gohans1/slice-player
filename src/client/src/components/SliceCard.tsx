import * as React from "react";
import { Play, Pause, Scissors, Disc, Check, Trash2 } from "lucide-react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { formatDuration } from "../lib/utils";
import { TrackThumbnail } from "./TrackThumbnail";
import { usePlayerStore } from "../store/usePlayerStore";
import { useSelectionStore, useIsTrackSelected, useIsSelectionActive, createSliceSelectedItem, type SelectedItem } from "../store/useSelectionStore";
import { useTranslation } from "react-i18next";
import { AddToPlaylistPopover } from "./AddToPlaylistPopover";
import type { Track, Segment } from "@/server/types";

interface SliceCardProps {
  segment: Segment;
  track: Track;
  index: number;
  badgeLabel?: string;
  visibleItemIds?: (string | SelectedItem)[];
  onPlay: () => void;
  onOpenStudio: () => void;
  onDelete?: (id: string) => void;
}

export function SliceCardComponent({
  segment,
  track,
  index,
  badgeLabel,
  visibleItemIds,
  onPlay,
  onOpenStudio,
  onDelete,
}: SliceCardProps) {
  const { t } = useTranslation();
  const isCurrentActive = usePlayerStore((s) => s.activeSegment?.id === segment.id);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const isCurrentPlaying = isCurrentActive && isPlaying;
  const isSelected = useIsTrackSelected(segment.id);
  const isSelectionActive = useIsSelectionActive();
  const toggleTrack = useSelectionStore((s) => s.toggleTrack);

  const isPlayBusyRef = React.useRef(false);
  const lastPlayInitiatedRef = React.useRef(0);

  const duration = Math.max(0, segment.end_time - segment.start_time);

  return (
    <div
      className={`group relative flex flex-col rounded-xl border bg-card p-4 transition-all hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5 ${
        isSelected
          ? "ring-2 ring-primary border-primary bg-primary/5 shadow-md shadow-primary/10"
          : isCurrentPlaying
          ? "border-primary ring-1 ring-primary/40 bg-primary/5 shadow-md shadow-primary/10"
          : "border-border"
      }`}
    >
      {/* Thumbnail */}
      <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-muted">
        <TrackThumbnail
          src={track.thumbnail_url}
          alt={track.title}
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          fallback={
            <div className="flex h-full w-full items-center justify-center text-muted-foreground">
              <Disc className="h-10 w-10 opacity-40" />
            </div>
          }
        />

        {/* Kind Badge */}
        <div className="absolute top-2 left-2">
          <Badge variant="yellow" className="flex items-center gap-1 text-[10px] py-0.5 font-mono shadow-xs">
            <Scissors className="h-3 w-3" />
            <span>{badgeLabel || t("table.sliceIndex", { index: index + 1, defaultValue: `Slice #${index + 1}` })}</span>
          </Badge>
        </div>

        {/* Selection Checkbox */}
        <button
          type="button"
          role="checkbox"
          aria-checked={isSelected}
          aria-label={t("trackCard.selectTrack", { title: segment.name, defaultValue: `Select ${segment.name}` })}
          onClick={(e) => {
            e.stopPropagation();
            toggleTrack(segment.id, visibleItemIds, e.shiftKey, {
              id: segment.id,
              type: "slice",
              trackId: track.id,
              segmentId: segment.id,
              title: segment.name,
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
          {formatDuration(duration)}
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
        <button
          type="button"
          onClick={async (e) => {
            e.stopPropagation();
            if (useSelectionStore.getState().selectedTrackIds.size > 0) {
              toggleTrack(segment.id, visibleItemIds, e.shiftKey, createSliceSelectedItem(segment, track.id));
              return;
            }

            const store = usePlayerStore.getState();
            const isActive = store.activeSegment?.id === segment.id;

            if (isActive) {
              if (Date.now() - lastPlayInitiatedRef.current < 600) {
                return;
              }
              if (isPlayBusyRef.current) return;
              isPlayBusyRef.current = true;
              setTimeout(() => {
                isPlayBusyRef.current = false;
              }, 300);

              if (store.isPlaying) {
                store.pause();
              } else {
                await store.resume();
              }
              return;
            }

            if (isPlayBusyRef.current) return;
            isPlayBusyRef.current = true;
            lastPlayInitiatedRef.current = Date.now();
            try {
              await onPlay();
            } finally {
              setTimeout(() => {
                isPlayBusyRef.current = false;
              }, 500);
            }
          }}
          className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary cursor-pointer"
          title={
            isSelectionActive
              ? (isSelected
                  ? t("trackCard.deselectTrack", { title: segment.name, defaultValue: `Deselect ${segment.name}` })
                  : t("trackCard.selectTrack", { title: segment.name, defaultValue: `Select ${segment.name}` }))
              : isCurrentPlaying
              ? t("trackCard.pauseSliceTitle", { name: segment.name, defaultValue: `Pause slice "${segment.name}"` })
              : t("trackCard.playSliceTitle", { name: segment.name, defaultValue: `Play slice "${segment.name}"` })
          }
          aria-label={
            isSelectionActive
              ? (isSelected
                  ? t("trackCard.deselectTrack", { title: segment.name, defaultValue: `Deselect ${segment.name}` })
                  : t("trackCard.selectTrack", { title: segment.name, defaultValue: `Select ${segment.name}` }))
              : isCurrentPlaying
              ? t("trackCard.pauseSliceTitle", { name: segment.name, defaultValue: `Pause slice "${segment.name}"` })
              : t("trackCard.playSliceTitle", { name: segment.name, defaultValue: `Play slice "${segment.name}"` })
          }
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xl transition-transform hover:scale-110">
            {isCurrentPlaying ? (
              <Pause className="h-6 w-6 fill-current" />
            ) : (
              <Play className="h-6 w-6 fill-current translate-x-0.5" />
            )}
          </div>
        </button>
      </div>

      {/* Info */}
      <div className="mt-3 flex-1 flex flex-col">
        <h3 className={`font-semibold text-sm leading-snug line-clamp-2 transition-colors ${
          isCurrentPlaying ? "text-primary" : "text-foreground group-hover:text-primary"
        }`}>
          {segment.name}
        </h3>
        <p className="text-xs text-muted-foreground mt-1 truncate">
          {track.title}
        </p>

        {/* Actions bar */}
        <div className="mt-4 pt-3 border-t border-border flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onOpenStudio}
            disabled={track.status !== "ready" || track.duration <= 0}
            title={t("table.openStudio", "Open Slice Studio")}
            className="h-8 text-xs gap-1.5 border-primary/30 hover:bg-primary/10 hover:text-primary cursor-pointer"
          >
            <Scissors className="h-3.5 w-3.5" />
            <span>{t("table.studio", "Studio")}</span>
          </Button>

          <div className="flex items-center gap-1 opacity-90 sm:opacity-60 sm:group-hover:opacity-100 sm:focus-within:opacity-100 transition-opacity duration-150">
            <AddToPlaylistPopover trackId={track.id} segmentId={segment.id} />
            {onDelete && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(segment.id);
                }}
                className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 cursor-pointer focus-visible:ring-1 focus-visible:ring-destructive focus-visible:opacity-100"
                title={t("trackCard.deleteSlice", "Delete slice")}
                aria-label={t("trackCard.deleteSlice", "Delete slice")}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export const SliceCard = React.memo(SliceCardComponent);
