import * as React from "react";
import { useTranslation } from "react-i18next";
import { useWindowVirtualizer, defaultRangeExtractor, type Range, type Virtualizer } from "@tanstack/react-virtual";
import { Play, Pause, Scissors, Music, Disc, ChevronUp, ChevronDown, Shuffle, Clock, AlertCircle, RotateCcw, GripVertical, SquareCheck } from "lucide-react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Spinner } from "./ui/spinner";
import { Checkbox } from "./ui/checkbox";
import { DropdownMenuItem } from "./ui/dropdown-menu";
import { INLINE_ROW_ACTIONS_QUERY, useMediaQuery } from "../hooks/use-media-query";
import { cn, formatDuration, createDefaultFullSegment, DEFAULT_SLICE_COLOR } from "../lib/utils";
import {
  findActivePlaylistItemIndex,
  findActiveMixedItemIndex,
  findActiveSliceItemIndex,
  findActiveTrackIndex,
} from "../lib/activeItemIndex";
import { searchItems } from "../lib/search";
import { getSortedPlaylistItems } from "../lib/playlistSort";
import { usePlayerStore, isPlaybackMode, createQueueItem, type QueueItem } from "../store/usePlayerStore";
import {
  useSelectionStore,
  useIsSelectionActive,
  isAllVisibleSelected,
  isPartiallyVisibleSelected,
  createTrackSelectedItem,
  createSliceSelectedItem,
  createPlaylistItemSelectedItem,
  type SelectedItem,
} from "../store/useSelectionStore";
import { RowActionsMenu } from "./RowActionsMenu";
import { EmptyState } from "./EmptyState";
import { ConfirmModal } from "./ConfirmModal";
import { NowPlayingEqualizer } from "./NowPlayingEqualizer";
import { TrackThumbnail } from "./TrackThumbnail";
import type { Track, Segment, PlaylistItemWithDetails } from "@/server/types";
import type { MixedItem } from "../lib/playlistSort";
export type { MixedItem };

const getEntityId = (item: { id: string }) => item.id;
const PLAYLIST_ROW_HEIGHT = 50;
// Parks the drag preview off screen until the first dragover gives it a position
const DRAG_PREVIEW_HIDDEN = "-9999px";

interface TableRowState {
  index: number;
  isSelected: boolean;
  isReady: boolean;
  isCurrentPlaying: boolean;
  isDragging?: boolean;
  isDragTarget?: boolean;
}

// Flat Apple Music style rows: zebra stripes, a tint on the playing row and a ring on selected rows
function tableRowClassName(
  gridCols: string,
  { index, isSelected, isReady, isCurrentPlaying, isDragging, isDragTarget }: TableRowState
) {
  return cn(
    "group grid items-center gap-x-2 rounded-md px-3 py-1 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring sm:gap-x-4",
    gridCols,
    index % 2 === 1 && "bg-muted/40",
    isSelected
      ? "bg-primary/10 ring-1 ring-primary/50"
      : isDragging
      ? "opacity-40 outline-1 outline-dashed outline-primary/60"
      : isDragTarget
      ? "bg-accent ring-2 ring-primary/60"
      : !isReady
      ? "cursor-not-allowed opacity-60"
      : cn("cursor-pointer", isCurrentPlaying ? "bg-primary/10" : "hover:bg-accent/60")
  );
}

// Phones keep the number, the title, the duration (it also carries download status) and the "..." menu.
// The third column (type, original track or slice count) waits for the table itself to be 48rem wide:
// beside the sidebar and the queue panel the viewport is wide but the table is not, and the title would starve.
const PLAYLIST_GRID = "grid-cols-[28px_minmax(0,1fr)_64px_24px] sm:grid-cols-[80px_minmax(0,1fr)_90px_128px] @3xl:grid-cols-[80px_minmax(0,1fr)_180px_90px_128px]";
const LIBRARY_GRID = "grid-cols-[28px_minmax(0,1fr)_64px_24px] sm:grid-cols-[56px_minmax(0,1fr)_90px_104px] @3xl:grid-cols-[56px_minmax(0,1fr)_180px_90px_104px]";
const TRACKS_GRID = "grid-cols-[28px_minmax(0,1fr)_64px_24px] sm:grid-cols-[56px_minmax(0,1fr)_100px_104px] @3xl:grid-cols-[56px_minmax(0,1fr)_160px_100px_104px]";

const TABLE_HEADER_CLASS =
  "grid items-center gap-x-2 border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground sm:gap-x-4";

// Row actions stay out of the way until the row is hovered or focused; touch screens always show them
const ROW_ACTIONS_CLASS =
  "flex items-center justify-end transition-opacity [@media(pointer:fine)]:opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 focus-within:opacity-100";

// Small 16:9 artwork; a slice also shows its color as a bar along the bottom
function TableArtwork({ track, sliceColor }: { track?: Track | null; sliceColor?: string }) {
  return (
    <div className="relative aspect-video h-8 shrink-0 overflow-hidden rounded bg-muted">
      <TrackThumbnail src={track?.thumbnail_url} className="size-full object-cover" />
      {sliceColor && (
        <div
          data-slot="slice-color"
          className="absolute inset-x-0 bottom-0 h-0.5 bg-(--slice-color)"
          style={{ "--slice-color": sliceColor }}
        />
      )}
    </div>
  );
}

// Rows play on Enter and Space; controls inside a row keep those keys but let page shortcuts such as Escape through
function stopRowPlayKeys(e: React.KeyboardEvent) {
  if (e.key === "Enter" || e.key === " ") e.stopPropagation();
}

interface RowLeadingCellProps {
  index: number;
  // Names the row in the checkbox label
  title: string;
  isSelected: boolean;
  isSelectionActive: boolean;
  isReady: boolean;
  isCurrentPlaying: boolean;
  onToggleSelected: (shiftKey: boolean) => void;
  // Extra controls before the checkbox, such as a playlist's drag handle
  children?: React.ReactNode;
}

// The row number, an equalizer while it plays and a play or pause glyph on hover. The checkbox shows on
// hover and stays visible while selecting; phones swap it in for the number only while selecting.
function RowLeadingCell({
  index,
  title,
  isSelected,
  isSelectionActive,
  isReady,
  isCurrentPlaying,
  onToggleSelected,
  children,
}: RowLeadingCellProps) {
  const { t } = useTranslation();
  return (
    <div role="cell" className="flex min-w-0 items-center gap-1.5 font-mono text-xs text-muted-foreground sm:gap-2">
      {children}
      <span
        className={cn(
          "flex",
          !isSelectionActive && "opacity-0 group-hover:opacity-100 focus-within:opacity-100 max-sm:hidden"
        )}
      >
        <Checkbox
          checked={isSelected}
          aria-label={t("trackCard.selectTrack", { title, defaultValue: `Select ${title}` })}
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelected(e.shiftKey);
          }}
          onKeyDown={stopRowPlayKeys}
        />
      </span>
      <span className={cn("truncate", isSelected && "hidden", isSelectionActive && "max-sm:hidden", isReady && !isSelectionActive && "group-hover:hidden")}>
        {isCurrentPlaying ? <NowPlayingEqualizer className="text-primary" /> : String(index + 1).padStart(2, "0")}
      </span>
      {isReady && !isSelectionActive &&
        (isCurrentPlaying ? (
          <Pause aria-hidden="true" className="hidden size-4 shrink-0 fill-current text-primary group-hover:block" />
        ) : (
          <Play aria-hidden="true" className="hidden size-4 shrink-0 fill-current text-primary group-hover:block" />
        ))}
    </div>
  );
}

interface SelectAllCellProps {
  hasRows: boolean;
  allSelected: boolean;
  partiallySelected: boolean;
  onToggle: () => void;
}

function SelectAllCell({ hasRows, allSelected, partiallySelected, onToggle }: SelectAllCellProps) {
  const { t } = useTranslation();
  return (
    <div role="columnheader" className="flex items-center gap-1.5 sm:gap-2">
      {hasRows && (
        <Checkbox
          checked={allSelected}
          indeterminate={partiallySelected && !allSelected}
          aria-label={allSelected ? t("bulkActions.deselectAll", "Deselect all") : t("bulkActions.selectAll", "Select all")}
          onCheckedChange={onToggle}
        />
      )}
      <span className="max-sm:hidden">#</span>
    </div>
  );
}

// Phones have no hover to reveal a row's checkbox, so its menu offers the way into selecting
function SelectRowMenuItem({ onSelect }: { onSelect: () => void }) {
  const { t } = useTranslation();
  return (
    <DropdownMenuItem onClick={onSelect}>
      <SquareCheck />
      {t("bulkActions.select")}
    </DropdownMenuItem>
  );
}

interface VirtualizedTableBodyProps<T> {
  items: T[];
  getItemKey: (item: T, index: number) => string;
  renderRow: (item: T, index: number) => React.ReactNode;
  estimateRowHeight?: number;
  draggedIdx?: number | null;
  virtualizerRef?: React.MutableRefObject<Virtualizer<Window, Element> | null>;
  initialScrollOffset?: number;
}

