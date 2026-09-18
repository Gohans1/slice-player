import * as React from "react";
import { useTranslation } from "react-i18next";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { Play, Trash2, Scissors, Music, Disc, ChevronUp, ChevronDown, Shuffle, Loader2, Clock, AlertCircle, RotateCcw, GripVertical, Check } from "lucide-react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { formatDuration, createDefaultFullSegment } from "../lib/utils";
import { normalizeVi, tokenizeQuery } from "../lib/search";
import { usePlayerStore, isPlaybackMode } from "../store/usePlayerStore";
import {
  useSelectionStore,
  isAllVisibleSelected,
  isPartiallyVisibleSelected,
  type SelectedItem,
} from "../store/useSelectionStore";
import { AddToPlaylistPopover } from "./AddToPlaylistPopover";
import { ConfirmModal } from "./ui/ConfirmModal";
import type { Track, Segment, PlaylistItemWithDetails } from "@/server/types";

export type MixedItem =
  | {
      type: "track";
      id: string;
      track: Track;
      segment?: never;
      createdAt?: number;
    }
  | {
      type: "slice";
      id: string;
      track: Track;
      segment: Segment;
      createdAt?: number;
    };

const getEntityId = (item: { id: string }) => item.id;

interface VirtualizedTableBodyProps<T> {
  items: T[];
  getItemKey: (item: T, index: number) => string;
  renderRow: (item: T, index: number) => React.ReactNode;
  estimateRowHeight?: number;
}

