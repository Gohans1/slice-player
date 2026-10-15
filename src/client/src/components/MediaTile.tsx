import * as React from "react";
import { AlertCircle, Clock, Disc, Pause, Play } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "./ui/badge";
import { Checkbox } from "./ui/checkbox";
import { Spinner } from "./ui/spinner";
import { NowPlayingEqualizer } from "./NowPlayingEqualizer";
import { TrackThumbnail } from "./TrackThumbnail";
import { cn } from "../lib/utils";
import type { Track } from "@/server/types";

// Hidden until hover on mouse and trackpad; touch screens can't hover, so they always show
const REVEAL_ON_HOVER = "transition-opacity pointer-fine:opacity-0 group-hover:opacity-100 focus-within:opacity-100";

interface MediaTileProps {
  thumbnailUrl?: string | null;
  // Slices show their color as a bar along the artwork's bottom edge
  sliceColor?: string;
  title: string;
  subtitle: React.ReactNode;
  // Small print under the subtitle, such as duration and slice count
  meta: React.ReactNode;
  status: Track["status"];
  isReady: boolean;
  isCurrentPlaying: boolean;
  isSelected: boolean;
  isSelectionActive: boolean;
  playLabel: string;
  pauseLabel: string;
  onPlayToggle: () => void;
  onToggleSelected: (shiftKey: boolean) => void;
  // Shown under a failed download's status, such as a Retry button
  errorAction?: React.ReactNode;
  // Extra artwork controls in the top-right corner, such as a drag handle
  artworkControls?: React.ReactNode;
  // Controls beside the title: a Slice Studio shortcut and the "..." menu
  actions: React.ReactNode;
  isDragging?: boolean;
  isDropTarget?: boolean;
}

// Apple Music style grid tile: artwork with a hover play button, then title, subtitle and details
export function MediaTile({
  thumbnailUrl,
  sliceColor,
  title,
  subtitle,
  meta,
  status,
  isReady,
  isCurrentPlaying,
  isSelected,
  isSelectionActive,
  playLabel,
  pauseLabel,
  onPlayToggle,
  onToggleSelected,
  errorAction,
  artworkControls,
  actions,
  isDragging,
  isDropTarget,
}: MediaTileProps) {
  const { t } = useTranslation();
  const selectLabel = t("trackCard.selectTrack", { title, defaultValue: `Select ${title}` });
  const activateLabel = isSelectionActive
    ? isSelected
      ? t("trackCard.deselectTrack", { title, defaultValue: `Deselect ${title}` })
      : selectLabel
    : isCurrentPlaying
      ? pauseLabel
      : playLabel;

  return (
    <div
      data-dragging={isDragging || undefined}
      data-drop-target={isDropTarget || undefined}
      className={cn("group flex flex-col gap-2", isDragging && "opacity-40")}
    >
      <div
        className={cn(
          "relative aspect-video overflow-hidden rounded-lg bg-muted",
          (isSelected || isDropTarget) && "ring-2 ring-primary ring-offset-2 ring-offset-background"
        )}
      >
        <TrackThumbnail
          src={thumbnailUrl}
          alt=""
          className={cn("size-full object-cover", !isReady && "opacity-50")}
          fallback={
            <div className="flex size-full items-center justify-center text-muted-foreground">
              <Disc className="size-10 opacity-40" />
            </div>
          }
        />
        {sliceColor && (
          <div
            data-slot="slice-color"
            className="absolute inset-x-0 bottom-0 h-1 bg-(--slice-color)"
            style={{ "--slice-color": sliceColor }}
          />
        )}

        {isReady && (
          <button
            type="button"
            title={activateLabel}
            aria-label={activateLabel}
            onClick={(e) => {
              if (isSelectionActive) {
                onToggleSelected(e.shiftKey);
              } else {
                onPlayToggle();
              }
            }}
            className="group/activate absolute inset-0 flex cursor-pointer items-end p-2 transition-colors outline-none group-hover:bg-background/30 focus-visible:bg-background/30 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          >
            {!isSelectionActive && (
              <span className="flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-visible/activate:opacity-100">
                {isCurrentPlaying ? <Pause className="size-4 fill-current" /> : <Play className="size-4 translate-x-px fill-current" />}
              </span>
            )}
          </button>
        )}

        {!isReady && status !== "ready" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-background/70 p-2 text-center text-xs font-medium backdrop-blur-xs">
            {status === "queued" && (
              <>
                <Clock className="size-5" />
                {t("trackCard.queued", "Queued...")}
              </>
            )}
            {status === "downloading" && (
              <>
                <Spinner className="size-5" />
                {t("trackCard.downloading", "Downloading audio...")}
              </>
            )}
            {status === "error" && (
              <>
                <AlertCircle className="size-5 text-destructive" />
                <span className="text-destructive">{t("trackCard.error", "Download failed")}</span>
                {errorAction}
              </>
            )}
          </div>
        )}

        {isCurrentPlaying && (
          <Badge className="absolute right-2 bottom-2">
            <NowPlayingEqualizer />
            {t("player.nowPlaying", "Playing")}
          </Badge>
        )}

        <span className={cn("absolute top-2 left-2 flex rounded-sm bg-background/70 backdrop-blur-xs", !isSelectionActive && REVEAL_ON_HOVER)}>
          <Checkbox
            checked={isSelected}
            aria-label={selectLabel}
            onClick={(e) => {
              e.stopPropagation();
              onToggleSelected(e.shiftKey);
            }}
          />
        </span>

        {artworkControls && <div className={cn("absolute top-2 right-2 flex gap-1", REVEAL_ON_HOVER)}>{artworkControls}</div>}
      </div>

      <div className="flex min-w-0 items-start gap-1">
        <div className="min-w-0 flex-1">
          <h3 title={title} className={cn("truncate text-sm font-medium", isCurrentPlaying ? "text-primary" : "text-foreground")}>
            {title}
          </h3>
          <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
          <p className="truncate font-mono text-2xs text-muted-foreground">{meta}</p>
        </div>
        <div className="flex shrink-0 items-center">{actions}</div>
      </div>
    </div>
  );
}
