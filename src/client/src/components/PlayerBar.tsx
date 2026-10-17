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
  MoreHorizontal,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Spinner } from "./ui/spinner";
import { SliceSeekBar } from "./SliceSeekBar";
import { VolumeSlider } from "./VolumeSlider";
import { cn, formatTime, DEFAULT_SLICE_COLOR } from "../lib/utils";
import { TrackThumbnail } from "./TrackThumbnail";
import { useHeightCssVar } from "../hooks/use-height-css-var";
import { usePlaybackSource } from "../hooks/use-playback-source";
import { usePlayerStore, normalizeTrackVolume } from "../store/usePlayerStore";
import { useTranslation } from "react-i18next";
import { useFormatNumber } from "../hooks/use-format-number";

// Like Apple Music, the player is a glass capsule floating over the foot of the main column, centred between the
// sidebar and the docked queue. Narrower than one row, it wraps into a card: the LCD on top, the controls beneath.
const CAPSULE_CLASS = "@container sticky bottom-3 z-40 mx-2 mt-auto mb-3 max-w-2xl sm:mx-auto sm:w-full";
const CAPSULE_BODY_CLASS =
  "flex flex-wrap items-center gap-x-1 gap-y-1.5 rounded-3xl border bg-card/70 p-1.5 shadow-xl backdrop-blur-lg backdrop-saturate-200 @xl:h-14 @xl:flex-nowrap @xl:gap-3 @xl:rounded-full @xl:px-4 @xl:py-0";
// The LCD: what's playing and how far along, on a slightly lifted panel
const LCD_CLASS =
  "order-first flex h-12 min-w-0 basis-full items-center gap-2.5 rounded-2xl bg-muted/50 px-1.5 @xl:order-none @xl:flex-1 @xl:basis-auto @xl:rounded-lg";

interface PlayerBarProps {
  onToggleQueue: () => void;
  isQueueOpen: boolean;
  // A docked queue is a plain show/hide panel; otherwise the toggle opens a dialog sheet
  isQueueDocked?: boolean;
}