function VirtualizedTableBody<T>({
  items,
  getItemKey,
  renderRow,
  estimateRowHeight = 68,
}: VirtualizedTableBodyProps<T>) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = React.useState(0);
  const getItemKeyRef = React.useRef(getItemKey);
  getItemKeyRef.current = getItemKey;

  // Accurately compute document-relative scrollMargin (distance from top of document)
  const updateMargin = React.useCallback(() => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const topOffset = Math.round(rect.top + (window.scrollY || window.pageYOffset || 0));
      setScrollMargin((prev) => (prev === topOffset ? prev : Math.max(0, topOffset)));
    }
  }, []);

  // Measure on layout effect and whenever items dataset changes
  React.useLayoutEffect(() => {
    updateMargin();
  }, [updateMargin, items]);

  // Throttled recalculation on window resize and parent layout shifts
  React.useEffect(() => {
    let rafId: number | null = null;
    const scheduleUpdate = () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        updateMargin();
      });
    };

    window.addEventListener("resize", scheduleUpdate, { passive: true });

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined" && containerRef.current?.parentElement) {
      observer = new ResizeObserver(scheduleUpdate);
      observer.observe(containerRef.current.parentElement);
    }

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      window.removeEventListener("resize", scheduleUpdate);
      if (observer) observer.disconnect();
    };
  }, [updateMargin]);

  const virtualizer = useWindowVirtualizer({
    count: items.length,
    estimateSize: () => estimateRowHeight,
    overscan: 10,
    scrollMargin,
    getItemKey: React.useCallback(
      (index: number) => (items[index] ? getItemKeyRef.current(items[index], index) : index),
      [items]
    ),
  });

  if (items.length === 0) return <div ref={containerRef} className="pt-1" />;

  const virtualRows = virtualizer.getVirtualItems();

  return (
    <div ref={containerRef} className="pt-1" role="rowgroup">
      <div
        role="presentation"
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
        }}
      >
        {virtualRows.map((virtualRow) => {
          const item = items[virtualRow.index];
          if (!item) return null;

          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              role="presentation"
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualRow.start - virtualizer.options.scrollMargin}px)`,
              }}
              className="pb-1"
            >
              {renderRow(item, virtualRow.index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface PlaylistTableViewProps {
  filteredTracks?: Track[];
  sliceItems?: { id: string; segment: Segment; track: Track }[];
  mixedItems?: MixedItem[];
  searchQuery?: string;
  onDeleteTrack?: (id: string) => void;
  onDeleteSlice?: (id: string) => void;
  onDeletePlaylistItem?: (itemId: string, name: string) => void;
}

export function PlaylistTableView({
  filteredTracks,
  sliceItems,
  mixedItems,
  searchQuery = "",
  onDeleteTrack,
  onDeleteSlice,
  onDeletePlaylistItem,
}: PlaylistTableViewProps) {
  const { t } = useTranslation();
  const [playlistItemToDelete, setPlaylistItemToDelete] = React.useState<{ id: string; name: string } | null>(null);
  const [isDeletingPlaylistItem, setIsDeletingPlaylistItem] = React.useState(false);
  const activePlaylistId = usePlayerStore((s) => s.activePlaylistId);
  const activePlaylistPlayingId = usePlayerStore((s) => s.activePlaylistPlayingId);
  const activeSystemCategory = usePlayerStore((s) => s.activeSystemCategory);
  const activePlaylistItems = usePlayerStore((s) => s.activePlaylistItems);
  const playlists = usePlayerStore((s) => s.playlists);
  const playPlaylistItemAtIndex = usePlayerStore((s) => s.playPlaylistItemAtIndex);
  const removeFromPlaylist = usePlayerStore((s) => s.removeFromPlaylist);
  const reorderPlaylist = usePlayerStore((s) => s.reorderPlaylist);
  const openSliceStudio = usePlayerStore((s) => s.openSliceStudio);
  const activeTrack = usePlayerStore((s) => s.activeTrack);
  const activeSegment = usePlayerStore((s) => s.activeSegment);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const playSegmentInMode = usePlayerStore((s) => s.playSegmentInMode);
  const queue = usePlayerStore((s) => s.queue);
  const queueIndex = usePlayerStore((s) => s.queueIndex);
  const playbackMode = usePlayerStore((s) => s.playbackMode);
  const retryTrack = usePlayerStore((s) => s.retryTrack);
  const retryingTrackIds = usePlayerStore((s) => s.retryingTrackIds);

  const selectedTrackIds = useSelectionStore((s) => s.selectedTrackIds);
  const toggleTrack = useSelectionStore((s) => s.toggleTrack);
  const selectAllVisible = useSelectionStore((s) => s.selectAllVisible);
  const deselectAllVisible = useSelectionStore((s) => s.deselectAllVisible);

  const [isReordering, setIsReordering] = React.useState(false);
  const isReorderingRef = React.useRef(false);
  const [draggedIdx, setDraggedIdx] = React.useState<number | null>(null);
  const draggedIdxRef = React.useRef<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = React.useState<number | null>(null);
  const isDraggingHandleRef = React.useRef(false);
  const justDroppedRef = React.useRef(false);
  const markJustDroppedTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const markJustDropped = React.useCallback(() => {
    justDroppedRef.current = true;
    if (markJustDroppedTimerRef.current) {
      clearTimeout(markJustDroppedTimerRef.current);
    }
    markJustDroppedTimerRef.current = setTimeout(() => {
      justDroppedRef.current = false;
      markJustDroppedTimerRef.current = null;
    }, 150);
  }, []);

  React.useEffect(() => {
    return () => {
      if (markJustDroppedTimerRef.current) {
        clearTimeout(markJustDroppedTimerRef.current);
      }
    };
  }, []);

  const resetDragState = React.useCallback(() => {
    draggedIdxRef.current = null;
    isDraggingHandleRef.current = false;
    setDraggedIdx(null);
    setDragOverIdx(null);
  }, []);

  React.useEffect(() => {
    const handleRelease = () => {
      if (draggedIdxRef.current === null) {
        isDraggingHandleRef.current = false;
      }
    };
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && (draggedIdxRef.current !== null || isDraggingHandleRef.current)) {
        resetDragState();
      }
    };
    window.addEventListener("mouseup", handleRelease);
    window.addEventListener("pointerup", handleRelease);
    window.addEventListener("pointercancel", handleRelease);
    window.addEventListener("dragend", resetDragState);
    window.addEventListener("keydown", handleGlobalKeyDown);
    window.addEventListener("blur", resetDragState);
    return () => {
      window.removeEventListener("mouseup", handleRelease);
      window.removeEventListener("pointerup", handleRelease);
      window.removeEventListener("pointercancel", handleRelease);
      window.removeEventListener("dragend", resetDragState);
      window.removeEventListener("keydown", handleGlobalKeyDown);
      window.removeEventListener("blur", resetDragState);
    };
  }, [resetDragState]);

  const commitReorder = React.useCallback(
    async (fromIdx: number, toIdx: number) => {
      if (!activePlaylistId || isReorderingRef.current || Boolean(searchQuery?.trim())) return;
      if (fromIdx === toIdx) return;
      if (
        fromIdx < 0 ||
        fromIdx >= activePlaylistItems.length ||
        toIdx < 0 ||
        toIdx >= activePlaylistItems.length
      ) {
        return;
      }
      isReorderingRef.current = true;
      setIsReordering(true);
      try {
        const newItems = [...activePlaylistItems];
        const [moved] = newItems.splice(fromIdx, 1);
        newItems.splice(toIdx, 0, moved);
        const newIds = newItems.map((it) => it.id);
        await reorderPlaylist(activePlaylistId, newIds);
      } finally {
        isReorderingRef.current = false;
        setIsReordering(false);
      }
    },
    [activePlaylistId, searchQuery, activePlaylistItems, reorderPlaylist]
  );

  const handleDragStart = React.useCallback(
    (e: React.DragEvent, idx: number, name: string) => {
      if (!isDraggingHandleRef.current) {
        e.preventDefault();
        return;
      }
      e.dataTransfer.setData("application/x-slice-playlist-index", String(idx));
      e.dataTransfer.setData("text/plain", name);
      e.dataTransfer.effectAllowed = "move";
      draggedIdxRef.current = idx;
      setDraggedIdx(idx);
    },
    []
  );

  const handleDragOver = React.useCallback(
    (e: React.DragEvent, idx: number) => {
      const currentDraggedIdx = draggedIdxRef.current;
      if (currentDraggedIdx === null) return;
      if (currentDraggedIdx === idx) {
        setDragOverIdx((prev) => (prev !== null ? null : prev));
        return;
      }
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setDragOverIdx((prev) => (prev !== idx ? idx : prev));
    },
    []
  );

  const handleDragLeave = React.useCallback(
    (e: React.DragEvent, idx: number) => {
      if (e.currentTarget.contains(e.relatedTarget as Node)) return;
      setDragOverIdx((prev) => (prev === idx ? null : prev));
    },
    []
  );

  const handleDrop = React.useCallback(
    (e: React.DragEvent, targetIdx: number) => {
      e.preventDefault();
      e.stopPropagation();
      const rawIdx = e.dataTransfer.getData("application/x-slice-playlist-index");
      const fromIdx = rawIdx ? parseInt(rawIdx, 10) : draggedIdxRef.current;
      if (fromIdx !== null && !isNaN(fromIdx) && fromIdx !== targetIdx) {
        commitReorder(fromIdx, targetIdx);
      }
      markJustDropped();
      resetDragState();
    },
    [commitReorder, markJustDropped, resetDragState]
  );

  const handleDragEnd = React.useCallback(() => {
    markJustDropped();
    resetDragState();
  }, [markJustDropped, resetDragState]);

  const currentPlaylist = React.useMemo(() => {
    return playlists.find((p) => p.id === activePlaylistId);
  }, [playlists, activePlaylistId]);

  const displayedItems = React.useMemo(() => {
    if (!searchQuery?.trim()) return activePlaylistItems;
    const tokens = tokenizeQuery(searchQuery);
    return activePlaylistItems.filter((item) => {
      const combined = `${normalizeVi(item.segment?.name)} ${normalizeVi(item.track?.title)} ${normalizeVi(item.track?.artist)}`;
      return tokens.every((t) => combined.includes(t));
    });
  }, [activePlaylistItems, searchQuery]);

  const originalIdxMap = React.useMemo(() => {
    return new Map(activePlaylistItems.map((it, idx) => [it.id, idx]));
  }, [activePlaylistItems]);

  const handleMoveItem = React.useCallback(
    async (e: React.MouseEvent, itemIndex: number, direction: "up" | "down") => {
      e.stopPropagation();
      const targetIdx = direction === "up" ? itemIndex - 1 : itemIndex + 1;
      await commitReorder(itemIndex, targetIdx);
    },
    [commitReorder]
  );

  const handlePlayTrack = React.useCallback(
    async (track: Track) => {
      if (track.status !== "ready" || track.duration <= 0) return;
      const targetMode = isPlaybackMode(activeSystemCategory) ? activeSystemCategory : playbackMode;
      if (targetMode === "original_only" || targetMode === "mixed") {
        playSegmentInMode(targetMode, createDefaultFullSegment(track), track);
        return;
      }
      const modeQueue = usePlayerStore.getState().queuesByMode[targetMode] || [];
      const modeTrackSlices = modeQueue
        .filter((it) => it.track.id === track.id && !it.segment.id.startsWith("fallback_"))
        .map((it) => it.segment);
      if (modeTrackSlices.length > 0) {
        playSegmentInMode(targetMode, modeTrackSlices[0], track);
      } else if ((track.segment_count || 0) > 0) {
        try {
          const res = await fetch(`/api/tracks/${encodeURIComponent(track.id)}/segments`);
          const segs = res.ok ? await res.json() : [];
          if (Array.isArray(segs) && segs.length > 0) {
            playSegmentInMode(targetMode, segs[0], track);
            return;
          }
        } catch (e) {
          console.error(e);
        }
        playSegmentInMode(targetMode, createDefaultFullSegment(track), track);
      } else {
        playSegmentInMode(targetMode, createDefaultFullSegment(track), track);
      }
    },
    [activeSystemCategory, playbackMode, playSegmentInMode]
  );

  const trackList = filteredTracks || [];

  const visiblePlaylistSelectedItems = React.useMemo<SelectedItem[]>(
    () =>
      displayedItems.map((it) => ({
        id: it.id,
        type: "playlist_item",
        trackId: it.track.id,
        segmentId: it.segment?.id || null,
        playlistId: activePlaylistId,
        title: it.segment ? it.segment.name : it.track.title,
      })),
    [displayedItems, activePlaylistId]
  );
  const visiblePlaylistItemIds = React.useMemo(
    () => visiblePlaylistSelectedItems.map((it) => it.id),
    [visiblePlaylistSelectedItems]
  );
  const allPlaylistItemsSelected = isAllVisibleSelected(selectedTrackIds, visiblePlaylistItemIds);
  const partiallyPlaylistItemsSelected = isPartiallyVisibleSelected(selectedTrackIds, visiblePlaylistItemIds);

  const visibleSliceSelectedItems = React.useMemo<SelectedItem[]>(
    () =>
      sliceItems
        ? sliceItems.map((it) => ({
            id: it.segment.id,
            type: "slice",
            trackId: it.track.id,
            segmentId: it.segment.id,
            title: it.segment.name,
          }))
        : [],
    [sliceItems]
  );
  const visibleSliceItemIds = React.useMemo(
    () => visibleSliceSelectedItems.map((it) => it.id),
    [visibleSliceSelectedItems]
  );
  const allSliceItemsSelected = isAllVisibleSelected(selectedTrackIds, visibleSliceItemIds);
  const partiallySliceItemsSelected = isPartiallyVisibleSelected(selectedTrackIds, visibleSliceItemIds);

  const visibleMixedSelectedItems = React.useMemo<SelectedItem[]>(
    () =>
      mixedItems
        ? mixedItems.map((it) =>
            it.type === "slice"
              ? {
                  id: it.segment.id,
                  type: "slice",
                  trackId: it.track.id,
                  segmentId: it.segment.id,
                  title: it.segment.name,
                }
              : {
                  id: it.track.id,
                  type: "track",
                  trackId: it.track.id,
                  title: it.track.title,
                }
          )
        : [],
    [mixedItems]
  );
  const visibleMixedItemIds = React.useMemo(
    () => visibleMixedSelectedItems.map((it) => it.id),
    [visibleMixedSelectedItems]
  );
  const allMixedItemsSelected = isAllVisibleSelected(selectedTrackIds, visibleMixedItemIds);
  const partiallyMixedItemsSelected = isPartiallyVisibleSelected(selectedTrackIds, visibleMixedItemIds);

  const visibleTrackSelectedItems = React.useMemo<SelectedItem[]>(
    () =>
      filteredTracks
        ? filteredTracks.map((trk) => ({
            id: trk.id,
            type: "track",
            trackId: trk.id,
            title: trk.title,
          }))
        : [],
    [filteredTracks]
  );
  const visibleTrackIds = React.useMemo(() => visibleTrackSelectedItems.map((t) => t.id), [visibleTrackSelectedItems]);
  const allTracksSelected = isAllVisibleSelected(selectedTrackIds, visibleTrackIds);
  const partiallyTracksSelected = isPartiallyVisibleSelected(selectedTrackIds, visibleTrackIds);

  // If in a custom playlist
  if (activePlaylistId) {
    if (activePlaylistItems.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border p-12 text-center bg-card/40 my-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary mb-4 border border-primary/20">
            <Music className="h-7 w-7" />
          </div>
          <h2 className="text-lg font-semibold text-foreground">
            {t("library.emptyPlaylistTitle")}
          </h2>
          <p className="text-xs text-muted-foreground mt-1 max-w-md">
            {t("library.emptyPlaylistDesc", { name: currentPlaylist?.name || "" })}
          </p>
        </div>
      );
    }

    if (displayedItems.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border p-12 text-center bg-card/40 my-4">
          <Music className="h-8 w-8 text-muted-foreground mb-2" />
          <h2 className="text-base font-semibold text-foreground">
            {t("table.emptyMixed")}
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            {t("table.emptyFilterDesc")}
          </p>
        </div>
      );
    }

    return (
      <div
        className="w-full space-y-1"
        role="table"
        aria-label={t("nav.playlists")}
        aria-rowcount={displayedItems.length + 1}
      >
        {/* Table Header */}
        <div role="row" aria-rowindex={1} className="grid grid-cols-[72px_1fr_64px_124px] sm:grid-cols-[80px_1fr_180px_90px_130px] gap-x-3 sm:gap-x-4 items-center px-3 sm:px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider border-b border-border">
          <div role="columnheader" className="flex items-center gap-1.5 sm:gap-2 pl-0.5 sm:pl-1">
            {visiblePlaylistItemIds.length > 0 && (
              <button
                type="button"
                role="checkbox"
                aria-checked={allPlaylistItemsSelected ? true : partiallyPlaylistItemsSelected ? "mixed" : false}
                aria-label={allPlaylistItemsSelected ? t("bulkActions.deselectAll", "Deselect all") : t("bulkActions.selectAll", "Select all")}
                onClick={() => {
                  if (allPlaylistItemsSelected) {
                    deselectAllVisible(visiblePlaylistItemIds);
                  } else {
                    selectAllVisible(displayedItems.map((it) => ({
                      id: it.id,
                      type: "playlist_item",
                      trackId: it.track.id,
                      segmentId: it.segment?.id || null,
                      playlistId: activePlaylistId,
                      title: it.segment ? it.segment.name : it.track.title,
                    })));
                  }
                }}
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors cursor-pointer ${
                  allPlaylistItemsSelected || partiallyPlaylistItemsSelected
                    ? "bg-primary border-primary text-primary-foreground"
                    : "border-muted-foreground/50 hover:border-foreground"
                }`}
              >
                {allPlaylistItemsSelected && <Check className="h-3 w-3 stroke-[3]" />}
                {partiallyPlaylistItemsSelected && !allPlaylistItemsSelected && (
                  <div className="h-0.5 w-2 bg-primary-foreground rounded-full" />
                )}
              </button>
            )}
            <span>#</span>
          </div>
          <span role="columnheader">{t("table.trackOrSlice")}</span>
          <span role="columnheader" className="hidden sm:inline">{t("table.type")}</span>
          <span role="columnheader">{t("table.duration")}</span>
          <span role="columnheader" className="text-right">{t("table.actions")}</span>
        </div>

        {/* Rows */}
        <VirtualizedTableBody
          items={displayedItems}
          getItemKey={getEntityId}
          renderRow={(item: PlaylistItemWithDetails, idx: number) => {
            const isSlice = Boolean(item.segment);
            const duration = isSlice && item.segment
              ? Math.max(0, item.segment.end_time - item.segment.start_time)
              : (item.track?.duration ?? 0);

            const currentQueueItem = queueIndex >= 0 ? queue[queueIndex] : null;
            const isThisPlaylistPlaying = activePlaylistPlayingId !== null && activePlaylistPlayingId === activePlaylistId;
            const isCurrentPlaying =
              isThisPlaylistPlaying &&
              (currentQueueItem?.queueItemId
                ? currentQueueItem.queueItemId === item.id
                : (isSlice && item.segment
                    ? activeSegment?.id === item.segment.id
                    : activeSegment?.track_id === item.track?.id && !activeSegment?.id.startsWith("seg_"))) &&
              isPlaying;

            const isSearching = Boolean(searchQuery?.trim());
            const isReady = item.track?.status === "ready" && (item.track?.duration ?? 0) > 0;
            const originalIdx = originalIdxMap.get(item.id) ?? -1;
            const canMoveUp = !isSearching && !isReordering && originalIdx > 0;
            const canMoveDown = !isSearching && !isReordering && originalIdx >= 0 && originalIdx < activePlaylistItems.length - 1;
            const showDragHandle = !isSearching && originalIdx >= 0;
            const canDrag = showDragHandle && !isReordering;
            const isDragging = draggedIdx === originalIdx;
            const isDragTarget = dragOverIdx === originalIdx && draggedIdx !== null && draggedIdx !== originalIdx;

            const isSelected = selectedTrackIds.has(item.id);

            return (
              <div
                role="row"
                aria-rowindex={idx + 2}
                tabIndex={isReady ? 0 : -1}
                aria-label={t("trackCard.playTitle", { title: isSlice && item.segment ? item.segment.name : (item.track?.title || "") })}
                draggable={canDrag}
                onDragStart={(e) => {
                  if (!canDrag) {
                    e.preventDefault();
                    return;
                  }
                  const name = isSlice && item.segment ? item.segment.name : (item.track?.title || "");
                  handleDragStart(e, originalIdx, name);
                }}
                onDragOver={(e) => {
                  if (!canDrag) return;
                  handleDragOver(e, originalIdx);
                }}
                onDragLeave={(e) => {
                  if (!canDrag) return;
                  handleDragLeave(e, originalIdx);
                }}
                onDrop={(e) => {
                  if (!canDrag) return;
                  handleDrop(e, originalIdx);
                }}
                onDragEnd={handleDragEnd}
                onKeyDown={(e) => {
                  if ((e.key === "Enter" || e.key === " ") && isReady) {
                    e.preventDefault();
                    playPlaylistItemAtIndex(activePlaylistId, item.id);
                  }
                }}
                onClick={() => {
                  if (justDroppedRef.current) return;
                  if (!isReady) return;
                  playPlaylistItemAtIndex(activePlaylistId, item.id);
                }}
                className={`group grid grid-cols-[72px_1fr_64px_124px] sm:grid-cols-[80px_1fr_180px_90px_130px] gap-x-3 sm:gap-x-4 items-center px-3 sm:px-4 py-3 rounded-lg border transition-all focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/60 ${
                  isSelected
                    ? "ring-1 ring-primary/60 border-primary/50 bg-primary/5 shadow-xs"
                    : isDragging
                    ? "opacity-40 border-dashed border-primary/60"
                    : isDragTarget
                    ? "border-primary ring-2 ring-primary/60 bg-accent/70 shadow-md"
                    : !isReady
                    ? "opacity-60 cursor-not-allowed border-border bg-card/60"
                    : "cursor-pointer " + (isCurrentPlaying
                      ? "border-primary/50 bg-primary/10 shadow-xs"
                      : "border-border bg-card hover:border-border/80 hover:bg-card/80")
                }`}
              >
                {/* Index / Play indicator & Drag Handle */}
                <div role="cell" className="flex items-center gap-1.5 sm:gap-2 text-xs font-mono text-muted-foreground min-w-0">
                  {showDragHandle && (
                    <div
                      data-drag-handle="true"
                      role="button"
                      tabIndex={isReordering ? -1 : 0}
                      aria-disabled={isReordering}
                      aria-label={t("queue.dragHandleAria", {
                        name: isSlice && item.segment ? item.segment.name : (item.track?.title || ""),
                        position: originalIdx + 1,
                        total: activePlaylistItems.length,
                      })}
                      aria-keyshortcuts="ArrowUp ArrowDown Home End"
                      aria-description={t("queue.dragHandleDesc")}
                      className={`p-0.5 shrink-0 select-none transition-colors focus:outline-none focus:ring-1 focus:ring-primary rounded ${
                        isReordering
                          ? "opacity-30 cursor-not-allowed"
                          : "cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-foreground"
                      }`}
                      title={isReordering ? t("table.reordering") : t("queue.dragHandleTitle")}
                      onPointerDown={(e) => {
                        if (e.button === 0 && !isReordering) isDraggingHandleRef.current = true;
                      }}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          e.stopPropagation();
                          return;
                        }
                        if (["ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) {
                          e.preventDefault();
                          e.stopPropagation();
                          if (isSearching || isReordering || isReorderingRef.current) return;
                          if (e.key === "ArrowUp" && originalIdx > 0) {
                            commitReorder(originalIdx, originalIdx - 1);
                          } else if (e.key === "ArrowDown" && originalIdx < activePlaylistItems.length - 1) {
                            commitReorder(originalIdx, originalIdx + 1);
                          } else if (e.key === "Home" && originalIdx > 0) {
                            commitReorder(originalIdx, 0);
                          } else if (e.key === "End" && originalIdx < activePlaylistItems.length - 1) {
                            commitReorder(originalIdx, activePlaylistItems.length - 1);
                          }
                        }
                      }}
                    >
                      <GripVertical className="h-4 w-4 pointer-events-none" />
                    </div>
                  )}
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={isSelected}
                    aria-label={t("trackCard.selectTrack", {
                      title: isSlice && item.segment ? item.segment.name : (item.track?.title || ""),
                      defaultValue: `Select ${isSlice && item.segment ? item.segment.name : (item.track?.title || "")}`,
                    })}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleTrack(item.id, visiblePlaylistSelectedItems, e.shiftKey, {
                        id: item.id,
                        type: "playlist_item",
                        trackId: item.track?.id ?? item.track_id,
                        segmentId: item.segment?.id || null,
                        playlistId: activePlaylistId,
                        title: isSlice && item.segment ? item.segment.name : (item.track?.title || ""),
                      });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === " " || e.key === "Enter") {
                        e.stopPropagation();
                      }
                    }}
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors cursor-pointer ${
                      isSelected
                        ? "bg-primary border-primary text-primary-foreground"
                        : "border-muted-foreground/40 hover:border-foreground opacity-0 group-hover:opacity-100 focus:opacity-100"
                    }`}
                  >
                    {isSelected && <Check className="h-3 w-3 stroke-[3]" />}
                  </button>
                  <span className={isSelected ? "hidden" : isReady ? "group-hover:hidden truncate" : "truncate"}>
                    {String(idx + 1).padStart(2, "0")}
                  </span>
                  {isReady && !isSelected && (
                    <Play className="h-4 w-4 text-primary hidden group-hover:block fill-current shrink-0" />
                  )}
                </div>

                {/* Title & Artist */}
                <div role="cell" className="min-w-0 pr-2">
                  <div className="text-sm font-medium text-foreground truncate group-hover:text-primary transition-colors">
                    {isSlice && item.segment ? item.segment.name : item.track?.title}
                  </div>
                  <div className="text-xs text-muted-foreground truncate mt-0.5">
                    {isSlice ? t("table.from", { title: item.track?.title }) : (item.track?.artist || t("table.unknownArtist"))}
                  </div>
                </div>

                {/* Kind Badge */}
                <div role="cell" className="hidden sm:flex items-center">
                  {isSlice && item.segment ? (
                    <Badge variant="yellow" className="text-[11px] gap-1 font-mono">
                      <Scissors className="h-3 w-3" />
                      <span>
                        {t("table.sliceBadge", {
                          start: formatDuration(item.segment.start_time),
                          end: formatDuration(item.segment.end_time),
                        })}
                      </span>
                    </Badge>
                  ) : (
                    <Badge variant="green" className="text-[11px] gap-1 font-mono">
                      <Disc className="h-3 w-3" />
                      <span>{t("table.fullTrack")}</span>
                    </Badge>
                  )}
                </div>

                {/* Duration */}
                <div role="cell" className="font-mono text-xs text-muted-foreground flex items-center gap-1.5">
                  <span>{formatDuration(duration)}</span>
                  {item.track?.status === "downloading" ? (
                    <Badge variant="outline" className="text-[10px] text-primary border-primary/30 gap-1 py-0 px-1.5 font-normal">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      <span className="hidden sm:inline">{t("table.downloading")}</span>
                    </Badge>
                  ) : item.track?.status === "queued" ? (
                    <Badge variant="outline" className="text-[10px] text-muted-foreground border-border gap-1 py-0 px-1.5 font-normal">
                      <Clock className="h-3 w-3 text-primary/80" />
                      <span className="hidden sm:inline">{t("table.queued")}</span>
                    </Badge>
                  ) : item.track?.status === "error" ? (
                    <Badge variant="destructive" className="text-[10px] gap-1 py-0 px-1.5 font-normal">
                      <AlertCircle className="h-3 w-3" />
                      <span className="hidden sm:inline">{t("table.downloadError")}</span>
                    </Badge>
                  ) : null}
                </div>

                {/* Actions */}
                <div
                  role="cell"
                  className="flex items-center justify-end gap-0.5"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={!canMoveUp}
                    onClick={(e) => handleMoveItem(e, originalIdx, "up")}
                    className="h-7 w-7 text-muted-foreground hover:text-foreground disabled:opacity-30 cursor-pointer"
                    title={isSearching ? t("table.disableSearchToReorder") : isReordering ? t("table.reordering") : t("table.moveUp")}
                    aria-label={isSearching ? t("table.disableSearchToReorder") : isReordering ? t("table.reordering") : t("table.moveUp")}
                  >
                    <ChevronUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={!canMoveDown}
                    onClick={(e) => handleMoveItem(e, originalIdx, "down")}
                    className="h-7 w-7 text-muted-foreground hover:text-foreground disabled:opacity-30 cursor-pointer"
                    title={isSearching ? t("table.disableSearchToReorder") : isReordering ? t("table.reordering") : t("table.moveDown")}
                    aria-label={isSearching ? t("table.disableSearchToReorder") : isReordering ? t("table.reordering") : t("table.moveDown")}
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </Button>
                  <AddToPlaylistPopover
                    trackId={item.track?.id ?? item.track_id}
                    segmentId={isSlice && item.segment ? item.segment.id : undefined}
                    disabled={!isReady || isReordering}
                    variant="ghost"
                    size="icon"
                    buttonClassName="h-7 w-7 text-muted-foreground hover:text-primary hover:bg-primary/10 cursor-pointer disabled:opacity-30"
                    showText={false}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={isReordering}
                    onClick={() => {
                      const name = item.segment ? item.segment.name : (item.track?.title || "");
                      if (onDeletePlaylistItem) {
                        onDeletePlaylistItem(item.id, name);
                      } else {
                        setPlaylistItemToDelete({ id: item.id, name });
                      }
                    }}
                    className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10 cursor-pointer disabled:opacity-30"
                    title={t("table.removeFromPlaylist")}
                    aria-label={t("table.removeFromPlaylist")}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            );
          }}
        />
        {playlistItemToDelete && (
          <ConfirmModal
            isOpen={!!playlistItemToDelete}
            onClose={() => !isDeletingPlaylistItem && setPlaylistItemToDelete(null)}
            onConfirm={async () => {
              if (!playlistItemToDelete || isDeletingPlaylistItem || !activePlaylistId) return;
              setIsDeletingPlaylistItem(true);
              try {
                await removeFromPlaylist(activePlaylistId, playlistItemToDelete.id);
                setPlaylistItemToDelete(null);
              } finally {
                setIsDeletingPlaylistItem(false);
              }
            }}
            isLoading={isDeletingPlaylistItem}
            title={t("library.confirmDeletePlaylistItemTitle", "Remove from playlist?")}
            description={t("library.confirmDeletePlaylistItem", {
              name: playlistItemToDelete.name,
              defaultValue: `Remove "${playlistItemToDelete.name}" from playlist?`,
            })}
            confirmText={t("common.delete", "Delete")}
            cancelText={t("common.cancel", "Cancel")}
            variant="destructive"
          />
        )}
      </div>
    );
  }

  // If in slices-only view
  if (sliceItems) {
    if (sliceItems.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border p-12 text-center bg-card/40 my-4">
          <Scissors className="h-8 w-8 text-muted-foreground mb-2" />
          <h2 className="text-base font-semibold text-foreground">{t("table.emptySlices")}</h2>
          <p className="text-xs text-muted-foreground mt-1">
            {t("table.emptyFilterDesc")}
          </p>
        </div>
      );
    }

    return (
      <div
        className="w-full space-y-1"
        role="table"
        aria-label={t("table.slices")}
        aria-rowcount={sliceItems.length + 1}
      >
        {/* Table Header */}
        <div role="row" aria-rowindex={1} className="grid grid-cols-[44px_1fr_64px_96px] sm:grid-cols-[56px_1fr_180px_90px_130px] gap-x-3 sm:gap-x-4 items-center px-3 sm:px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider border-b border-border">
          <div role="columnheader" className="flex items-center gap-1.5 sm:gap-2">
            {visibleSliceItemIds.length > 0 && (
              <button
                type="button"
                role="checkbox"
                aria-checked={allSliceItemsSelected ? true : partiallySliceItemsSelected ? "mixed" : false}
                aria-label={allSliceItemsSelected ? t("bulkActions.deselectAll", "Deselect all") : t("bulkActions.selectAll", "Select all")}
                onClick={() => {
                  if (allSliceItemsSelected) {
                    deselectAllVisible(visibleSliceItemIds);
                  } else {
                    selectAllVisible(sliceItems.map((it) => ({
                      id: it.segment.id,
                      type: "slice",
                      trackId: it.track.id,
                      segmentId: it.segment.id,
                      title: it.segment.name,
                    })));
                  }
                }}
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors cursor-pointer ${
                  allSliceItemsSelected || partiallySliceItemsSelected
                    ? "bg-primary border-primary text-primary-foreground"
                    : "border-muted-foreground/50 hover:border-foreground"
                }`}
              >
                {allSliceItemsSelected && <Check className="h-3 w-3 stroke-[3]" />}
                {partiallySliceItemsSelected && !allSliceItemsSelected && (
                  <div className="h-0.5 w-2 bg-primary-foreground rounded-full" />
                )}
              </button>
            )}
            <span>#</span>
          </div>
          <span role="columnheader">{t("table.slices")}</span>
          <span role="columnheader" className="hidden sm:inline">{t("table.originalTrack")}</span>
          <span role="columnheader">{t("table.duration")}</span>
          <span role="columnheader" className="text-right">{t("table.actions")}</span>
        </div>

        {/* Rows */}
        <VirtualizedTableBody
          items={sliceItems}
          getItemKey={getEntityId}
          renderRow={(item, idx) => {
            const isCurrentPlaying = isPlaying && activeSegment?.id === item.segment.id;
            const duration = Math.max(0, item.segment.end_time - item.segment.start_time);
            const isReady = item.track?.status === "ready" && (item.track?.duration ?? 0) > 0;
            const isSelected = selectedTrackIds.has(item.segment.id);

            return (
              <div
                role="row"
                aria-rowindex={idx + 2}
                tabIndex={isReady ? 0 : -1}
                aria-label={t("trackCard.playSliceTitle", { name: item.segment.name })}
                onKeyDown={(e) => {
                  if ((e.key === "Enter" || e.key === " ") && isReady) {
                    e.preventDefault();
                    playSegmentInMode("slices_only", item.segment, item.track);
                  }
                }}
                onClick={() => {
                  if (!isReady) return;
                  playSegmentInMode("slices_only", item.segment, item.track);
                }}
                className={`group grid grid-cols-[44px_1fr_64px_96px] sm:grid-cols-[56px_1fr_180px_90px_130px] gap-x-3 sm:gap-x-4 items-center px-3 sm:px-4 py-3 rounded-lg border transition-all ${
                  isSelected
                    ? "ring-1 ring-primary/60 border-primary/50 bg-primary/5 shadow-xs"
                    : !isReady
                    ? "opacity-60 cursor-not-allowed border-border bg-card/60"
                    : "cursor-pointer " + (isCurrentPlaying
                      ? "border-primary/50 bg-primary/10 shadow-xs"
                      : "border-border bg-card hover:border-border/80 hover:bg-card/80")
                }`}
              >
                {/* Index / Play icon */}
                <div role="cell" className="flex items-center gap-1.5 sm:gap-2 text-xs font-mono text-muted-foreground min-w-0">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={isSelected}
                    aria-label={t("trackCard.selectTrack", { title: item.segment.name, defaultValue: `Select ${item.segment.name}` })}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleTrack(item.segment.id, visibleSliceSelectedItems, e.shiftKey, {
                        id: item.segment.id,
                        type: "slice",
                        trackId: item.track.id,
                        segmentId: item.segment.id,
                        title: item.segment.name,
                      });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === " " || e.key === "Enter") {
                        e.stopPropagation();
                      }
                    }}
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors cursor-pointer ${
                      isSelected
                        ? "bg-primary border-primary text-primary-foreground"
                        : "border-muted-foreground/40 hover:border-foreground opacity-0 group-hover:opacity-100 focus:opacity-100"
                    }`}
                  >
                    {isSelected && <Check className="h-3 w-3 stroke-[3]" />}
                  </button>
                  <span className={isSelected ? "hidden" : isReady ? "group-hover:hidden" : ""}>
                    {String(idx + 1).padStart(2, "0")}
                  </span>
                  {isReady && !isSelected && (
                    <Play className="h-4 w-4 text-primary hidden group-hover:block fill-current shrink-0" />
                  )}
                </div>

                {/* Title */}
                <div role="cell" className="min-w-0 pr-2">
                  <div className="text-sm font-medium text-foreground truncate group-hover:text-primary transition-colors flex items-center gap-1.5">
                    <Scissors className="h-3.5 w-3.5 shrink-0 text-flexoki-yellow" />
                    <span className="truncate">{item.segment.name}</span>
                  </div>
                </div>

                {/* Original Track */}
                <div role="cell" className="hidden sm:block text-xs text-muted-foreground truncate pr-2">
                  {item.track.title}
                </div>

                {/* Duration */}
                <div role="cell" className="text-xs font-mono text-muted-foreground">
                  {formatDuration(duration)}
                </div>

                {/* Actions */}
                <div
                  role="cell"
                  className="flex items-center justify-end gap-1"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openSliceStudio(item.track)}
                    disabled={!isReady}
                    className="h-7 text-xs px-2 gap-1 text-primary hover:bg-primary/10 cursor-pointer"
                    title={t("table.openStudio")}
                  >
                    <Scissors className="h-3.5 w-3.5" />
                    <span className="hidden md:inline">{t("table.studio")}</span>
                  </Button>
                  <AddToPlaylistPopover
                    trackId={item.track?.id ?? ""}
                    segmentId={item.segment.id}
                    disabled={!isReady}
                    variant="ghost"
                    size="icon"
                    buttonClassName="h-7 w-7 text-muted-foreground hover:text-primary hover:bg-primary/10 cursor-pointer"
                    showText={false}
                  />
                  {onDeleteSlice && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onDeleteSlice(item.segment.id)}
                      className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10 cursor-pointer"
                      title={t("table.deleteSlice", "Delete slice")}
                      aria-label={t("table.deleteSlice", "Delete slice")}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </div>
            );
          }}
        />
      </div>
    );
  }

  // If in mixed view (activeSystemCategory === "mixed")
  if (mixedItems) {
    if (mixedItems.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border p-12 text-center bg-card/40 my-4">
          <Shuffle className="h-8 w-8 text-muted-foreground mb-2" />
          <h2 className="text-base font-semibold text-foreground">{t("table.emptyMixed")}</h2>
          <p className="text-xs text-muted-foreground mt-1">
            {t("table.emptyFilterDesc")}
          </p>
        </div>
      );
    }

    return (
      <div
        className="w-full space-y-1"
        role="table"
        aria-label={t("categories.mixed")}
        aria-rowcount={mixedItems.length + 1}
      >
        {/* Table Header */}
        <div role="row" aria-rowindex={1} className="grid grid-cols-[44px_1fr_64px_96px] sm:grid-cols-[56px_1fr_180px_90px_130px] gap-x-3 sm:gap-x-4 items-center px-3 sm:px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider border-b border-border">
          <div role="columnheader" className="flex items-center gap-1.5 sm:gap-2">
            {visibleMixedItemIds.length > 0 && (
              <button
                type="button"
                role="checkbox"
                aria-checked={allMixedItemsSelected ? true : partiallyMixedItemsSelected ? "mixed" : false}
                aria-label={allMixedItemsSelected ? t("bulkActions.deselectAll", "Deselect all") : t("bulkActions.selectAll", "Select all")}
                onClick={() => {
                  if (allMixedItemsSelected) {
                    deselectAllVisible(visibleMixedItemIds);
                  } else {
                    selectAllVisible(
                      mixedItems.map((it) =>
                        it.type === "slice"
                          ? {
                              id: it.segment.id,
                              type: "slice" as const,
                              trackId: it.track.id,
                              segmentId: it.segment.id,
                              title: it.segment.name,
                            }
                          : {
                              id: it.track.id,
                              type: "track" as const,
                              trackId: it.track.id,
                              title: it.track.title,
                            }
                      )
                    );
                  }
                }}
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors cursor-pointer ${
                  allMixedItemsSelected || partiallyMixedItemsSelected
                    ? "bg-primary border-primary text-primary-foreground"
                    : "border-muted-foreground/50 hover:border-foreground"
                }`}
              >
                {allMixedItemsSelected && <Check className="h-3 w-3 stroke-[3]" />}
                {partiallyMixedItemsSelected && !allMixedItemsSelected && (
                  <div className="h-0.5 w-2 bg-primary-foreground rounded-full" />
                )}
              </button>
            )}
            <span>#</span>
          </div>
          <span role="columnheader">{t("table.trackOrSlice")}</span>
          <span role="columnheader" className="hidden sm:inline">{t("table.type")}</span>
          <span role="columnheader">{t("table.duration")}</span>
          <span role="columnheader" className="text-right">{t("table.actions")}</span>
        </div>

        {/* Rows */}
        <VirtualizedTableBody
          items={mixedItems}
          getItemKey={getEntityId}
          renderRow={(item, idx) => {
            const isSlice = item.type === "slice";
            const entityId = isSlice ? item.segment.id : item.track.id;
            const isSelected = selectedTrackIds.has(entityId);
            const duration = isSlice
              ? Math.max(0, item.segment.end_time - item.segment.start_time)
              : item.track.duration;

            const isReady = item.track.status === "ready" && item.track.duration > 0;
            const isCurrentPlaying =
              isPlaying &&
              (isSlice
                ? activeSegment?.id === item.segment.id
                : activeTrack?.id === item.track.id && (!activeSegment || activeSegment.id.startsWith("fallback_")));

            const handlePlay = () => {
              if (!isReady) return;
              if (isSlice) {
                playSegmentInMode("mixed", item.segment, item.track);
              } else {
                playSegmentInMode("mixed", createDefaultFullSegment(item.track), item.track);
              }
            };

            return (
              <div
                role="row"
                aria-rowindex={idx + 2}
                tabIndex={isReady ? 0 : -1}
                aria-label={t("trackCard.playTitle", { title: isSlice ? item.segment.name : item.track.title })}
                onKeyDown={(e) => {
                  if ((e.key === "Enter" || e.key === " ") && isReady) {
                    e.preventDefault();
                    handlePlay();
                  }
                }}
                onClick={handlePlay}
                className={`group grid grid-cols-[44px_1fr_64px_96px] sm:grid-cols-[56px_1fr_180px_90px_130px] gap-x-3 sm:gap-x-4 items-center px-3 sm:px-4 py-3 rounded-lg border transition-all ${
                  isSelected
                    ? "ring-1 ring-primary/60 border-primary/50 bg-primary/5 shadow-xs"
                    : !isReady
                    ? "opacity-60 cursor-not-allowed border-border bg-card/60"
                    : "cursor-pointer " + (isCurrentPlaying
                      ? "border-primary/50 bg-primary/10 shadow-xs"
                      : "border-border bg-card hover:border-border/80 hover:bg-card/80")
                }`}
              >
                {/* Index / Play indicator */}
                <div role="cell" className="flex items-center gap-1.5 sm:gap-2 text-xs font-mono text-muted-foreground min-w-0">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={isSelected}
                    aria-label={t("trackCard.selectTrack", { title: isSlice ? item.segment.name : item.track.title, defaultValue: `Select ${isSlice ? item.segment.name : item.track.title}` })}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleTrack(
                        entityId,
                        visibleMixedSelectedItems,
                        e.shiftKey,
                        isSlice
                          ? {
                              id: item.segment.id,
                              type: "slice",
                              trackId: item.track.id,
                              segmentId: item.segment.id,
                              title: item.segment.name,
                            }
                          : {
                              id: item.track.id,
                              type: "track",
                              trackId: item.track.id,
                              title: item.track.title,
                            }
                      );
                    }}
                    onKeyDown={(e) => {
                      if (e.key === " " || e.key === "Enter") {
                        e.stopPropagation();
                      }
                    }}
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors cursor-pointer ${
                      isSelected
                        ? "bg-primary border-primary text-primary-foreground"
                        : "border-muted-foreground/40 hover:border-foreground opacity-0 group-hover:opacity-100 focus:opacity-100"
                    }`}
                  >
                    {isSelected && <Check className="h-3 w-3 stroke-[3]" />}
                  </button>
                  <span className={isSelected ? "hidden" : isReady ? "group-hover:hidden" : ""}>
                    {String(idx + 1).padStart(2, "0")}
                  </span>
                  {isReady && !isSelected && (
                    <Play className="h-4 w-4 text-primary hidden group-hover:block fill-current shrink-0" />
                  )}
                </div>

                {/* Title & Artist */}
                <div role="cell" className="min-w-0 pr-2">
                  <div className="text-sm font-medium text-foreground truncate group-hover:text-primary transition-colors flex items-center gap-1.5">
                    {isSlice && <Scissors className="h-3.5 w-3.5 shrink-0 text-flexoki-yellow" />}
                    <span className="truncate">{isSlice ? item.segment.name : item.track.title}</span>
                  </div>
                  <div className="text-xs text-muted-foreground truncate mt-0.5">
                    {isSlice ? t("table.from", { title: item.track.title }) : (item.track.artist || t("table.unknownArtist"))}
                  </div>
                </div>

                {/* Kind Badge */}
                <div role="cell" className="hidden sm:flex items-center">
                  {isSlice ? (
                    <Badge variant="yellow" className="text-[11px] gap-1 font-mono">
                      <Scissors className="h-3 w-3" />
                      <span>
                        {t("table.sliceBadge", {
                          start: formatDuration(item.segment.start_time),
                          end: formatDuration(item.segment.end_time),
                        })}
                      </span>
                    </Badge>
                  ) : (
                    <Badge variant="green" className="text-[11px] gap-1 font-mono">
                      <Disc className="h-3 w-3" />
                      <span>{t("table.fullTrack")}</span>
                    </Badge>
                  )}
                </div>

                {/* Duration */}
                <div role="cell" className="font-mono text-xs text-muted-foreground flex items-center gap-1.5">
                  <span>{formatDuration(duration)}</span>
                  {item.track.status === "downloading" ? (
                    <Badge variant="outline" className="text-[10px] text-primary border-primary/30 gap-1 py-0 px-1.5 font-normal">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      <span className="hidden sm:inline">{t("table.downloading")}</span>
                    </Badge>
                  ) : item.track.status === "queued" ? (
                    <Badge variant="outline" className="text-[10px] text-muted-foreground border-border gap-1 py-0 px-1.5 font-normal">
                      <Clock className="h-3 w-3 text-primary/80" />
                      <span className="hidden sm:inline">{t("table.queued")}</span>
                    </Badge>
                  ) : item.track.status === "error" ? (
                    <Badge variant="destructive" className="text-[10px] gap-1 py-0 px-1.5 font-normal">
                      <AlertCircle className="h-3 w-3" />
                      <span className="hidden sm:inline">{t("table.downloadError")}</span>
                    </Badge>
                  ) : null}
                </div>

                {/* Actions */}
                <div
                  role="cell"
                  className="flex items-center justify-end gap-1"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openSliceStudio(item.track)}
                    disabled={!isReady}
                    className="h-7 text-xs px-2 gap-1 text-primary hover:bg-primary/10 cursor-pointer"
                    title={isSlice ? t("table.openStudio") : t("table.openStudio")}
                  >
                    <Scissors className="h-3.5 w-3.5" />
                    <span className="hidden md:inline">{isSlice ? t("table.studio") : t("table.slice")}</span>
                  </Button>
                  <AddToPlaylistPopover
                    trackId={item.track?.id ?? ""}
                    segmentId={isSlice ? item.segment.id : undefined}
                    disabled={!isReady}
                    variant="ghost"
                    size="icon"
                    buttonClassName="h-7 w-7 text-muted-foreground hover:text-primary hover:bg-primary/10 cursor-pointer"
                    showText={false}
                  />
                  {!isSlice && onDeleteTrack && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onDeleteTrack(item.track.id)}
                      className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10 cursor-pointer"
                      title={t("table.deleteTrack")}
                      aria-label={t("table.deleteTrack")}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  )}
                  {isSlice && onDeleteSlice && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onDeleteSlice(item.segment.id)}
                      className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10 cursor-pointer"
                      title={t("table.deleteSlice", "Delete slice")}
                      aria-label={t("table.deleteSlice", "Delete slice")}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </div>
            );
          }}
        />
      </div>
    );
  }

  // If in general library mode (activePlaylistId === null)
  if (trackList.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border p-12 text-center bg-card/40 my-4">
        <Music className="h-8 w-8 text-muted-foreground mb-2" />
        <h2 className="text-base font-semibold text-foreground">{t("table.emptyTracks")}</h2>
      </div>
    );
  }

  return (
    <div
      className="w-full space-y-1"
      role="table"
      aria-label={t("categories.tracks")}
      aria-rowcount={trackList.length + 1}
    >
      {/* Table Header */}
      <div role="row" aria-rowindex={1} className="grid grid-cols-[44px_1fr_64px_96px] sm:grid-cols-[56px_1fr_160px_100px_130px] gap-x-3 sm:gap-x-4 items-center px-3 sm:px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider border-b border-border">
        <div role="columnheader" className="flex items-center gap-1.5 sm:gap-2">
          {visibleTrackIds.length > 0 && (
            <button
              type="button"
              role="checkbox"
              aria-checked={allTracksSelected ? true : partiallyTracksSelected ? "mixed" : false}
              aria-label={allTracksSelected ? t("bulkActions.deselectAll", "Deselect all") : t("bulkActions.selectAll", "Select all")}
              onClick={() => {
                if (allTracksSelected) {
                  deselectAllVisible(visibleTrackIds);
                } else {
                  selectAllVisible(visibleTrackSelectedItems);
                }
              }}
              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors cursor-pointer ${
                allTracksSelected || partiallyTracksSelected
                  ? "bg-primary border-primary text-primary-foreground"
                  : "border-muted-foreground/50 hover:border-foreground"
              }`}
            >
              {allTracksSelected && <Check className="h-3 w-3 stroke-[3]" />}
              {partiallyTracksSelected && !allTracksSelected && (
                <div className="h-0.5 w-2 bg-primary-foreground rounded-full" />
              )}
            </button>
          )}
          <span>#</span>
        </div>
        <span role="columnheader">{t("table.track")}</span>
        <span role="columnheader" className="hidden sm:inline">{t("table.slices")}</span>
        <span role="columnheader">{t("table.duration")}</span>
        <span role="columnheader" className="text-right">{t("table.actions")}</span>
      </div>

      {/* Rows */}
      <VirtualizedTableBody
        items={trackList}
        getItemKey={getEntityId}
        renderRow={(track, idx) => {
          const isSelected = selectedTrackIds.has(track.id);
          const isCurrentPlaying =
            activeTrack?.id === track.id &&
            (!activeSegment || activeSegment.id.startsWith("fallback_")) &&
            isPlaying;
          const isReady = track.status === "ready" && track.duration > 0;
          const isRetrying = Boolean(retryingTrackIds?.[track.id]);
          const rowAriaLabel = isReady
            ? t("trackCard.playTitle", { title: track.title })
            : track.status === "downloading"
            ? `${t("trackCard.downloading")}: ${track.title}`
            : track.status === "queued"
            ? `${t("trackCard.inQueue")}: ${track.title}`
            : `${t("trackCard.error")}: ${track.title}`;

          return (
            <div
              role="row"
              aria-rowindex={idx + 2}
              tabIndex={isReady ? 0 : -1}
              aria-label={rowAriaLabel}
              onKeyDown={(e) => {
                if ((e.key === "Enter" || e.key === " ") && isReady) {
                  e.preventDefault();
                  handlePlayTrack(track);
                }
              }}
              onClick={() => handlePlayTrack(track)}
              className={`group grid grid-cols-[44px_1fr_64px_96px] sm:grid-cols-[56px_1fr_160px_100px_130px] gap-x-3 sm:gap-x-4 items-center px-3 sm:px-4 py-3 rounded-lg border transition-all ${
                isSelected
                  ? "ring-1 ring-primary/60 border-primary/50 bg-primary/5 shadow-xs"
                  : !isReady
                  ? "opacity-60 cursor-not-allowed border-border bg-card/60"
                  : "cursor-pointer " + (isCurrentPlaying
                    ? "border-primary/50 bg-primary/10 shadow-xs"
                    : "border-border bg-card hover:border-border/80 hover:bg-card/80")
              }`}
            >
              {/* Index & Selection Checkbox */}
              <div role="cell" className="flex items-center gap-1.5 sm:gap-2 text-xs font-mono text-muted-foreground min-w-0">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={isSelected}
                  aria-label={t("trackCard.selectTrack", { title: track.title, defaultValue: `Select ${track.title}` })}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleTrack(track.id, visibleTrackSelectedItems, e.shiftKey, {
                      id: track.id,
                      type: "track",
                      trackId: track.id,
                      title: track.title,
                    });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === " " || e.key === "Enter") {
                      e.stopPropagation();
                    }
                  }}
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors cursor-pointer ${
                    isSelected
                      ? "bg-primary border-primary text-primary-foreground"
                      : "border-muted-foreground/40 hover:border-foreground opacity-0 group-hover:opacity-100 focus:opacity-100"
                  }`}
                >
                  {isSelected && <Check className="h-3 w-3 stroke-[3]" />}
                </button>
                <span className={isSelected ? "hidden" : isReady ? "group-hover:hidden" : ""}>
                  {String(idx + 1).padStart(2, "0")}
                </span>
                {isReady && !isSelected && (
                  <Play className="h-4 w-4 text-primary hidden group-hover:block fill-current shrink-0" />
                )}
              </div>

              {/* Title & Artist */}
              <div role="cell" className="min-w-0 pr-2">
                <div className="text-sm font-medium text-foreground truncate group-hover:text-primary transition-colors">
                  {track.title}
                </div>
                <div className="text-xs text-muted-foreground truncate mt-0.5">
                  {track.artist || t("table.unknownArtist")}
                </div>
                {track.status === "error" && track.error_message && (
                  <div className="text-[11px] text-destructive/90 truncate mt-0.5" title={track.error_message}>
                    {track.error_message}
                  </div>
                )}
              </div>

              {/* Segment count */}
              <div role="cell" className="hidden sm:flex items-center">
                <Badge variant="secondary" className="text-[11px] font-mono">
                  {t("table.slicesCountBadge", { count: track.segment_count || 0 })}
                </Badge>
              </div>

              {/* Duration */}
              <div role="cell" className="font-mono text-xs text-muted-foreground flex items-center gap-1.5">
                <span>{formatDuration(track.duration)}</span>
                {track.status === "downloading" ? (
                  <Badge variant="outline" className="text-[10px] text-primary border-primary/30 gap-1 py-0 px-1.5 font-normal">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    <span className="hidden sm:inline">{t("table.downloading")}</span>
                  </Badge>
                ) : track.status === "queued" ? (
                  <Badge variant="outline" className="text-[10px] text-muted-foreground border-border gap-1 py-0 px-1.5 font-normal">
                    <Clock className="h-3 w-3 text-primary/80" />
                    <span className="hidden sm:inline">{t("table.queued")}</span>
                  </Badge>
                ) : track.status === "error" ? (
                  <Badge variant="destructive" className="text-[10px] gap-1 py-0 px-1.5 font-normal" title={track.error_message || t("trackCard.error")}>
                    <AlertCircle className="h-3 w-3" />
                    <span className="hidden sm:inline">{t("table.downloadError")}</span>
                  </Badge>
                ) : null}
              </div>

              {/* Actions */}
              <div
                role="cell"
                className="flex items-center justify-end gap-1"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              >
                {track.status === "error" ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={isRetrying}
                    onClick={async () => {
                      await retryTrack(track.id);
                    }}
                    className="h-7 px-2 text-xs gap-1 border-destructive/40 text-destructive hover:bg-destructive/10 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    title={isRetrying ? t("table.retrying") : t("table.retry")}
                  >
                    <RotateCcw className={`h-3 w-3 ${isRetrying ? "animate-spin" : ""}`} />
                    <span className="hidden sm:inline">{isRetrying ? t("table.retrying") : t("table.retry")}</span>
                  </Button>
                ) : (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openSliceStudio(track)}
                      disabled={!isReady}
                      className="h-7 px-2 text-xs gap-1 border-primary/30 hover:bg-primary/10 hover:text-primary"
                      title={t("table.openStudio")}
                    >
                      <Scissors className="h-3 w-3" />
                      <span className="hidden md:inline">{t("table.slice")}</span>
                    </Button>
                    <AddToPlaylistPopover
                      trackId={track?.id ?? ""}
                      disabled={!isReady}
                      variant="ghost"
                      size="icon"
                      buttonClassName="h-7 w-7 text-muted-foreground hover:text-primary hover:bg-primary/10 cursor-pointer"
                      showText={false}
                    />
                  </>
                )}
                {onDeleteTrack && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onDeleteTrack(track.id)}
                    className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    title={t("table.deleteTrack")}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </div>
          );
        }}
      />
    </div>
  );
}
