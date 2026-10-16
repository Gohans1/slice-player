import * as React from "react";
import { X, Shuffle, RotateCcw, Music, Trash2, GripVertical, ChevronUp, ChevronDown, Scissors, Disc, Folder, Repeat } from "lucide-react";
import { useVirtualizer, defaultRangeExtractor, type Range } from "@tanstack/react-virtual";
import { useTranslation } from "react-i18next";
import { useFormatNumber } from "../hooks/use-format-number";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./ui/empty";
import { Sheet, SheetContent, SheetTitle } from "./ui/sheet";
import { cn, formatDuration, DEFAULT_SLICE_COLOR, REVEAL_ON_HOVER } from "../lib/utils";
import { TrackThumbnail } from "./TrackThumbnail";
import { NowPlayingEqualizer } from "./NowPlayingEqualizer";
import { usePlaybackSource } from "../hooks/use-playback-source";
import { usePlayerStore, type QueueItem } from "../store/usePlayerStore";

interface QueueDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

interface QueueContentProps {
  onClose: () => void;
  // The sheet passes its dialog title so Base UI labels the dialog with it
  titleAs?: React.ElementType;
  // A sheet covers the page its source leads to, so it closes on the way there
  closeOnNavigate?: boolean;
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
  isPlaying?: boolean;
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
  isPlaying,
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
      data-tint={isCurrent || isDragTarget ? "on" : isDragging ? undefined : "hover"}
      className={cn(
        "group flex min-h-13.5 items-center gap-2 rounded-md p-1.5 select-none transition-colors",
        isDragging
          ? "opacity-40 outline-1 outline-dashed outline-primary/60"
          : isDragTarget
          ? "bg-accent ring-2 ring-primary/60"
          : isCurrent
          ? "bg-primary/10"
          : "hover:bg-accent/60"
      )}
    >
      <div className="flex items-center gap-2 min-w-0 flex-1">
        {/* Mobile & Touchscreen reorder buttons */}
        <div className="flex flex-col [@media(pointer:fine)]:sm:hidden gap-0.5 shrink-0">
          <Button
            variant="ghost"
            size="icon-sm"
            data-action="move-up"
            disabled={idx === 0}
            onClick={(e) => {
              e.stopPropagation();
              onReorder(idx, idx - 1);
            }}
            title={t("queue.moveUp", "Move up")}
            aria-label={t("queue.moveUp", "Move up")}
          >
            <ChevronUp />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            data-action="move-down"
            disabled={idx === totalItems - 1}
            onClick={(e) => {
              e.stopPropagation();
              onReorder(idx, idx + 1);
            }}
            title={t("queue.moveDown", "Move down")}
            aria-label={t("queue.moveDown", "Move down")}
          >
            <ChevronDown />
          </Button>
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
          className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring rounded p-1 -m-1"
        >
          <div className="relative size-10 rounded overflow-hidden bg-muted shrink-0">
            <TrackThumbnail
              src={item.track.thumbnail_url}
              size="small"
              alt={item.track.title}
              className="h-full w-full object-cover select-none pointer-events-none"
              fallback={
                <div className="flex h-full w-full items-center justify-center text-xs tabular-nums select-none">
                  {idx + 1}
                </div>
              }
            />
            <div
              className="absolute inset-x-0 bottom-0 h-0.5 bg-(--slice-color)"
              style={{ "--slice-color": item.segment.color || DEFAULT_SLICE_COLOR }}
            />
          </div>