export function PlayerBar({ onToggleQueue, isQueueOpen, isQueueDocked = false }: PlayerBarProps) {
  const { t } = useTranslation();
  const formatNumber = useFormatNumber();
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
  const activePlaylistPlayingId = usePlayerStore((s) => s.activePlaylistPlayingId);
  const setActivePlaylist = usePlayerStore((s) => s.setActivePlaylist);
  const requestScrollToActiveTrack = usePlayerStore((s) => s.requestScrollToActiveTrack);
  const isTransitional = usePlayerStore((s) => {
    if (!s.activeSegment || s.queue.length === 0) return false;
    const item = s.queueIndex >= 0 ? s.queue[s.queueIndex] : null;
    return Boolean(!item || item.segment.id !== s.activeSegment.id);
  });

  const queueOrigin = usePlayerStore((s) => s.queueOrigin);
  const isFromSearch = queueOrigin?.type === "search";
  const searchCount = (typeof queueOrigin?.count === "number" ? Math.min(queueOrigin.count, queueLength || queueOrigin.count) : queueLength) || 0;

  const { name: playingPlaylistName, reveal: handleActiveTagClick } = usePlaybackSource();

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

  const queueButton = (
    <Button
      variant={isQueueOpen ? "secondary" : "ghost"}
      size="icon-lg"
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
      <ListMusic className={cn(isQueueOpen && "text-primary")} />
    </Button>
  );

  if (!activeTrack || !activeSegment) {
    return (
      <section ref={footerRef} aria-label={t("player.landmark", "Player")} className={CAPSULE_CLASS}>
        {/* Idle, the LCD has only a hint to show, so the capsule keeps to one row at every width */}
        <div className={cn(CAPSULE_BODY_CLASS, "flex-nowrap rounded-full")}>
          <div className={cn(LCD_CLASS, "flex-1 basis-auto")}>
            <Disc className="size-5 shrink-0 text-muted-foreground opacity-60" />
            <span className="truncate text-xs text-muted-foreground">
              {t("player.noTrack", "No track selected. Click any track or slice to play.")}
            </span>
          </div>
          <div className="ml-auto flex items-center">{queueButton}</div>
        </div>
      </section>
    );
  }

  const isSlice = !activeSegment.id.startsWith("fallback_");
  const artistText = activeTrack.artist?.trim() || t("table.unknownArtist", "Unknown Artist");
  const trackVolumeTitle = t("player.trackVolumeTooltip", {
    percent: Math.round(activeTrackVolume * 100),
    defaultValue: `Track volume: ${Math.round(activeTrackVolume * 100)}%`,
  });

  return (
    <section ref={footerRef} aria-label={t("player.landmark", "Player")} className={CAPSULE_CLASS}>
      <div className={CAPSULE_BODY_CLASS}>
        <div className="flex items-center gap-0.5">
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
              <Shuffle className={cn(isShuffle && "text-primary")} />
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
                  <span className="ml-auto text-muted-foreground tabular-nums">{formatNumber(queueLength)}</span>
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
                          <span className="text-muted-foreground tabular-nums">{formatNumber(pl.item_count)}</span>
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
              <Pause className="size-5 fill-current" />
            ) : (
              <Play className="size-5 fill-current" />
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
            <Repeat1 className={cn(isLoopTrack && "text-primary")} />
          </Button>
        </div>

        <div className={LCD_CLASS}>
          <button
            type="button"
            onClick={handleActiveTagClick}
            className="relative size-8.5 shrink-0 cursor-pointer overflow-hidden rounded-sm bg-muted p-0 outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring"
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
              fallback={<Disc className="h-full w-full p-1.5 text-muted-foreground opacity-60" />}
            />
            <div
              className="absolute inset-x-0 bottom-0 h-0.5 bg-(--slice-color)"
              style={{ "--slice-color": activeSegment.color || DEFAULT_SLICE_COLOR }}
            />
          </button>

          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex min-w-0 items-center gap-2">
              <button
                type="button"
                onClick={handleActiveTagClick}
                className="min-w-0 cursor-pointer truncate rounded-xs text-left text-xs leading-4 font-semibold text-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
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
                className="ml-auto max-w-40"
              >
                <span
                  className={cn("size-1.5 shrink-0 rounded-full", isPlaying ? "animate-pulse bg-flexoki-green" : "bg-muted-foreground/60")}
                  aria-hidden="true"
                />
                {isShuffle && <Shuffle aria-hidden="true" />}
                {isFromSearch && <Search aria-hidden="true" />}
                <span className="min-w-0 truncate">{playingPlaylistName}</span>
                {isFromSearch && <span className="shrink-0 tabular-nums">({formatNumber(searchCount)})</span>}
              </Button>
            </div>
            {/* Apple Music's "Artist — Album" line: a slice names itself, a full track its artist */}
            <p className="truncate text-2xs leading-4 font-medium text-muted-foreground">
              {isSlice ? (
                <span
                  className="text-flexoki-blue"
                  title={`${activeSegment.name} [${formatTime(activeSegment.start_time)} → ${formatTime(activeSegment.end_time)}]`}
                >
                  {activeSegment.name}
                </span>
              ) : (
                artistText
              )}
            </p>
            <SliceSeekBar segment={activeSegment} />
          </div>
        </div>

        <div className="ml-auto flex items-center gap-0.5">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-lg"
                  aria-label={t("table.moreActions", { name: activeTrack.title, defaultValue: `More options for ${activeTrack.title}` })}
                  title={t("table.moreActions", { name: activeTrack.title, defaultValue: `More options for ${activeTrack.title}` })}
                />
              }
            >
              <MoreHorizontal />
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="end" className="w-64">
              <DropdownMenuGroup>
                <DropdownMenuLabel>{t("player.playlistsContainingTrack", "Playlists containing this song")}</DropdownMenuLabel>
                {isLoadingMemberships ? (
                  <DropdownMenuItem disabled>
                    <Spinner />
                    {t("common.loading", "Loading…")}
                  </DropdownMenuItem>
                ) : displayPlaylists.length === 0 ? (
                  <DropdownMenuItem disabled>
                    <Info />
                    {/* The playlist playing is left out, as the LCD names it already */}
                    {containingPlaylists.length > 0
                      ? t("player.noOtherPlaylistsForTrack", "Not in any other playlists")
                      : t("player.noPlaylistsForTrack", "Not in any custom playlists")}
                  </DropdownMenuItem>
                ) : (
                  displayPlaylists.map((pl) => (
                    <DropdownMenuItem
                      key={pl.id}
                      onClick={async () => {
                        await setActivePlaylist(pl.id);
                        requestScrollToActiveTrack(`playlist:${pl.id}`);
                      }}
                    >
                      <Folder />
                      <span className="truncate">{pl.name}</span>
                      {typeof pl.item_count === "number" && (
                        <span className="ml-auto text-muted-foreground tabular-nums">{formatNumber(pl.item_count)}</span>
                      )}
                    </DropdownMenuItem>
                  ))
                )}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Like Apple Music, the speaker opens the volume: here the playing track's own level */}
          <Popover>
            <PopoverTrigger
              render={<Button variant="ghost" size="icon-lg" aria-label={t("player.volume", "Volume")} title={trackVolumeTitle} />}
            >
              {isMuted ? <VolumeX className="text-destructive" /> : <Volume2 />}
            </PopoverTrigger>
            <PopoverContent side="top" align="end" aria-label={t("player.volume", "Volume")} className="w-auto">
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={handleToggleMute}
                  aria-label={isMuted ? t("player.unmute", "Unmute") : t("player.mute", "Mute")}
                  title={isMuted ? t("player.unmute", "Unmute") : t("player.mute", "Mute")}
                >
                  {isMuted ? <VolumeX className="text-destructive" /> : <Volume2 />}
                </Button>
                <VolumeSlider
                  value={activeTrackVolume}
                  onChange={handleVolumeChange}
                  aria-label={t("player.trackVolume", "Track volume")}
                  title={trackVolumeTitle}
                  className="w-36"
                />
              </div>
            </PopoverContent>
          </Popover>

          {queueButton}
        </div>
      </div>
    </section>
  );
}
