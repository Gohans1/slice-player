import * as React from "react";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Volume2,
  VolumeX,
  ListMusic,
  Disc,
  Repeat1,
  Info,
  Folder,
  Search,
} from "lucide-react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "./ui/context-menu";
import { Spinner } from "./ui/spinner";
import { SliceSeekBar } from "./SliceSeekBar";
import { VolumeSlider } from "./VolumeSlider";
import { cn, formatTime, DEFAULT_SLICE_COLOR } from "../lib/utils";
import { findActivePlaylistItemIndex } from "../lib/activeItemIndex";
import { TrackThumbnail } from "./TrackThumbnail";
import { useHeightCssVar } from "../hooks/use-height-css-var";
import { usePlayerStore, normalizeTrackVolume } from "../store/usePlayerStore";
import { useTranslation } from "react-i18next";

interface PlayerBarProps {
  onToggleQueue: () => void;
  isQueueOpen: boolean;
  // A docked queue is a plain show/hide panel; otherwise the toggle opens a dialog sheet
  isQueueDocked?: boolean;
}

export function PlayerBar({ onToggleQueue, isQueueOpen, isQueueDocked = false }: PlayerBarProps) {
  const { t } = useTranslation();
  const footerRef = useHeightCssVar("--player-bar-height");
  const activeTrack = usePlayerStore((s) => s.activeTrack);
  const activeSegment = usePlayerStore((s) => s.activeSegment);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const isBuffering = usePlayerStore((s) => s.isBuffering);
  const isShuffle = usePlayerStore((s) => s.isShuffle);
  const isLoopQueue = usePlayerStore((s) => s.isLoopQueue);
  const isLoopTrack = usePlayerStore((s) => s.isLoopTrack);
  const toggleLoopTrack = usePlayerStore((s) => s.toggleLoopTrack);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const buildPlaylistQueue = usePlayerStore((s) => s.buildPlaylistQueue);
  const playlists = usePlayerStore((s) => s.playlists);
  const queueIndex = usePlayerStore((s) => s.queueIndex);
  const queueLength = usePlayerStore((s) => s.queue.length);
  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const nextSegment = usePlayerStore((s) => s.nextSegment);
  const prevSegment = usePlayerStore((s) => s.prevSegment);
  const setTrackVolume = usePlayerStore((s) => s.setTrackVolume);
  const playbackMode = usePlayerStore((s) => s.playbackMode);
  const activePlaylistPlayingId = usePlayerStore((s) => s.activePlaylistPlayingId);
  const activePlaylistId = usePlayerStore((s) => s.activePlaylistId);
  const activePlaylistItems = usePlayerStore((s) => s.activePlaylistItems);
  const setActivePlaylist = usePlayerStore((s) => s.setActivePlaylist);
  const setActiveSystemCategory = usePlayerStore((s) => s.setActiveSystemCategory);
  const requestScrollToActiveTrack = usePlayerStore((s) => s.requestScrollToActiveTrack);
  const activePlaylistPlayingName = usePlayerStore((s) => {
    if (!s.activePlaylistPlayingId) return null;
    return s.playlists.find((p) => p.id === s.activePlaylistPlayingId)?.name ?? null;
  });
  const isTransitional = usePlayerStore((s) => {
    if (!s.activeSegment || s.queue.length === 0) return false;
    const item = s.queueIndex >= 0 ? s.queue[s.queueIndex] : null;
    return Boolean(!item || item.segment.id !== s.activeSegment.id);
  });

  const queueOrigin = usePlayerStore((s) => s.queueOrigin);
  const isFromSearch = queueOrigin?.type === "search";
  const searchCount = (typeof queueOrigin?.count === "number" ? Math.min(queueOrigin.count, queueLength || queueOrigin.count) : queueLength) || 0;

  const playingPlaylistName = React.useMemo(() => {
    if (activePlaylistPlayingId) {
      return activePlaylistPlayingName || t("playlist.customHeader", "Playlists");
    }
    return playbackMode === "slices_only"
      ? t("categories.slices", "Slices")
      : playbackMode === "original_only"
      ? t("categories.tracks", "Tracks")
      : t("categories.mixed", "Mix");
  }, [activePlaylistPlayingId, activePlaylistPlayingName, playbackMode, t]);

  const badgeTitle = React.useMemo(() => {
    if (isFromSearch) {
      if (isShuffle) {
        return queueOrigin?.query
          ? t("player.viewPlayingSearchShuffled", {
              name: playingPlaylistName,
              query: queueOrigin.query,
              count: searchCount,
              defaultValue: `Playing: ${playingPlaylistName} search "${queueOrigin.query}" (${searchCount} items, Shuffled) - Click to view in main`,
            })
          : t("player.viewPlayingSearchGenericShuffled", {
              name: playingPlaylistName,
              count: searchCount,
              defaultValue: `Playing: ${playingPlaylistName} search (${searchCount} items, Shuffled) - Click to view in main`,
            });
      }
      return queueOrigin?.query
        ? t("player.viewPlayingSearch", {
            name: playingPlaylistName,
            query: queueOrigin.query,
            count: searchCount,
            defaultValue: `Playing: ${playingPlaylistName} search "${queueOrigin.query}" (${searchCount} items) - Click to view in main`,
          })
        : t("player.viewPlayingSearchGeneric", {
            name: playingPlaylistName,
            count: searchCount,
            defaultValue: `Playing: ${playingPlaylistName} search (${searchCount} items) - Click to view in main`,
          });
    }
    if (activePlaylistPlayingId) {
      return isShuffle
        ? t("player.viewPlayingPlaylistShuffled", {
            name: playingPlaylistName,
            defaultValue: `Playing: ${playingPlaylistName} (Shuffled) - Click to view in main`,
          })
        : t("player.viewPlayingPlaylist", {
            name: playingPlaylistName,
            defaultValue: `Playing: ${playingPlaylistName} - Click to view in main`,
          });
    }
    return isShuffle
      ? t("player.playingPlaylistShuffled", {
          name: playingPlaylistName,
          defaultValue: `Playing: ${playingPlaylistName} (Shuffled)`,
        })
      : t("player.playingPlaylist", {
          name: playingPlaylistName,
          defaultValue: `Playing: ${playingPlaylistName}`,
        });
  }, [
    isFromSearch,
    queueOrigin?.query,
    searchCount,
    isShuffle,
    activePlaylistPlayingId,
    playingPlaylistName,
    t,
  ]);

  const activeTrackVolume = activeTrack ? normalizeTrackVolume(activeTrack.volume, 0.5) : 0.5;
  const isMuted = activeTrackVolume === 0;
  const previousVolumeByTrackRef = React.useRef<Map<string, number>>(new Map());

  React.useEffect(() => {
    if (activeTrack && activeTrackVolume > 0) {
      previousVolumeByTrackRef.current.set(activeTrack.id, activeTrackVolume);
    }
  }, [activeTrack?.id, activeTrackVolume]);

  const handleToggleMute = React.useCallback(() => {
    if (!activeTrack) return;
    if (activeTrackVolume === 0) {
      const lastVol = previousVolumeByTrackRef.current.get(activeTrack.id);
      const restore = typeof lastVol === "number" && lastVol > 0 ? lastVol : 0.5;
      setTrackVolume(activeTrack.id, restore);
    } else {
      previousVolumeByTrackRef.current.set(activeTrack.id, activeTrackVolume);
      setTrackVolume(activeTrack.id, 0);
    }
  }, [activeTrack, activeTrackVolume, setTrackVolume]);

  const handleVolumeChange = React.useCallback((val: number) => {
    if (!activeTrack) return;
    const safe = normalizeTrackVolume(val, 0.5);
    if (safe > 0) {
      previousVolumeByTrackRef.current.set(activeTrack.id, safe);
    }
    setTrackVolume(activeTrack.id, safe);
  }, [activeTrack, setTrackVolume]);

  const [isShuffleMenuOpen, setIsShuffleMenuOpen] = React.useState(false);
  const [containingPlaylists, setContainingPlaylists] = React.useState<typeof playlists>([]);
  const [isLoadingMemberships, setIsLoadingMemberships] = React.useState(false);
  const [lastShufflePlaylistId, setLastShufflePlaylistId] = React.useState<string | null>(() => {
    try {
      return typeof window !== "undefined" ? window.localStorage.getItem("slice_player_last_shuffle_playlist_id") : null;
    } catch {
      return null;
    }
  });

  const displayPlaylists = React.useMemo(() => {
    if (!activePlaylistPlayingId) return containingPlaylists;
    const normalizedPlayingName = playingPlaylistName?.trim().toLowerCase();
    return containingPlaylists.filter(
      (pl) =>
        pl.id !== activePlaylistPlayingId &&
        (!normalizedPlayingName || pl.name.trim().toLowerCase() !== normalizedPlayingName)
    );
  }, [containingPlaylists, activePlaylistPlayingId, playingPlaylistName]);

  const handleActiveTagClick = React.useCallback(async () => {
    // If the user has a playlist currently open and that playlist contains the active track/slice,
    // scroll directly to that track in the open playlist rather than navigating away.
    if ((!activePlaylistPlayingId || activePlaylistPlayingId === activePlaylistId) && activePlaylistId && activePlaylistItems.length > 0) {
      const activeIdx = findActivePlaylistItemIndex(activePlaylistItems, {
        activeTrackId: activeTrack?.id,
        activeSegmentId: activeSegment?.id,
        isFallbackSegment: !activeSegment || activeSegment.id.startsWith("fallback_"),
      });
      if (activeIdx >= 0) {
        requestScrollToActiveTrack(`playlist:${activePlaylistId}`);
        return;
      }
    }

    const targetKey = activePlaylistPlayingId
      ? `playlist:${activePlaylistPlayingId}`
      : `category:${playbackMode || "mixed"}`;

    if (activePlaylistPlayingId) {
      await setActivePlaylist(activePlaylistPlayingId);
    } else {
      await setActivePlaylist(null);
      if (playbackMode) {
        setActiveSystemCategory(playbackMode);
      }
    }
    requestScrollToActiveTrack(targetKey);
  }, [
    activePlaylistId,
    activePlaylistItems,
    activeTrack?.id,
    activeSegment?.id,
    activePlaylistPlayingId,
    playbackMode,
    setActivePlaylist,
    setActiveSystemCategory,
    requestScrollToActiveTrack,
  ]);

  React.useEffect(() => {
    if (!activeTrack?.id) {
      setContainingPlaylists([]);
      setIsLoadingMemberships(false);
      return;
    }

    const abortController = new AbortController();
    setIsLoadingMemberships(true);

    const fetchMemberships = async () => {
      try {
        const url = `/api/playlist-memberships?track_id=${encodeURIComponent(activeTrack.id)}&all=true`;
        const res = await fetch(url, { signal: abortController.signal });
        if (res.ok) {
          const data: unknown = await res.json();
          if (Array.isArray(data) && !abortController.signal.aborted) {
            const plIdSet = new Set(
              data
                .map((item: unknown) =>
                  item && typeof item === "object" && "playlist_id" in item && typeof (item as { playlist_id?: unknown }).playlist_id === "string"
                    ? (item as { playlist_id: string }).playlist_id
                    : null
                )
                .filter(Boolean)
            );
            const matched = playlists.filter((pl) => plIdSet.has(pl.id));
            setContainingPlaylists(matched);
          }
        } else if (!abortController.signal.aborted) {
          setContainingPlaylists([]);
        }
      } catch (e: any) {
        if (e?.name !== "AbortError") {
          setContainingPlaylists([]);
        }
      } finally {
        if (!abortController.signal.aborted) {
          setIsLoadingMemberships(false);
        }
      }
    };

    fetchMemberships();

    return () => {
      abortController.abort();
    };
  }, [activeTrack?.id, playlists]);

  const matchingLastPlaylist = React.useMemo(() => {
    if (!lastShufflePlaylistId) return null;
    return containingPlaylists.find((p) => p.id === lastShufflePlaylistId) ?? null;
  }, [lastShufflePlaylistId, containingPlaylists]);

  const canQuickShuffleLastPlaylist = Boolean(
    !activePlaylistPlayingId && !isFromSearch && matchingLastPlaylist
  );

  const handleShufflePlaylist = React.useCallback(
    async (playlistId: string) => {
      setIsShuffleMenuOpen(false);
      try {
        if (typeof window !== "undefined") {
          window.localStorage.setItem("slice_player_last_shuffle_playlist_id", playlistId);
        }
      } catch {
        // ignore localStorage errors
      }
      setLastShufflePlaylistId(playlistId);
      await buildPlaylistQueue(playlistId, true, 0, true);
    },
    [buildPlaylistQueue]
  );

  const handleShuffleClick = React.useCallback(() => {
    if (canQuickShuffleLastPlaylist && matchingLastPlaylist) {
      handleShufflePlaylist(matchingLastPlaylist.id);
      return;
    }
    toggleShuffle();
    setIsShuffleMenuOpen(false);
  }, [canQuickShuffleLastPlaylist, matchingLastPlaylist, handleShufflePlaylist, toggleShuffle]);

  const handleShuffleCurrentQueue = React.useCallback(() => {
    toggleShuffle();
    setIsShuffleMenuOpen(false);
  }, [toggleShuffle]);

  if (!activeTrack || !activeSegment) {
    return (
      <footer ref={footerRef} className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-card/95 backdrop-blur-md px-4 sm:px-6 lg:px-8 py-3 animate-in fade-in duration-150">
        <div className="w-full flex items-center justify-between">
          <div className="flex items-center gap-3 text-muted-foreground text-xs">
            <Disc className="h-5 w-5 opacity-40" />
            <span>{t("player.noTrack", "No track selected. Click any track or slice to play.")}</span>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant={isQueueOpen ? "secondary" : "ghost"}
              size="lg"
              onClick={onToggleQueue}
              aria-haspopup={isQueueDocked ? undefined : "dialog"}
              aria-expanded={isQueueOpen}
              aria-controls="queue-drawer"
              aria-label={
                isQueueOpen
                  ? t("player.closeQueue", "Close queue")
                  : t("player.openQueue", { count: queueLength, defaultValue: `Open queue (${queueLength} items)` })
              }
              title={t("player.queue", "Queue")}
            >
              <ListMusic data-icon="inline-start" />
              <span className="hidden md:inline">{t("player.queue", "Queue")}</span>
              <Badge variant="secondary">{queueLength}</Badge>
            </Button>
          </div>
        </div>
      </footer>
    );
  }

  return (
    <footer ref={footerRef} className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-card/95 backdrop-blur-md px-4 sm:px-6 lg:px-8 py-2.5 shadow-2xl animate-in fade-in duration-150">
      <div className="w-full flex flex-col sm:flex-row items-center justify-between gap-3">
        {/* Track & Segment Info */}
        <div className="flex items-center gap-3 w-full sm:flex-1 min-w-0">
          <button
            type="button"
            onClick={handleActiveTagClick}
            className="relative size-11 shrink-0 cursor-pointer overflow-hidden rounded-md border border-border bg-muted p-0 text-left outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring"
            title={t("player.jumpToTrack", { defaultValue: "Click to jump to active track in view" })}
            aria-label={t("player.jumpToTrack", { defaultValue: "Click to jump to active track in view" })}
          >
            <TrackThumbnail
              key={activeTrack.id}
              src={activeTrack.thumbnail_url}
              size="small"
              alt={activeTrack.title}
              className="h-full w-full object-cover"
              loading="eager"
              fallback={<Disc className="h-full w-full p-2 text-muted-foreground opacity-60" />}
            />
            <div
              className="absolute inset-x-0 bottom-0 h-1 bg-(--slice-color)"
              style={{ "--slice-color": activeSegment.color || DEFAULT_SLICE_COLOR }}
            />
          </button>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                type="button"
                onClick={handleActiveTagClick}
                className="max-w-40 cursor-pointer truncate rounded-xs text-left text-xs font-semibold text-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring sm:max-w-50"
                title={t("player.jumpToTrack", { defaultValue: "Click to jump to active track in view" })}
              >
                {activeTrack.title}
              </button>
              <Button
                variant="secondary"
                size="xs"
                onClick={handleActiveTagClick}
                title={badgeTitle}
                aria-label={badgeTitle}
                className="max-w-44 sm:max-w-56"
              >
                <span
                  className={cn("size-1.5 shrink-0 rounded-full", isPlaying ? "animate-pulse bg-flexoki-green" : "bg-muted-foreground/60")}
                  aria-hidden="true"
                />
                {isShuffle && <Shuffle aria-hidden="true" />}
                {isFromSearch && <Search aria-hidden="true" />}
                <span className="min-w-0 truncate">{playingPlaylistName}</span>
                {isFromSearch && <span className="shrink-0 font-mono">({searchCount})</span>}
              </Button>
              {displayPlaylists.length > 0 && (
                <div role="group" className="flex flex-wrap items-center gap-1" aria-label={t("player.playlistsTagLabel", "Playlists")}>
                  {displayPlaylists.slice(0, 2).map((pl) => (
                    <Button
                      key={pl.id}
                      variant="outline"
                      size="xs"
                      onClick={async () => {
                        await setActivePlaylist(pl.id);
                        requestScrollToActiveTrack(`playlist:${pl.id}`);
                      }}
                      className="max-w-25"
                      title={t("player.openPlaylist", { name: pl.name, defaultValue: `Open playlist: ${pl.name}` })}
                      aria-label={t("player.openPlaylist", { name: pl.name, defaultValue: `Open playlist: ${pl.name}` })}
                    >
                      <Folder data-icon="inline-start" aria-hidden="true" />
                      <span className="min-w-0 truncate">{pl.name}</span>
                    </Button>
                  ))}
                  {displayPlaylists.length > 2 && (
                    <Badge variant="outline" title={displayPlaylists.slice(2).map((p) => p.name).join(", ")}>
                      +{displayPlaylists.length - 2}
                    </Badge>
                  )}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs font-medium text-flexoki-blue truncate">
                {activeSegment.name}
              </span>
              <span className="text-2xs text-muted-foreground font-mono">
                [{formatTime(activeSegment.start_time)} → {formatTime(activeSegment.end_time)}]
              </span>
            </div>
          </div>
        </div>

        {/* Center Controls & Progress */}
        <div className="flex flex-col items-center gap-1.5 w-full sm:flex-1 sm:max-w-xl min-w-0">
          <div className="flex items-center gap-3">
            {/* Shuffle: click toggles it; right-click or a long press offers playlists to shuffle */}
            <ContextMenu open={isShuffleMenuOpen} onOpenChange={setIsShuffleMenuOpen}>
              <ContextMenuTrigger
                render={
                  <Button
                    variant={isShuffle ? "secondary" : "ghost"}
                    size="icon-lg"
                    onClick={handleShuffleClick}
                    disabled={queueLength === 0}
                    aria-label={t("player.shuffle", "Shuffle")}
                    aria-pressed={isShuffle}
                    title={
                      canQuickShuffleLastPlaylist && matchingLastPlaylist
                        ? t("player.shuffleQuickTooltip", {
                            name: matchingLastPlaylist.name,
                            defaultValue: `Click to shuffle playlist "${matchingLastPlaylist.name}" (recent), right-click to choose playlist`,
                          })
                        : t("player.shuffleTooltip", "Click to toggle shuffle, right-click to choose playlist")
                    }
                  />
                }
              >
                <Shuffle className={cn(isShuffle && "text-flexoki-green")} />
              </ContextMenuTrigger>
              <ContextMenuContent className="w-64">
                <ContextMenuGroup>
                  <ContextMenuLabel>{t("player.shuffleMenuHeader", "Shuffle Options")}</ContextMenuLabel>
                  <ContextMenuItem onClick={handleShuffleCurrentQueue}>
                    <Shuffle />
                    <span className="truncate">
                      {t("player.shuffleCurrentQueue", {
                        name: playingPlaylistName,
                        defaultValue: `Current Queue (${playingPlaylistName})`,
                      })}
                    </span>
                    <span className="ml-auto font-mono text-muted-foreground">{queueLength}</span>
                  </ContextMenuItem>
                </ContextMenuGroup>
                <ContextMenuSeparator />
                <ContextMenuGroup>
                  <ContextMenuLabel>{t("player.playlistsContainingTrack", "Playlists containing this song")}</ContextMenuLabel>
                  {isLoadingMemberships ? (
                    <ContextMenuItem disabled>
                      <Spinner />
                      {t("common.loading", "Loading…")}
                    </ContextMenuItem>
                  ) : containingPlaylists.length === 0 ? (
                    <ContextMenuItem disabled>
                      <Info />
                      {t("player.noPlaylistsForTrack", "Not in any custom playlists")}
                    </ContextMenuItem>
                  ) : (
                    containingPlaylists.map((pl) => (
                      <ContextMenuItem key={pl.id} onClick={() => void handleShufflePlaylist(pl.id)}>
                        <Folder />
                        <span className="truncate">{pl.name}</span>
                        <span className="ml-auto flex items-center gap-1.5">
                          {pl.id === lastShufflePlaylistId && <Badge variant="secondary">{t("player.lastUsed", "Recent")}</Badge>}
                          {typeof pl.item_count === "number" && (
                            <span className="font-mono text-muted-foreground">{pl.item_count}</span>
                          )}
                        </span>
                      </ContextMenuItem>
                    ))
                  )}
                </ContextMenuGroup>
              </ContextMenuContent>
            </ContextMenu>

            <Button
              variant="ghost"
              size="icon-lg"
              onClick={prevSegment}
              disabled={queueLength === 0}
              aria-label={t("player.previous", "Previous slice")}
              title={t("player.previous", "Previous slice")}
            >
              <SkipBack className="fill-current" />
            </Button>

            {/* Like Apple Music, play/pause is a larger glyph rather than a filled button */}
            <Button
              variant="ghost"
              size="icon-lg"
              onClick={togglePlay}
              aria-label={isPlaying ? t("player.pause", "Pause") : t("player.play", "Play")}
              title={isPlaying ? t("player.pause", "Pause") : t("player.play", "Play")}
            >
              {isBuffering && isPlaying ? (
                <Spinner className="size-5" />
              ) : isPlaying ? (
                <Pause className="size-5 fill-current animate-in zoom-in-75 duration-100" />
              ) : (
                <Play className="size-5 fill-current animate-in zoom-in-75 duration-100" />
              )}
            </Button>

            <Button
              variant="ghost"
              size="icon-lg"
              onClick={() => nextSegment(false)}
              disabled={!(queueLength > 0 && (isTransitional || (queueLength > 1 && (isLoopQueue || queueIndex < queueLength - 1))))}
              aria-label={t("player.next", "Next slice")}
              title={t("player.next", "Next slice")}
            >
              <SkipForward className="fill-current" />
            </Button>

            <Button
              variant={isLoopTrack ? "secondary" : "ghost"}
              size="icon-lg"
              onClick={toggleLoopTrack}
              disabled={queueLength === 0}
              aria-label={t("player.loopTrack", "Loop track")}
              aria-pressed={isLoopTrack}
              aria-description={
                isLoopTrack
                  ? t("player.loopTrackActiveDesc", "Track loop is active. The current track will repeat continuously.")
                  : undefined
              }
              title={
                isLoopTrack
                  ? t("player.loopTrackActive", "Loop track enabled")
                  : t("player.loopTrackTitle", "Repeat current track")
              }
            >
              <Repeat1 className={cn(isLoopTrack && "text-flexoki-green")} />
            </Button>
          </div>

          <SliceSeekBar segment={activeSegment} />
        </div>

        {/* Volume & Queue Button */}
        <div className="flex items-center justify-end gap-3 w-full sm:flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon-lg"
              onClick={handleToggleMute}
              aria-label={isMuted ? t("player.unmute", "Unmute") : t("player.mute", "Mute")}
              title={isMuted ? t("player.unmute", "Unmute") : t("player.mute", "Mute")}
            >
              {isMuted ? (
                <VolumeX className="text-destructive animate-in zoom-in-75 duration-100" />
              ) : (
                <Volume2 className="animate-in zoom-in-75 duration-100" />
              )}
            </Button>
            <VolumeSlider
              value={activeTrackVolume}
              onChange={handleVolumeChange}
              aria-label={t("player.trackVolume", "Track volume")}
              title={t("player.trackVolumeTooltip", { percent: Math.round(activeTrackVolume * 100), defaultValue: `Track volume: ${Math.round(activeTrackVolume * 100)}%` })}
              className="w-20"
            />
          </div>

          <Button
            variant={isQueueOpen ? "secondary" : "ghost"}
            size="lg"
            onClick={onToggleQueue}
            aria-haspopup={isQueueDocked ? undefined : "dialog"}
            aria-expanded={isQueueOpen}
            aria-controls="queue-drawer"
            aria-label={
              isQueueOpen
                ? t("player.closeQueue", "Close queue")
                : t("player.openQueue", { count: queueLength, defaultValue: `Open queue (${queueLength} items)` })
            }
            title={t("player.queue", "Queue")}
          >
            <ListMusic data-icon="inline-start" />
            <span className="hidden md:inline">{t("player.queue", "Queue")}</span>
            <Badge variant="secondary">{queueLength}</Badge>
          </Button>
        </div>
      </div>
    </footer>
  );
}