          <div className="min-w-0 flex-1">
            {isSlice ? (
              <>
                <div className="flex items-center gap-1.5 min-w-0">
                  {isCurrent && isPlaying && (
                    <NowPlayingEqualizer className="text-primary shrink-0" />
                  )}
                  <span
                    className={cn("truncate text-xs", isCurrent ? "text-primary" : "text-foreground")}
                    title={item.segment.name}
                  >
                    {item.segment.name}
                  </span>
                  <span
                    className="text-2xs text-muted-foreground tabular-nums shrink-0 select-none"
                    title={`${formatDuration(item.segment.start_time)} - ${formatDuration(item.segment.end_time)}`}
                  >
                    [{formatDuration(item.segment.start_time)} - {formatDuration(item.segment.end_time)}]
                  </span>
                </div>
                <p
                  className="truncate text-xs text-muted-foreground"
                  title={artistText ? `${item.track.title} • ${artistText}` : item.track.title}
                >
                  {artistText ? `${item.track.title} • ${artistText}` : item.track.title}
                </p>
              </>
            ) : (
              <>
                <div className="flex items-center gap-1.5 min-w-0">
                  {isCurrent && isPlaying && (
                    <NowPlayingEqualizer className="text-primary shrink-0" />
                  )}
                  <p
                    className={cn("truncate text-xs", isCurrent ? "text-primary" : "text-foreground")}
                    title={item.track.title}
                  >
                    {item.track.title}
                  </p>
                </div>
                <p
                  className="truncate text-xs text-muted-foreground"
                  title={artistText || t("table.unknownArtist", "Unknown Artist")}
                >
                  {artistText || t("table.unknownArtist", "Unknown Artist")}
                </p>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Like Apple Music, the duration gives way to the row's controls on hover or focus. Touch screens can't hover, so
          they show both side by side. */}
      <div className="flex shrink-0 items-center gap-1.5 pointer-fine:grid pointer-fine:justify-items-end pointer-fine:*:[grid-area:1/1]">
        <span className="text-xs text-muted-foreground tabular-nums transition-opacity pointer-fine:group-hover:opacity-0 pointer-fine:group-focus-within:opacity-0">
          {formatDuration(segDuration)}
        </span>
        <div className={cn("flex items-center", REVEAL_ON_HOVER, "group-focus-within:opacity-100")}>
          <div
            data-drag-handle="true"
            role="button"
            tabIndex={0}
            aria-label={t("queue.dragHandleAria", { name: itemName, position: idx + 1, total: totalItems, defaultValue: `Reorder ${itemName}, position ${idx + 1} of ${totalItems}` })}
            aria-keyshortcuts="ArrowUp ArrowDown Home End"
            aria-description={t("queue.dragHandleDesc", "Press Up/Down arrow or Home/End to change position in queue")}
            className="shrink-0 cursor-grab rounded p-0.5 text-muted-foreground/60 transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:cursor-grabbing"
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
          <Button
            variant="ghost"
            size="icon-sm"
            data-action="remove"
            onClick={(e) => {
              e.stopPropagation();
              onRemove(idx);
            }}
            title={t("queue.remove", "Remove from queue")}
            aria-label={t("queue.remove", "Remove from queue")}
          >
            <Trash2 />
          </Button>
        </div>
      </div>
    </div>
  );
});

// Controls inside a queue row (or the whole list) in tab order. Each row puts its touch-only reorder buttons first,
// and a fine pointer hides them, so a row's first and last controls are its first and last rendered ones
const FOCUSABLE_SELECTOR = 'button:not([disabled]):not([tabindex="-1"]), [tabindex="0"]:not([disabled])';
function getShownFocusables(container: Element | null | undefined): HTMLElement[] {
  return Array.from(container?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? []).filter((el) => el.checkVisibility());
}

const ESTIMATED_ITEM_HEIGHT = 54;
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

