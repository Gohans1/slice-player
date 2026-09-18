import * as React from "react";
import { X, Play, Shuffle, RotateCcw, Music, Trash2, GripVertical, ChevronUp, ChevronDown, Scissors, Disc, Folder, Repeat } from "lucide-react";
import { useVirtualizer, defaultRangeExtractor, type Range } from "@tanstack/react-virtual";
import { useTranslation } from "react-i18next";
import { Button } from "./ui/button";
import { formatDuration } from "../lib/utils";
import { TrackThumbnail } from "./TrackThumbnail";
import { usePlayerStore, type QueueItem } from "../store/usePlayerStore";

interface QueueDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export function getBoundaryDropIndex(
  clientY: number,
  container: HTMLDivElement | null,
  totalItems: number,
  listRect?: DOMRect | null,
  totalHeight?: number
): number | null {
  if (!container || totalItems <= 0) return null;
  const rect = listRect || container.getBoundingClientRect();
  if (clientY < rect.top || clientY > rect.bottom) {
    return null;
  }
  if (clientY <= rect.top + 20 && container.scrollTop === 0) {
    return 0;
  }
  const isScrolledToBottom =
    container.scrollTop + container.clientHeight >= container.scrollHeight - 10;

  const contentBottom =
    typeof totalHeight === "number"
      ? rect.top - container.scrollTop + totalHeight
      : (container.firstElementChild as HTMLElement | null)?.getBoundingClientRect().bottom;

  if (
    (contentBottom !== undefined && clientY > contentBottom) ||
    (clientY >= rect.bottom - 20 && isScrolledToBottom)
  ) {
    return totalItems - 1;
  }
  return null;
}

interface QueueItemRowProps {
  item: QueueItem;
  idx: number;
  totalItems: number;
  isCurrent: boolean;
  isDragging: boolean;
  isDragTarget: boolean;
  onDragStart: (e: React.DragEvent, idx: number, name: string) => void;
  onDragOver: (e: React.DragEvent, idx: number) => void;
  onDrop: (e: React.DragEvent, idx: number) => void;
  onDragEnd: () => void;
  onPlay: (item: QueueItem, idx: number) => void;
  onRemove: (idx: number) => void;
  onReorder: (fromIdx: number, toIdx: number) => void;
  onAnnouncement: (msg: string) => void;
  onHandleMouseDown: () => void;
}

