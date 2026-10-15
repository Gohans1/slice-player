import * as React from "react";
import { Scissors } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui/button";
import { MediaTile } from "./MediaTile";
import { RowActionsMenu } from "./RowActionsMenu";
import { useGuardedPlayToggle } from "../hooks/use-guarded-play-toggle";
import { formatDuration, DEFAULT_SLICE_COLOR } from "../lib/utils";
import { usePlayerStore } from "../store/usePlayerStore";
import { useSelectionStore, useIsTrackSelected, useIsSelectionActive, createSliceSelectedItem, type SelectedItem } from "../store/useSelectionStore";
import type { Track, Segment } from "@/server/types";

interface SliceCardProps {
  segment: Segment;
  track: Track;
  visibleItemIds?: (string | SelectedItem)[];
  onPlay: (segment: Segment, track: Track) => unknown;
  onOpenStudio: (track: Track) => void;
  onDelete?: (id: string) => void;
}

export function SliceCardComponent({ segment, track, visibleItemIds, onPlay, onOpenStudio, onDelete }: SliceCardProps) {
  const { t } = useTranslation();
  const isCurrentPlaying = usePlayerStore((s) => s.isPlaying && s.activeSegment?.id === segment.id);
  const isSelected = useIsTrackSelected(segment.id);
  const isSelectionActive = useIsSelectionActive();
  const toggleTrack = useSelectionStore((s) => s.toggleTrack);
  const togglePlay = useGuardedPlayToggle((s) => s.activeSegment?.id === segment.id, () => onPlay(segment, track));

  const isReady = track.status === "ready" && track.duration > 0;
  const studioLabel = t("table.openStudio", "Open Slice Studio");

  return (
    <MediaTile
      thumbnailUrl={track.thumbnail_url}
      sliceColor={segment.color || DEFAULT_SLICE_COLOR}
      title={segment.name}
      subtitle={track.title}
      meta={t("table.sliceBadge", { start: formatDuration(segment.start_time), end: formatDuration(segment.end_time) })}
      status={track.status}
      isReady={isReady}
      isCurrentPlaying={isCurrentPlaying}
      isSelected={isSelected}
      isSelectionActive={isSelectionActive}
      playLabel={t("trackCard.playSliceTitle", { name: segment.name, defaultValue: `Play slice "${segment.name}"` })}
      pauseLabel={t("trackCard.pauseSliceTitle", { name: segment.name, defaultValue: `Pause slice "${segment.name}"` })}
      onPlayToggle={() => void togglePlay()}
      onToggleSelected={(shiftKey) => toggleTrack(segment.id, visibleItemIds, shiftKey, createSliceSelectedItem(segment, track.id))}
      actions={
        <>
          <Button variant="ghost" size="icon-sm" disabled={!isReady} onClick={() => onOpenStudio(track)} title={studioLabel} aria-label={studioLabel}>
            <Scissors />
          </Button>
          <RowActionsMenu
            name={segment.name}
            track={track}
            segmentId={segment.id}
            canAddToPlaylist={isReady}
            deleteLabel={t("trackCard.deleteSlice", "Delete slice")}
            onDelete={onDelete && (() => onDelete(segment.id))}
          />
        </>
      }
    />
  );
}

export const SliceCard = React.memo(SliceCardComponent, (prev, next) => {
  return (
    prev.segment.id === next.segment.id &&
    prev.segment.name === next.segment.name &&
    prev.segment.start_time === next.segment.start_time &&
    prev.segment.end_time === next.segment.end_time &&
    prev.segment.color === next.segment.color &&
    prev.track.id === next.track.id &&
    prev.track.source_type === next.track.source_type &&
    prev.track.source_uri === next.track.source_uri &&
    prev.track.title === next.track.title &&
    prev.track.status === next.track.status &&
    prev.track.duration === next.track.duration &&
    prev.track.thumbnail_url === next.track.thumbnail_url &&
    prev.onDelete === next.onDelete &&
    prev.onPlay === next.onPlay &&
    prev.onOpenStudio === next.onOpenStudio &&
    prev.visibleItemIds === next.visibleItemIds
  );
});
