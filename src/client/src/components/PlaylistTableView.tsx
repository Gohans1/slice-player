import * as React from "react";
import { useTranslation } from "react-i18next";
import { useWindowVirtualizer, defaultRangeExtractor, type Range, type Virtualizer } from "@tanstack/react-virtual";
import { Play, Pause, Trash2, Scissors, Music, Disc, ChevronUp, ChevronDown, Shuffle, Loader2, Clock, AlertCircle, RotateCcw, GripVertical, Check } from "lucide-react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { formatDuration, createDefaultFullSegment } from "../lib/utils";
import { searchItems } from "../lib/search";
import { usePlayerStore, isPlaybackMode } from "../store/usePlayerStore";
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
import { AddToPlaylistPopover } from "./AddToPlaylistPopover";
import { ConfirmModal } from "./ui/ConfirmModal";
import { NowPlayingEqualizer } from "./NowPlayingEqualizer";
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
const PLAYLIST_ROW_HEIGHT = 68;

interface VirtualizedTableBodyProps<T> {
  items: T[];
  getItemKey: (item: T, index: number) => string;
  renderRow: (item: T, index: number) => React.ReactNode;
  estimateRowHeight?: number;
  draggedIdx?: number | null;
  virtualizerRef?: React.MutableRefObject<Virtualizer<Window, Element> | null>;
}