const QueueItemRow = React.memo(function QueueItemRow({
  item,
  idx,
  totalItems,
  isCurrent,
  isDragging,
  isDragTarget,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onPlay,
  onRemove,
  onReorder,
  onAnnouncement,
  onHandleMouseDown,
}: QueueItemRowProps) {
  const { t } = useTranslation();
  const segDuration = item.segment.end_time - item.segment.start_time;
  const isSlice = !item.segment.id.startsWith("fallback_");
  const itemName = isSlice ? item.segment.name : item.track.title;
  const artistText = item.track.artist?.trim() || "";
  const playAriaTitle = isSlice
    ? `${item.segment.name} - ${item.track.title}`
    : (artistText ? `${item.track.title} - ${artistText}` : item.track.title);

  return (
    <div
      draggable={true}
      onDragStart={(e) => onDragStart(e, idx, itemName)}
      onDragOver={(e) => onDragOver(e, idx)}
      onDrop={(e) => onDrop(e, idx)}
      onDragEnd={onDragEnd}
      className={`group flex items-center justify-between gap-2.5 p-2.5 rounded-lg border select-none transition-colors ${
        isDragging
          ? "opacity-40 border-dashed border-primary/60"
          : isDragTarget
          ? "border-primary ring-2 ring-primary/60 bg-accent/70 shadow-md"
          : isCurrent
          ? "border-primary bg-primary/10 shadow-sm"
          : "border-border/50 bg-background/50 hover:bg-accent/40 hover:border-border"
      }`}
    >
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <div
          data-drag-handle="true"
          role="button"
          tabIndex={0}
          aria-label={t("queue.dragHandleAria", { name: itemName, position: idx + 1, total: totalItems, defaultValue: `Reorder ${itemName}, position ${idx + 1} of ${totalItems}` })}
          aria-keyshortcuts="ArrowUp ArrowDown Home End"
          aria-description={t("queue.dragHandleDesc", "Press Up/Down arrow or Home/End to change position in queue")}
          className="cursor-grab active:cursor-grabbing p-0.5 text-muted-foreground/40 hover:text-foreground shrink-0 transition-colors focus:outline-none focus:ring-1 focus:ring-primary rounded"
          title={t("queue.dragHandleTitle", "Drag or press Up/Down arrows, Home/End to reorder")}
          onMouseDown={(e) => {
            if (e.button === 0) onHandleMouseDown();
          }}
          onPointerDown={(e) => {
            if (e.button === 0) onHandleMouseDown();
          }}
          onKeyDown={(e) => {
            const currentEl = e.currentTarget.closest<HTMLElement>("[data-index]");
            const rawIdx = currentEl ? Number(currentEl.getAttribute("data-index")) : idx;
            const effectiveIdx = !isNaN(rawIdx) ? rawIdx : idx;
            if (e.key === "ArrowUp" && effectiveIdx > 0) {
              e.preventDefault();
              e.stopPropagation();
              onReorder(effectiveIdx, effectiveIdx - 1);
            } else if (e.key === "ArrowDown" && effectiveIdx < totalItems - 1) {
              e.preventDefault();
              e.stopPropagation();
              onReorder(effectiveIdx, effectiveIdx + 1);
            } else if (e.key === "Home" && effectiveIdx > 0) {
              e.preventDefault();
              e.stopPropagation();
              onReorder(effectiveIdx, 0);
            } else if (e.key === "End" && effectiveIdx < totalItems - 1) {
              e.preventDefault();
              e.stopPropagation();
              onReorder(effectiveIdx, totalItems - 1);
            } else if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              onAnnouncement(t("queue.dragHandleSelectedAnnouncement", { name: itemName, position: effectiveIdx + 1, total: totalItems, defaultValue: `Selected ${itemName}, position ${effectiveIdx + 1} of ${totalItems}. Press Up or Down arrow to reorder.` }));
            }
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="h-4 w-4 pointer-events-none" />
        </div>

        {/* Mobile & Touchscreen reorder buttons */}
        <div className="flex flex-col [@media(pointer:fine)]:sm:hidden gap-0.5 shrink-0">
          <button
            type="button"
            data-action="move-up"
            disabled={idx === 0}
            onClick={(e) => {
              e.stopPropagation();
              onReorder(idx, idx - 1);
            }}
            className="p-1 rounded disabled:opacity-20 text-muted-foreground hover:text-foreground hover:bg-accent flex items-center justify-center min-h-[24px] min-w-[24px] focus-visible:ring-1 focus-visible:ring-primary focus:outline-none"
            title={t("queue.moveUp", "Move up")}
            aria-label={t("queue.moveUp", "Move up")}
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            data-action="move-down"
            disabled={idx === totalItems - 1}
            onClick={(e) => {
              e.stopPropagation();
              onReorder(idx, idx + 1);
            }}
            className="p-1 rounded disabled:opacity-20 text-muted-foreground hover:text-foreground hover:bg-accent flex items-center justify-center min-h-[24px] min-w-[24px] focus-visible:ring-1 focus-visible:ring-primary focus:outline-none"
            title={t("queue.moveDown", "Move down")}
            aria-label={t("queue.moveDown", "Move down")}
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Primary Clickable Play Area (no nested interactive elements inside) */}
        <div
          tabIndex={0}
          role="button"
          data-action="play"
          aria-label={t("trackCard.playTitle", { title: playAriaTitle, defaultValue: `Play ${playAriaTitle}` })}
          onClick={() => onPlay(item, idx)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onPlay(item, idx);
            }
          }}
          className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary rounded p-1 -m-1"
        >
          <div className="relative h-9 w-9 rounded overflow-hidden bg-muted shrink-0 border border-border">
            <TrackThumbnail
              src={item.track.thumbnail_url}
              alt={item.track.title}
              className="h-full w-full object-cover select-none pointer-events-none"
              fallback={
                <div className="flex h-full w-full items-center justify-center text-xs font-mono select-none">
                  {idx + 1}
                </div>
              }
            />
            <div
              className="absolute bottom-0 left-0 right-0 h-0.5"
              style={{ backgroundColor: item.segment.color || "#4385BE" }}
            />
          </div>

          <div className="min-w-0 flex-1">
            {isSlice ? (
              <>
                <div className="flex items-center gap-1.5 min-w-0">
                  <span
                    className={`text-xs font-medium truncate ${
                      isCurrent ? "text-primary font-semibold" : "text-foreground"
                    }`}
                    title={item.segment.name}
                  >
                    {item.segment.name}
                  </span>
                  <span
                    className="text-[10px] font-mono text-muted-foreground shrink-0 select-none"
                    title={`${formatDuration(item.segment.start_time)} - ${formatDuration(item.segment.end_time)}`}
                  >
                    [{formatDuration(item.segment.start_time)} - {formatDuration(item.segment.end_time)}]
                  </span>
                </div>
                <p
                  className="text-[11px] text-muted-foreground truncate"
                  title={artistText ? `${item.track.title} • ${artistText}` : item.track.title}
                >
                  {artistText ? `${item.track.title} • ${artistText}` : item.track.title}
                </p>
              </>
            ) : (
              <>
                <p
                  className={`text-xs font-medium truncate ${
                    isCurrent ? "text-primary font-semibold" : "text-foreground"
                  }`}
                  title={item.track.title}
                >
                  {item.track.title}
                </p>
                <p
                  className="text-[11px] text-muted-foreground truncate"
                  title={artistText || t("table.unknownArtist", "Unknown Artist")}
                >
                  {artistText || t("table.unknownArtist", "Unknown Artist")}
                </p>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        <span className="font-mono text-[10px] text-muted-foreground">
          {formatDuration(segDuration)}
        </span>
        <button
          type="button"
          data-action="remove"
          onClick={(e) => {
            e.stopPropagation();
            onRemove(idx);
          }}
          className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 focus-visible:ring-1 focus-visible:ring-destructive focus:outline-none p-1 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-all"
          title={t("queue.remove", "Remove from queue")}
          aria-label={t("queue.remove", "Remove from queue")}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
        <div
          aria-hidden="true"
          className="opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none p-0.5 rounded text-primary"
        >
          <Play className="h-3.5 w-3.5 fill-current text-primary" />
        </div>
      </div>
    </div>
  );
});

const ESTIMATED_ITEM_HEIGHT = 62;
const INITIAL_DRAWER_RECT = { width: 384, height: 600 };
const estimateItemSize = () => ESTIMATED_ITEM_HEIGHT;

const safeRaf = (cb: FrameRequestCallback): number => {
  if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
    return window.requestAnimationFrame(cb);
  }
  return setTimeout(cb, 16) as unknown as number;
};

const safeCancelRaf = (handle: number | null) => {
  if (handle === null) return;
  if (typeof window !== "undefined" && typeof window.cancelAnimationFrame === "function") {
    window.cancelAnimationFrame(handle);
  } else {
    clearTimeout(handle);
  }
};