function VirtualizedTableBody<T>({
  items,
  getItemKey,
  renderRow,
  estimateRowHeight = PLAYLIST_ROW_HEIGHT,
  draggedIdx,
  virtualizerRef,
  initialScrollOffset,
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

  // Keep actively dragged item mounted in DOM to prevent HTML5 Drag & Drop abort on window scroll
  const rangeExtractor = React.useCallback(
    (range: Range) => {
      const active = defaultRangeExtractor(range);
      if (
        draggedIdx !== undefined &&
        draggedIdx !== null &&
        draggedIdx >= 0 &&
        draggedIdx < items.length &&
        !active.includes(draggedIdx)
      ) {
        active.push(draggedIdx);
        active.sort((a, b) => a - b);
      }
      return active;
    },
    [items.length, draggedIdx]
  );

  const virtualizer = useWindowVirtualizer({
    count: items.length,
    estimateSize: () => estimateRowHeight,
    overscan: 10,
    scrollMargin,
    rangeExtractor,
    ...(typeof initialScrollOffset === "number" && initialScrollOffset > 0
      ? { initialOffset: initialScrollOffset }
      : {}),
    getItemKey: React.useCallback(
      (index: number) => (items[index] ? getItemKeyRef.current(items[index], index) : index),
      [items]
    ),
  });

  React.useEffect(() => {
    if (virtualizerRef) {
      virtualizerRef.current = virtualizer;
    }
    return () => {
      if (virtualizerRef) {
        virtualizerRef.current = null;
      }
    };
  }, [virtualizer, virtualizerRef]);

  if (items.length === 0) return <div ref={containerRef} className="pt-1" />;

  const virtualRows = virtualizer.getVirtualItems();

  return (
    <div ref={containerRef} className="pt-1 [overflow-anchor:none]" role="rowgroup">
      <div
        role="presentation"
        className="relative h-(--virtual-size) w-full"
        style={{ "--virtual-size": `${virtualizer.getTotalSize()}px` }}
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
              className="absolute inset-x-0 top-0 translate-y-(--virtual-start)"
              style={{ "--virtual-start": `${virtualRow.start - virtualizer.options.scrollMargin}px` }}
              onDragOver={(e) => {
                if (draggedIdx !== null && draggedIdx !== undefined) {
                  e.preventDefault();
                  if (e.dataTransfer) {
                    e.dataTransfer.dropEffect = "move";
                  }
                }
              }}
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
  initialScrollOffset?: number;
}

export function PlaylistTableView({
  filteredTracks,
  sliceItems,
  mixedItems,
  searchQuery = "",
  onDeleteTrack,
  onDeleteSlice,
  onDeletePlaylistItem,
  initialScrollOffset,
}: PlaylistTableViewProps) {
  const { t } = useTranslation();
  const [playlistItemToDelete, setPlaylistItemToDelete] = React.useState<{ id: string; name: string } | null>(null);
  const [isDeletingPlaylistItem, setIsDeletingPlaylistItem] = React.useState(false);
  const activePlaylistId = usePlayerStore((s) => s.activePlaylistId);
  const activePlaylistPlayingId = usePlayerStore((s) => s.activePlaylistPlayingId);
  const activeSystemCategory = usePlayerStore((s) => s.activeSystemCategory);
  const activePlaylistItems = usePlayerStore((s) => s.activePlaylistItems);
  const playlistSortMode = usePlayerStore((s) => s.playlistSortMode);
  const playlistRandomMap = usePlayerStore((s) => s.playlistRandomMap);
  const playlists = usePlayerStore((s) => s.playlists);
  const isMixPlaylist = Boolean(playlists.find((p) => p.id === activePlaylistId)?.is_mix);
  const playPlaylistItemAtIndex = usePlayerStore((s) => s.playPlaylistItemAtIndex);
  const buildPlaylistQueue = usePlayerStore((s) => s.buildPlaylistQueue);
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
  const activeTrackScrollRequest = usePlayerStore((s) => s.activeTrackScrollRequest);
  const retryTrack = usePlayerStore((s) => s.retryTrack);
  const retryingTrackIds = usePlayerStore((s) => s.retryingTrackIds);

  const selectedTrackIds = useSelectionStore((s) => s.selectedTrackIds);
  const isSelectionActive = useIsSelectionActive();
  // Phones move a row's inline actions into its "..." menu
  const showInlineRowActions = useMediaQuery(INLINE_ROW_ACTIONS_QUERY);
  const toggleTrack = useSelectionStore((s) => s.toggleTrack);
  const selectAllVisible = useSelectionStore((s) => s.selectAllVisible);
  const deselectAllVisible = useSelectionStore((s) => s.deselectAllVisible);

  const currentPlaylist = React.useMemo(() => {
    return playlists.find((p) => p.id === activePlaylistId);
  }, [playlists, activePlaylistId]);

  const sortedPlaylistItems = React.useMemo(() => {
    if (!activePlaylistId) return [];
    return getSortedPlaylistItems(
      activePlaylistItems,
      playlistSortMode,
      playlistRandomMap[activePlaylistId],
      currentPlaylist?.is_custom_ordered
    );
  }, [activePlaylistId, activePlaylistItems, playlistSortMode, playlistRandomMap, currentPlaylist?.is_custom_ordered]);

  const [isReordering, setIsReordering] = React.useState(false);
  const isReorderingRef = React.useRef(false);
  const busyIdRef = React.useRef<string | null>(null);
  const lastPlayInitiatedRef = React.useRef(0);
  const [draggedIdx, setDraggedIdx] = React.useState<number | null>(null);
  const draggedIdxRef = React.useRef<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = React.useState<number | null>(null);
  const dragOverIdxRef = React.useRef<number | null>(null);
  const isDraggingHandleRef = React.useRef(false);
  const justDroppedRef = React.useRef(false);
  const markJustDroppedTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const tableContainerRef = React.useRef<HTMLDivElement | null>(null);
  const virtualizerRef = React.useRef<Virtualizer<Window, Element> | null>(null);
  const autoScrollRafRef = React.useRef<number | null>(null);
  const scrollSpeedRef = React.useRef<number>(0);
  const lastClientYRef = React.useRef<number>(0);
  const floatingPreviewRef = React.useRef<HTMLDivElement | null>(null);

  const updatePreviewPosition = React.useCallback((clientX: number, clientY: number) => {
    if (floatingPreviewRef.current && (clientX !== 0 || clientY !== 0)) {
      floatingPreviewRef.current.style.setProperty("--drag-x", `${clientX + 16}px`);
      floatingPreviewRef.current.style.setProperty("--drag-y", `${clientY - 20}px`);
    }
  }, []);

  const resolveHoverTargetIndex = React.useCallback(
    (clientY: number, threshold = 30): number | null => {
      if (!tableContainerRef.current || sortedPlaylistItems.length === 0) return null;
      const rect = tableContainerRef.current.getBoundingClientRect();
      if (rect.height <= 0) return null;
      if (clientY <= rect.top + threshold) {
        return 0;
      }
      if (clientY >= rect.bottom - threshold) {
        return Math.max(0, sortedPlaylistItems.length - 1);
      }
      const offsetInTable = clientY - rect.top;
      const scrollMargin = virtualizerRef.current?.options?.scrollMargin ?? 0;
      const vItem = virtualizerRef.current?.getVirtualItemForOffset?.(offsetInTable + scrollMargin);
      if (
        vItem &&
        typeof vItem.index === "number" &&
        vItem.index >= 0 &&
        vItem.index < sortedPlaylistItems.length
      ) {
        return vItem.index;
      }
      return null;
    },
    [sortedPlaylistItems.length]
  );

  const setDragOverIdxSafe = React.useCallback(
    (valOrFn: number | null | ((prev: number | null) => number | null)) => {
      const next = typeof valOrFn === "function" ? valOrFn(dragOverIdxRef.current) : valOrFn;
      dragOverIdxRef.current = next;
      setDragOverIdx(next);
    },
    []
  );

  const stopAutoScroll = React.useCallback(() => {
    if (autoScrollRafRef.current !== null) {
      if (typeof window !== "undefined" && typeof window.cancelAnimationFrame === "function") {
        window.cancelAnimationFrame(autoScrollRafRef.current);
      } else {
        clearTimeout(autoScrollRafRef.current);
      }
      autoScrollRafRef.current = null;
    }
    scrollSpeedRef.current = 0;
  }, []);

  const startAutoScroll = React.useCallback(
    (speed: number) => {
      scrollSpeedRef.current = speed;
      if (typeof window === "undefined") return;

      const currentY =
        window.scrollY ||
        window.pageYOffset ||
        document?.documentElement?.scrollTop ||
        0;
      const scrollHeight = Math.max(
        document?.documentElement?.scrollHeight || 0,
        document?.body?.scrollHeight || 0
      );
      const maxScrollY = Math.max(0, scrollHeight - (window.innerHeight || 800));

      if ((speed < 0 && currentY <= 0) || (speed > 0 && currentY >= maxScrollY)) {
        stopAutoScroll();
        return;
      }

      if (autoScrollRafRef.current !== null) return;

      let lastTime = performance.now();
      const step = (now: number) => {
        if (scrollSpeedRef.current === 0) {
          autoScrollRafRef.current = null;
          return;
        }
        const currentNow = typeof now === "number" && !isNaN(now) ? now : performance.now();
        const dt = Math.min((currentNow - lastTime) / 1000, 0.1);
        lastTime = currentNow;

        const curY =
          window.scrollY ||
          window.pageYOffset ||
          document?.documentElement?.scrollTop ||
          0;
        const curScrollHeight = Math.max(
          document?.documentElement?.scrollHeight || 0,
          document?.body?.scrollHeight || 0
        );
        const maxY = Math.max(0, curScrollHeight - (window.innerHeight || 800));
        const delta = scrollSpeedRef.current * dt * 60;
        const nextY = Math.max(0, Math.min(maxY, curY + delta));

        if (
          (delta < 0 && curY <= 0) ||
          (delta > 0 && curY >= maxY) ||
          (Math.abs(delta) >= 1 && nextY === curY)
        ) {
          stopAutoScroll();
          return;
        }

        if (typeof window.scrollTo === "function") {
          window.scrollTo(0, nextY);
        }

        // Realtime dragOver target update as list scrolls under cursor
        if (draggedIdxRef.current !== null && tableContainerRef.current) {
          const clientY = lastClientYRef.current;
          const target = resolveHoverTargetIndex(clientY, 30);
          if (target !== null && dragOverIdxRef.current !== target) {
            setDragOverIdxSafe(target);
          }
        }

        autoScrollRafRef.current =
          typeof window.requestAnimationFrame === "function"
            ? window.requestAnimationFrame(step)
            : (setTimeout(step, 16) as unknown as number);
      };

      autoScrollRafRef.current =
        typeof window.requestAnimationFrame === "function"
          ? window.requestAnimationFrame(step)
          : (setTimeout(step, 16) as unknown as number);
    },
    [stopAutoScroll, setDragOverIdxSafe, resolveHoverTargetIndex]
  );

  const checkAutoScroll = React.useCallback(
    (clientY: number) => {
      if (typeof window === "undefined" || draggedIdxRef.current === null) return;
      lastClientYRef.current = clientY;

      const topZone = 120;
      const bottomZone = 140;
      const vh = window.innerHeight || 800;

      if (clientY < topZone) {
        const depth = Math.max(0, topZone - clientY);
        const ratio = Math.min(1, depth / topZone);
        const speed = -(8 + ratio * 20);
        startAutoScroll(speed);
      } else if (clientY > vh - bottomZone) {
        const depth = Math.max(0, clientY - (vh - bottomZone));
        const ratio = Math.min(1, depth / bottomZone);
        const speed = 8 + ratio * 20;
        startAutoScroll(speed);
      } else {
        stopAutoScroll();
      }
    },
    [startAutoScroll, stopAutoScroll]
  );

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
      stopAutoScroll();
      if (markJustDroppedTimerRef.current) {
        clearTimeout(markJustDroppedTimerRef.current);
      }
    };
  }, [stopAutoScroll]);

  const resetDragState = React.useCallback(() => {
    draggedIdxRef.current = null;
    dragOverIdxRef.current = null;
    isDraggingHandleRef.current = false;
    setDraggedIdx(null);
    setDragOverIdx(null);
    if (floatingPreviewRef.current) {
      floatingPreviewRef.current.style.setProperty("--drag-x", DRAG_PREVIEW_HIDDEN);
      floatingPreviewRef.current.style.setProperty("--drag-y", DRAG_PREVIEW_HIDDEN);
    }
    stopAutoScroll();
  }, [stopAutoScroll]);

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
      if (!activePlaylistId || isReorderingRef.current || Boolean(searchQuery?.trim()) || playlistSortMode !== "manual") return;
      if (fromIdx === toIdx) return;
      if (
        fromIdx < 0 ||
        fromIdx >= sortedPlaylistItems.length ||
        toIdx < 0 ||
        toIdx >= sortedPlaylistItems.length
      ) {
        return;
      }
      isReorderingRef.current = true;
      setIsReordering(true);
      try {
        const newItems = [...sortedPlaylistItems];
        const [moved] = newItems.splice(fromIdx, 1);
        newItems.splice(toIdx, 0, moved);
        const newIds = newItems.map((it) => it.id);
        await reorderPlaylist(activePlaylistId, newIds);
        if (virtualizerRef.current?.scrollToIndex && toIdx >= 0 && toIdx < sortedPlaylistItems.length) {
          virtualizerRef.current.scrollToIndex(toIdx, { align: "auto" });
        }
      } finally {
        isReorderingRef.current = false;
        setIsReordering(false);
      }
    },
    [activePlaylistId, searchQuery, sortedPlaylistItems, reorderPlaylist, playlistSortMode]
  );

  const handleDragStart = React.useCallback(
    (e: React.DragEvent, idx: number, name: string) => {
      if (!isDraggingHandleRef.current || playlistSortMode !== "manual") {
        e.preventDefault();
        return;
      }
      e.dataTransfer.setData("application/x-slice-playlist-index", String(idx));
      e.dataTransfer.setData("text/plain", name);
      e.dataTransfer.effectAllowed = "move";
      // Suppress native drag ghost so only the custom floating preview is visible
      try {
        if (e.dataTransfer.setDragImage) {
          const emptyImg = new Image();
          emptyImg.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
          e.dataTransfer.setDragImage(emptyImg, 0, 0);
        }
      } catch {
        // Fallback gracefully if setDragImage fails
      }
      draggedIdxRef.current = idx;
      setDraggedIdx(idx);
      updatePreviewPosition(e.clientX, e.clientY);
    },
    [playlistSortMode, updatePreviewPosition]
  );

  const handleDragOver = React.useCallback(
    (e: React.DragEvent, idx: number) => {
      const currentDraggedIdx = draggedIdxRef.current;
      if (currentDraggedIdx === null) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      checkAutoScroll(e.clientY);
      updatePreviewPosition(e.clientX, e.clientY);
      setDragOverIdxSafe((prev) => (prev !== idx ? idx : prev));
    },
    [checkAutoScroll, setDragOverIdxSafe, updatePreviewPosition]
  );

  const handleDragLeave = React.useCallback((_e: React.DragEvent) => {
    // Intentionally keep dragOverIdx sticky when crossing gaps between rows
  }, []);

  const handleDrop = React.useCallback(
    (e: React.DragEvent, targetIdx: number) => {
      e.preventDefault();
      e.stopPropagation();
      stopAutoScroll();
      const rawIdx = e.dataTransfer.getData("application/x-slice-playlist-index");
      const fromIdx = rawIdx ? parseInt(rawIdx, 10) : draggedIdxRef.current;
      if (fromIdx !== null && !isNaN(fromIdx) && fromIdx !== targetIdx) {
        commitReorder(fromIdx, targetIdx);
      }
      markJustDropped();
      resetDragState();
    },
    [commitReorder, markJustDropped, resetDragState, stopAutoScroll]
  );

  const handleDragEnd = React.useCallback(() => {
    stopAutoScroll();
    markJustDropped();
    resetDragState();
  }, [markJustDropped, resetDragState, stopAutoScroll]);

  // Window-level dragover and drop listeners to guarantee autoscroll and edge drops work smoothly
  React.useEffect(() => {
    if (draggedIdx === null) return;

    const handleGlobalDragOver = (e: DragEvent) => {
      if (draggedIdxRef.current === null) return;
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = "move";
      }
      checkAutoScroll(e.clientY);
      updatePreviewPosition(e.clientX, e.clientY);

      // If user drags horizontally outside the table (cancel intent), revert target to original dragged index
      if (tableContainerRef.current && typeof e.clientX === "number") {
        const rect = tableContainerRef.current.getBoundingClientRect();
        if (rect.width > 0 && (e.clientX < rect.left - 40 || e.clientX > rect.right + 40)) {
          if (dragOverIdxRef.current !== draggedIdxRef.current) {
            setDragOverIdxSafe(draggedIdxRef.current);
          }
          return;
        }
      }

      const target = resolveHoverTargetIndex(e.clientY, 30);
      if (target !== null && dragOverIdxRef.current !== target) {
        setDragOverIdxSafe(target);
      }
    };

    const handleGlobalDrop = (e: DragEvent) => {
      if (draggedIdxRef.current === null) return;
      e.preventDefault();
      if (tableContainerRef.current && typeof e.clientX === "number") {
        const rect = tableContainerRef.current.getBoundingClientRect();
        if (rect.width > 0 && (e.clientX < rect.left - 40 || e.clientX > rect.right + 40)) {
          stopAutoScroll();
          markJustDropped();
          resetDragState();
          return;
        }
      }
      const targetIdx = dragOverIdxRef.current ?? resolveHoverTargetIndex(e.clientY, 50);
      if (targetIdx !== null) {
        const rawIdx = e.dataTransfer?.getData("application/x-slice-playlist-index");
        const fromIdx = rawIdx ? parseInt(rawIdx, 10) : draggedIdxRef.current;
        if (fromIdx !== null && !isNaN(fromIdx) && fromIdx !== targetIdx) {
          commitReorder(fromIdx, targetIdx);
        }
      }
      stopAutoScroll();
      markJustDropped();
      resetDragState();
    };

    window.addEventListener("dragover", handleGlobalDragOver, { passive: false });
    window.addEventListener("drop", handleGlobalDrop);
    return () => {
      window.removeEventListener("dragover", handleGlobalDragOver);
      window.removeEventListener("drop", handleGlobalDrop);
      stopAutoScroll();
    };
  }, [
    draggedIdx,
    checkAutoScroll,
    commitReorder,
    markJustDropped,
    resetDragState,
    stopAutoScroll,
    setDragOverIdxSafe,
    updatePreviewPosition,
    resolveHoverTargetIndex,
  ]);

  const displayedItems = React.useMemo(() => {
    return searchItems(sortedPlaylistItems, searchQuery || "", (item) => ({
      title: item.segment?.name || item.track?.title,
      artist: item.track?.artist,
      segmentName: item.segment ? item.track?.title : undefined,
      createdAt: item.added_at,
    }));
  }, [sortedPlaylistItems, searchQuery]);

  const originalIdxMap = React.useMemo(() => {
    return new Map(sortedPlaylistItems.map((it, idx) => [it.id, idx]));
  }, [sortedPlaylistItems]);

  const handleMoveItem = React.useCallback(
    async (e: React.MouseEvent, itemIndex: number, direction: "up" | "down") => {
      e.stopPropagation();
      if (playlistSortMode !== "manual") return;
      const targetIdx = direction === "up" ? itemIndex - 1 : itemIndex + 1;
      await commitReorder(itemIndex, targetIdx);
    },
    [commitReorder, playlistSortMode]
  );

  const handlePlayPlaylistItem = React.useCallback(
    async (item: PlaylistItemWithDetails) => {
      const isReady = item.track?.status === "ready" && (item.track?.duration ?? 0) > 0;
      if (!isReady || !activePlaylistId) return;

      const store = usePlayerStore.getState();
      const isPlayingPlaylist = store.activePlaylistPlayingId !== null && store.activePlaylistPlayingId === activePlaylistId;
      const currentQItem = store.queue[store.queueIndex];
      const isSlice = Boolean(item.segment);
      const isActive =
        isPlayingPlaylist &&
        (currentQItem?.queueItemId
          ? currentQItem.queueItemId === item.id
          : (isSlice && item.segment
              ? store.activeSegment?.id === item.segment.id
              : store.activeSegment?.track_id === item.track?.id && !store.activeSegment?.id.startsWith("seg_")));

      if (isActive) {
        if (Date.now() - lastPlayInitiatedRef.current < 600) return;
        if (busyIdRef.current === item.id) return;
        busyIdRef.current = item.id;
        setTimeout(() => {
          if (busyIdRef.current === item.id) busyIdRef.current = null;
        }, 300);

        if (store.isPlaying) {
          store.pause();
        } else {
          await store.resume();
        }
        return;
      }

      if (busyIdRef.current === item.id) return;
      busyIdRef.current = item.id;
      lastPlayInitiatedRef.current = Date.now();
      try {
        if (searchQuery?.trim()) {
          await buildPlaylistQueue(activePlaylistId, false, item.id, false, {
            type: "search",
            query: searchQuery.trim(),
            count: displayedItems.length,
            playlistId: activePlaylistId,
          });
        } else {
          await playPlaylistItemAtIndex(activePlaylistId, item.id);
        }
      } finally {
        setTimeout(() => {
          if (busyIdRef.current === item.id) busyIdRef.current = null;
        }, 500);
      }
    },
    [activePlaylistId, playPlaylistItemAtIndex, buildPlaylistQueue, searchQuery, displayedItems.length]
  );

  const handlePlaySlice = React.useCallback(
    async (segment: Segment, track: Track) => {
      if (track.status !== "ready" || (track.duration ?? 0) <= 0) return;
      const store = usePlayerStore.getState();
      const isActive = store.activeSegment?.id === segment.id;

      if (isActive) {
        if (Date.now() - lastPlayInitiatedRef.current < 600) return;
        if (busyIdRef.current === segment.id) return;
        busyIdRef.current = segment.id;
        setTimeout(() => {
          if (busyIdRef.current === segment.id) busyIdRef.current = null;
        }, 300);

        if (store.isPlaying) {
          store.pause();
        } else {
          await store.resume();
        }
        return;
      }

      if (busyIdRef.current === segment.id) return;
      busyIdRef.current = segment.id;
      lastPlayInitiatedRef.current = Date.now();
      try {
        const customQueue = sliceItems
          ? sliceItems
              .filter((it) => it.track.status === "ready" && (it.track.duration ?? 0) > 0)
              .map((it) => createQueueItem(it.segment, it.track, it.id))
          : undefined;
        const customIndex = customQueue ? customQueue.findIndex((q) => q.segment.id === segment.id) : undefined;
        await playSegmentInMode(
          "slices_only",
          segment,
          track,
          customQueue,
          customIndex,
          searchQuery?.trim()
            ? {
                type: "search",
                query: searchQuery.trim(),
                count: customQueue ? customQueue.length : sliceItems?.length || 0,
                mode: "slices_only",
              }
            : { type: "system", mode: "slices_only" }
        );
      } finally {
        setTimeout(() => {
          if (busyIdRef.current === segment.id) busyIdRef.current = null;
        }, 500);
      }
    },
    [playSegmentInMode, sliceItems, searchQuery]
  );

  const handlePlayMixed = React.useCallback(
    async (item: MixedItem) => {
      if (item.track.status !== "ready" || item.track.duration <= 0) return;
      const isSlice = item.type === "slice";
      const itemId = isSlice ? item.segment.id : item.track.id;
      const store = usePlayerStore.getState();
      const isActive = isSlice
        ? store.activeSegment?.id === item.segment.id
        : store.activeTrack?.id === item.track.id && (!store.activeSegment || store.activeSegment.id.startsWith("fallback_"));

      if (isActive) {
        if (Date.now() - lastPlayInitiatedRef.current < 600) return;
        if (busyIdRef.current === itemId) return;
        busyIdRef.current = itemId;
        setTimeout(() => {
          if (busyIdRef.current === itemId) busyIdRef.current = null;
        }, 300);

        if (store.isPlaying) {
          store.pause();
        } else {
          await store.resume();
        }
        return;
      }

      if (busyIdRef.current === itemId) return;
      busyIdRef.current = itemId;
      lastPlayInitiatedRef.current = Date.now();
      try {
        const customQueue = mixedItems
          ? mixedItems
              .filter((it) => it.track.status === "ready" && (it.track.duration ?? 0) > 0)
              .map((it) =>
                it.type === "slice" && it.segment
                  ? createQueueItem(it.segment, it.track, it.id)
                  : createQueueItem(createDefaultFullSegment(it.track), it.track, it.id)
              )
          : undefined;
        const customIndex = customQueue
          ? customQueue.findIndex((q) => {
              if (isSlice && item.segment) {
                return q.segment.id === item.segment.id;
              }
              return q.track.id === item.track.id && q.segment.id.startsWith("fallback_");
            })
          : undefined;

        const isSearch = Boolean(searchQuery?.trim());
        const searchOrigin = isSearch
          ? {
              type: "search" as const,
              query: searchQuery.trim(),
              count: customQueue ? customQueue.length : mixedItems?.length || 0,
              mode: "mixed" as const,
            }
          : { type: "system" as const, mode: "mixed" as const };

        if (isSlice && item.segment) {
          await playSegmentInMode("mixed", item.segment, item.track, customQueue, customIndex, searchOrigin);
        } else {
          await playSegmentInMode("mixed", createDefaultFullSegment(item.track), item.track, customQueue, customIndex, searchOrigin);
        }
      } finally {
        setTimeout(() => {
          if (busyIdRef.current === itemId) busyIdRef.current = null;
        }, 500);
      }
    },
    [playSegmentInMode, mixedItems, searchQuery]
  );

  const handlePlayTrack = React.useCallback(
    async (track: Track) => {
      if (track.status !== "ready" || track.duration <= 0) return;

      const store = usePlayerStore.getState();
      const isActive = store.activeTrack?.id === track.id && (!store.activeSegment || store.activeSegment.id.startsWith("fallback_"));

      if (isActive) {
        if (Date.now() - lastPlayInitiatedRef.current < 600) return;
        if (busyIdRef.current === track.id) return;
        busyIdRef.current = track.id;
        setTimeout(() => {
          if (busyIdRef.current === track.id) busyIdRef.current = null;
        }, 300);

        if (store.isPlaying) {
          store.pause();
        } else {
          await store.resume();
        }
        return;
      }

      if (busyIdRef.current === track.id) return;
      busyIdRef.current = track.id;
      lastPlayInitiatedRef.current = Date.now();

      try {
        const targetMode = isPlaybackMode(activeSystemCategory) ? activeSystemCategory : playbackMode;
        const isSearch = Boolean(searchQuery?.trim());
        if (targetMode === "original_only") {
          const customQueue = filteredTracks
            ? filteredTracks
                .filter((t) => t.status === "ready" && (t.duration ?? 0) > 0)
                .map((t) => createQueueItem(createDefaultFullSegment(t), t, t.id))
            : undefined;
          const customIndex = customQueue ? customQueue.findIndex((q) => q.track.id === track.id) : undefined;
          const searchOrigin = isSearch
            ? {
                type: "search" as const,
                query: searchQuery.trim(),
                count: customQueue ? customQueue.length : filteredTracks?.length || 0,
                mode: targetMode,
              }
            : { type: "system" as const, mode: targetMode };
          await playSegmentInMode(targetMode, createDefaultFullSegment(track), track, customQueue, customIndex, searchOrigin);
          return;
        }
        if (targetMode === "mixed") {
          const customQueue = mixedItems
            ? mixedItems
                .filter((it) => it.track.status === "ready" && (it.track.duration ?? 0) > 0)
                .map((it) =>
                  it.type === "slice" && it.segment
                    ? createQueueItem(it.segment, it.track, it.id)
                    : createQueueItem(createDefaultFullSegment(it.track), it.track, it.id)
                )
            : undefined;
          const customIndex = customQueue
            ? customQueue.findIndex((q) => q.track.id === track.id && q.segment.id.startsWith("fallback_"))
            : undefined;
          const searchOrigin = isSearch
            ? {
                type: "search" as const,
                query: searchQuery.trim(),
                count: customQueue ? customQueue.length : mixedItems?.length || 0,
                mode: targetMode,
              }
            : { type: "system" as const, mode: targetMode };
          await playSegmentInMode(targetMode, createDefaultFullSegment(track), track, customQueue, customIndex, searchOrigin);
          return;
        }
        const modeQueue = store.queuesByMode[targetMode] || [];
        const modeTrackSlices = modeQueue
          .filter((it) => it.track.id === track.id && !it.segment.id.startsWith("fallback_"))
          .map((it) => it.segment);
        if (modeTrackSlices.length > 0) {
          await playSegmentInMode(targetMode, modeTrackSlices[0], track);
        } else if ((track.segment_count || 0) > 0) {
          try {
            const res = await fetch(`/api/tracks/${encodeURIComponent(track.id)}/segments`);
            const segs = res.ok ? await res.json() : [];
            if (Array.isArray(segs) && segs.length > 0) {
              await playSegmentInMode(targetMode, segs[0], track);
              return;
            }
          } catch (e) {
            console.error(e);
          }
          await playSegmentInMode(targetMode, createDefaultFullSegment(track), track);
        } else {
          await playSegmentInMode(targetMode, createDefaultFullSegment(track), track);
        }
      } finally {
        setTimeout(() => {
          if (busyIdRef.current === track.id) busyIdRef.current = null;
        }, 500);
      }
    },
    [activeSystemCategory, playbackMode, playSegmentInMode, filteredTracks, mixedItems, searchQuery]
  );

  const trackList = filteredTracks || [];

  const visiblePlaylistSelectedItems = React.useMemo<SelectedItem[]>(
    () => displayedItems.map((it) => createPlaylistItemSelectedItem(it, activePlaylistId)),
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
        ? sliceItems.map((it) => createSliceSelectedItem(it.segment, it.track.id))
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
              ? createSliceSelectedItem(it.segment, it.track.id)
              : createTrackSelectedItem(it.track)
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
        ? filteredTracks.map((trk) => createTrackSelectedItem(trk))
        : [],
    [filteredTracks]
  );
  const visibleTrackIds = React.useMemo(() => visibleTrackSelectedItems.map((t) => t.id), [visibleTrackSelectedItems]);
  const allTracksSelected = isAllVisibleSelected(selectedTrackIds, visibleTrackIds);
  const partiallyTracksSelected = isPartiallyVisibleSelected(selectedTrackIds, visibleTrackIds);

  const lastHandledScrollRequestIdRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    if (!activeTrackScrollRequest) return;
    if (lastHandledScrollRequestIdRef.current === activeTrackScrollRequest.id) return;
    if (Date.now() - activeTrackScrollRequest.timestamp > 2000) return;

    if (activeTrackScrollRequest.targetKey) {
      const currentViewKey = activePlaylistId ? `playlist:${activePlaylistId}` : `category:${activeSystemCategory}`;
      if (activeTrackScrollRequest.targetKey !== currentViewKey) return;
    }

    let activeIndex = -1;
    const isFallback = !activeSegment || activeSegment.id.startsWith("fallback_");

    if (mixedItems) {
      activeIndex = findActiveMixedItemIndex(mixedItems, {
        activeTrackId: activeTrack?.id,
        activeSegmentId: activeSegment?.id,
        isFallbackSegment: isFallback,
      });
    } else if (sliceItems) {
      activeIndex = findActiveSliceItemIndex(sliceItems, activeSegment?.id);
    } else if (filteredTracks) {
      activeIndex = findActiveTrackIndex(filteredTracks, activeTrack?.id, isFallback);
    } else {
      const currentQueueItemId = queueIndex >= 0 ? queue[queueIndex]?.queueItemId : undefined;
      activeIndex = findActivePlaylistItemIndex(displayedItems, {
        currentQueueItemId,
        activeTrackId: activeTrack?.id,
        activeSegmentId: activeSegment?.id,
        isFallbackSegment: isFallback,
      });
    }

    if (activeIndex >= 0) {
      if (virtualizerRef.current?.scrollToIndex) {
        lastHandledScrollRequestIdRef.current = activeTrackScrollRequest.id;
        const currentY = typeof window !== "undefined" ? window.scrollY || window.pageYOffset || 0 : 0;
        const estimatedRowHeight = PLAYLIST_ROW_HEIGHT;
        const estimatedTargetY = activeIndex * estimatedRowHeight;
        const distance = Math.abs(currentY - estimatedTargetY);
        const isClose = distance < (typeof window !== "undefined" ? window.innerHeight * 1.2 : 800);
        const prefersReduced =
          typeof window !== "undefined" &&
          typeof window.matchMedia === "function" &&
          window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const behavior = !prefersReduced && isClose && distance > 20 ? "smooth" : "auto";

        virtualizerRef.current.scrollToIndex(activeIndex, { align: "center", behavior });
        usePlayerStore.getState().clearActiveTrackScrollRequest();
      }
    }
  }, [
    activeTrackScrollRequest,
    activePlaylistId,
    activeSystemCategory,
    mixedItems,
    sliceItems,
    filteredTracks,
    displayedItems,
    activeTrack?.id,
    activeSegment?.id,
    queueIndex,
    queue,
  ]);

  // If in a custom playlist
  if (activePlaylistId) {
    if (activePlaylistItems.length === 0) {
      return (
        <EmptyState
          className="my-4"
          icon={Music}
          title={t("library.emptyPlaylistTitle")}
          description={t("library.emptyPlaylistDesc", { name: currentPlaylist?.name || "" })}
        />
      );
    }

    if (displayedItems.length === 0) {
      return (
        <EmptyState
          className="my-4"
          icon={Music}
          title={searchQuery?.trim() ? t("library.noResultsTitle") : t("table.emptyMixed")}
          description={searchQuery?.trim() ? t("library.noResultsDesc") : t("table.emptyFilterDesc")}
        />
      );
    }

    return (
      <div
        ref={tableContainerRef}
        className="@container w-full space-y-1"
        role="table"
        aria-label={t("nav.playlists")}
        aria-rowcount={displayedItems.length + 1}
        onDragOver={(e) => {
          if (playlistSortMode !== "manual" || draggedIdxRef.current === null) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          checkAutoScroll(e.clientY);
          updatePreviewPosition(e.clientX, e.clientY);
          const target = resolveHoverTargetIndex(e.clientY, 30);
          if (target !== null && dragOverIdxRef.current !== target) {
            setDragOverIdxSafe(target);
          }
        }}
        onDrop={(e) => {
          if (playlistSortMode !== "manual" || draggedIdxRef.current === null) return;
          e.preventDefault();
          e.stopPropagation();
          const targetIdx = dragOverIdxRef.current ?? resolveHoverTargetIndex(e.clientY, 50);
          if (targetIdx !== null) {
            handleDrop(e, targetIdx);
          } else {
            stopAutoScroll();
            resetDragState();
          }
        }}
      >
        {/* Table Header */}
        <div
          role="row"
          aria-rowindex={1}
          onDragOver={(e) => {
            if (playlistSortMode !== "manual" || draggedIdxRef.current === null) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            checkAutoScroll(e.clientY);
            if (dragOverIdxRef.current !== 0) {
              setDragOverIdxSafe(0);
            }
          }}
          onDrop={(e) => {
            if (playlistSortMode !== "manual" || draggedIdxRef.current === null) return;
            handleDrop(e, 0);
          }}
          className={cn(
            TABLE_HEADER_CLASS,
            PLAYLIST_GRID,
            "transition-colors",
            dragOverIdx === 0 && draggedIdx !== null && draggedIdx !== 0 && "border-primary bg-accent text-foreground ring-2 ring-primary/60"
          )}
        >
          <SelectAllCell
            hasRows={visiblePlaylistItemIds.length > 0}
            allSelected={allPlaylistItemsSelected}
            partiallySelected={partiallyPlaylistItemsSelected}
            onToggle={() => {
              if (allPlaylistItemsSelected) {
                deselectAllVisible(visiblePlaylistItemIds);
              } else {
                selectAllVisible(displayedItems.map((it) => createPlaylistItemSelectedItem(it, activePlaylistId)));
              }
            }}
          />
          <span role="columnheader">{t("table.trackOrSlice")}</span>
          <span role="columnheader" className="hidden @3xl:inline">{t("table.type")}</span>
          <span role="columnheader">{t("table.duration")}</span>
          <span role="columnheader" className="text-right max-sm:sr-only">{t("table.actions")}</span>
        </div>

        {/* Rows */}
        <VirtualizedTableBody
          items={displayedItems}
          getItemKey={getEntityId}
          draggedIdx={draggedIdx}
          virtualizerRef={virtualizerRef}
          initialScrollOffset={initialScrollOffset}
          renderRow={(item: PlaylistItemWithDetails, idx: number) => {
            const isSlice = Boolean(item.segment);
            const duration = isSlice && item.segment
              ? Math.max(0, item.segment.end_time - item.segment.start_time)
              : (item.track?.duration ?? 0);

            const currentQueueItem = queueIndex >= 0 ? queue[queueIndex] : null;
            const isThisPlaylistPlaying = activePlaylistPlayingId !== null && activePlaylistPlayingId === activePlaylistId;
            const isCurrentActive =
              isThisPlaylistPlaying &&
              (currentQueueItem?.queueItemId
                ? currentQueueItem.queueItemId === item.id
                : (isSlice && item.segment
                    ? activeSegment?.id === item.segment.id
                    : activeTrack?.id === item.track?.id && (!activeSegment || activeSegment.id.startsWith("fallback_"))));
            const isCurrentPlaying = isCurrentActive && isPlaying;

            const isSearching = Boolean(searchQuery?.trim());
            const isReady = item.track?.status === "ready" && (item.track?.duration ?? 0) > 0;
            const originalIdx = originalIdxMap.get(item.id) ?? -1;
            const isManualSort = playlistSortMode === "manual" && !isMixPlaylist;
            const canMoveUp = isManualSort && !isSearching && !isReordering && originalIdx > 0;
            const canMoveDown = isManualSort && !isSearching && !isReordering && originalIdx >= 0 && originalIdx < sortedPlaylistItems.length - 1;
            const showDragHandle = isManualSort && !isSearching && originalIdx >= 0;
            const canDrag = showDragHandle && !isReordering;
            const isDragging = isManualSort && draggedIdx === originalIdx;
            const isDragTarget = isManualSort && dragOverIdx === originalIdx && draggedIdx !== null && draggedIdx !== originalIdx;

            // FLIP shift animation for rows to smoothly move out of the way
            let shiftY = 0;
            if (
              draggedIdx !== null &&
              dragOverIdx !== null &&
              draggedIdx !== dragOverIdx &&
              originalIdx !== draggedIdx &&
              originalIdx >= 0
            ) {
              const rowShiftPx = PLAYLIST_ROW_HEIGHT;
              if (draggedIdx > dragOverIdx) {
                // Dragging UP: items from dragOverIdx to draggedIdx - 1 shift DOWN
                if (originalIdx >= dragOverIdx && originalIdx < draggedIdx) {
                  shiftY = rowShiftPx;
                }
              } else {
                // Dragging DOWN: items from draggedIdx + 1 to dragOverIdx shift UP
                if (originalIdx <= dragOverIdx && originalIdx > draggedIdx) {
                  shiftY = -rowShiftPx;
                }
              }
            }

            const isSelected = selectedTrackIds.has(item.id);

            const toggleSelected = (shiftKey: boolean) => toggleTrack(item.id, visiblePlaylistSelectedItems, shiftKey, createPlaylistItemSelectedItem(item, activePlaylistId));

            return (
              <div
                role="row"
                aria-rowindex={idx + 2}
                tabIndex={isSelectionActive || isReady ? 0 : -1}
                style={shiftY !== 0 ? { "--drag-shift": `${shiftY}px` } : undefined}
                aria-label={
                  isSelectionActive
                    ? (isSelected
                        ? t("trackCard.deselectTrack", { title: isSlice && item.segment ? item.segment.name : (item.track?.title || "") })
                        : t("trackCard.selectTrack", { title: isSlice && item.segment ? item.segment.name : (item.track?.title || "") }))
                    : isCurrentPlaying
                    ? (isSlice && item.segment
                        ? t("trackCard.pauseSliceTitle", { name: item.segment.name, defaultValue: `Pause ${item.segment.name}` })
                        : t("trackCard.pauseTitle", { title: item.track?.title || "", defaultValue: `Pause ${item.track?.title || ""}` }))
                    : (isSlice && item.segment
                        ? t("trackCard.playSliceTitle", { name: item.segment.name })
                        : t("trackCard.playTitle", { title: item.track?.title || "" }))
                }
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
                  handleDragLeave(e);
                }}
                onDrop={(e) => {
                  if (!canDrag) return;
                  handleDrop(e, originalIdx);
                }}
                onDragEnd={handleDragEnd}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    if (useSelectionStore.getState().selectedTrackIds.size > 0) {
                      toggleSelected(e.shiftKey);
                      return;
                    }
                    handlePlayPlaylistItem(item);
                  }
                }}
                onClick={(e) => {
                  if (justDroppedRef.current) return;
                  if (useSelectionStore.getState().selectedTrackIds.size > 0) {
                    toggleSelected(e.shiftKey);
                    return;
                  }
                  handlePlayPlaylistItem(item);
                }}
                aria-current={isCurrentPlaying ? "true" : undefined}
                className={cn(
                  tableRowClassName(PLAYLIST_GRID, {
                    index: idx,
                    isSelected,
                    isReady,
                    isCurrentPlaying,
                    isDragging,
                    isDragTarget,
                  }),
                  // FLIP: rows slide aside to open a gap under the dragged item
                  shiftY !== 0 && "translate-y-(--drag-shift)",
                  draggedIdx !== null && "transition duration-220 ease-standard"
                )}
              >
                {/* Index / Play indicator & Drag Handle */}
                <RowLeadingCell
                  index={idx}
                  title={isSlice && item.segment ? item.segment.name : (item.track?.title || "")}
                  isSelected={isSelected}
                  isSelectionActive={isSelectionActive}
                  isReady={isReady}
                  isCurrentPlaying={isCurrentPlaying}
                  onToggleSelected={toggleSelected}
                >
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
                      className={cn(
                        "shrink-0 rounded p-0.5 transition-colors select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none max-sm:hidden",
                        isReordering
                          ? "cursor-not-allowed opacity-30"
                          : "cursor-grab text-muted-foreground/40 hover:text-foreground active:cursor-grabbing"
                      )}
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
                      <GripVertical className="pointer-events-none size-4" />
                    </div>
                  )}
                </RowLeadingCell>

                {/* Title & Artist */}
                <div role="cell" className="flex min-w-0 items-center gap-3 pr-2">
                  <TableArtwork track={item.track} sliceColor={isSlice ? (item.segment?.color || DEFAULT_SLICE_COLOR) : undefined} />
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-foreground truncate group-hover:text-primary transition-colors">
                      {isSlice && item.segment ? item.segment.name : item.track?.title}
                    </div>
                    <div className="text-xs text-muted-foreground truncate mt-0.5">
                      {isSlice ? t("table.from", { title: item.track?.title }) : (item.track?.artist || t("table.unknownArtist"))}
                    </div>
                  </div>
                </div>

                {/* Kind Badge */}
                <div role="cell" className="hidden @3xl:flex items-center">
                  {isSlice && item.segment ? (
                    <Badge variant="yellow">
                      <Scissors data-icon="inline-start" />
                      <span className="font-mono">
                        {t("table.sliceBadge", {
                          start: formatDuration(item.segment.start_time),
                          end: formatDuration(item.segment.end_time),
                        })}
                      </span>
                    </Badge>
                  ) : (
                    <Badge variant="green">
                      <Disc data-icon="inline-start" />
                      <span>{t("table.fullTrack")}</span>
                    </Badge>
                  )}
                </div>

                {/* Duration */}
                <div role="cell" className="font-mono text-xs text-muted-foreground flex items-center gap-1.5">
                  <span>{formatDuration(duration)}</span>
                  {item.track?.status === "downloading" ? (
                    <Badge variant="outline">
                      <Spinner data-icon="inline-start" />
                      <span className="hidden sm:inline">{t("table.downloading")}</span>
                    </Badge>
                  ) : item.track?.status === "queued" ? (
                    <Badge variant="outline">
                      <Clock data-icon="inline-start" />
                      <span className="hidden sm:inline">{t("table.queued")}</span>
                    </Badge>
                  ) : item.track?.status === "error" ? (
                    <Badge variant="destructive">
                      <AlertCircle data-icon="inline-start" />
                      <span className="hidden sm:inline">{t("table.downloadError")}</span>
                    </Badge>
                  ) : null}
                </div>

                {/* Actions */}
                <div
                  role="cell"
                  className={cn(ROW_ACTIONS_CLASS, "gap-0.5")}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={stopRowPlayKeys}
                >
                  {showInlineRowActions && (
                    <>
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={!canMoveUp}
                        onClick={(e) => handleMoveItem(e, originalIdx, "up")}
                        title={isSearching ? t("table.disableSearchToReorder") : isReordering ? t("table.reordering") : t("table.moveUp")}
                        aria-label={isSearching ? t("table.disableSearchToReorder") : isReordering ? t("table.reordering") : t("table.moveUp")}
                      >
                        <ChevronUp />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={!canMoveDown}
                        onClick={(e) => handleMoveItem(e, originalIdx, "down")}
                        title={isSearching ? t("table.disableSearchToReorder") : isReordering ? t("table.reordering") : t("table.moveDown")}
                        aria-label={isSearching ? t("table.disableSearchToReorder") : isReordering ? t("table.reordering") : t("table.moveDown")}
                      >
                        <ChevronDown />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={!isReady || isReordering}
                        onClick={() => item.track && openSliceStudio(item.track)}
                        title={t("table.openStudio")}
                        aria-label={t("table.openStudio")}
                      >
                        <Scissors />
                      </Button>
                    </>
                  )}
                  <RowActionsMenu
                    name={item.segment ? item.segment.name : (item.track?.title || "")}
                    track={item.track}
                    segmentId={isSlice && item.segment ? item.segment.id : undefined}
                    canAddToPlaylist={isReady}
                    disabled={isReordering}
                    deleteLabel={t("table.removeFromPlaylist")}
                    onDelete={
                      isMixPlaylist
                        ? undefined
                        : () => {
                            const name = item.segment ? item.segment.name : (item.track?.title || "");
                            if (onDeletePlaylistItem) {
                              onDeletePlaylistItem(item.id, name);
                            } else {
                              setPlaylistItemToDelete({ id: item.id, name });
                            }
                          }
                    }
                  >
                    {!showInlineRowActions && (
                      <>
                        {!isSelectionActive && <SelectRowMenuItem onSelect={() => toggleSelected(false)} />}
                        <DropdownMenuItem disabled={!canMoveUp} onClick={(e) => handleMoveItem(e, originalIdx, "up")}>
                          <ChevronUp />
                          {t("table.moveUp")}
                        </DropdownMenuItem>
                        <DropdownMenuItem disabled={!canMoveDown} onClick={(e) => handleMoveItem(e, originalIdx, "down")}>
                          <ChevronDown />
                          {t("table.moveDown")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={!isReady || isReordering}
                          onClick={() => item.track && openSliceStudio(item.track)}
                        >
                          <Scissors />
                          {t("table.openStudio")}
                        </DropdownMenuItem>
                      </>
                    )}
                  </RowActionsMenu>
                </div>
              </div>
            );
          }}
        />
        {draggedIdx !== null && activePlaylistItems[draggedIdx] && (
          <div
            ref={floatingPreviewRef}
            data-slot="drag-preview"
            aria-hidden="true"
            className="pointer-events-none fixed top-0 left-0 z-50 flex max-w-sm translate-x-(--drag-x) translate-y-(--drag-y) rotate-2 scale-102 items-center gap-2.5 rounded-lg border border-primary/70 bg-card/95 px-3.5 py-2 text-xs font-medium text-foreground shadow-2xl ring-2 ring-primary/40 backdrop-blur-md select-none"
            style={{ "--drag-x": DRAG_PREVIEW_HIDDEN, "--drag-y": DRAG_PREVIEW_HIDDEN }}
          >
            <GripVertical className="size-3.5 shrink-0 text-primary" />
            <Music className="size-3.5 shrink-0 text-primary" />
            <span className="max-w-50 truncate font-semibold">
              {activePlaylistItems[draggedIdx].segment
                ? activePlaylistItems[draggedIdx].segment?.name
                : activePlaylistItems[draggedIdx].track?.title || t("table.track", "Bài hát")}
            </span>
            <Badge variant="outline" className="shrink-0">
              #{draggedIdx + 1}
            </Badge>
          </div>
        )}
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
        <EmptyState className="my-4" icon={Scissors} title={t("table.emptySlices")} description={t("table.emptyFilterDesc")} />
      );
    }

    return (
      <div
        className="@container w-full space-y-1"
        role="table"
        aria-label={t("table.slices")}
        aria-rowcount={sliceItems.length + 1}
      >
        {/* Table Header */}
        <div role="row" aria-rowindex={1} className={cn(TABLE_HEADER_CLASS, LIBRARY_GRID)}>
          <SelectAllCell
            hasRows={visibleSliceItemIds.length > 0}
            allSelected={allSliceItemsSelected}
            partiallySelected={partiallySliceItemsSelected}
            onToggle={() => {
              if (allSliceItemsSelected) {
                deselectAllVisible(visibleSliceItemIds);
              } else {
                selectAllVisible(visibleSliceSelectedItems);
              }
            }}
          />
          <span role="columnheader">{t("table.slices")}</span>
          <span role="columnheader" className="hidden @3xl:inline">{t("table.originalTrack")}</span>
          <span role="columnheader">{t("table.duration")}</span>
          <span role="columnheader" className="text-right max-sm:sr-only">{t("table.actions")}</span>
        </div>

        {/* Rows */}
        <VirtualizedTableBody
          items={sliceItems}
          getItemKey={getEntityId}
          virtualizerRef={virtualizerRef}
          initialScrollOffset={initialScrollOffset}
          renderRow={(item, idx) => {
            const isCurrentActive = activeSegment?.id === item.segment.id;
            const isCurrentPlaying = isPlaying && isCurrentActive;
            const duration = Math.max(0, item.segment.end_time - item.segment.start_time);
            const isReady = item.track?.status === "ready" && (item.track?.duration ?? 0) > 0;
            const isSelected = selectedTrackIds.has(item.segment.id);

            const toggleSelected = (shiftKey: boolean) => toggleTrack(item.segment.id, visibleSliceSelectedItems, shiftKey, createSliceSelectedItem(item.segment, item.track.id));

            return (
              <div
                role="row"
                aria-rowindex={idx + 2}
                tabIndex={isSelectionActive || isReady ? 0 : -1}
                aria-label={
                  isSelectionActive
                    ? (isSelected ? t("trackCard.deselectTrack", { title: item.segment.name }) : t("trackCard.selectTrack", { title: item.segment.name }))
                    : isCurrentPlaying
                    ? t("trackCard.pauseSliceTitle", { name: item.segment.name, defaultValue: `Pause ${item.segment.name}` })
                    : t("trackCard.playSliceTitle", { name: item.segment.name })
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    if (useSelectionStore.getState().selectedTrackIds.size > 0) {
                      toggleSelected(e.shiftKey);
                      return;
                    }
                    handlePlaySlice(item.segment, item.track);
                  }
                }}
                onClick={(e) => {
                  if (useSelectionStore.getState().selectedTrackIds.size > 0) {
                    toggleSelected(e.shiftKey);
                    return;
                  }
                  handlePlaySlice(item.segment, item.track);
                }}
                aria-current={isCurrentPlaying ? "true" : undefined}
                className={tableRowClassName(LIBRARY_GRID, {
                  index: idx,
                  isSelected,
                  isReady,
                  isCurrentPlaying,
                })}
              >
                {/* Index / Play icon */}
                <RowLeadingCell
                  index={idx}
                  title={item.segment.name}
                  isSelected={isSelected}
                  isSelectionActive={isSelectionActive}
                  isReady={isReady}
                  isCurrentPlaying={isCurrentPlaying}
                  onToggleSelected={toggleSelected}
                />

                {/* Title */}
                <div role="cell" className="flex min-w-0 items-center gap-3 pr-2">
                  <TableArtwork track={item.track} sliceColor={item.segment.color || DEFAULT_SLICE_COLOR} />
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-foreground truncate group-hover:text-primary transition-colors flex min-w-0 items-center gap-1.5">
                      <Scissors className="h-3.5 w-3.5 shrink-0 text-flexoki-yellow" />
                      <span className="truncate">{item.segment.name}</span>
                    </div>
                    {/* Stands in for the Original Track column until the table is wide enough to show it */}
                    <div className="text-xs text-muted-foreground truncate mt-0.5 @3xl:hidden">
                      {t("table.from", { title: item.track.title })}
                    </div>
                  </div>
                </div>

                {/* Original Track */}
                <div role="cell" className="hidden @3xl:block text-xs text-muted-foreground truncate pr-2">
                  {item.track.title}
                </div>

                {/* Duration */}
                <div role="cell" className="text-xs font-mono text-muted-foreground">
                  {formatDuration(duration)}
                </div>

                {/* Actions */}
                <div
                  role="cell"
                  className={cn(ROW_ACTIONS_CLASS, "gap-1")}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={stopRowPlayKeys}
                >
                  {showInlineRowActions && (
                    <Button
                      variant="ghost"
                      onClick={() => openSliceStudio(item.track)}
                      disabled={!isReady}
                      title={t("table.openStudio")}
                    >
                      <Scissors data-icon="inline-start" />
                      <span className="hidden md:inline">{t("table.studio")}</span>
                    </Button>
                  )}
                  <RowActionsMenu
                    name={item.segment.name}
                    track={item.track}
                    segmentId={item.segment.id}
                    canAddToPlaylist={isReady}
                    deleteLabel={t("table.deleteSlice", "Delete slice")}
                    onDelete={onDeleteSlice && (() => onDeleteSlice(item.segment.id))}
                  >
                    {!showInlineRowActions && (
                      <>
                        {!isSelectionActive && <SelectRowMenuItem onSelect={() => toggleSelected(false)} />}
                        <DropdownMenuItem disabled={!isReady} onClick={() => openSliceStudio(item.track)}>
                          <Scissors />
                          {t("table.openStudio")}
                        </DropdownMenuItem>
                      </>
                    )}
                  </RowActionsMenu>
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
        <EmptyState className="my-4" icon={Shuffle} title={t("table.emptyMixed")} description={t("table.emptyFilterDesc")} />
      );
    }

    return (
      <div
        className="@container w-full space-y-1"
        role="table"
        aria-label={t("categories.mixed")}
        aria-rowcount={mixedItems.length + 1}
      >
        {/* Table Header */}
        <div role="row" aria-rowindex={1} className={cn(TABLE_HEADER_CLASS, LIBRARY_GRID)}>
          <SelectAllCell
            hasRows={visibleMixedItemIds.length > 0}
            allSelected={allMixedItemsSelected}
            partiallySelected={partiallyMixedItemsSelected}
            onToggle={() => {
              if (allMixedItemsSelected) {
                deselectAllVisible(visibleMixedItemIds);
              } else {
                selectAllVisible(visibleMixedSelectedItems);
              }
            }}
          />
          <span role="columnheader">{t("table.trackOrSlice")}</span>
          <span role="columnheader" className="hidden @3xl:inline">{t("table.type")}</span>
          <span role="columnheader">{t("table.duration")}</span>
          <span role="columnheader" className="text-right max-sm:sr-only">{t("table.actions")}</span>
        </div>

        {/* Rows */}
        <VirtualizedTableBody
          items={mixedItems}
          getItemKey={getEntityId}
          virtualizerRef={virtualizerRef}
          initialScrollOffset={initialScrollOffset}
          renderRow={(item, idx) => {
            const isSlice = item.type === "slice";
            const entityId = isSlice ? item.segment.id : item.track.id;
            const isSelected = selectedTrackIds.has(entityId);
            const duration = isSlice
              ? Math.max(0, item.segment.end_time - item.segment.start_time)
              : item.track.duration;

            const isReady = item.track.status === "ready" && item.track.duration > 0;
            const isCurrentActive = isSlice
              ? activeSegment?.id === item.segment.id
              : activeTrack?.id === item.track.id && (!activeSegment || activeSegment.id.startsWith("fallback_"));
            const isCurrentPlaying = isPlaying && isCurrentActive;

            const toggleSelected = (shiftKey: boolean) => toggleTrack(entityId, visibleMixedSelectedItems, shiftKey, isSlice ? createSliceSelectedItem(item.segment, item.track.id) : createTrackSelectedItem(item.track));

            return (
              <div
                role="row"
                aria-rowindex={idx + 2}
                tabIndex={isSelectionActive || isReady ? 0 : -1}
                aria-label={
                  isSelectionActive
                    ? (isSelected
                        ? t("trackCard.deselectTrack", { title: isSlice ? item.segment.name : item.track.title })
                        : t("trackCard.selectTrack", { title: isSlice ? item.segment.name : item.track.title }))
                    : isCurrentPlaying
                    ? (isSlice
                        ? t("trackCard.pauseSliceTitle", { name: item.segment.name, defaultValue: `Pause ${item.segment.name}` })
                        : t("trackCard.pauseTitle", { title: item.track.title, defaultValue: `Pause ${item.track.title}` }))
                    : (isSlice
                        ? t("trackCard.playSliceTitle", { name: item.segment.name })
                        : t("trackCard.playTitle", { title: item.track.title }))
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    if (useSelectionStore.getState().selectedTrackIds.size > 0) {
                      toggleSelected(e.shiftKey);
                      return;
                    }
                    handlePlayMixed(item);
                  }
                }}
                onClick={(e) => {
                  if (useSelectionStore.getState().selectedTrackIds.size > 0) {
                    toggleSelected(e.shiftKey);
                    return;
                  }
                  handlePlayMixed(item);
                }}
                aria-current={isCurrentPlaying ? "true" : undefined}
                className={tableRowClassName(LIBRARY_GRID, {
                  index: idx,
                  isSelected,
                  isReady,
                  isCurrentPlaying,
                })}
              >
                {/* Index / Play indicator */}
                <RowLeadingCell
                  index={idx}
                  title={isSlice ? item.segment.name : item.track.title}
                  isSelected={isSelected}
                  isSelectionActive={isSelectionActive}
                  isReady={isReady}
                  isCurrentPlaying={isCurrentPlaying}
                  onToggleSelected={toggleSelected}
                />

                {/* Title & Artist */}
                <div role="cell" className="flex min-w-0 items-center gap-3 pr-2">
                  <TableArtwork track={item.track} sliceColor={isSlice ? (item.segment.color || DEFAULT_SLICE_COLOR) : undefined} />
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-foreground truncate group-hover:text-primary transition-colors flex items-center gap-1.5">
                      {isSlice && <Scissors className="h-3.5 w-3.5 shrink-0 text-flexoki-yellow" />}
                      <span className="truncate">{isSlice ? item.segment.name : item.track.title}</span>
                    </div>
                    <div className="text-xs text-muted-foreground truncate mt-0.5">
                      {isSlice ? t("table.from", { title: item.track.title }) : (item.track.artist || t("table.unknownArtist"))}
                    </div>
                  </div>
                </div>

                {/* Kind Badge */}
                <div role="cell" className="hidden @3xl:flex items-center">
                  {isSlice ? (
                    <Badge variant="yellow">
                      <Scissors data-icon="inline-start" />
                      <span className="font-mono">
                        {t("table.sliceBadge", {
                          start: formatDuration(item.segment.start_time),
                          end: formatDuration(item.segment.end_time),
                        })}
                      </span>
                    </Badge>
                  ) : (
                    <Badge variant="green">
                      <Disc data-icon="inline-start" />
                      <span>{t("table.fullTrack")}</span>
                    </Badge>
                  )}
                </div>

                {/* Duration */}
                <div role="cell" className="font-mono text-xs text-muted-foreground flex items-center gap-1.5">
                  <span>{formatDuration(duration)}</span>
                  {item.track.status === "downloading" ? (
                    <Badge variant="outline">
                      <Spinner data-icon="inline-start" />
                      <span className="hidden sm:inline">{t("table.downloading")}</span>
                    </Badge>
                  ) : item.track.status === "queued" ? (
                    <Badge variant="outline">
                      <Clock data-icon="inline-start" />
                      <span className="hidden sm:inline">{t("table.queued")}</span>
                    </Badge>
                  ) : item.track.status === "error" ? (
                    <Badge variant="destructive">
                      <AlertCircle data-icon="inline-start" />
                      <span className="hidden sm:inline">{t("table.downloadError")}</span>
                    </Badge>
                  ) : null}
                </div>

                {/* Actions */}
                <div
                  role="cell"
                  className={cn(ROW_ACTIONS_CLASS, "gap-1")}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={stopRowPlayKeys}
                >
                  {showInlineRowActions && (
                    <Button
                      variant="ghost"
                      onClick={() => openSliceStudio(item.track)}
                      disabled={!isReady}
                      title={t("table.openStudio")}
                    >
                      <Scissors data-icon="inline-start" />
                      <span className="hidden md:inline">{isSlice ? t("table.studio") : t("table.slice")}</span>
                    </Button>
                  )}
                  <RowActionsMenu
                    name={isSlice ? item.segment.name : item.track.title}
                    track={item.track}
                    segmentId={isSlice ? item.segment.id : undefined}
                    canAddToPlaylist={isReady}
                    deleteLabel={isSlice ? t("table.deleteSlice", "Delete slice") : t("table.deleteTrack")}
                    onDelete={
                      isSlice
                        ? onDeleteSlice && (() => onDeleteSlice(item.segment.id))
                        : onDeleteTrack && (() => onDeleteTrack(item.track.id))
                    }
                  >
                    {!showInlineRowActions && (
                      <>
                        {!isSelectionActive && <SelectRowMenuItem onSelect={() => toggleSelected(false)} />}
                        <DropdownMenuItem disabled={!isReady} onClick={() => openSliceStudio(item.track)}>
                          <Scissors />
                          {t("table.openStudio")}
                        </DropdownMenuItem>
                      </>
                    )}
                  </RowActionsMenu>
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
      <EmptyState className="my-4" icon={Music} title={t("table.emptyTracks")} />
    );
  }

  return (
    <div
      className="@container w-full space-y-1"
      role="table"
      aria-label={t("categories.tracks")}
      aria-rowcount={trackList.length + 1}
    >
      {/* Table Header */}
      <div role="row" aria-rowindex={1} className={cn(TABLE_HEADER_CLASS, TRACKS_GRID)}>
        <SelectAllCell
          hasRows={visibleTrackIds.length > 0}
          allSelected={allTracksSelected}
          partiallySelected={partiallyTracksSelected}
          onToggle={() => {
            if (allTracksSelected) {
              deselectAllVisible(visibleTrackIds);
            } else {
              selectAllVisible(visibleTrackSelectedItems);
            }
          }}
        />
        <span role="columnheader">{t("table.track")}</span>
        <span role="columnheader" className="hidden @3xl:inline">{t("table.slices")}</span>
        <span role="columnheader">{t("table.duration")}</span>
        <span role="columnheader" className="text-right max-sm:sr-only">{t("table.actions")}</span>
      </div>

      {/* Rows */}
      <VirtualizedTableBody
        items={trackList}
        getItemKey={getEntityId}
        virtualizerRef={virtualizerRef}
        initialScrollOffset={initialScrollOffset}
        renderRow={(track, idx) => {
          const isSelected = selectedTrackIds.has(track.id);
          const isCurrentActive =
            activeTrack?.id === track.id &&
            (!activeSegment || activeSegment.id.startsWith("fallback_"));
          const isCurrentPlaying = isCurrentActive && isPlaying;
          const isReady = track.status === "ready" && track.duration > 0;
          const isRetrying = Boolean(retryingTrackIds?.[track.id]);
          const rowAriaLabel = isSelectionActive
            ? (isSelected
                ? t("trackCard.deselectTrack", { title: track.title })
                : t("trackCard.selectTrack", { title: track.title }))
            : isCurrentPlaying
            ? t("trackCard.pauseTitle", { title: track.title, defaultValue: `Pause ${track.title}` })
            : isReady
            ? t("trackCard.playTitle", { title: track.title })
            : track.status === "downloading"
            ? `${t("trackCard.downloading")}: ${track.title}`
            : track.status === "queued"
            ? `${t("trackCard.inQueue")}: ${track.title}`
            : `${t("trackCard.error")}: ${track.title}`;

          const toggleSelected = (shiftKey: boolean) => toggleTrack(track.id, visibleTrackSelectedItems, shiftKey, createTrackSelectedItem(track));

          return (
            <div
              role="row"
              aria-rowindex={idx + 2}
              tabIndex={isSelectionActive || isReady ? 0 : -1}
              aria-label={rowAriaLabel}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  if (useSelectionStore.getState().selectedTrackIds.size > 0) {
                    toggleSelected(e.shiftKey);
                    return;
                  }
                  if (!isReady) return;
                  handlePlayTrack(track);
                }
              }}
              onClick={(e) => {
                if (useSelectionStore.getState().selectedTrackIds.size > 0) {
                  toggleSelected(e.shiftKey);
                  return;
                }
                if (!isReady) return;
                handlePlayTrack(track);
              }}
              aria-current={isCurrentPlaying ? "true" : undefined}
              className={tableRowClassName(TRACKS_GRID, {
                index: idx,
                isSelected,
                isReady,
                isCurrentPlaying,
              })}
            >
              {/* Index & Selection Checkbox */}
              <RowLeadingCell
                index={idx}
                title={track.title}
                isSelected={isSelected}
                isSelectionActive={isSelectionActive}
                isReady={isReady}
                isCurrentPlaying={isCurrentPlaying}
                onToggleSelected={toggleSelected}
              />

              {/* Title & Artist */}
              <div role="cell" className="flex min-w-0 items-center gap-3 pr-2">
                <TableArtwork track={track} />
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground truncate group-hover:text-primary transition-colors">
                    {track.title}
                  </div>
                  <div className="text-xs text-muted-foreground truncate mt-0.5">
                    {track.artist || t("table.unknownArtist")}
                  </div>
                  {track.status === "error" && track.error_message && (
                    <div className="text-2xs text-destructive/90 truncate mt-0.5" title={track.error_message}>
                      {track.error_message}
                    </div>
                  )}
                </div>
              </div>

              {/* Segment count */}
              <div role="cell" className="hidden @3xl:flex items-center">
                <Badge variant="secondary">
                  {t("table.slicesCountBadge", { count: track.segment_count || 0 })}
                </Badge>
              </div>

              {/* Duration */}
              <div role="cell" className="font-mono text-xs text-muted-foreground flex items-center gap-1.5">
                <span>{formatDuration(track.duration)}</span>
                {track.status === "downloading" ? (
                  <Badge variant="outline">
                    <Spinner data-icon="inline-start" />
                    <span className="hidden sm:inline">{t("table.downloading")}</span>
                  </Badge>
                ) : track.status === "queued" ? (
                  <Badge variant="outline">
                    <Clock data-icon="inline-start" />
                    <span className="hidden sm:inline">{t("table.queued")}</span>
                  </Badge>
                ) : track.status === "error" ? (
                  <Badge variant="destructive" title={track.error_message || t("trackCard.error")}>
                    <AlertCircle data-icon="inline-start" />
                    <span className="hidden sm:inline">{t("table.downloadError")}</span>
                  </Badge>
                ) : null}
              </div>

              {/* Actions */}
              <div
                role="cell"
                className={cn(ROW_ACTIONS_CLASS, "gap-1")}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={stopRowPlayKeys}
              >
                {showInlineRowActions &&
                  (track.status === "error" ? (
                    <Button
                      variant="destructive"
                      disabled={isRetrying}
                      onClick={() => void retryTrack(track.id)}
                      title={isRetrying ? t("table.retrying") : t("table.retry")}
                    >
                      <RotateCcw data-icon="inline-start" className={cn(isRetrying && "animate-spin")} />
                      <span className="hidden sm:inline">{isRetrying ? t("table.retrying") : t("table.retry")}</span>
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      onClick={() => openSliceStudio(track)}
                      disabled={!isReady}
                      title={t("table.openStudio")}
                    >
                      <Scissors data-icon="inline-start" />
                      <span className="hidden md:inline">{t("table.slice")}</span>
                    </Button>
                  ))}
                <RowActionsMenu
                  name={track.title}
                  track={track}
                  canAddToPlaylist={isReady}
                  deleteLabel={t("table.deleteTrack")}
                  onDelete={onDeleteTrack && (() => onDeleteTrack(track.id))}
                >
                  {!showInlineRowActions && (
                    <>
                      {!isSelectionActive && <SelectRowMenuItem onSelect={() => toggleSelected(false)} />}
                      {track.status === "error" ? (
                        <DropdownMenuItem disabled={isRetrying} onClick={() => void retryTrack(track.id)}>
                          <RotateCcw />
                          {isRetrying ? t("table.retrying") : t("table.retry")}
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem disabled={!isReady} onClick={() => openSliceStudio(track)}>
                          <Scissors />
                          {t("table.openStudio")}
                        </DropdownMenuItem>
                      )}
                    </>
                  )}
                </RowActionsMenu>
              </div>
            </div>
          );
        }}
      />
    </div>
  );
}
