import * as React from "react";
import { Play, Pause, Trash2, Scissors, Disc, ScissorsLineDashed, Loader2, Clock, AlertCircle, Check } from "lucide-react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { formatDuration } from "../lib/utils";
import { TrackThumbnail } from "./TrackThumbnail";
import { usePlayerStore } from "../store/usePlayerStore";
import { useSelectionStore, useIsTrackSelected, useIsSelectionActive, createPlaylistItemSelectedItem, type SelectedItem } from "../store/useSelectionStore";
import { useTranslation } from "react-i18next";
import { AddToPlaylistPopover } from "./AddToPlaylistPopover";
import { NowPlayingEqualizer } from "./NowPlayingEqualizer";
import type { PlaylistItemWithDetails } from "@/server/types";

interface PlaylistItemCardProps {
  item: PlaylistItemWithDetails;
  index: number;
  visibleItemIds?: (string | SelectedItem)[];
  onPlay: (itemId: string) => void;
  onDelete: (itemId: string, name: string) => void;
}

export function PlaylistItemCardComponent({
  item,
  index,
  visibleItemIds,
  onPlay,
  onDelete,
}: PlaylistItemCardProps) {
  const { t } = useTranslation();
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const activeSegment = usePlayerStore((s) => s.activeSegment);
  const queue = usePlayerStore((s) => s.queue);
  const queueIndex = usePlayerStore((s) => s.queueIndex);
  const openSliceStudio = usePlayerStore((s) => s.openSliceStudio);

  const activePlaylistPlayingId = usePlayerStore((s) => s.activePlaylistPlayingId);
  const activePlaylistId = usePlayerStore((s) => s.activePlaylistId);
  const isSelected = useIsTrackSelected(item.id);
  const isSelectionActive = useIsSelectionActive();
  const toggleTrack = useSelectionStore((s) => s.toggleTrack);

  const isSlice = Boolean(item.segment);
  const duration = isSlice && item.segment
    ? Math.max(0, item.segment.end_time - item.segment.start_time)
    : Math.max(0, item.track?.duration ?? 0);
  const isReady = item.track?.status === "ready" && (item.track?.duration ?? 0) > 0;

  const isThisPlaylistPlaying = activePlaylistPlayingId !== null && activePlaylistPlayingId === activePlaylistId;
  const currentQueueItem = queue[queueIndex];
  const isCurrentActive =
    isThisPlaylistPlaying &&
    (currentQueueItem?.queueItemId
      ? currentQueueItem.queueItemId === item.id
      : (isSlice && item.segment
          ? activeSegment?.id === item.segment.id
          : activeSegment?.track_id === item.track?.id && !activeSegment?.id.startsWith("seg_")));
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

  return (
    <div
      className={`group relative flex flex-col rounded-xl border bg-card p-4 transition-[border-color,box-shadow,background-color] duration-200 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5 ${
        isSelected
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

        {/* Kind Badge */}
        <div className="absolute top-2 left-2">
          {isSlice && item.segment ? (
            <Badge variant="yellow" className="flex items-center gap-1 text-2xs py-0.5 font-mono shadow-xs">
              <Scissors className="h-3 w-3" />
              <span>{t("table.sliceIndex", { index: index + 1, defaultValue: `Slice #${index + 1}` })}</span>
            </Badge>
          ) : (
            <Badge variant="green" className="flex items-center gap-1 text-2xs py-0.5 font-mono shadow-xs">
              <Disc className="h-3 w-3" />
              <span>{t("table.fullTrackIndex", { index: index + 1, defaultValue: `Full Track #${index + 1}` })}</span>
            </Badge>
          )}
        </div>

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
            toggleTrack(item.id, visibleItemIds, e.shiftKey, {
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
                toggleTrack(item.id, visibleItemIds, e.shiftKey, createPlaylistItemSelectedItem(item, activePlaylistId));
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
                await onPlay(item.id);
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
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xl transition-transform hover:scale-110">
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
        <h3 className="font-semibold text-sm leading-snug line-clamp-2 text-foreground group-hover:text-primary transition-colors">
          {isSlice && item.segment ? item.segment.name : item.track.title}
        </h3>
        <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
          {isSlice ? t("table.from", { title: item.track.title }) : (item.track.artist || t("table.unknownArtist", "Unknown Artist"))}
        </p>

        {isSlice && item.segment && (
          <div className="mt-2 text-2xs font-mono text-flexoki-yellow flex items-center gap-1">
            <ScissorsLineDashed className="h-3 w-3" />
            <span>
              {formatDuration(item.segment.start_time)} - {formatDuration(item.segment.end_time)}
            </span>
          </div>
        )}

        <div className="mt-auto pt-3 flex items-center justify-between border-t border-border/60">
          <Button
            variant="outline"
            size="sm"
            onClick={(e) => {
              if (useSelectionStore.getState().selectedTrackIds.size > 0) {
                toggleTrack(item.id, visibleItemIds, e.shiftKey, createPlaylistItemSelectedItem(item, activePlaylistId));
                return;
              }
              if (isReady) onPlay(item.id);
            }}
            disabled={!isSelectionActive && !isReady}
            title={isSelectionActive ? (isSelected ? t("trackCard.deselectTrack", { title: itemTitle }) : t("trackCard.selectTrack", { title: itemTitle })) : undefined}
            aria-label={isSelectionActive ? (isSelected ? t("trackCard.deselectTrack", { title: itemTitle }) : t("trackCard.selectTrack", { title: itemTitle })) : (isCurrentPlaying && isPlaying ? t("trackCard.pause") : t("trackCard.play"))}
            className="h-8 text-xs gap-1.5 px-3 hover:border-primary/40 hover:text-primary cursor-pointer disabled:opacity-60"
          >
            {isSelectionActive ? (
              <>
                <Check className={`h-3.5 w-3.5 ${isSelected ? "text-primary" : "text-muted-foreground"}`} />
                <span>{isSelected ? t("bulkActions.deselect", "Deselect") : t("bulkActions.select", "Select")}</span>
              </>
            ) : item.track?.status === "downloading" ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                <span className="text-primary">{t("table.downloading", "Downloading")}</span>
              </>
            ) : item.track?.status === "queued" ? (
              <>
                <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                <span>{t("table.queued", "Queued")}</span>
              </>
            ) : item.track?.status === "error" ? (
              <>
                <AlertCircle className="h-3.5 w-3.5 text-destructive" />
                <span className="text-destructive">{t("table.downloadError", "Error")}</span>
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5 fill-current" />
                <span>{isCurrentPlaying ? t("player.nowPlaying", "Playing") : t("player.play", "Play")}</span>
              </>
            )}
          </Button>

          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => openSliceStudio(item.track)}
              className="h-8 w-8 text-muted-foreground hover:text-primary hover:bg-primary/10"
              title={t("table.openStudio", "Open Slice Studio")}
            >
              <Scissors className="h-3.5 w-3.5" />
            </Button>

            <AddToPlaylistPopover
              trackId={item.track?.id ?? item.track_id}
              segmentId={isSlice && item.segment ? item.segment.id : undefined}
              disabled={!isReady}
              variant="ghost"
              size="icon"
              buttonClassName="h-8 w-8 text-muted-foreground hover:text-primary hover:bg-primary/10 cursor-pointer"
              showText={false}
            />

            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                const name = isSlice && item.segment ? item.segment.name : item.track.title;
                onDelete(item.id, name);
              }}
              className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              title={t("table.removeFromPlaylist", "Remove from Playlist")}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export const PlaylistItemCard = React.memo(PlaylistItemCardComponent);