function QueueDrawerContent({ isOpen, onClose }: QueueDrawerProps) {
  const { t } = useTranslation();
  const queue = usePlayerStore((s) => s.queue);
  const queueIndex = usePlayerStore((s) => s.queueIndex);
  const activeSegment = usePlayerStore((s) => s.activeSegment);
  const activeTrack = usePlayerStore((s) => s.activeTrack);
  const playSegment = usePlayerStore((s) => s.playSegment);
  const removeQueueItemAtIndex = usePlayerStore((s) => s.removeQueueItemAtIndex);
  const reorderQueue = usePlayerStore((s) => s.reorderQueue);
  const playbackMode = usePlayerStore((s) => s.playbackMode);
  const activePlaylistPlayingId = usePlayerStore((s) => s.activePlaylistPlayingId);
  const activePlaylistPlayingName = usePlayerStore((s) => {
    if (!s.activePlaylistPlayingId) return null;
    return s.playlists.find((p) => p.id === s.activePlaylistPlayingId)?.name ?? null;
  });
  const reshuffleCurrentQueue = usePlayerStore((s) => s.reshuffleCurrentQueue);
  const isShuffle = usePlayerStore((s) => s.isShuffle);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const isLoopQueue = usePlayerStore((s) => s.isLoopQueue);
  const toggleLoopQueue = usePlayerStore((s) => s.toggleLoopQueue);
  const isPlaying = usePlayerStore((s) => s.isPlaying);

  const [draggedIdx, setDraggedIdx] = React.useState<number | null>(null);
  const draggedIdxRef = React.useRef<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = React.useState<number | null>(null);
  const [liveAnnouncement, setLiveAnnouncement] = React.useState("");
  const isDraggingHandleRef = React.useRef(false);
  const justDroppedRef = React.useRef(false);
  const dropTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const drawerRef = React.useRef<HTMLDivElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const listRectRef = React.useRef<DOMRect | null>(null);
  const shuffleBtnRef = React.useRef<HTMLButtonElement>(null);

  const autoScrollRafRef = React.useRef<number | null>(null);
  const scrollSpeedRef = React.useRef<number>(0);

  const stopAutoScroll = React.useCallback(() => {
    if (autoScrollRafRef.current !== null) {
      safeCancelRaf(autoScrollRafRef.current);
      autoScrollRafRef.current = null;
    }
    scrollSpeedRef.current = 0;
  }, []);

  const startAutoScroll = React.useCallback((speed: number) => {
    scrollSpeedRef.current = speed;
    if (!listRef.current) return;
    const atTop = speed < 0 && listRef.current.scrollTop <= 0;
    const atBottom =
      speed > 0 &&
      listRef.current.scrollTop + listRef.current.clientHeight >= listRef.current.scrollHeight - 1;
    if (atTop || atBottom) {
      stopAutoScroll();
      return;
    }
    if (autoScrollRafRef.current !== null) return;

    let lastTime = performance.now();
    const step = (now: number) => {
      if (!listRef.current || scrollSpeedRef.current === 0) {
        autoScrollRafRef.current = null;
        return;
      }
      const currentNow = typeof now === "number" && !isNaN(now) ? now : performance.now();
      const dt = Math.min((currentNow - lastTime) / 1000, 0.1);
      lastTime = currentNow;
      const prev = listRef.current.scrollTop;
      listRef.current.scrollTop += scrollSpeedRef.current * dt * 60;
      const atTop = scrollSpeedRef.current < 0 && listRef.current.scrollTop <= 0;
      const atBottom =
        scrollSpeedRef.current > 0 &&
        listRef.current.scrollTop + listRef.current.clientHeight >= listRef.current.scrollHeight - 1;
      if (atTop || atBottom || (Math.abs(scrollSpeedRef.current * dt * 60) >= 1 && listRef.current.scrollTop === prev)) {
        stopAutoScroll();
        return;
      }
      autoScrollRafRef.current = safeRaf(step);
    };
    autoScrollRafRef.current = safeRaf(step);
  }, [stopAutoScroll]);

  React.useEffect(() => {
    return () => {
      stopAutoScroll();
      safeCancelRaf(restoreRafRef.current);
      safeCancelRaf(shuffleScrollRafRef.current);
      if (dropTimeoutRef.current) {
        clearTimeout(dropTimeoutRef.current);
      }
    };
  }, [stopAutoScroll]);

  const displayQueue = queue;

  const playingPlaylistName = React.useMemo(() => {
    if (activePlaylistPlayingId) {
      return activePlaylistPlayingName || t("playlist.customHeader", "Playlists");
    }
    if (playbackMode === "slices_only") return t("categories.slices", "Slices");
    if (playbackMode === "original_only") return t("categories.tracks", "Tracks");
    return t("categories.mixed", "Mix");
  }, [activePlaylistPlayingId, activePlaylistPlayingName, playbackMode, t]);

  // Keep actively dragged item mounted in the DOM to prevent HTML5 Drag & Drop from aborting on auto-scroll
  const rangeExtractor = React.useCallback(
    (range: Range) => {
      const active = defaultRangeExtractor(range);
      if (
        draggedIdx !== null &&
        draggedIdx >= 0 &&
        draggedIdx < displayQueue.length &&
        !active.includes(draggedIdx)
      ) {
        active.push(draggedIdx);
        active.sort((a, b) => a - b);
      }
      return active;
    },
    [displayQueue.length, draggedIdx]
  );

  // Memoized element observer providing non-blocking geometry and headless fallback
  const observeElementRect = React.useCallback(
    (
      instance: { scrollElement: HTMLDivElement | null },
      cb: (rect: { width: number; height: number }) => void
    ) => {
      const el = instance.scrollElement;
      if (!el) return () => {};
      let rafId: number | null = null;
      const update = () => {
        const r = el.getBoundingClientRect();
        cb({
          width: r.width > 0 ? r.width : 384,
          height: r.height > 0 ? r.height : 600,
        });
      };
      update();
      if (typeof ResizeObserver !== "undefined") {
        const observer = new ResizeObserver((entries) => {
          if (rafId !== null) safeCancelRaf(rafId);
          rafId = safeRaf(() => {
            rafId = null;
            const entry = entries[0];
            if (entry) {
              const borderBox = entry.borderBoxSize?.[0];
              const width = borderBox ? borderBox.inlineSize : entry.contentRect?.width;
              const height = borderBox ? borderBox.blockSize : entry.contentRect?.height;
              cb({
                width: width && width > 0 ? Math.round(width) : 384,
                height: height && height > 0 ? Math.round(height) : 600,
              });
            } else {
              update();
            }
          });
        });
        observer.observe(el, { box: "border-box" });
        return () => {
          if (rafId !== null) safeCancelRaf(rafId);
          observer.disconnect();
        };
      }
      return () => {};
    },
    []
  );

  const displayQueueRef = React.useRef(displayQueue);
  const rowVirtualizerRef = React.useRef<ReturnType<typeof useVirtualizer<HTMLDivElement, HTMLElement>> | null>(null);

  const itemKeyMapRef = React.useRef(new WeakMap<QueueItem, string>());
  const idSeqRef = React.useRef(0);
  const restoreRafRef = React.useRef<number | null>(null);
  const shuffleScrollRafRef = React.useRef<number | null>(null);

  const itemKeys = React.useMemo(() => {
    if (!isOpen) return [];
    const usedKeys = new Set<string>();
    return displayQueue.map((item) => {
      let rawKey = item.queueItemId;
      if (!rawKey) {
        let cached = itemKeyMapRef.current.get(item);
        if (!cached) {
          cached = `${item.segment?.id || "seg"}_${++idSeqRef.current}`;
          itemKeyMapRef.current.set(item, cached);
        }
        rawKey = cached;
      }
      let finalKey = rawKey;
      let dupIndex = 1;
      while (usedKeys.has(finalKey)) {
        finalKey = `${rawKey}__dup${dupIndex++}`;
      }
      usedKeys.add(finalKey);
      return finalKey;
    });
  }, [isOpen, displayQueue]);

  const getItemKey = React.useCallback(
    (index: number) => itemKeys[index] ?? `queue_item_${index}`,
    [itemKeys]
  );

  const getScrollElement = React.useCallback(() => listRef.current, []);

  const measureElement = React.useCallback(
    (el: HTMLElement, entry?: ResizeObserverEntry) => {
      if (entry?.borderBoxSize?.[0]?.blockSize) {
        return Math.round(entry.borderBoxSize[0].blockSize);
      }
      if (el?.offsetHeight > 0) return el.offsetHeight;
      if (entry?.contentRect?.height) {
        return Math.round(entry.contentRect.height);
      }
      const r = el?.getBoundingClientRect();
      if (r && r.height > 0) return Math.round(r.height);
      return ESTIMATED_ITEM_HEIGHT;
    },
    []
  );

  const rowVirtualizer = useVirtualizer({
    count: displayQueue.length,
    getScrollElement,
    estimateSize: estimateItemSize,
    overscan: 5,
    useFlushSync: false,
    initialRect: INITIAL_DRAWER_RECT,
    rangeExtractor,
    observeElementRect,
    measureElement,
    getItemKey,
    enabled: true,
    paddingStart: 12,
    paddingEnd: 12,
  });

  React.useLayoutEffect(() => {
    displayQueueRef.current = displayQueue;
    rowVirtualizerRef.current = rowVirtualizer;
  }, [displayQueue, rowVirtualizer]);

  const prevIsOpenRef = React.useRef(false);
  const prevSegmentIdRef = React.useRef<string | null>(null);
  const prevQueueIndexRef = React.useRef<number>(-1);
  const prevQueueLengthRef = React.useRef(displayQueue.length);

  // Only auto-scroll when drawer opens or active playing track advances
  React.useEffect(() => {
    if (!isOpen) {
      prevIsOpenRef.current = false;
      return;
    }
    const isInitialOpen = !prevIsOpenRef.current && isOpen;
    const isSegmentChanged = prevSegmentIdRef.current !== activeSegment?.id;
    const isLengthChanged = prevQueueLengthRef.current !== displayQueue.length;
    const isQueueIndexChanged = prevQueueIndexRef.current !== queueIndex && !isLengthChanged;
    prevIsOpenRef.current = isOpen;
    prevSegmentIdRef.current = activeSegment?.id ?? null;
    prevQueueIndexRef.current = queueIndex;
    prevQueueLengthRef.current = displayQueue.length;

    if (
      (isInitialOpen || isSegmentChanged || isQueueIndexChanged) &&
      !justDroppedRef.current &&
      draggedIdxRef.current === null
    ) {
      if (activeSegment) {
        const activeIdx =
          queueIndex >= 0 &&
          queueIndex < displayQueue.length &&
          displayQueue[queueIndex]?.segment.id === activeSegment.id
            ? queueIndex
            : -1;
        if (activeIdx >= 0) {
          if (activeIdx === 0) {
            if (listRef.current) listRef.current.scrollTop = 0;
            rowVirtualizerRef.current?.scrollToIndex(0, { align: "start" });
          } else {
            rowVirtualizerRef.current?.scrollToIndex(activeIdx, {
              align: "auto",
            });
          }
        }
      }
    }
  }, [isOpen, activeSegment?.id, queueIndex, displayQueue.length]);

  const pendingFocusRef = React.useRef<{
    index: number;
    target: "handle" | "up" | "down" | "delete" | "any" | "last";
    timestamp: number;
  } | null>(null);

  const markJustDropped = React.useCallback(() => {
    justDroppedRef.current = true;
    if (dropTimeoutRef.current) clearTimeout(dropTimeoutRef.current);
    dropTimeoutRef.current = setTimeout(() => {
      justDroppedRef.current = false;
    }, 150);
  }, []);

  const commitReorder = React.useCallback(
    (fromIdx: number, toIdx: number) => {
      const q = displayQueueRef.current;
      if (fromIdx === toIdx || fromIdx < 0 || toIdx < 0 || fromIdx >= q.length || toIdx >= q.length) {
        return;
      }
      const activeEl = document.activeElement;
      const hadHandleFocus = activeEl?.getAttribute("data-drag-handle") === "true";
      const hadChevronUp =
        activeEl?.getAttribute("data-action") === "move-up" ||
        activeEl?.getAttribute("title") === t("queue.moveUp");
      const hadChevronDown =
        activeEl?.getAttribute("data-action") === "move-down" ||
        activeEl?.getAttribute("title") === t("queue.moveDown");
      const focusTarget: "handle" | "up" | "down" | null = hadHandleFocus
        ? "handle"
        : hadChevronUp
        ? "up"
        : hadChevronDown
        ? "down"
        : null;

      const movedName = q[fromIdx]?.segment.name;
      markJustDropped();
      reorderQueue(fromIdx, toIdx);
      if (movedName) {
        setLiveAnnouncement((prev) => {
          const text = t("queue.announcementMoved", {
            name: movedName,
            position: toIdx + 1,
            total: q.length,
            defaultValue: `Moved ${movedName} to position ${toIdx + 1} of ${q.length}`,
          });
          return prev === text ? `${text}\u200B` : text;
        });
      }
      if (toIdx >= 0 && toIdx < q.length) {
        rowVirtualizerRef.current?.scrollToIndex(toIdx, { align: "auto" });
      }
      if (focusTarget) {
        pendingFocusRef.current = { index: toIdx, target: focusTarget, timestamp: Date.now() };
      }
    },
    [reorderQueue, markJustDropped, t]
  );

  const virtualItems = rowVirtualizer.getVirtualItems();

  React.useLayoutEffect(() => {
    if (pendingFocusRef.current === null) return;
    const { index, target, timestamp } = pendingFocusRef.current;
    if (Date.now() - timestamp > 1200) {
      pendingFocusRef.current = null;
      return;
    }
    const rowEl = listRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`);
    if (rowEl) {
      const isVisibleFocusable = (el: HTMLElement | null): el is HTMLElement => {
        if (!el || (el as HTMLButtonElement).disabled) return false;
        if (typeof el.checkVisibility === "function") {
          if (!el.checkVisibility()) return false;
        } else {
          if (el.offsetParent === null && (!el.getClientRects || el.getClientRects().length === 0)) return false;
        }
        if (el.closest?.('[hidden], .hidden')) return false;
        const isFinePointerDesktop = typeof window !== "undefined" && window.matchMedia?.("(min-width: 640px) and (pointer: fine)").matches;
        let curr: HTMLElement | null = el;
        while (curr && curr !== rowEl) {
          if (
            isFinePointerDesktop &&
            (curr.classList?.contains("sm:hidden") ||
              (typeof curr.className === "string" && curr.className.includes("sm:hidden")))
          ) {
            return false;
          }
          curr = curr.parentElement;
        }
        return true;
      };

      let elToFocus: HTMLElement | null = null;
      if (target === "handle") {
        const handle = rowEl.querySelector<HTMLElement>('[data-drag-handle="true"]:not([disabled])');
        if (isVisibleFocusable(handle)) elToFocus = handle;
      } else if (target === "up") {
        const upBtn = rowEl.querySelector<HTMLElement>('button[data-action="move-up"]:not([disabled])');
        if (isVisibleFocusable(upBtn)) elToFocus = upBtn;
      } else if (target === "down") {
        const downBtn = rowEl.querySelector<HTMLElement>('button[data-action="move-down"]:not([disabled])');
        if (isVisibleFocusable(downBtn)) elToFocus = downBtn;
      } else if (target === "delete") {
        const delBtn = rowEl.querySelector<HTMLElement>('button[data-action="remove"]:not([disabled])');
        if (isVisibleFocusable(delBtn)) elToFocus = delBtn;
      } else if (target === "last") {
        const focusables = Array.from(
          rowEl.querySelectorAll<HTMLElement>(
            'button:not([disabled]):not([tabindex="-1"]), [tabindex="0"]:not([disabled])'
          )
        ).filter(isVisibleFocusable);
        if (focusables.length > 0) {
          elToFocus = focusables[focusables.length - 1];
        }
      }
      if (!isVisibleFocusable(elToFocus)) {
        const candidates = [
          rowEl.querySelector<HTMLElement>('[data-drag-handle="true"]:not([disabled])'),
          rowEl.querySelector<HTMLElement>('[role="button"][data-action="play"]:not([disabled])'),
          rowEl.querySelector<HTMLElement>('button[data-action="remove"]:not([disabled])'),
          rowEl.querySelector<HTMLElement>('button[data-action="move-up"]:not([disabled])'),
          rowEl.querySelector<HTMLElement>('button[data-action="move-down"]:not([disabled])'),
          ...Array.from(
            rowEl.querySelectorAll<HTMLElement>(
              'button:not([disabled]):not([tabindex="-1"]), [tabindex="0"]:not([disabled])'
            )
          ),
        ];
        elToFocus = candidates.find(isVisibleFocusable) || null;
      }
      if (elToFocus) {
        elToFocus.focus();
        pendingFocusRef.current = null;
      }
    }
  }, [queue, virtualItems.length, virtualItems[0]?.index, virtualItems[virtualItems.length - 1]?.index]);

  const resetDragState = React.useCallback(() => {
    draggedIdxRef.current = null;
    setDraggedIdx(null);
    setDragOverIdx(null);
    isDraggingHandleRef.current = false;
    listRectRef.current = null;
    stopAutoScroll();
  }, [stopAutoScroll]);

  React.useEffect(() => {
    return () => {
      if (dropTimeoutRef.current) clearTimeout(dropTimeoutRef.current);
      safeCancelRaf(restoreRafRef.current);
    };
  }, []);

  React.useEffect(() => {
    const handleRelease = () => {
      isDraggingHandleRef.current = false;
    };
    window.addEventListener("mouseup", handleRelease);
    window.addEventListener("pointerup", handleRelease);
    window.addEventListener("dragend", resetDragState);
    window.addEventListener("pointercancel", handleRelease);
    window.addEventListener("blur", resetDragState);
    return () => {
      window.removeEventListener("mouseup", handleRelease);
      window.removeEventListener("pointerup", handleRelease);
      window.removeEventListener("dragend", resetDragState);
      window.removeEventListener("pointercancel", handleRelease);
      window.removeEventListener("blur", resetDragState);
    };
  }, [isOpen, resetDragState]);

  const onCloseRef = React.useRef(onClose);
  React.useLayoutEffect(() => {
    onCloseRef.current = onClose;
  });

  // Focus drawer container upon mount
  React.useEffect(() => {
    drawerRef.current?.focus();
  }, []);

  // Global Escape dismiss (cancels drag first if active)
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (drawerRef.current && drawerRef.current.contains(e.target as Node)) {
          return;
        }
        if (draggedIdxRef.current !== null || isDraggingHandleRef.current) {
          stopAutoScroll();
          resetDragState();
          return;
        }
        onCloseRef.current();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [stopAutoScroll, resetDragState]);

  const handlePlayItem = React.useCallback(
    async (item: QueueItem, idx: number) => {
      if (justDroppedRef.current) return;
      playSegment(item.segment, item.track, idx);
    },
    [playSegment]
  );

  const handleDragStart = React.useCallback(
    (e: React.DragEvent, idx: number, name: string) => {
      if (!isDraggingHandleRef.current) {
        e.preventDefault();
        return;
      }
      if (listRef.current) {
        listRectRef.current = listRef.current.getBoundingClientRect();
      }
      e.dataTransfer.setData("application/x-slice-queue-index", String(idx));
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

  const handleDrop = React.useCallback(
    (e: React.DragEvent, targetIdx: number) => {
      e.preventDefault();
      e.stopPropagation();
      const rawIdx = e.dataTransfer.getData("application/x-slice-queue-index");
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
    resetDragState();
  }, [resetDragState]);

  const handleRemove = React.useCallback(
    (idx: number) => {
      markJustDropped();
      const q = displayQueueRef.current;
      const removedName = q[idx]?.segment.name;
      const activeEl = document.activeElement as HTMLElement | null;
      const hadFocusInside = activeEl?.closest?.(`[data-index="${idx}"]`) !== null;
      const hadDeleteFocus =
        activeEl?.closest?.('button[data-action="remove"]') !== null;
      const remainingCount = q.length - 1;

      removeQueueItemAtIndex(idx);

      if (removedName) {
        setLiveAnnouncement((prev) => {
          const text = t("queue.announcementRemoved", {
            name: removedName,
            defaultValue: `Removed ${removedName} from queue`,
          });
          return prev === text ? `${text}\u200B` : text;
        });
      }

      if (hadFocusInside) {
        if (remainingCount <= 0) {
          drawerRef.current?.focus();
        } else {
          const nextTargetIdx = Math.max(0, Math.min(idx, remainingCount - 1));
          pendingFocusRef.current = {
            index: nextTargetIdx,
            target: hadDeleteFocus ? "delete" : "any",
            timestamp: Date.now(),
          };
        }
      }
    },
    [removeQueueItemAtIndex, markJustDropped]
  );

  const handleReorder = React.useCallback(
    (fromIdx: number, toIdx: number) => {
      commitReorder(fromIdx, toIdx);
    },
    [commitReorder]
  );

  const handleHandleMouseDown = React.useCallback(() => {
    isDraggingHandleRef.current = true;
  }, []);

  const handleDialogKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        e.nativeEvent.stopImmediatePropagation();
        if (draggedIdxRef.current !== null || isDraggingHandleRef.current) {
          stopAutoScroll();
          resetDragState();
          return;
        }
        onCloseRef.current();
        return;
      }

      if (e.key === "Tab") {
        if (!drawerRef.current) return;
        const allFocusable = Array.from(
          drawerRef.current.querySelectorAll<HTMLElement>(
            'button:not([disabled]):not([tabindex="-1"]), [tabindex="0"]:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])'
          )
        ).filter((el) => el.offsetParent !== null || el.getClientRects().length > 0);

        if (allFocusable.length === 0) {
          e.preventDefault();
          return;
        }

        const first = allFocusable[0];
        const lastInDom = allFocusable[allFocusable.length - 1];

        if (e.shiftKey) {
          const activeEl = document.activeElement as HTMLElement | null;
          const currentRowEl = activeEl?.closest<HTMLElement>("[data-index]");
          const currentRowIdx = currentRowEl ? Number(currentRowEl.getAttribute("data-index")) : -1;
          const firstFocusableInRow = currentRowEl?.querySelector<HTMLElement>(
            'button:not([disabled]):not([tabindex="-1"]), [tabindex="0"]:not([disabled])'
          );

          if (currentRowEl && !isNaN(currentRowIdx) && activeEl === firstFocusableInRow && currentRowIdx > 0) {
            e.preventDefault();
            const prevIdx = currentRowIdx - 1;
            rowVirtualizerRef.current?.scrollToIndex(prevIdx, { align: "auto" });
            const prevRow = listRef.current?.querySelector<HTMLElement>(`[data-index="${prevIdx}"]`);
            const prevFocusables = Array.from(
              prevRow?.querySelectorAll<HTMLElement>(
                'button:not([disabled]):not([tabindex="-1"]), [tabindex="0"]:not([disabled])'
              ) ?? []
            ).filter((el) => el.offsetParent !== null || el.getClientRects().length > 0);
            if (prevFocusables.length > 0) {
              prevFocusables[prevFocusables.length - 1].focus();
            } else {
              pendingFocusRef.current = { index: prevIdx, target: "last", timestamp: Date.now() };
            }
          } else if (
            document.activeElement === first ||
            document.activeElement === drawerRef.current ||
            !drawerRef.current.contains(document.activeElement)
          ) {
            e.preventDefault();
            const qLen = displayQueueRef.current.length;
            if (qLen > 0) {
              const lastIdx = qLen - 1;
              rowVirtualizerRef.current?.scrollToIndex(lastIdx, { align: "auto" });
              const lastRow = listRef.current?.querySelector<HTMLElement>(`[data-index="${lastIdx}"]`);
              const lastFocusables = Array.from(
                lastRow?.querySelectorAll<HTMLElement>(
                  'button:not([disabled]):not([tabindex="-1"]), [tabindex="0"]:not([disabled])'
                ) ?? []
              ).filter((el) => el.offsetParent !== null || el.getClientRects().length > 0);
              if (lastFocusables.length > 0) {
                lastFocusables[lastFocusables.length - 1].focus();
              } else {
                pendingFocusRef.current = { index: lastIdx, target: "last", timestamp: Date.now() };
              }
            } else {
              lastInDom.focus();
            }
          }
        } else {
          if (document.activeElement === lastInDom || !drawerRef.current.contains(document.activeElement)) {
            const activeEl = document.activeElement as HTMLElement | null;
            const currentRowEl = activeEl?.closest<HTMLElement>("[data-index]");
            const currentRowIdx = currentRowEl ? Number(currentRowEl.getAttribute("data-index")) : -1;
            const qLen = displayQueueRef.current.length;

            if (currentRowEl && !isNaN(currentRowIdx) && currentRowIdx < qLen - 1) {
              e.preventDefault();
              const nextIdx = currentRowIdx + 1;
              rowVirtualizerRef.current?.scrollToIndex(nextIdx, { align: "auto" });
              const nextRow = listRef.current?.querySelector<HTMLElement>(`[data-index="${nextIdx}"]`);
              const nextFocusable = nextRow?.querySelector<HTMLElement>(
                'button:not([disabled]):not([tabindex="-1"]), [tabindex="0"]:not([disabled])'
              );
              if (nextFocusable) {
                nextFocusable.focus();
              } else {
                pendingFocusRef.current = { index: nextIdx, target: "any", timestamp: Date.now() };
              }
            } else {
              e.preventDefault();
              first.focus();
            }
          }
        }
      }
    },
    [stopAutoScroll, resetDragState]
  );

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px] animate-in fade-in duration-200"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={drawerRef}
        id="queue-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="queue-drawer-title"
        tabIndex={-1}
        onKeyDown={handleDialogKeyDown}
        className="fixed inset-y-0 right-0 z-50 w-full max-w-sm border-l border-border bg-card/95 backdrop-blur-md p-5 shadow-2xl flex flex-col animate-in slide-in-from-right duration-200"
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-border">
          <div className="flex items-center gap-2 min-w-0">
            <Music className="h-5 w-5 text-primary shrink-0" />
            <h2 id="queue-drawer-title" className="font-bold text-base text-foreground truncate">
              {t("queue.title", "Now Playing Queue")}
            </h2>
            <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-accent text-accent-foreground shrink-0">
              {displayQueue.length}
            </span>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {isShuffle && displayQueue.length > 0 && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  toggleShuffle();
                  setLiveAnnouncement(t("queue.announcementRestored", "Restored original queue order"));
                  safeCancelRaf(restoreRafRef.current);
                  restoreRafRef.current = safeRaf(() => {
                    restoreRafRef.current = null;
                    if (shuffleBtnRef.current && !shuffleBtnRef.current.disabled) {
                      shuffleBtnRef.current.focus();
                    } else {
                      const closeBtn = drawerRef.current?.querySelector<HTMLElement>('button[data-action="close-queue"]');
                      if (closeBtn) closeBtn.focus();
                      else drawerRef.current?.focus();
                    }
                  });
                }}
                className="h-8 w-8 text-muted-foreground hover:text-foreground cursor-pointer shrink-0"
                title={t("queue.restoreOrder", "Restore original order")}
                aria-label={t("queue.restoreOrder", "Restore original order")}
              >
                <RotateCcw className="h-4 w-4" />
              </Button>
            )}

            <Button
              ref={shuffleBtnRef}
              variant="ghost"
              size="icon"
              onClick={() => {
                reshuffleCurrentQueue();
                if (listRef.current) {
                  listRef.current.scrollTop = 0;
                }
                rowVirtualizerRef.current?.scrollToIndex(0, { align: "start" });
                safeCancelRaf(shuffleScrollRafRef.current);
                shuffleScrollRafRef.current = safeRaf(() => {
                  shuffleScrollRafRef.current = null;
                  if (listRef.current) {
                    listRef.current.scrollTop = 0;
                  }
                  rowVirtualizerRef.current?.scrollToIndex(0, { align: "start" });
                });
                setLiveAnnouncement((prev) => {
                  const text = t("queue.announcementShuffled", "Reshuffled queue order");
                  return prev === text ? `${text}\u200B` : text;
                });
              }}
              disabled={displayQueue.length <= 1}
              className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
              title={
                isShuffle
                  ? t("queue.reshuffle", "Reshuffle queue")
                  : t("queue.shuffleTitle", "Shuffle playback order in queue")
              }
              aria-label={
                isShuffle
                  ? t("queue.reshuffle", "Reshuffle queue")
                  : t("queue.shuffle", "Shuffle queue")
              }
              aria-description={
                isShuffle
                  ? t("queue.shuffleActiveDesc", "Queue is shuffled. Press to reshuffle, or restore original order.")
                  : undefined
              }
            >
              <Shuffle className="h-4 w-4" />
            </Button>

            <Button
              variant={isLoopQueue ? "secondary" : "ghost"}
              size="icon"
              onClick={() => {
                toggleLoopQueue();
                const nextState = !isLoopQueue;
                const msg = nextState
                  ? t("queue.announcementLoopQueueEnabled", "Queue loop enabled")
                  : t("queue.announcementLoopQueueDisabled", "Queue loop disabled");
                setLiveAnnouncement((prev) => (prev === msg ? `${msg}\u200B` : msg));
              }}
              className={`h-8 w-8 shrink-0 ${
                isLoopQueue ? "text-flexoki-green hover:bg-flexoki-green/10" : "text-muted-foreground hover:text-foreground"
              } cursor-pointer`}
              title={
                isLoopQueue
                  ? t("queue.loopQueueActive", "Loop queue enabled")
                  : t("queue.loopQueueTitle", "Loop playback of queue")
              }
              aria-label={t("queue.loopQueue", "Loop queue")}
              aria-pressed={isLoopQueue}
              aria-description={
                isLoopQueue
                  ? t("queue.loopQueueActiveDesc", "Queue loop is active. Plays from the beginning after finishing.")
                  : undefined
              }
            >
              <Repeat className="h-4 w-4" />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              data-action="close-queue"
              aria-label={t("queue.close", "Close queue")}
              title={t("queue.close", "Close queue")}
              className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground cursor-pointer shrink-0"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Playing Playlist Indicator */}
        <div className="py-2.5 border-b border-border/50">
          <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-accent/40 border border-border/40 text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-muted-foreground text-[11px] shrink-0">{t("queue.playingLabel", "Playing:")}</span>
              <div className="inline-flex items-center gap-1.5 font-semibold text-primary truncate">
                {activePlaylistPlayingId ? (
                  <Folder className="h-3.5 w-3.5 shrink-0 text-flexoki-yellow" />
                ) : playbackMode === "slices_only" ? (
                  <Scissors className="h-3.5 w-3.5 shrink-0 text-primary" />
                ) : playbackMode === "original_only" ? (
                  <Disc className="h-3.5 w-3.5 shrink-0 text-flexoki-green" />
                ) : (
                  <Shuffle className="h-3.5 w-3.5 shrink-0 text-flexoki-blue" />
                )}
                <span className="truncate">{playingPlaylistName}</span>
              </div>
            </div>
            {Boolean(activeTrack) && (
              <span className="inline-flex items-center gap-1 font-mono text-[10px] text-flexoki-green shrink-0 ml-2">
                {isPlaying ? (
                  <>
                    <span className="h-1.5 w-1.5 rounded-full bg-flexoki-green animate-pulse" />
                    <span>{t("queue.playing", "Playing")}</span>
                  </>
                ) : (
                  <>
                    <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />
                    <span className="text-muted-foreground">{t("queue.paused", "Paused")}</span>
                  </>
                )}
              </span>
            )}
          </div>
        </div>

      {/* Accessibility live announcement */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {liveAnnouncement}
      </div>

      {/* Queue items list */}
      <div
        ref={listRef}
        role="region"
        aria-label={t("queue.regionAria", "Current playback queue")}
        tabIndex={-1}
        className="flex-1 min-h-0 overflow-y-auto focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
        onDragOver={(e) => {
          if (draggedIdxRef.current === null) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          if (!listRef.current) return;

          const listRect = listRectRef.current || (listRef.current ? (listRectRef.current = listRef.current.getBoundingClientRect()) : null);

          const targetEl = e.target instanceof Element ? e.target : null;
          const itemEl = targetEl?.closest<HTMLElement>('[data-index]');
          if (itemEl) {
            const rawIdx = itemEl.getAttribute("data-index");
            const idx = rawIdx !== null ? parseInt(rawIdx, 10) : null;
            if (idx !== null && !isNaN(idx)) {
              if (idx === draggedIdxRef.current) {
                if (dragOverIdx !== null) setDragOverIdx(null);
              } else if (idx !== dragOverIdx) {
                setDragOverIdx(idx);
              }
            }
          } else if (
            e.target === listRef.current ||
            targetEl?.getAttribute("role") === "list"
          ) {
            const boundaryIdx = getBoundaryDropIndex(
              e.clientY,
              listRef.current,
              displayQueue.length,
              listRect,
              rowVirtualizer.getTotalSize()
            );
            const scrollOffset = listRect ? listRef.current.scrollTop + (e.clientY - listRect.top) : null;
            const virtualItem = scrollOffset !== null ? rowVirtualizer.getVirtualItemForOffset(scrollOffset) : null;
            const targetIdx = boundaryIdx !== null ? boundaryIdx : (virtualItem?.index ?? null);
            if (targetIdx !== null && dragOverIdx !== targetIdx && targetIdx !== draggedIdxRef.current) {
              setDragOverIdx(targetIdx);
            } else if (targetIdx === draggedIdxRef.current && dragOverIdx !== null) {
              setDragOverIdx(null);
            }
          }

          if (listRect) {
            const threshold = Math.min(40, Math.floor((listRect.height || 600) / 3));
            if (e.clientY < listRect.top + threshold) {
              startAutoScroll(-10);
            } else if (e.clientY > listRect.bottom - threshold) {
              startAutoScroll(10);
            } else {
              stopAutoScroll();
            }
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          const listRect = listRectRef.current || (listRef.current ? (listRectRef.current = listRef.current.getBoundingClientRect()) : null);
          const currentDraggedIdx = draggedIdxRef.current;
          if (currentDraggedIdx !== null && listRef.current && listRect) {
            const boundaryIdx = getBoundaryDropIndex(
              e.clientY,
              listRef.current,
              displayQueue.length,
              listRect,
              rowVirtualizer.getTotalSize()
            );
            const scrollOffset = listRef.current.scrollTop + (e.clientY - listRect.top);
            const virtualItem = rowVirtualizer.getVirtualItemForOffset(scrollOffset);
            const targetIdx = boundaryIdx !== null ? boundaryIdx : (virtualItem?.index ?? dragOverIdx);
            if (targetIdx !== null && targetIdx !== currentDraggedIdx) {
              commitReorder(currentDraggedIdx, targetIdx);
            }
          }
          stopAutoScroll();
          markJustDropped();
          resetDragState();
        }}
        onDragLeave={(e) => {
          const rect = listRectRef.current || e.currentTarget.getBoundingClientRect();
          const isOutside =
            e.clientX < rect.left ||
            e.clientX >= rect.right ||
            e.clientY < rect.top - 60 ||
            e.clientY >= rect.bottom + 60;
          if (isOutside) {
            stopAutoScroll();
            setDragOverIdx(null);
          }
        }}
      >
        {displayQueue.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-center text-muted-foreground p-4">
            <Music className="h-8 w-8 opacity-30 mb-2" />
            <p className="text-sm font-medium text-foreground">{t("queue.empty", "Queue is empty")}</p>
            <p className="text-xs text-muted-foreground/70 mt-1 max-w-[220px]">
              {t("queue.emptyHint", "Select a playlist or track to begin playback.")}
            </p>
          </div>
        ) : (
          <div
            role="list"
            aria-label={t("queue.regionAria", "Current playback queue")}
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative",
            }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const item = displayQueue[virtualRow.index];
              if (!item) return null;

              const isCurrent = Boolean(
                activeSegment &&
                queueIndex >= 0 &&
                virtualRow.index === queueIndex &&
                item.segment.id === activeSegment.id
              );
              const isDragging = draggedIdx === virtualRow.index;
              const isDragTarget = dragOverIdx === virtualRow.index && draggedIdx !== null && draggedIdx !== virtualRow.index;

              return (
                <div
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  ref={rowVirtualizer.measureElement}
                  role="listitem"
                  aria-current={isCurrent ? "true" : undefined}
                  aria-setsize={displayQueue.length}
                  aria-posinset={virtualRow.index + 1}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                  className="pb-2"
                >
                  <QueueItemRow
                    item={item}
                    idx={virtualRow.index}
                    totalItems={displayQueue.length}
                    isCurrent={isCurrent}
                    isDragging={isDragging}
                    isDragTarget={isDragTarget}
                    onDragStart={handleDragStart}
                    onDragOver={handleDragOver}
                    onDrop={handleDrop}
                    onDragEnd={handleDragEnd}
                    onPlay={handlePlayItem}
                    onRemove={handleRemove}
                    onReorder={handleReorder}
                    onAnnouncement={setLiveAnnouncement}
                    onHandleMouseDown={handleHandleMouseDown}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
    </>
  );
}

export function QueueDrawer({ isOpen, onClose }: QueueDrawerProps) {
  const triggerElementRef = React.useRef<HTMLElement | null>(null);
  const prevIsOpenRef = React.useRef(false);

  React.useLayoutEffect(() => {
    if (!prevIsOpenRef.current && isOpen && typeof document !== "undefined") {
      triggerElementRef.current = document.activeElement as HTMLElement | null;
    } else if (prevIsOpenRef.current && !isOpen) {
      if (triggerElementRef.current?.isConnected) {
        triggerElementRef.current.focus();
      } else if (typeof document !== "undefined") {
        const queueTrigger = document.querySelector<HTMLElement>(
          'button[aria-controls="queue-drawer"]'
        );
        queueTrigger?.focus();
      }
      triggerElementRef.current = null;
    }
    prevIsOpenRef.current = isOpen;
  }, [isOpen]);

  React.useEffect(() => {
    return () => {
      if (triggerElementRef.current) {
        if (triggerElementRef.current.isConnected) {
          triggerElementRef.current.focus();
        } else if (typeof document !== "undefined") {
          const queueTrigger = document.querySelector<HTMLElement>(
            'button[aria-controls="queue-drawer"]'
          );
          queueTrigger?.focus();
        }
        triggerElementRef.current = null;
      }
    };
  }, []);

  if (!isOpen) return null;

  return <QueueDrawerContent isOpen={isOpen} onClose={onClose} />;
}

