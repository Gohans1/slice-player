import * as React from "react";
import { GripVertical, ImageIcon, ImageOff, Scissors } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui/button";
import { DropdownMenuItem } from "./ui/dropdown-menu";
import { MediaTile } from "./MediaTile";
import { RowActionsMenu } from "./RowActionsMenu";
import { useGuardedPlayToggle } from "../hooks/use-guarded-play-toggle";
import { formatDuration, DEFAULT_SLICE_COLOR } from "../lib/utils";
import { usePlayerStore, type PlayerState } from "../store/usePlayerStore";
import { useSelectionStore, useIsTrackSelected, useIsSelectionActive, createPlaylistItemSelectedItem, type SelectedItem } from "../store/useSelectionStore";
import type { PlaylistItemWithDetails } from "@/server/types";
import type { CardDragProps } from "./VirtualizedCardGrid";

const REORDER_KEYS = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"];

interface PlaylistItemCardProps {
  item: PlaylistItemWithDetails;
  index: number;
  totalItems?: number;
  visibleItemIds?: (string | SelectedItem)[];
  onPlay: (itemId: string) => void;
  onDelete?: (itemId: string, name: string) => void;
  dragProps?: CardDragProps;
}

export function PlaylistItemCardComponent({
  item,
  index,
  totalItems,
  visibleItemIds,
  onPlay,
  onDelete,
  dragProps,
}: PlaylistItemCardProps) {
  const { t } = useTranslation();
  const openSliceStudio = usePlayerStore((s) => s.openSliceStudio);
  const activePlaylistId = usePlayerStore((s) => s.activePlaylistId);
  const setPlaylistCover = usePlayerStore((s) => s.setPlaylistCover);
  const isCover = usePlayerStore(
    (s) => Boolean(item.track?.id) && s.playlists.find((p) => p.id === s.activePlaylistId)?.cover_track_id === item.track?.id
  );
  const isSelected = useIsTrackSelected(item.id);
  const isSelectionActive = useIsSelectionActive();
  const toggleTrack = useSelectionStore((s) => s.toggleTrack);

  const segment = item.segment;
  const title = segment ? segment.name : item.track.title;
  const duration = segment ? Math.max(0, segment.end_time - segment.start_time) : Math.max(0, item.track?.duration ?? 0);
  const isReady = item.track?.status === "ready" && (item.track?.duration ?? 0) > 0;

  // Playing this item means playing this playlist with this item, or failing a queue id, this slice or full track
  const isItemActive = (s: PlayerState) => {
    if (s.activePlaylistPlayingId === null || s.activePlaylistPlayingId !== s.activePlaylistId) return false;
    const currentQueueItem = s.queueIndex >= 0 ? s.queue[s.queueIndex] : null;
    if (currentQueueItem?.queueItemId) return currentQueueItem.queueItemId === item.id;
    return segment
      ? s.activeSegment?.id === segment.id
      : s.activeSegment?.track_id === item.track?.id && !s.activeSegment?.id.startsWith("seg_");
  };
  const isCurrentPlaying = usePlayerStore((s) => s.isPlaying && isItemActive(s));
  const togglePlay = useGuardedPlayToggle(isItemActive, () => onPlay(item.id));

  const studioLabel = t("table.openStudio", "Open Slice Studio");

  return (
    <MediaTile
      thumbnailUrl={item.track.thumbnail_url}
      sliceColor={segment ? segment.color || DEFAULT_SLICE_COLOR : undefined}
      title={title}
      subtitle={segment ? item.track.title : item.track.artist || t("table.unknownArtist", "Unknown Artist")}
      meta={
        segment ? (
          t("table.sliceBadge", { start: formatDuration(segment.start_time), end: formatDuration(segment.end_time) })
        ) : (
          <>
            {formatDuration(duration)} · {t("table.slicesCountBadge", { count: item.track.segment_count ?? 0 })}
          </>
        )
      }
      status={item.track.status}
      isReady={isReady}
      isCurrentPlaying={isCurrentPlaying}
      isSelected={isSelected}
      isSelectionActive={isSelectionActive}
      playLabel={
        segment
          ? t("trackCard.playSliceTitle", { name: segment.name, defaultValue: `Play slice "${segment.name}"` })
          : t("trackCard.playTitle", { title, defaultValue: `Play ${title}` })
      }
      pauseLabel={
        segment
          ? t("trackCard.pauseSliceTitle", { name: segment.name, defaultValue: `Pause slice "${segment.name}"` })
          : t("trackCard.pauseTitle", { title, defaultValue: `Pause ${title}` })
      }
      onPlayToggle={() => void togglePlay()}
      onToggleSelected={(shiftKey) =>
        toggleTrack(item.id, visibleItemIds, shiftKey, createPlaylistItemSelectedItem(item, activePlaylistId))
      }
      isDragging={dragProps?.isDragging}
      isDropTarget={dragProps?.isDragTarget}
      artworkControls={
        dragProps?.canDrag && (
          <Button
            variant="secondary"
            size="icon-sm"
            data-drag-handle="true"
            data-drag-handle-index={index}
            aria-label={t("queue.dragHandleAria", { name: title, position: index + 1, total: totalItems ?? index + 1 })}
            aria-description={t("playlist.dragToReorder", "Drag or use arrow keys to reorder playlist")}
            aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Home End"
            title={dragProps.isReordering ? t("playlist.movingItem", "Moving item...") : t("queue.dragHandleTitle", "Drag to reorder")}
            disabled={dragProps.isReordering}
            onPointerDown={(e) => {
              if (e.button === 0 && !dragProps.isReordering) dragProps.onPointerDownHandle(e);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
              } else if (REORDER_KEYS.includes(e.key)) {
                e.stopPropagation();
                dragProps.onKeyDownHandle(e);
              }
            }}
            className="cursor-grab active:cursor-grabbing"
          >
            <GripVertical />
          </Button>
        )
      }
      actions={
        <>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={!isReady}
            onClick={() => openSliceStudio(item.track)}
            title={studioLabel}
            aria-label={studioLabel}
          >
            <Scissors />
          </Button>
          <RowActionsMenu
            name={title}
            track={item.track}
            segmentId={segment?.id}
            canAddToPlaylist={isReady}
            deleteLabel={t("table.removeFromPlaylist", "Remove from Playlist")}
            onDelete={onDelete && (() => onDelete(item.id, title))}
          >
            {activePlaylistId && (
              <DropdownMenuItem onClick={() => void setPlaylistCover(activePlaylistId, isCover ? null : item.track.id)}>
                {isCover ? <ImageOff /> : <ImageIcon />}
                {isCover ? t("playlist.clearCover", "Remove playlist cover") : t("playlist.setCover", "Set as playlist cover")}
              </DropdownMenuItem>
            )}
          </RowActionsMenu>
        </>
      }
    />
  );
}