function VirtualizedTableBody<T>({
  items,
  getItemKey,
  renderRow,
  estimateRowHeight = PLAYLIST_ROW_HEIGHT,
  draggedIdx,
  virtualizerRef,
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
  const isSelectionActive = useIsSelectionActive();
  const toggleTrack = useSelectionStore((s) => s.toggleTrack);
  const selectAllVisible = useSelectionStore((s) => s.selectAllVisible);
  const deselectAllVisible = useSelectionStore((s) => s.deselectAllVisible);

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
      floatingPreviewRef.current.style.transform = `translate3d(${clientX + 16}px, ${clientY - 20}px, 0) rotate(1.5deg) scale(1.02)`;
    }
  }, []);

  const resolveHoverTargetIndex = React.useCallback(
    (clientY: number, threshold = 30): number | null => {
      if (!tableContainerRef.current || activePlaylistItems.length === 0) return null;
      const rect = tableContainerRef.current.getBoundingClientRect();
      if (rect.height <= 0) return null;
      if (clientY <= rect.top + threshold) {
        return 0;
      }
      if (clientY >= rect.bottom - threshold) {
        return Math.max(0, activePlaylistItems.length - 1);
      }
      const offsetInTable = clientY - rect.top;
      const scrollMargin = virtualizerRef.current?.options?.scrollMargin ?? 0;
      const vItem = virtualizerRef.current?.getVirtualItemForOffset?.(offsetInTable + scrollMargin);
      if (
        vItem &&
        typeof vItem.index === "number" &&
        vItem.index >= 0 &&
        vItem.index < activePlaylistItems.length
      ) {
        return vItem.index;
      }
      return null;
    },
    [activePlaylistItems.length]
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
      floatingPreviewRef.current.style.transform = "translate3d(-9999px, -9999px, 0)";
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
        if (virtualizerRef.current?.scrollToIndex && toIdx >= 0 && toIdx < activePlaylistItems.length) {
          virtualizerRef.current.scrollToIndex(toIdx, { align: "auto" });
        }
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
    [updatePreviewPosition]
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

  const currentPlaylist = React.useMemo(() => {
    return playlists.find((p) => p.id === activePlaylistId);
  }, [playlists, activePlaylistId]);

  const displayedItems = React.useMemo(() => {
    return searchItems(activePlaylistItems, searchQuery || "", (item) => ({
      title: item.segment?.name || item.track?.title,
      artist: item.track?.artist,
      segmentName: item.segment ? item.track?.title : undefined,
      createdAt: item.added_at,
    }));
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
        await playPlaylistItemAtIndex(activePlaylistId, item.id);
      } finally {
        setTimeout(() => {
          if (busyIdRef.current === item.id) busyIdRef.current = null;
        }, 500);
      }
    },
    [activePlaylistId, playPlaylistItemAtIndex]
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
        await playSegmentInMode("slices_only", segment, track);
      } finally {
        setTimeout(() => {
          if (busyIdRef.current === segment.id) busyIdRef.current = null;
        }, 500);
      }
    },
    [playSegmentInMode]
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
        if (isSlice) {
          await playSegmentInMode("mixed", item.segment, item.track);
        } else {
          await playSegmentInMode("mixed", createDefaultFullSegment(item.track), item.track);
        }
      } finally {
        setTimeout(() => {
          if (busyIdRef.current === itemId) busyIdRef.current = null;
        }, 500);
      }
    },
    [playSegmentInMode]
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
        if (targetMode === "original_only" || targetMode === "mixed") {
          await playSegmentInMode(targetMode, createDefaultFullSegment(track), track);
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
    [activeSystemCategory, playbackMode, playSegmentInMode]
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

  // If in a custom playlist
  if (activePlaylistId) {
    if (activePlaylistItems.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border p-12 text-center bg-card/40 my-4 animate-in fade-in zoom-in-95 duration-150 ease-out motion-reduce:animate-none">
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
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border p-12 text-center bg-card/40 my-4 animate-in fade-in zoom-in-95 duration-150 ease-out motion-reduce:animate-none">
          <Music className="h-8 w-8 text-muted-foreground mb-2" />
          <h2 className="text-base font-semibold text-foreground">
            {searchQuery?.trim() ? t("library.noResultsTitle") : t("table.emptyMixed")}
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            {searchQuery?.trim() ? t("library.noResultsDesc") : t("table.emptyFilterDesc")}
          </p>
        </div>
      );
    }

    return (
      <div
        ref={tableContainerRef}
        className="w-full space-y-1"
        role="table"
        aria-label={t("nav.playlists")}
        aria-rowcount={displayedItems.length + 1}
        onDragOver={(e) => {
          if (draggedIdxRef.current === null) return;
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
          if (draggedIdxRef.current === null) return;
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
            if (draggedIdxRef.current === null) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            checkAutoScroll(e.clientY);
            if (dragOverIdxRef.current !== 0) {
              setDragOverIdxSafe(0);
            }
          }}
          onDrop={(e) => {
            if (draggedIdxRef.current === null) return;
            handleDrop(e, 0);
          }}
          className={`grid grid-cols-[72px_1fr_64px_124px] sm:grid-cols-[80px_1fr_180px_90px_130px] gap-x-3 sm:gap-x-4 items-center px-3 sm:px-4 py-2.5 text-xs font-semibold uppercase tracking-wider border-b transition-colors ${
            dragOverIdx === 0 && draggedIdx !== null && draggedIdx !== 0
              ? "border-primary ring-2 ring-primary/60 bg-accent/70 shadow-md text-foreground"
              : "border-border text-muted-foreground"
          }`}
        >
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
                    selectAllVisible(displayedItems.map((it) => createPlaylistItemSelectedItem(it, activePlaylistId)));
                  }
                }}
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-[background-color,border-color,color,transform] active:scale-90 motion-reduce:transform-none duration-100 cursor-pointer ${
                  allPlaylistItemsSelected || partiallyPlaylistItemsSelected
                    ? "bg-primary border-primary text-primary-foreground"
                    : "border-muted-foreground/50 hover:border-foreground"
                }`}
              >
                {allPlaylistItemsSelected && <Check className="h-3 w-3 stroke-[3] animate-in zoom-in-75 duration-100" />}
                {partiallyPlaylistItemsSelected && !allPlaylistItemsSelected && (
                  <div className="h-0.5 w-2 bg-primary-foreground rounded-full animate-in zoom-in-75 duration-100" />
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
          draggedIdx={draggedIdx}
          virtualizerRef={virtualizerRef}
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
                    : activeSegment?.track_id === item.track?.id && !activeSegment?.id.startsWith("seg_")));
            const isCurrentPlaying = isCurrentActive && isPlaying;

            const isSearching = Boolean(searchQuery?.trim());
            const isReady = item.track?.status === "ready" && (item.track?.duration ?? 0) > 0;
            const originalIdx = originalIdxMap.get(item.id) ?? -1;
            const canMoveUp = !isSearching && !isReordering && originalIdx > 0;
            const canMoveDown = !isSearching && !isReordering && originalIdx >= 0 && originalIdx < activePlaylistItems.length - 1;
            const showDragHandle = !isSearching && originalIdx >= 0;
            const canDrag = showDragHandle && !isReordering;
            const isDragging = draggedIdx === originalIdx;
            const isDragTarget = dragOverIdx === originalIdx && draggedIdx !== null && draggedIdx !== originalIdx;

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

            return (
              <div
                role="row"
                aria-rowindex={idx + 2}
                tabIndex={isSelectionActive || isReady ? 0 : -1}
                style={{
                  transform: shiftY !== 0 ? `translateY(${shiftY}px)` : undefined,
                  transition: draggedIdx !== null ? "transform 220ms cubic-bezier(0.2, 0, 0, 1), border-color 150ms ease, background-color 150ms ease" : undefined,
                  willChange: draggedIdx !== null ? "transform" : undefined,
                }}
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
                      toggleTrack(item.id, visiblePlaylistSelectedItems, e.shiftKey, createPlaylistItemSelectedItem(item, activePlaylistId));
                      return;
                    }
                    handlePlayPlaylistItem(item);
                  }
                }}
                onClick={(e) => {
                  if (justDroppedRef.current) return;
                  if (useSelectionStore.getState().selectedTrackIds.size > 0) {
                    toggleTrack(item.id, visiblePlaylistSelectedItems, e.shiftKey, createPlaylistItemSelectedItem(item, activePlaylistId));
                    return;
                  }
                  handlePlayPlaylistItem(item);
                }}
                className={`group grid grid-cols-[72px_1fr_64px_124px] sm:grid-cols-[80px_1fr_180px_90px_130px] gap-x-3 sm:gap-x-4 items-center px-3 sm:px-4 py-3 rounded-lg border transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/60 ${
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
                      toggleTrack(item.id, visiblePlaylistSelectedItems, e.shiftKey, createPlaylistItemSelectedItem(item, activePlaylistId));
                    }}
                    onKeyDown={(e) => {
                      if (e.key === " " || e.key === "Enter") {
                        e.stopPropagation();
                      }
                    }}
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-[background-color,border-color,color,transform,opacity] active:scale-90 motion-reduce:transform-none duration-100 cursor-pointer ${
                      isSelected
                        ? "bg-primary border-primary text-primary-foreground"
                        : "border-muted-foreground/40 hover:border-foreground opacity-0 group-hover:opacity-100 focus:opacity-100"
                    }`}
                  >
                    {isSelected && <Check className="h-3 w-3 stroke-[3] animate-in zoom-in-75 duration-100" />}
                  </button>
                  <span className={isSelected ? "hidden" : isReady ? "group-hover:hidden truncate" : "truncate"}>
                    {isCurrentPlaying ? (
                      <NowPlayingEqualizer className="text-primary" />
                    ) : (
                      String(idx + 1).padStart(2, "0")
                    )}
                  </span>
                  {isReady && !isSelected && (
                    isCurrentPlaying ? (
                      <Pause className="h-4 w-4 text-primary hidden group-hover:block fill-current shrink-0 animate-in zoom-in-75 duration-100 motion-reduce:animate-none" />
                    ) : (
                      <Play className="h-4 w-4 text-primary hidden group-hover:block fill-current shrink-0 animate-in zoom-in-75 duration-100 motion-reduce:animate-none" />
                    )
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
                    <Badge variant="yellow" className="text-2xs gap-1 font-mono">
                      <Scissors className="h-3 w-3" />
                      <span>
                        {t("table.sliceBadge", {
                          start: formatDuration(item.segment.start_time),
                          end: formatDuration(item.segment.end_time),
                        })}
                      </span>
                    </Badge>
                  ) : (
                    <Badge variant="green" className="text-2xs gap-1 font-mono">
                      <Disc className="h-3 w-3" />
                      <span>{t("table.fullTrack")}</span>
                    </Badge>
                  )}
                </div>

                {/* Duration */}
                <div role="cell" className="font-mono text-xs text-muted-foreground flex items-center gap-1.5">
                  <span>{formatDuration(duration)}</span>
                  {item.track?.status === "downloading" ? (
                    <Badge variant="outline" className="text-2xs text-primary border-primary/30 gap-1 py-0 px-1.5 font-normal">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      <span className="hidden sm:inline">{t("table.downloading")}</span>
                    </Badge>
                  ) : item.track?.status === "queued" ? (
                    <Badge variant="outline" className="text-2xs text-muted-foreground border-border gap-1 py-0 px-1.5 font-normal">
                      <Clock className="h-3 w-3 text-primary/80" />
                      <span className="hidden sm:inline">{t("table.queued")}</span>
                    </Badge>
                  ) : item.track?.status === "error" ? (
                    <Badge variant="destructive" className="text-2xs gap-1 py-0 px-1.5 font-normal">
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
        {draggedIdx !== null && activePlaylistItems[draggedIdx] && (
          <div
            ref={floatingPreviewRef}
            style={{
              position: "fixed",
              left: 0,
              top: 0,
              pointerEvents: "none",
              zIndex: 99999,
              willChange: "transform",
              transform: "translate3d(-9999px, -9999px, 0)",
            }}
            className="flex items-center gap-2.5 px-3.5 py-2 rounded-lg border border-primary/70 bg-card/95 backdrop-blur-md shadow-2xl text-xs font-medium text-foreground ring-2 ring-primary/40 select-none max-w-sm pointer-events-none transition-none"
          >
            <GripVertical className="h-3.5 w-3.5 text-primary shrink-0" />
            <Music className="h-3.5 w-3.5 text-primary shrink-0" />
            <span className="truncate max-w-[200px] font-semibold">
              {activePlaylistItems[draggedIdx].segment
                ? activePlaylistItems[draggedIdx].segment?.name
                : activePlaylistItems[draggedIdx].track?.title || t("table.track", "Bài hát")}
            </span>
            <Badge variant="outline" className="text-2xs py-0 px-1.5 font-mono border-primary/50 text-primary shrink-0">
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
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border p-12 text-center bg-card/40 my-4 animate-in fade-in zoom-in-95 duration-150 ease-out motion-reduce:animate-none">
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
                    selectAllVisible(visibleSliceSelectedItems);
                  }
                }}
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-[background-color,border-color,color,transform] active:scale-90 motion-reduce:transform-none duration-100 cursor-pointer ${
                  allSliceItemsSelected || partiallySliceItemsSelected
                    ? "bg-primary border-primary text-primary-foreground"
                    : "border-muted-foreground/50 hover:border-foreground"
                }`}
              >
                {allSliceItemsSelected && <Check className="h-3 w-3 stroke-[3] animate-in zoom-in-75 duration-100" />}
                {partiallySliceItemsSelected && !allSliceItemsSelected && (
                  <div className="h-0.5 w-2 bg-primary-foreground rounded-full animate-in zoom-in-75 duration-100" />
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
            const isCurrentActive = activeSegment?.id === item.segment.id;
            const isCurrentPlaying = isPlaying && isCurrentActive;
            const duration = Math.max(0, item.segment.end_time - item.segment.start_time);
            const isReady = item.track?.status === "ready" && (item.track?.duration ?? 0) > 0;
            const isSelected = selectedTrackIds.has(item.segment.id);

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
                      toggleTrack(item.segment.id, visibleSliceSelectedItems, e.shiftKey, createSliceSelectedItem(item.segment, item.track.id));
                      return;
                    }
                    handlePlaySlice(item.segment, item.track);
                  }
                }}
                onClick={(e) => {
                  if (useSelectionStore.getState().selectedTrackIds.size > 0) {
                    toggleTrack(item.segment.id, visibleSliceSelectedItems, e.shiftKey, createSliceSelectedItem(item.segment, item.track.id));
                    return;
                  }
                  handlePlaySlice(item.segment, item.track);
                }}
                className={`group grid grid-cols-[44px_1fr_64px_96px] sm:grid-cols-[56px_1fr_180px_90px_130px] gap-x-3 sm:gap-x-4 items-center px-3 sm:px-4 py-3 rounded-lg border transition-[border-color,background-color,box-shadow,opacity] duration-150 ${
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
                      toggleTrack(item.segment.id, visibleSliceSelectedItems, e.shiftKey, createSliceSelectedItem(item.segment, item.track.id));
                    }}
                    onKeyDown={(e) => {
                      if (e.key === " " || e.key === "Enter") {
                        e.stopPropagation();
                      }
                    }}
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-[background-color,border-color,color,transform,opacity] active:scale-90 motion-reduce:transform-none duration-100 cursor-pointer ${
                      isSelected
                        ? "bg-primary border-primary text-primary-foreground"
                        : "border-muted-foreground/40 hover:border-foreground opacity-0 group-hover:opacity-100 focus:opacity-100"
                    }`}
                  >
                    {isSelected && <Check className="h-3 w-3 stroke-[3] animate-in zoom-in-75 duration-100" />}
                  </button>
                  <span className={isSelected ? "hidden" : isReady ? "group-hover:hidden" : ""}>
                    {isCurrentPlaying ? (
                      <NowPlayingEqualizer className="text-primary" />
                    ) : (
                      String(idx + 1).padStart(2, "0")
                    )}
                  </span>
                  {isReady && !isSelected && (
                    isCurrentPlaying ? (
                      <Pause className="h-4 w-4 text-primary hidden group-hover:block fill-current shrink-0 animate-in zoom-in-75 duration-100 motion-reduce:animate-none" />
                    ) : (
                      <Play className="h-4 w-4 text-primary hidden group-hover:block fill-current shrink-0 animate-in zoom-in-75 duration-100 motion-reduce:animate-none" />
                    )
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
                    selectAllVisible(visibleMixedSelectedItems);
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
            const isCurrentActive = isSlice
              ? activeSegment?.id === item.segment.id
              : activeTrack?.id === item.track.id && (!activeSegment || activeSegment.id.startsWith("fallback_"));
            const isCurrentPlaying = isPlaying && isCurrentActive;

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
                      toggleTrack(
                        entityId,
                        visibleMixedSelectedItems,
                        e.shiftKey,
                        isSlice
                          ? createSliceSelectedItem(item.segment, item.track.id)
                          : createTrackSelectedItem(item.track)
                      );
                      return;
                    }
                    handlePlayMixed(item);
                  }
                }}
                onClick={(e) => {
                  if (useSelectionStore.getState().selectedTrackIds.size > 0) {
                    toggleTrack(
                      entityId,
                      visibleMixedSelectedItems,
                      e.shiftKey,
                      isSlice
                        ? createSliceSelectedItem(item.segment, item.track.id)
                        : createTrackSelectedItem(item.track)
                    );
                    return;
                  }
                  handlePlayMixed(item);
                }}
                className={`group grid grid-cols-[44px_1fr_64px_96px] sm:grid-cols-[56px_1fr_180px_90px_130px] gap-x-3 sm:gap-x-4 items-center px-3 sm:px-4 py-3 rounded-lg border transition-[border-color,background-color,box-shadow,opacity] duration-150 ${
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
                          ? createSliceSelectedItem(item.segment, item.track.id)
                          : createTrackSelectedItem(item.track)
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
                    {isCurrentPlaying ? (
                      <NowPlayingEqualizer className="text-primary" />
                    ) : (
                      String(idx + 1).padStart(2, "0")
                    )}
                  </span>
                  {isReady && !isSelected && (
                    isCurrentPlaying ? (
                      <Pause className="h-4 w-4 text-primary hidden group-hover:block fill-current shrink-0" />
                    ) : (
                      <Play className="h-4 w-4 text-primary hidden group-hover:block fill-current shrink-0" />
                    )
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
                    <Badge variant="yellow" className="text-2xs gap-1 font-mono">
                      <Scissors className="h-3 w-3" />
                      <span>
                        {t("table.sliceBadge", {
                          start: formatDuration(item.segment.start_time),
                          end: formatDuration(item.segment.end_time),
                        })}
                      </span>
                    </Badge>
                  ) : (
                    <Badge variant="green" className="text-2xs gap-1 font-mono">
                      <Disc className="h-3 w-3" />
                      <span>{t("table.fullTrack")}</span>
                    </Badge>
                  )}
                </div>

                {/* Duration */}
                <div role="cell" className="font-mono text-xs text-muted-foreground flex items-center gap-1.5">
                  <span>{formatDuration(duration)}</span>
                  {item.track.status === "downloading" ? (
                    <Badge variant="outline" className="text-2xs text-primary border-primary/30 gap-1 py-0 px-1.5 font-normal">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      <span className="hidden sm:inline">{t("table.downloading")}</span>
                    </Badge>
                  ) : item.track.status === "queued" ? (
                    <Badge variant="outline" className="text-2xs text-muted-foreground border-border gap-1 py-0 px-1.5 font-normal">
                      <Clock className="h-3 w-3 text-primary/80" />
                      <span className="hidden sm:inline">{t("table.queued")}</span>
                    </Badge>
                  ) : item.track.status === "error" ? (
                    <Badge variant="destructive" className="text-2xs gap-1 py-0 px-1.5 font-normal">
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
                    toggleTrack(track.id, visibleTrackSelectedItems, e.shiftKey, createTrackSelectedItem(track));
                    return;
                  }
                  if (!isReady) return;
                  handlePlayTrack(track);
                }
              }}
              onClick={(e) => {
                if (useSelectionStore.getState().selectedTrackIds.size > 0) {
                  toggleTrack(track.id, visibleTrackSelectedItems, e.shiftKey, createTrackSelectedItem(track));
                  return;
                }
                if (!isReady) return;
                handlePlayTrack(track);
              }}
              className={`group grid grid-cols-[44px_1fr_64px_96px] sm:grid-cols-[56px_1fr_160px_100px_130px] gap-x-3 sm:gap-x-4 items-center px-3 sm:px-4 py-3 rounded-lg border transition-[border-color,background-color,box-shadow,opacity] duration-150 ${
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
                    toggleTrack(track.id, visibleTrackSelectedItems, e.shiftKey, createTrackSelectedItem(track));
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
                  {isCurrentPlaying ? (
                    <NowPlayingEqualizer className="text-primary" />
                  ) : (
                    String(idx + 1).padStart(2, "0")
                  )}
                </span>
                {isReady && !isSelected && (
                  isCurrentPlaying ? (
                    <Pause className="h-4 w-4 text-primary hidden group-hover:block fill-current shrink-0" />
                  ) : (
                    <Play className="h-4 w-4 text-primary hidden group-hover:block fill-current shrink-0" />
                  )
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
                  <div className="text-2xs text-destructive/90 truncate mt-0.5" title={track.error_message}>
                    {track.error_message}
                  </div>
                )}
              </div>

              {/* Segment count */}
              <div role="cell" className="hidden sm:flex items-center">
                <Badge variant="secondary" className="text-2xs font-mono">
                  {t("table.slicesCountBadge", { count: track.segment_count || 0 })}
                </Badge>
              </div>

              {/* Duration */}
              <div role="cell" className="font-mono text-xs text-muted-foreground flex items-center gap-1.5">
                <span>{formatDuration(track.duration)}</span>
                {track.status === "downloading" ? (
                  <Badge variant="outline" className="text-2xs text-primary border-primary/30 gap-1 py-0 px-1.5 font-normal">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    <span className="hidden sm:inline">{t("table.downloading")}</span>
                  </Badge>
                ) : track.status === "queued" ? (
                  <Badge variant="outline" className="text-2xs text-muted-foreground border-border gap-1 py-0 px-1.5 font-normal">
                    <Clock className="h-3 w-3 text-primary/80" />
                    <span className="hidden sm:inline">{t("table.queued")}</span>
                  </Badge>
                ) : track.status === "error" ? (
                  <Badge variant="destructive" className="text-2xs gap-1 py-0 px-1.5 font-normal" title={track.error_message || t("trackCard.error")}>
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
