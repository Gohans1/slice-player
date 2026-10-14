import * as React from "react";
import { Play, Pause, Trash2, Scissors, Disc, Loader2, Clock, AlertCircle, Check, GripVertical, ImageIcon } from "lucide-react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { formatDuration } from "../lib/utils";
import { TrackThumbnail } from "./TrackThumbnail";
import { usePlayerStore } from "../store/usePlayerStore";
import { useSelectionStore, useIsTrackSelected, useIsSelectionActive, createPlaylistItemSelectedItem, type SelectedItem } from "../store/useSelectionStore";
import { useTranslation } from "react-i18next";
import { AddToPlaylistPopover } from "./AddToPlaylistPopover";
import { CopyTrackLinkButton } from "./CopyTrackLinkButton";
import { NowPlayingEqualizer } from "./NowPlayingEqualizer";
import type { PlaylistItemWithDetails } from "@/server/types";
import type { CardDragProps } from "./VirtualizedCardGrid";

function YoutubeIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
  );
}

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
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const openSliceStudio = usePlayerStore((s) => s.openSliceStudio);

  const activePlaylistId = usePlayerStore((s) => s.activePlaylistId);
  const setPlaylistCover = usePlayerStore((s) => s.setPlaylistCover);
  const isCover = usePlayerStore(
    (s) => Boolean(item.track?.id) && s.playlists.find((p) => p.id === s.activePlaylistId)?.cover_track_id === item.track?.id
  );
  const isSelected = useIsTrackSelected(item.id);
  const isSelectionActive = useIsSelectionActive();
  const toggleTrack = useSelectionStore((s) => s.toggleTrack);

  const onPlayRef = React.useRef(onPlay);
  onPlayRef.current = onPlay;
  const onDeleteRef = React.useRef(onDelete);
  onDeleteRef.current = onDelete;
  const visibleItemIdsRef = React.useRef(visibleItemIds);
  visibleItemIdsRef.current = visibleItemIds;

  const isSlice = Boolean(item.segment);
  const duration = isSlice && item.segment
    ? Math.max(0, item.segment.end_time - item.segment.start_time)
    : Math.max(0, item.track?.duration ?? 0);
  const isReady = item.track?.status === "ready" && (item.track?.duration ?? 0) > 0;

  const isCurrentActive = usePlayerStore((s) => {
    const isThisPlaylistPlaying = s.activePlaylistPlayingId !== null && s.activePlaylistPlayingId === s.activePlaylistId;
    if (!isThisPlaylistPlaying) return false;
    const currentQueueItem = s.queueIndex >= 0 ? s.queue[s.queueIndex] : null;
    if (currentQueueItem?.queueItemId) {
      return currentQueueItem.queueItemId === item.id;
    }
    return isSlice && item.segment
      ? s.activeSegment?.id === item.segment.id
      : s.activeSegment?.track_id === item.track?.id && !s.activeSegment?.id.startsWith("seg_");
  });
  const isCurrentPlaying = isCurrentActive && isPlaying;

  const isPlayBusyRef = React.useRef(false);
  const lastPlayInitiatedRef = React.useRef(0);

  const itemTitle = isSlice && item.segment ? item.segment.name : (item.track?.title ?? "");
  const pauseTooltip = isSlice && item.segment
    ? t("trackCard.pauseSliceTitle", { name: item.segment.name, defaultValue: `Pause slice "${item.segment.name}"` })
    : t("trackCard.pauseTitle", { title: itemTitle, defaultValue: `Pause ${itemTitle}` });
  const playTooltip = isSlice && item.segment
    ? t("trackCard.playSliceTitle", { name: item.segment.name, defaultValue: `Play slice "${item.segment.name}"` })
    : t("trackCard.playTitle", { title: itemTitle, defaultValue: `Play ${itemTitle}` });

  const isDragging = dragProps?.isDragging;
  const isDragTarget = dragProps?.isDragTarget;
  const canDrag = dragProps?.canDrag;

  return (
    <div
      className={`group relative flex flex-col h-full rounded-xl border bg-card p-4 transition-[border-color,box-shadow,background-color,transform,opacity] duration-200 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5 ${
        isDragging
          ? "opacity-35 scale-[0.98] border-dashed border-primary/60 bg-primary/5"
          : isDragTarget
          ? "ring-2 ring-primary border-primary bg-primary/5 shadow-xl shadow-primary/20 scale-[1.02]"
          : isSelected
          ? "ring-2 ring-primary border-primary bg-primary/5 shadow-md shadow-primary/10"
          : isCurrentPlaying
          ? "border-primary/60 bg-primary/5 shadow-xs ring-1 ring-primary/30"
          : "border-border"
      } ${!isReady ? "opacity-75" : ""}`}
    >
      {/* Thumbnail */}
      <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-muted">
        <TrackThumbnail
          src={item.track.thumbnail_url}
          alt={item.track.title}
          className={`h-full w-full object-cover transition-transform duration-300 ${!isReady ? "opacity-70 brightness-90" : "group-hover:scale-105"}`}
          fallback={
            <div className="flex h-full w-full items-center justify-center text-muted-foreground">
              <Disc className="h-10 w-10 opacity-40" />
            </div>
          }
        />

        {/* Source / Kind Badge */}
        <div className="absolute top-2 left-2">
          {isSlice && item.segment ? (
            <Badge variant="yellow" className="flex items-center gap-1 text-2xs py-0.5 font-mono shadow-xs">
              <Scissors className="h-3 w-3" />
              <span>{t("table.sliceIndex", { index: index + 1, defaultValue: `Slice #${index + 1}` })}</span>
            </Badge>
          ) : item.track.source_type === "youtube" ? (
            <Badge variant="destructive" className="flex items-center gap-1 text-2xs py-0.5">
              <YoutubeIcon className="h-3 w-3" />
              <span>YouTube</span>
            </Badge>
          ) : (
            <Badge variant="cyan" className="flex items-center gap-1 text-2xs py-0.5">
              <Disc className="h-3 w-3" />
              <span>{t("trackCard.flacLocal", "FLAC Local")}</span>
            </Badge>
          )}
        </div>

        {/* Set as Playlist Cover Button */}
        {activePlaylistId && (
          <button
            type="button"
            aria-pressed={isCover}
            aria-label={t("playlist.setCover", "Set as playlist cover")}
            title={isCover ? t("playlist.clearCover", "Remove playlist cover") : t("playlist.setCover", "Set as playlist cover")}
            onClick={(e) => {
              e.stopPropagation();
              setPlaylistCover(activePlaylistId, isCover ? null : item.track.id);
            }}
            className={`absolute top-2 ${canDrag ? "right-16" : "right-9"} z-20 flex h-6 w-6 items-center justify-center rounded-md backdrop-blur-xs transition-[background-color,color,opacity,box-shadow,transform] duration-150 active:scale-95 motion-reduce:transform-none cursor-pointer focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none ${
              isCover
                ? "bg-black/80 text-flexoki-yellow opacity-100 ring-1 ring-flexoki-yellow/50 shadow-sm"
                : "bg-black/60 text-white/80 hover:bg-black/80 hover:text-flexoki-yellow opacity-40 sm:opacity-0 group-hover:opacity-100"
            }`}
          >
            <ImageIcon className="h-3.5 w-3.5" />
          </button>
        )}

        {/* Drag Handle */}
        {canDrag && (
          <button
            type="button"
            data-drag-handle="true"
            data-drag-handle-index={index}
            aria-label={t("queue.dragHandleAria", {
              name: itemTitle,
              position: index + 1,
              total: totalItems ?? index + 1,
            })}
            aria-description={t("playlist.dragToReorder", "Drag or use arrow keys to reorder playlist")}
            aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Home End"
            title={dragProps?.isReordering ? t("playlist.movingItem", "Moving item...") : t("queue.dragHandleTitle", "Drag to reorder")}
            disabled={dragProps?.isReordering}
            onPointerDown={(e) => {
              if (e.button === 0 && !dragProps?.isReordering) {
                dragProps?.onPointerDownHandle(e);
              }
            }}
            onClick={(e) => {
              e.stopPropagation();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                return;
              }
              if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) {
                e.stopPropagation();
                dragProps?.onKeyDownHandle(e);
              }
            }}
            className={`absolute top-2 right-9 z-20 flex h-6 w-6 items-center justify-center rounded-md bg-black/60 text-white/80 backdrop-blur-xs transition-[background-color,color,opacity,box-shadow,transform] duration-150 active:scale-95 motion-reduce:transform-none cursor-grab active:cursor-grabbing hover:bg-black/80 hover:text-white focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none ${
              dragProps?.isReordering
                ? "opacity-30 cursor-not-allowed"
                : "opacity-60 sm:opacity-0 group-hover:opacity-100"
            }`}
          >
            <GripVertical className="h-3.5 w-3.5" />
          </button>
        )}

        {/* Selection Checkbox */}
        <button
          type="button"
          role="checkbox"
          aria-checked={isSelected}
          aria-label={t("trackCard.selectTrack", {
            title: isSlice && item.segment ? item.segment.name : item.track.title,
            defaultValue: `Select ${isSlice && item.segment ? item.segment.name : item.track.title}`,
          })}
          onClick={(e) => {
            e.stopPropagation();
            toggleTrack(item.id, visibleItemIdsRef.current, e.shiftKey, {
              id: item.id,
              type: "playlist_item",
              trackId: item.track.id,
              segmentId: item.segment?.id || null,
              playlistId: activePlaylistId,
              title: isSlice && item.segment ? item.segment.name : item.track.title,
            });
          }}
          className={`absolute top-2 right-2 z-20 flex h-6 w-6 items-center justify-center rounded-md transition-[background-color,color,opacity,box-shadow,transform] active:scale-90 motion-reduce:transform-none duration-150 cursor-pointer ${
            isSelected
              ? "bg-primary text-primary-foreground shadow-md opacity-100 ring-2 ring-background"
              : "bg-black/60 text-white/80 hover:bg-black/80 hover:text-white backdrop-blur-xs opacity-40 sm:opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
          }`}
        >
          {isSelected ? (
            <Check className="h-3.5 w-3.5 stroke-[3] animate-in zoom-in-75 duration-100 ease-out" />
          ) : (
            <div className="h-3.5 w-3.5 rounded-xs border-2 border-white/70" />
          )}
        </button>

        {/* Duration badge */}
        <div className="absolute bottom-2 right-2 rounded bg-black/80 px-1.5 py-0.5 text-2xs font-mono font-medium text-white backdrop-blur-xs">
          {formatDuration(duration)}
        </div>

        {/* Active Playing Equalizer Badge */}
        {isCurrentPlaying && (
          <div className="absolute bottom-2 left-2 z-10 flex items-center gap-1.5 rounded bg-primary px-1.5 py-0.5 text-2xs font-mono font-semibold text-primary-foreground shadow-sm animate-in fade-in zoom-in-95 duration-150 ease-out motion-reduce:animate-none">
            <NowPlayingEqualizer />
            <span className="uppercase text-2xs tracking-wider font-sans">{t("player.nowPlaying", "Playing")}</span>
          </div>
        )}

        {/* Quick play overlay / status overlay */}
        {isReady ? (
          <button
            type="button"
            onClick={async (e) => {
              e.stopPropagation();
              if (useSelectionStore.getState().selectedTrackIds.size > 0) {
                toggleTrack(item.id, visibleItemIdsRef.current, e.shiftKey, createPlaylistItemSelectedItem(item, activePlaylistId));
                return;
              }

              const store = usePlayerStore.getState();
              const isPlayingPlaylist = store.activePlaylistPlayingId !== null && store.activePlaylistPlayingId === activePlaylistId;
              const currentQItem = store.queue[store.queueIndex];
              const isActive =
                isPlayingPlaylist &&
                (currentQItem?.queueItemId
                  ? currentQItem.queueItemId === item.id
                  : (isSlice && item.segment
                      ? store.activeSegment?.id === item.segment.id
                      : store.activeSegment?.track_id === item.track?.id && !store.activeSegment?.id.startsWith("seg_")));

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
                await onPlayRef.current(item.id);
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
                    ? t("trackCard.deselectTrack", {
                        title: itemTitle,
                        defaultValue: `Deselect ${itemTitle}`,
                      })
                    : t("trackCard.selectTrack", {
                        title: itemTitle,
                        defaultValue: `Select ${itemTitle}`,
                      }))
                : isCurrentPlaying
                ? pauseTooltip
                : playTooltip
            }
            aria-label={
              isSelectionActive
                ? (isSelected
                    ? t("trackCard.deselectTrack", {
                        title: itemTitle,
                        defaultValue: `Deselect ${itemTitle}`,
                      })
                    : t("trackCard.selectTrack", {
                        title: itemTitle,
                        defaultValue: `Select ${itemTitle}`,
                      }))
                : isCurrentPlaying
                ? pauseTooltip
                : playTooltip
            }
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xl transition-transform duration-100 hover:scale-110 active:scale-95">
              {isCurrentPlaying ? (
                <Pause className="h-6 w-6 fill-current" />
              ) : (
                <Play className="h-6 w-6 fill-current translate-x-0.5" />
              )}
            </div>
          </button>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-xs">
            {item.track.status === "downloading" ? (
              <div className="flex items-center gap-1.5 text-xs text-primary font-medium px-2.5 py-1 rounded-md bg-black/70 border border-primary/20">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>{t("table.downloading", "Downloading...")}</span>
              </div>
            ) : item.track.status === "queued" ? (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium px-2.5 py-1 rounded-md bg-black/70 border border-border">
                <Clock className="h-4 w-4 animate-pulse text-primary/80" />
                <span>{t("table.queued", "Queued...")}</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-xs text-destructive font-medium px-2.5 py-1 rounded-md bg-black/70 border border-destructive/20">
                <AlertCircle className="h-4 w-4" />
                <span>{t("table.downloadError", "Download Error")}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="mt-3 flex-1 flex flex-col">
        <h3 className={`font-semibold text-sm leading-snug line-clamp-2 min-h-[2.5rem] transition-colors ${
          isCurrentPlaying ? "text-primary" : "text-foreground group-hover:text-primary"
        }`}>
          {isSlice && item.segment ? item.segment.name : item.track.title}
        </h3>
        <p className="text-xs text-muted-foreground mt-1 truncate">
          {isSlice ? item.track.title : (item.track.artist || t("table.unknownArtist", "Unknown Artist"))}
        </p>

        {/* Segment badge & actions (unified with TrackCard and SliceCard) */}
        <div className="mt-auto pt-3 border-t border-border flex items-center justify-between gap-1.5">
          {isSlice && item.segment ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => openSliceStudio(item.track)}
              disabled={!isReady}
              title={t("table.openStudio", "Open Slice Studio")}
              className="h-8 text-xs gap-1.5 border-primary/30 hover:bg-primary/10 hover:text-primary cursor-pointer shrink-0"
            >
              <Scissors className="h-3.5 w-3.5" />
              <span>{t("table.studio", "Studio")}</span>
            </Button>
          ) : (
            <Badge variant="secondary" className="font-mono text-2xs font-normal whitespace-nowrap shrink-0">
              {t("trackCard.slicesCount", {
                count: item.track.segment_count ?? 0,
                defaultValue: `${item.track.segment_count ?? 0} slices`,
              })}
            </Badge>
          )}

          <div className="flex items-center gap-1.5 shrink-0">
            {!isSlice && (
              item.track.status === "error" ? (
                <Badge variant="destructive" className="h-8 text-xs gap-1.5 border-destructive/40 font-normal shrink-0">
                  <AlertCircle className="h-3.5 w-3.5" />
                  <span>{t("table.downloadError", "Error")}</span>
                </Badge>
              ) : item.track.status === "downloading" ? (
                <Badge variant="outline" className="h-8 text-xs gap-1.5 border-primary/30 text-primary px-2.5 font-normal shrink-0">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>{t("table.downloading", "Downloading...")}</span>
                </Badge>
              ) : item.track.status === "queued" ? (
                <Badge variant="outline" className="h-8 text-xs gap-1.5 border-border text-muted-foreground px-2.5 font-normal shrink-0">
                  <Clock className="h-3.5 w-3.5 text-primary/80" />
                  <span>{t("table.queued", "Queued...")}</span>
                </Badge>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => openSliceStudio(item.track)}
                  disabled={!isReady}
                  title={t("table.openStudio", "Open Slice Studio")}
                  className="h-8 text-xs gap-1 px-2 border-primary/30 hover:bg-primary/10 hover:text-primary cursor-pointer shrink-0"
                >
                  <Scissors className="h-3.5 w-3.5" />
                  <span>{t("trackCard.slice", "Slice")}</span>
                </Button>
              )
            )}

            <div className="flex items-center gap-0.5 opacity-90 sm:opacity-60 sm:group-hover:opacity-100 sm:focus-within:opacity-100 transition-opacity duration-150 shrink-0">
              <CopyTrackLinkButton
                sourceType={item.track?.source_type}
                sourceUri={item.track?.source_uri}
              />

              <AddToPlaylistPopover
                trackId={item.track?.id ?? item.track_id}
                segmentId={isSlice && item.segment ? item.segment.id : undefined}
                disabled={!isReady}
                variant="ghost"
                size="icon"
                buttonClassName="h-8 w-8 text-muted-foreground hover:text-primary hover:bg-primary/10 cursor-pointer"
                showText={false}
              />

              {onDelete && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    const name = isSlice && item.segment ? item.segment.name : item.track.title;
                    onDeleteRef.current?.(item.id, name);
                  }}
                  className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 cursor-pointer focus-visible:ring-1 focus-visible:ring-destructive focus-visible:opacity-100"
                  title={t("table.removeFromPlaylist", "Remove from Playlist")}
                  aria-label={t("table.removeFromPlaylist", "Remove from Playlist")}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
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