export const PlaylistItemCard = React.memo(PlaylistItemCardComponent, (prev, next) => {
  return (
    prev.item.id === next.item.id &&
    prev.item.sort_order === next.item.sort_order &&
    prev.item.track?.id === next.item.track?.id &&
    prev.item.track?.source_type === next.item.track?.source_type &&
    prev.item.track?.source_uri === next.item.track?.source_uri &&
    prev.item.track?.title === next.item.track?.title &&
    prev.item.track?.artist === next.item.track?.artist &&
    prev.item.track?.status === next.item.track?.status &&
    prev.item.track?.duration === next.item.track?.duration &&
    prev.item.track?.thumbnail_url === next.item.track?.thumbnail_url &&
    prev.item.track?.segment_count === next.item.track?.segment_count &&
    prev.item.segment?.id === next.item.segment?.id &&
    prev.item.segment?.name === next.item.segment?.name &&
    prev.item.segment?.start_time === next.item.segment?.start_time &&
    prev.item.segment?.end_time === next.item.segment?.end_time &&
    prev.item.segment?.color === next.item.segment?.color &&
    prev.index === next.index &&
    prev.totalItems === next.totalItems &&
    Boolean(prev.onDelete) === Boolean(next.onDelete) &&
    prev.onPlay === next.onPlay &&
    prev.visibleItemIds === next.visibleItemIds &&
    prev.dragProps?.canDrag === next.dragProps?.canDrag &&
    prev.dragProps?.isDragging === next.dragProps?.isDragging &&
    prev.dragProps?.isDragTarget === next.dragProps?.isDragTarget &&
    prev.dragProps?.isReordering === next.dragProps?.isReordering
  );
});