function QueueContent({ onClose, titleAs: Title = "h2", closeOnNavigate = false }: QueueContentProps) {
  const { t } = useTranslation();
  const formatNumber = useFormatNumber();
  const queue = usePlayerStore((s) => s.queue);
  const queueIndex = usePlayerStore((s) => s.queueIndex);
  const activeSegment = usePlayerStore((s) => s.activeSegment);
  const playSegment = usePlayerStore((s) => s.playSegment);
  const removeQueueItemAtIndex = usePlayerStore((s) => s.removeQueueItemAtIndex);
  const reorderQueue = usePlayerStore((s) => s.reorderQueue);
  const playbackMode = usePlayerStore((s) => s.playbackMode);
  const activePlaylistPlayingId = usePlayerStore((s) => s.activePlaylistPlayingId);
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

  const playbackSource = usePlaybackSource();
  const sourceName = playbackSource.name;
  const goToSource = async () => {
    await playbackSource.goToSource();
    if (closeOnNavigate) onClose();
  };

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
  }, [displayQueue]);

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

  // Only auto-scroll when the queue opens or active playing track advances
  React.useEffect(() => {
    const isInitialOpen = !prevIsOpenRef.current;
    const isSegmentChanged = prevSegmentIdRef.current !== activeSegment?.id;
    const isLengthChanged = prevQueueLengthRef.current !== displayQueue.length;
    const isQueueIndexChanged = prevQueueIndexRef.current !== queueIndex && !isLengthChanged;
    prevIsOpenRef.current = true;
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
  }, [activeSegment?.id, queueIndex, displayQueue.length]);

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
      const isVisibleFocusable = (el: HTMLElement | null): el is HTMLElement =>
        el !== null && !(el as HTMLButtonElement).disabled && el.checkVisibility();

      let elToFocus: HTMLElement | null = null;
      if (target === "handle") {
        elToFocus = rowEl.querySelector<HTMLElement>('[data-drag-handle="true"]');
      } else if (target === "up") {
        elToFocus = rowEl.querySelector<HTMLElement>('button[data-action="move-up"]');
      } else if (target === "down") {
        elToFocus = rowEl.querySelector<HTMLElement>('button[data-action="move-down"]');
      } else if (target === "delete") {
        elToFocus = rowEl.querySelector<HTMLElement>('button[data-action="remove"]');
      } else if (target === "any") {
        elToFocus = getShownFocusables(rowEl)[0] ?? null;
      } else {
        elToFocus = getShownFocusables(rowEl).at(-1) ?? null;
      }
      // A reorder whose button has gone (moved to an end, or hidden under a fine pointer) keeps focus on the moved row
      if (!isVisibleFocusable(elToFocus)) {
        elToFocus = [rowEl.querySelector<HTMLElement>('[data-drag-handle="true"]'), ...getShownFocusables(rowEl)].find(isVisibleFocusable) ?? null;
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
  }, [resetDragState]);

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

  // Escape mid-drag only cancels the drag; stopping it here keeps the sheet from closing too
  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key !== "Escape") return;
      if (draggedIdxRef.current !== null || isDraggingHandleRef.current) {
        e.stopPropagation();
        stopAutoScroll();
        resetDragState();
      }
    },
    [stopAutoScroll, resetDragState]
  );

  // Tab off the last rendered row, or Shift+Tab off a row's first control, walks into rows the
  // virtualizer has not mounted yet instead of leaving the list
  const handleListKeyDown = React.useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const list = listRef.current;
    if (e.key !== "Tab" || !list) return;
    const activeEl = document.activeElement as HTMLElement | null;
    const currentRowEl = activeEl?.closest<HTMLElement>("[data-index]");
    const currentRowIdx = currentRowEl ? Number(currentRowEl.getAttribute("data-index")) : NaN;
    if (!currentRowEl || isNaN(currentRowIdx)) return;
    if (e.shiftKey) {
      if (currentRowIdx === 0 || activeEl !== getShownFocusables(currentRowEl)[0]) return;
      e.preventDefault();
      const prevIdx = currentRowIdx - 1;
      rowVirtualizerRef.current?.scrollToIndex(prevIdx, { align: "auto" });
      const lastInPrevRow = getShownFocusables(list.querySelector(`[data-index="${prevIdx}"]`)).at(-1);
      if (lastInPrevRow) lastInPrevRow.focus();
      else pendingFocusRef.current = { index: prevIdx, target: "last", timestamp: Date.now() };
      return;
    }

    if (activeEl !== getShownFocusables(list).at(-1) || currentRowIdx >= displayQueueRef.current.length - 1) {
      return;
    }
    e.preventDefault();
    const nextIdx = currentRowIdx + 1;
    rowVirtualizerRef.current?.scrollToIndex(nextIdx, { align: "auto" });
    const nextFocusable = getShownFocusables(list.querySelector(`[data-index="${nextIdx}"]`))[0];
    if (nextFocusable) nextFocusable.focus();
    else pendingFocusRef.current = { index: nextIdx, target: "any", timestamp: Date.now() };
  }, []);

  return (
    <div ref={drawerRef} tabIndex={-1} onKeyDown={handleKeyDown} className="flex min-h-0 flex-1 flex-col p-4 focus:outline-none">
        {/* Header */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Title id="queue-drawer-title" className="truncate text-base font-bold text-foreground">
              {t("queue.title", "Now Playing Queue")}
            </Title>
            <Badge variant="secondary" className="shrink-0">
              {formatNumber(displayQueue.length)}
            </Badge>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            data-action="close-queue"
            aria-label={t("queue.close", "Close queue")}
            title={t("queue.close", "Close queue")}
          >
            <X />
          </Button>
        </div>

        {/* Where playback comes from, which leads there, next to the queue order controls */}
        <div className="mt-2 flex items-center justify-between gap-2 border-b border-border/50 py-2">
          <div className="flex min-w-0 items-center gap-1.5 text-xs">
            <span className="shrink-0 text-muted-foreground">{t("queue.playingFrom", "Playing from")}</span>
            <Button
              variant="link"
              size="sm"
              onClick={() => void goToSource()}
              aria-label={t("queue.goToSource", { name: sourceName, defaultValue: `Go to ${sourceName}` })}
              title={t("queue.goToSource", { name: sourceName, defaultValue: `Go to ${sourceName}` })}
              className="min-w-0"
            >
              {activePlaylistPlayingId ? (
                <Folder data-icon="inline-start" className="text-flexoki-yellow" />
              ) : playbackMode === "slices_only" ? (
                <Scissors data-icon="inline-start" />
              ) : playbackMode === "original_only" ? (
                <Disc data-icon="inline-start" className="text-flexoki-green" />
              ) : (
                <Shuffle data-icon="inline-start" className="text-flexoki-blue" />
              )}
              <span className="truncate">{sourceName}</span>
            </Button>
          </div>
          <div className="flex shrink-0 items-center">
            {isShuffle && displayQueue.length > 0 && (
              <Button
                variant="ghost"
                size="icon-sm"
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
                title={t("queue.restoreOrder", "Restore original order")}
                aria-label={t("queue.restoreOrder", "Restore original order")}
              >
                <RotateCcw />
              </Button>
            )}

            <Button
              ref={shuffleBtnRef}
              variant="ghost"
              size="icon-sm"
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
              <Shuffle />
            </Button>

            <Button
              variant={isLoopQueue ? "secondary" : "ghost"}
              size="icon-sm"
              onClick={() => {
                toggleLoopQueue();
                const nextState = !isLoopQueue;
                const msg = nextState
                  ? t("queue.announcementLoopQueueEnabled", "Queue loop enabled")
                  : t("queue.announcementLoopQueueDisabled", "Queue loop disabled");
                setLiveAnnouncement((prev) => (prev === msg ? `${msg}\u200B` : msg));
              }}
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
              <Repeat />
            </Button>
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
        onKeyDown={handleListKeyDown}
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
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
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Music />
              </EmptyMedia>
              <EmptyTitle>{t("queue.empty", "Queue is empty")}</EmptyTitle>
              <EmptyDescription>{t("queue.emptyHint", "Select a playlist or track to begin playback.")}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div
            role="list"
            aria-label={t("queue.regionAria", "Current playback queue")}
            className="relative h-(--virtual-size) w-full"
            style={{ "--virtual-size": `${rowVirtualizer.getTotalSize()}px` }}
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
                  className="row-divider absolute inset-x-0 top-0 translate-y-(--virtual-start)"
                  style={{ "--virtual-start": `${virtualRow.start}px` }}
                >
                  <QueueItemRow
                    item={item}
                    idx={virtualRow.index}
                    totalItems={displayQueue.length}
                    isCurrent={isCurrent}
                    isPlaying={isCurrent && isPlaying}
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
  );
}

// Docked beside the library on wide screens: a non-modal panel the player bar shows and hides
export function QueuePanel({ onClose }: QueueContentProps) {
  return (
    <aside
      id="queue-drawer"
      aria-labelledby="queue-drawer-title"
      className="sticky top-0 flex h-svh w-80 shrink-0 flex-col border-l border-sidebar-border bg-sidebar text-sidebar-foreground"
    >
      <QueueContent onClose={onClose} />
    </aside>
  );
}

// Overlay sheet for narrower screens
export function QueueDrawer({ isOpen, onClose }: QueueDrawerProps) {
  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent id="queue-drawer" showCloseButton={false}>
        <QueueContent onClose={onClose} titleAs={SheetTitle} closeOnNavigate />
      </SheetContent>
    </Sheet>
  );
}
