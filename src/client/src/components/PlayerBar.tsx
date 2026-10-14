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
  Loader2,
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
import { VolumeSlider } from "./ui/VolumeSlider";
import { formatTime, DEFAULT_SLICE_COLOR } from "../lib/utils";
import { findActivePlaylistItemIndex } from "../lib/activeItemIndex";
import { TrackThumbnail } from "./TrackThumbnail";
import { useHeightCssVar } from "../hooks/use-height-css-var";
import { usePlayerStore, normalizeTrackVolume, type Segment } from "../store/usePlayerStore";
import { useTranslation } from "react-i18next";

interface PlayerBarProps {
  onToggleQueue: () => void;
  isQueueOpen: boolean;
  // A docked queue is a plain show/hide panel; otherwise the toggle opens a dialog sheet
  isQueueDocked?: boolean;
}

interface TrackProgressBarProps {
  activeSegment: Segment;
}

function TrackProgressBar({ activeSegment }: TrackProgressBarProps) {
  const { t } = useTranslation();
  const currentTime = usePlayerStore((s) => s.currentTime);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const seek = usePlayerStore((s) => s.seek);
  const pause = usePlayerStore((s) => s.pause);
  const resume = usePlayerStore((s) => s.resume);
  const togglePlay = usePlayerStore((s) => s.togglePlay);

  const [isDragging, setIsDragging] = React.useState(false);
  const [dragRatio, setDragRatio] = React.useState<number | null>(null);
  const progressBarRef = React.useRef<HTMLDivElement>(null);
  const wasPlayingRef = React.useRef(false);
  const activePointerIdRef = React.useRef<number | null>(null);
  const rectCacheRef = React.useRef<DOMRect | null>(null);
  const rafIdRef = React.useRef<number | null>(null);
  const pendingRatioRef = React.useRef<number | null>(null);

  const resetDragState = React.useCallback(() => {
    const pointerId = activePointerIdRef.current;
    activePointerIdRef.current = null;
    rectCacheRef.current = null;
    wasPlayingRef.current = false;
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    pendingRatioRef.current = null;
    setIsDragging(false);
    setDragRatio(null);

    if (pointerId !== null && progressBarRef.current) {
      try {
        if (progressBarRef.current.hasPointerCapture(pointerId)) {
          progressBarRef.current.releasePointerCapture(pointerId);
        }
      } catch {}
    }
  }, []);

  const activeSegmentId = activeSegment?.id;
  React.useEffect(() => {
    if (activeSegmentId !== undefined) {
      resetDragState();
    }
    return () => {
      resetDragState();
    };
  }, [activeSegmentId, resetDragState]);

  const segmentDuration = activeSegment.end_time - activeSegment.start_time;
  const elapsedInSegment = Math.max(0, currentTime - activeSegment.start_time);
  const currentRatio = isDragging && dragRatio !== null
    ? dragRatio
    : (segmentDuration > 0 ? Math.max(0, Math.min(1, elapsedInSegment / segmentDuration)) : 0);
  const displayedElapsed = currentRatio * segmentDuration;
  const effectiveProgressPercent = currentRatio * 100;

  const getSafeSeekTarget = (rawTarget: number) => {
    if (!activeSegment || segmentDuration <= 0) return 0;
    const clampMargin = Math.min(0.05, segmentDuration * 0.02);
    return Math.max(
      activeSegment.start_time,
      Math.min(activeSegment.end_time - clampMargin, rawTarget)
    );
  };

  const calculateRatio = (clientX: number) => {
    const rect = rectCacheRef.current || progressBarRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return 0;
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!activeSegment || segmentDuration <= 0) return;
    if (e.button !== 0) return;
    if (activePointerIdRef.current !== null) return;

    activePointerIdRef.current = e.pointerId;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}

    if (progressBarRef.current) {
      rectCacheRef.current = progressBarRef.current.getBoundingClientRect();
    }

    wasPlayingRef.current = isPlaying;
    if (isPlaying) {
      pause();
    }

    const ratio = calculateRatio(e.clientX);
    pendingRatioRef.current = ratio;
    setIsDragging(true);
    setDragRatio(ratio);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (activePointerIdRef.current === null || e.pointerId !== activePointerIdRef.current) return;
    const ratio = calculateRatio(e.clientX);
    pendingRatioRef.current = ratio;
    if (rafIdRef.current === null) {
      rafIdRef.current = requestAnimationFrame(() => {
        rafIdRef.current = null;
        if (pendingRatioRef.current !== null) {
          setDragRatio(pendingRatioRef.current);
        }
      });
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (activePointerIdRef.current === null || e.pointerId !== activePointerIdRef.current) return;

    const ratio = typeof e.clientX === "number"
      ? calculateRatio(e.clientX)
      : (pendingRatioRef.current ?? dragRatio ?? 0);
    const shouldResume = wasPlayingRef.current;

    resetDragState();

    if (activeSegment && segmentDuration > 0) {
      const rawTarget = activeSegment.start_time + ratio * segmentDuration;
      const safeTarget = getSafeSeekTarget(rawTarget);
      seek(safeTarget);
      if (shouldResume) {
        resume();
      }
    }
  };

  const handlePointerCancel = (e?: React.PointerEvent<HTMLDivElement>) => {
    if (activePointerIdRef.current === null) return;
    if (e && e.pointerId !== activePointerIdRef.current) {
      return;
    }

    const shouldResume = wasPlayingRef.current;
    resetDragState();

    if (shouldResume) {
      resume();
    }
  };

  const handleLostPointerCapture = (e: React.PointerEvent<HTMLDivElement>) => {
    if (activePointerIdRef.current !== null && e.pointerId === activePointerIdRef.current) {
      handlePointerCancel();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!activeSegment || segmentDuration <= 0) return;
    if (activePointerIdRef.current !== null) return;

    const cur = usePlayerStore.getState().currentTime;
    const step = Math.min(5, Math.max(0.1, segmentDuration * 0.05));
    const pageStep = Math.min(15, Math.max(1, segmentDuration * 0.2));

    if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      seek(getSafeSeekTarget(cur - step));
    } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      seek(getSafeSeekTarget(cur + step));
    } else if (e.key === "PageDown") {
      e.preventDefault();
      seek(getSafeSeekTarget(cur - pageStep));
    } else if (e.key === "PageUp") {
      e.preventDefault();
      seek(getSafeSeekTarget(cur + pageStep));
    } else if (e.key === "Home") {
      e.preventDefault();
      seek(activeSegment.start_time);
    } else if (e.key === "End") {
      e.preventDefault();
      seek(getSafeSeekTarget(activeSegment.end_time));
    } else if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      togglePlay();
    }
  };

  return (
    <div className="flex items-center gap-2 w-full max-w-xl text-2xs font-mono text-muted-foreground">
      <span className="w-12 text-right">{formatTime(displayedElapsed)}</span>
      <div
        ref={progressBarRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onLostPointerCapture={handleLostPointerCapture}
        onKeyDown={handleKeyDown}
        role="slider"
        tabIndex={0}
        aria-label={t("player.seekAria", "Seek slice")}
        aria-orientation="horizontal"
        aria-valuemin={0}
        aria-valuemax={Number(segmentDuration.toFixed(1))}
        aria-valuenow={Number.isFinite(displayedElapsed) ? Number(displayedElapsed.toFixed(1)) : 0}
        aria-valuetext={`${formatTime(displayedElapsed)} / ${formatTime(segmentDuration)}`}
        className="group relative flex-1 py-2.5 cursor-pointer select-none touch-none rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
        title={t("player.seekTitle", "Drag or click to seek in slice")}
      >
        <div className="relative h-2 w-full rounded-full bg-secondary overflow-hidden group-hover:scale-y-125 transition-transform duration-150 origin-center">
          <div
            className={`absolute inset-0 rounded-full origin-left ${
              isDragging ? "transition-none" : "transition-transform duration-100 ease-linear"
            }`}
            style={{
              transform: `scaleX(${Math.max(0, Math.min(100, effectiveProgressPercent)) / 100})`,
              backgroundColor: activeSegment.color || DEFAULT_SLICE_COLOR,
            }}
          />
        </div>
        <div
          className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-white shadow-md pointer-events-none ${
            isDragging
              ? "scale-100 opacity-100 transition-none"
              : "scale-0 opacity-0 group-hover:scale-100 group-hover:opacity-100 group-focus-visible:scale-100 group-focus-visible:opacity-100 transition-[transform,opacity] duration-150 ease-out"
          }`}
          style={{
            left: `${effectiveProgressPercent}%`,
          }}
        />
      </div>
      <span className="w-12 text-left">{formatTime(segmentDuration)}</span>
    </div>
  );
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
              size="sm"
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
              className="text-xs gap-1.5 text-muted-foreground"
            >
              <ListMusic className="h-4 w-4" />
              <span className="hidden md:inline">{t("player.queue", "Queue")}</span>
              <span className="font-mono text-2xs px-1 rounded bg-accent text-accent-foreground">
                {queueLength}
              </span>
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
            className="relative h-11 w-11 rounded-md overflow-hidden bg-muted shrink-0 border border-border cursor-pointer group hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary text-left p-0"
            title={t("player.jumpToTrack", { defaultValue: "Click to jump to active track in view" })}
            aria-label={t("player.jumpToTrack", { defaultValue: "Click to jump to active track in view" })}
          >
            <TrackThumbnail
              key={activeTrack.id}
              src={activeTrack.thumbnail_url}
              alt={activeTrack.title}
              className="h-full w-full object-cover"
              loading="eager"
              fallback={<Disc className="h-full w-full p-2 text-muted-foreground opacity-60" />}
            />
            <div
              className="absolute bottom-0 left-0 right-0 h-1"
              style={{ backgroundColor: activeSegment.color || DEFAULT_SLICE_COLOR }}
            />
          </button>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                type="button"
                onClick={handleActiveTagClick}
                className="font-semibold text-xs text-foreground truncate max-w-[160px] sm:max-w-[200px] hover:underline cursor-pointer text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded-xs p-0 border-none bg-transparent"
                title={t("player.jumpToTrack", { defaultValue: "Click to jump to active track in view" })}
              >
                {activeTrack.title}
              </button>
              <button
                type="button"
                onClick={handleActiveTagClick}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-2xs font-medium bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 hover:border-primary/40 shrink-0 max-w-[170px] sm:max-w-[220px] truncate cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                title={badgeTitle}
                aria-label={badgeTitle}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${isPlaying ? "bg-flexoki-green animate-pulse" : "bg-muted-foreground/60"} shrink-0`} aria-hidden="true" />
                {isShuffle && <Shuffle className="h-2.5 w-2.5 text-flexoki-green shrink-0" aria-hidden="true" />}
                {isFromSearch && <Search className="h-2.5 w-2.5 text-primary/80 shrink-0" aria-hidden="true" />}
                <span className="truncate min-w-0">{playingPlaylistName}</span>
                {isFromSearch && (
                  <span className="font-mono text-2xs opacity-80 shrink-0">
                    ({searchCount})
                  </span>
                )}
              </button>
              {displayPlaylists.length > 0 && (
                <div className="flex items-center gap-1 flex-wrap" aria-label={t("player.playlistsTagLabel", "Playlists")}>
                  {displayPlaylists.slice(0, 2).map((pl) => (
                    <button
                      key={pl.id}
                      type="button"
                      onClick={async () => {
                        await setActivePlaylist(pl.id);
                        requestScrollToActiveTrack(`playlist:${pl.id}`);
                      }}
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-2xs font-normal bg-secondary/80 text-muted-foreground hover:text-foreground hover:bg-secondary border border-border/40 hover:border-border/80 shrink-0 max-w-[100px] truncate cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                      title={t("player.openPlaylist", { name: pl.name, defaultValue: `Open playlist: ${pl.name}` })}
                      aria-label={t("player.openPlaylist", { name: pl.name, defaultValue: `Open playlist: ${pl.name}` })}
                    >
                      <Folder className="h-2.5 w-2.5 shrink-0 opacity-60" aria-hidden="true" />
                      <span className="truncate">{pl.name}</span>
                    </button>
                  ))}
                  {displayPlaylists.length > 2 && (
                    <span
                      className="inline-flex items-center px-1 py-0.5 rounded text-2xs font-mono text-muted-foreground bg-secondary/50 border border-border/30 select-none shrink-0"
                      title={displayPlaylists.slice(2).map((p) => p.name).join(", ")}
                    >
                      +{displayPlaylists.length - 2}
                    </span>
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
                    size="icon"
                    onClick={handleShuffleClick}
                    disabled={queueLength === 0}
                    aria-label={t("player.shuffle", "Shuffle")}
                    aria-pressed={isShuffle}
                    className={`h-8 w-8 rounded-full active:rotate-12 transition-[transform,background-color,color] duration-100 ${
                      isShuffle ? "text-flexoki-green hover:bg-flexoki-green/10" : "text-muted-foreground hover:text-foreground hover:bg-accent"
                    } disabled:opacity-40 disabled:transform-none`}
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
                <Shuffle className="h-4 w-4" />
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
                      {t("common.loading", "Loading...")}
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
              size="icon"
              onClick={prevSegment}
              disabled={queueLength === 0}
              aria-label={t("player.previous", "Previous slice")}
              className="h-8 w-8 rounded-full text-foreground hover:bg-accent active:-translate-x-0.5 transition-transform duration-100 disabled:opacity-40 disabled:transform-none"
              title={t("player.previous", "Previous slice")}
            >
              <SkipBack className="h-4 w-4" />
            </Button>

            <Button
              variant="default"
              size="icon"
              onClick={togglePlay}
              aria-label={isPlaying ? t("player.pause", "Pause") : t("player.play", "Play")}
              className="h-9 w-9 rounded-full bg-primary text-primary-foreground shadow-md hover:scale-105 active:scale-95 transition-[transform,background-color] duration-150"
              title={isPlaying ? t("player.pause", "Pause") : t("player.play", "Play")}
            >
              {isBuffering && isPlaying ? (
                <Loader2 className="h-4 w-4 animate-spin text-primary-foreground" />
              ) : isPlaying ? (
                <Pause className="h-4 w-4 fill-current animate-in zoom-in-75 duration-100" />
              ) : (
                <Play className="h-4 w-4 fill-current translate-x-0.5 animate-in zoom-in-75 duration-100" />
              )}
            </Button>

            <Button
              variant="ghost"
              size="icon"
              onClick={() => nextSegment(false)}
              disabled={!(queueLength > 0 && (isTransitional || (queueLength > 1 && (isLoopQueue || queueIndex < queueLength - 1))))}
              aria-label={t("player.next", "Next slice")}
              className="h-8 w-8 rounded-full text-foreground hover:bg-accent active:translate-x-0.5 transition-transform duration-100 disabled:opacity-40 disabled:transform-none"
              title={t("player.next", "Next slice")}
            >
              <SkipForward className="h-4 w-4" />
            </Button>

            <Button
              variant={isLoopTrack ? "secondary" : "ghost"}
              size="icon"
              onClick={toggleLoopTrack}
              disabled={queueLength === 0}
              aria-label={t("player.loopTrack", "Loop track")}
              aria-pressed={isLoopTrack}
              aria-description={
                isLoopTrack
                  ? t("player.loopTrackActiveDesc", "Track loop is active. The current track will repeat continuously.")
                  : undefined
              }
              className={`h-8 w-8 rounded-full active:rotate-12 transition-[transform,background-color,color] duration-100 ${
                isLoopTrack ? "text-flexoki-green hover:bg-flexoki-green/10" : "text-muted-foreground hover:text-foreground hover:bg-accent"
              } disabled:opacity-40 disabled:transform-none`}
              title={
                isLoopTrack
                  ? t("player.loopTrackActive", "Loop track enabled")
                  : t("player.loopTrackTitle", "Repeat current track")
              }
            >
              <Repeat1 className="h-4 w-4" />
            </Button>
          </div>

          {/* Segment Progress Bar */}
          <TrackProgressBar activeSegment={activeSegment} />
        </div>

        {/* Volume & Queue Button */}
        <div className="flex items-center justify-end gap-3 w-full sm:flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleToggleMute}
              aria-label={isMuted ? t("player.unmute", "Unmute") : t("player.mute", "Mute")}
              className="h-8 w-8 text-muted-foreground hover:text-foreground active:scale-90 motion-reduce:transform-none transition-transform duration-100"
              title={isMuted ? t("player.unmute", "Unmute") : t("player.mute", "Mute")}
            >
              {isMuted ? (
                <VolumeX className="h-4 w-4 text-destructive animate-in zoom-in-75 duration-100" />
              ) : (
                <Volume2 className="h-4 w-4 animate-in zoom-in-75 duration-100" />
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
            size="sm"
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
            className="text-xs gap-1.5"
          >
            <ListMusic className="h-4 w-4" />
            <span className="hidden md:inline">{t("player.queue", "Queue")}</span>
            <span className="font-mono text-2xs px-1 rounded bg-accent text-accent-foreground">
              {queueLength}
            </span>
          </Button>
        </div>
      </div>
    </footer>
  );
}
