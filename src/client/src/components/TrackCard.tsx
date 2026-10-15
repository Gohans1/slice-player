import * as React from "react";
import { RotateCcw, Scissors } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui/button";
import { MediaTile } from "./MediaTile";
import { RowActionsMenu } from "./RowActionsMenu";
import { useGuardedPlayToggle } from "../hooks/use-guarded-play-toggle";
import { cn, formatDuration, createDefaultFullSegment, isFullTrackSegment } from "../lib/utils";
import { usePlayerStore, isPlaybackMode, type PlayerState } from "../store/usePlayerStore";
import { useIsTrackSelected, useSelectionStore, useIsSelectionActive, createTrackSelectedItem, type SelectedItem } from "../store/useSelectionStore";
import type { Track, Segment } from "@/server/types";

interface TrackCardProps {
  track: Track;
  onDelete: (id: string) => void;
  deleteTitle?: string;
  visibleTrackIds?: (string | SelectedItem)[];
  // Starts this track in the view's queue; without it the card plays the track on its own
  onPlay?: (track: Track) => unknown;
}

export function TrackCardComponent({ track, onDelete, deleteTitle, visibleTrackIds, onPlay }: TrackCardProps) {
  const { t } = useTranslation();
  const openSliceStudio = usePlayerStore((s) => s.openSliceStudio);
  const retryTrack = usePlayerStore((s) => s.retryTrack);
  const isRetrying = usePlayerStore((s) => Boolean(s.retryingTrackIds?.[track.id]));
  const isSelected = useIsTrackSelected(track.id);
  const isSelectionActive = useIsSelectionActive();
  const toggleTrack = useSelectionStore((s) => s.toggleTrack);
  // The card stands for the full track; one of its slices playing is a different item
  const isActiveItem = (s: PlayerState) => s.activeTrack?.id === track.id && isFullTrackSegment(s.activeSegment);
  const isCurrentPlaying = usePlayerStore((s) => s.isPlaying && isActiveItem(s));

  // Fetched slices go stale once the track's slice count changes
  const [fetchedSegments, setFetchedSegments] = React.useState<{ count?: number; list: Segment[] } | null>(null);
  const segments = fetchedSegments && fetchedSegments.count === track.segment_count ? fetchedSegments.list : null;

  const playFirstSlice = async () => {
    if (onPlay) {
      onPlay(track);
      return;
    }
    const store = usePlayerStore.getState();
    const { activeSystemCategory, playbackMode, playSegmentInMode } = store;
    const targetMode = isPlaybackMode(activeSystemCategory) ? activeSystemCategory : playbackMode;

    if (targetMode === "original_only" || targetMode === "mixed") {
      await playSegmentInMode(targetMode, createDefaultFullSegment(track), track);
      return;
    }

    // Check if player store queue already has custom slices for this track
    const queue = store.queuesByMode[targetMode] || store.queue;
    const queuedTrackSlices = queue
      .filter((it) => it.track.id === track.id && !it.segment.id.startsWith("fallback_"))
      .map((it) => it.segment);
    if (queuedTrackSlices.length > 0) {
      await playSegmentInMode(targetMode, queuedTrackSlices[0], track);
      return;
    }

    let segList = segments;
    if (!segList) {
      try {
        const res = await fetch(`/api/tracks/${encodeURIComponent(track.id)}/segments`);
        if (res.ok) {
          const list: Segment[] = await res.json();
          segList = list;
          setFetchedSegments({ count: track.segment_count, list });
        }
      } catch (e) {
        console.error(e);
      }
    }

    if (segList && segList.length > 0) {
      await playSegmentInMode(targetMode, segList[0], track);
    } else {
      // Create a default full-length segment if none exists
      await playSegmentInMode(targetMode, createDefaultFullSegment(track), track);
    }
  };

  const togglePlay = useGuardedPlayToggle(isActiveItem, playFirstSlice);

  const isReady = track.status === "ready" && track.duration > 0;
  const studioLabel = t("table.openStudio", "Open Slice Studio");

  return (
    <MediaTile
      thumbnailUrl={track.thumbnail_url}
      title={track.title}
      subtitle={track.artist || t("table.unknownArtist", "Unknown Artist")}
      meta={
        track.status === "error" ? (
          <span className="text-destructive" title={track.error_message || undefined}>
            {track.error_message || t("trackCard.unknownError", "Unknown error")}
          </span>
        ) : (
          <>
            {formatDuration(track.duration)} ·{" "}
            {t("table.slicesCountBadge", { count: track.segment_count ?? segments?.length ?? 0 })}
          </>
        )
      }
      status={track.status}
      isReady={isReady}
      isCurrentPlaying={isCurrentPlaying}
      isSelected={isSelected}
      isSelectionActive={isSelectionActive}
      playLabel={t("trackCard.playTitle", { title: track.title, defaultValue: `Play ${track.title}` })}
      pauseLabel={t("trackCard.pauseTitle", { title: track.title, defaultValue: `Pause ${track.title}` })}
      onPlayToggle={() => void togglePlay()}
      onToggleSelected={(shiftKey) => toggleTrack(track.id, visibleTrackIds, shiftKey, createTrackSelectedItem(track))}
      errorAction={
        <Button variant="destructive" size="sm" disabled={isRetrying} onClick={() => void retryTrack(track.id)}>
          <RotateCcw data-icon="inline-start" className={cn(isRetrying && "animate-spin")} />
          {isRetrying ? t("trackCard.retrying", "Retrying…") : t("trackCard.retry", "Retry")}
        </Button>
      }
      actions={
        <>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={!isReady}
            onClick={() => openSliceStudio(track)}
            title={studioLabel}
            aria-label={studioLabel}
          >
            <Scissors />
          </Button>
          <RowActionsMenu
            name={track.title}
            track={track}
            canAddToPlaylist={isReady}
            deleteLabel={deleteTitle || t("trackCard.delete", "Delete track")}
            onDelete={() => onDelete(track.id)}
          />
        </>
      }
    />
  );
}

export const TrackCard = React.memo(TrackCardComponent, (prev, next) => {
  return (
    prev.track.id === next.track.id &&
    prev.track.source_type === next.track.source_type &&
    prev.track.source_uri === next.track.source_uri &&
    prev.track.title === next.track.title &&
    prev.track.artist === next.track.artist &&
    prev.track.status === next.track.status &&
    prev.track.error_message === next.track.error_message &&
    prev.track.duration === next.track.duration &&
    prev.track.thumbnail_url === next.track.thumbnail_url &&
    prev.track.segment_count === next.track.segment_count &&
    prev.deleteTitle === next.deleteTitle &&
    prev.onPlay === next.onPlay &&
    prev.onDelete === next.onDelete &&
    prev.visibleTrackIds === next.visibleTrackIds
  );
});
