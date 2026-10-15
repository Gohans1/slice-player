import * as React from "react";
import { useWindowVirtualizer, defaultRangeExtractor, measureElement, type Range } from "@tanstack/react-virtual";
import { GripVertical } from "lucide-react";
import { cn } from "../lib/utils";

export interface CardDragProps {
  canDrag: boolean;
  isDragging: boolean;
  isDragTarget: boolean;
  isReordering?: boolean;
  onPointerDownHandle: (e: React.PointerEvent) => void;
  onKeyDownHandle: (e: React.KeyboardEvent) => void;
}

export interface VirtualizedCardGridProps<T> {
  items: T[];
  getItemKey: (item: T, index: number) => string;
  renderItem: (item: T, index: number, dragProps?: CardDragProps) => React.ReactNode;
  className?: string;
  estimateCardHeight?: number;
  scrollRequest?: { index: number; requestId: number } | null;
  onScrollHandled?: (requestId: number) => void;
  initialScrollOffset?: number;
  /** @deprecated use scrollRequest instead */
  scrollToIndex?: number | null;
  isReorderable?: boolean;
  onReorder?: (fromIndex: number, toIndex: number) => void | Promise<void>;
  getItemName?: (item: T) => string;
  getItemThumbnail?: (item: T) => string | undefined;
}

// Parks the drag preview off screen until the first dragover gives it a position
const DRAG_PREVIEW_HIDDEN = "-9999px";
const MIN_CARD_WIDTH = 240;
// Space between cards, across and down
const GRID_GAP = 20;
const MAX_COLUMNS = 8;

// As many cards of at least MIN_CARD_WIDTH as fit the grid's own width (GRID_GAP between them)
export function columnsForWidth(width: number): number {
  const fit = Math.floor((width + GRID_GAP) / (MIN_CARD_WIDTH + GRID_GAP));
  return Math.min(MAX_COLUMNS, Math.max(1, fit));
}

/**
 * Column count for a card grid, measured from the grid element rather than the window,
 * so it adapts when the sidebar expands, collapses to icons or hides.
 */
export function useGridColumnCount(ref: React.RefObject<HTMLElement | null>): number {
  const [cols, setCols] = React.useState(4);

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const update = () => {
      // 0 means no layout yet (or a test DOM); keep the current count
      if (el.clientWidth > 0) setCols(columnsForWidth(el.clientWidth));
    };
    update();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);

  return cols;
}

export function VirtualizedCardGrid<T>({
  items,
  getItemKey,
  renderItem,
  className,
  estimateCardHeight,
  scrollRequest,
  onScrollHandled,
  initialScrollOffset,
  scrollToIndex,
  isReorderable = false,
  onReorder,
  getItemName,
  getItemThumbnail,
}: VirtualizedCardGridProps<T>) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const cols = useGridColumnCount(containerRef);
  const [scrollMargin, setScrollMargin] = React.useState(0);

  // Drag & drop state and refs
  const [draggedIdx, setDraggedIdx] = React.useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = React.useState<number | null>(null);
  const [isReordering, setIsReordering] = React.useState(false);

  const draggedIdxRef = React.useRef<number | null>(null);
  const dragOverIdxRef = React.useRef<number | null>(null);
  const isDraggingHandleRef = React.useRef(false);
  const isReorderingRef = React.useRef(false);
  const floatingPreviewRef = React.useRef<HTMLDivElement>(null);
  const autoScrollRafRef = React.useRef<number | null>(null);
  const scrollSpeedRef = React.useRef(0);
  const pendingFocusIndexRef = React.useRef<number | null>(null);

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

  const defaultEstimatedHeight = estimateCardHeight ?? (cols === 1 ? 360 : 260);
  // Cards in a grid share one height, so the last card measured is the best guess for cards not measured yet
  // (a search swaps in cards the virtualizer has never seen; a wrong guess shifts every card once they're measured)
  const measuredCardHeightRef = React.useRef<number | null>(null);

  // Guarantee the dragged card remains mounted during window scroll
  const rangeExtractor = React.useCallback(
    (range: Range) => {
      const active = defaultRangeExtractor(range);
      if (draggedIdx !== null && !active.includes(draggedIdx)) {
        return [...active, draggedIdx].sort((a, b) => a - b);
      }
      return active;
    },
    [draggedIdx]
  );

  // Each card is its own virtual item laid out in `cols` lanes and keyed by its own id, so a change in the
  // column count (the sidebar collapsing, say) moves cards between lanes without remounting them
  const virtualizer = useWindowVirtualizer({
    count: items.length,
    lanes: cols,
    gap: GRID_GAP,
    estimateSize: () => measuredCardHeightRef.current ?? defaultEstimatedHeight,
    measureElement: (element, entry, instance) => {
      const height = measureElement(element, entry, instance);
      measuredCardHeightRef.current = height;
      return height;
    },
    overscan: cols * 2,
    scrollMargin,
    rangeExtractor,
    ...(typeof initialScrollOffset === "number" && initialScrollOffset > 0
      ? { initialOffset: initialScrollOffset }
      : {}),
    getItemKey: React.useCallback((index: number) => getItemKey(items[index], index), [items, getItemKey]),
  });

  // Autoscroll mechanics
  const stopAutoScroll = React.useCallback(() => {
    if (autoScrollRafRef.current !== null) {
      cancelAnimationFrame(autoScrollRafRef.current);
      autoScrollRafRef.current = null;
    }
    scrollSpeedRef.current = 0;
  }, []);

  const checkAutoScroll = React.useCallback(
    (clientY: number) => {
      if (typeof window === "undefined") return;
      const edgeThreshold = 120;
      const viewportHeight = window.innerHeight;
      let speed = 0;

      if (clientY < edgeThreshold) {
        const factor = Math.max(0, (edgeThreshold - clientY) / edgeThreshold);
        speed = -Math.round(4 + factor * 20);
      } else if (clientY > viewportHeight - edgeThreshold) {
        const factor = Math.max(0, (clientY - (viewportHeight - edgeThreshold)) / edgeThreshold);
        speed = Math.round(4 + factor * 20);
      }

      scrollSpeedRef.current = speed;

      if (speed !== 0) {
        if (autoScrollRafRef.current === null) {
          const step = () => {
            if (scrollSpeedRef.current !== 0) {
              window.scrollBy({ top: scrollSpeedRef.current, behavior: "auto" });
              autoScrollRafRef.current = requestAnimationFrame(step);
            } else {
              autoScrollRafRef.current = null;
            }
          };
          autoScrollRafRef.current = requestAnimationFrame(step);
        }
      } else {
        stopAutoScroll();
      }
    },
    [stopAutoScroll]
  );

  // Floating preview position updater
  const updatePreviewPosition = React.useCallback((clientX: number, clientY: number) => {
    if (floatingPreviewRef.current) {
      floatingPreviewRef.current.style.setProperty("--drag-x", `${clientX + 16}px`);
      floatingPreviewRef.current.style.setProperty("--drag-y", `${clientY + 16}px`);
    }
  }, []);

  // Reset drag state
  const resetDragState = React.useCallback(() => {
    stopAutoScroll();
    isDraggingHandleRef.current = false;
    draggedIdxRef.current = null;
    dragOverIdxRef.current = null;
    setDraggedIdx(null);
    setDragOverIdx(null);
    if (floatingPreviewRef.current) {
      floatingPreviewRef.current.style.setProperty("--drag-x", DRAG_PREVIEW_HIDDEN);
      floatingPreviewRef.current.style.setProperty("--drag-y", DRAG_PREVIEW_HIDDEN);
    }
  }, [stopAutoScroll]);

  // Commit reorder callback
  const commitReorder = React.useCallback(
    async (fromIdx: number, toIdx: number) => {
      if (!isReorderable || isReorderingRef.current || fromIdx === toIdx) return;
      if (fromIdx < 0 || fromIdx >= items.length || toIdx < 0 || toIdx >= items.length) return;
      isReorderingRef.current = true;
      setIsReordering(true);
      try {
        await onReorder?.(fromIdx, toIdx);
      } finally {
        isReorderingRef.current = false;
        setIsReordering(false);
      }
    },
    [isReorderable, items.length, onReorder]
  );

  // Keyboard navigation for reordering
  const handleKeyDownReorder = React.useCallback(
    (e: React.KeyboardEvent, index: number) => {
      if (!isReorderable || isReorderingRef.current) return;
      let targetIdx: number | null = null;

      if (e.key === "ArrowLeft" && index > 0) {
        targetIdx = index - 1;
      } else if (e.key === "ArrowRight" && index < items.length - 1) {
        targetIdx = index + 1;
      } else if (e.key === "ArrowUp") {
        targetIdx = Math.max(0, index - cols);
      } else if (e.key === "ArrowDown") {
        targetIdx = Math.min(items.length - 1, index + cols);
      } else if (e.key === "Home" && index > 0) {
        targetIdx = 0;
      } else if (e.key === "End" && index < items.length - 1) {
        targetIdx = items.length - 1;
      }

      if (targetIdx !== null && targetIdx !== index) {
        e.preventDefault();
        e.stopPropagation();
        pendingFocusIndexRef.current = targetIdx;
        virtualizer?.scrollToIndex?.(targetIdx, { align: "auto" });
        commitReorder(index, targetIdx);
      }
    },
    [isReorderable, cols, items.length, virtualizer, commitReorder]
  );

  // Restore focus to moved item's drag handle after keyboard reordering
  React.useEffect(() => {
    if (pendingFocusIndexRef.current !== null) {
      const targetIdx = pendingFocusIndexRef.current;
      pendingFocusIndexRef.current = null;
      requestAnimationFrame(() => {
        const handleEl = containerRef.current?.querySelector<HTMLElement>(
          `[data-drag-handle-index="${targetIdx}"]`
        );
        handleEl?.focus();
      });
    }
  }, [items]);

  // HTML5 Drag Event Handlers
  const handleDragStart = React.useCallback(
    (e: React.DragEvent, idx: number) => {
      if (!isDraggingHandleRef.current || !isReorderable || isReorderingRef.current) {
        e.preventDefault();
        return;
      }
      draggedIdxRef.current = idx;
      setDraggedIdx(idx);
      e.dataTransfer.setData("application/x-slice-card-grid-index", String(idx));
      const name = getItemName ? getItemName(items[idx]) : "";
      e.dataTransfer.setData("text/plain", name);
      e.dataTransfer.effectAllowed = "move";

      try {
        if (e.dataTransfer.setDragImage) {
          const emptyImg = new Image();
          emptyImg.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
          e.dataTransfer.setDragImage(emptyImg, 0, 0);
        }
      } catch {
        // Fallback gracefully
      }
      updatePreviewPosition(e.clientX, e.clientY);
    },
    [isReorderable, items, getItemName, updatePreviewPosition]
  );

  const handleDragOver = React.useCallback(
    (e: React.DragEvent, targetIdx: number) => {
      if (draggedIdxRef.current === null) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      checkAutoScroll(e.clientY);
      updatePreviewPosition(e.clientX, e.clientY);
      if (dragOverIdxRef.current !== targetIdx) {
        dragOverIdxRef.current = targetIdx;
        setDragOverIdx(targetIdx);
      }
    },
    [checkAutoScroll, updatePreviewPosition]
  );

  const handleDrop = React.useCallback(
    (e: React.DragEvent, targetIdx: number) => {
      e.preventDefault();
      e.stopPropagation();
      stopAutoScroll();
      const rawIdx = e.dataTransfer.getData("application/x-slice-card-grid-index");
      const fromIdx = rawIdx ? parseInt(rawIdx, 10) : draggedIdxRef.current;
      if (fromIdx !== null && !isNaN(fromIdx) && fromIdx !== targetIdx) {
        commitReorder(fromIdx, targetIdx);
      }
      resetDragState();
    },
    [commitReorder, resetDragState, stopAutoScroll]
  );

  const handleDragEnd = React.useCallback(() => {
    stopAutoScroll();
    resetDragState();
  }, [stopAutoScroll, resetDragState]);

  // Global window listeners for dragover, drop, dragend, blur, and pointerup
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
    };

    const handleGlobalDrop = (e: DragEvent) => {
      if (draggedIdxRef.current === null) return;
      e.preventDefault();
      stopAutoScroll();
      resetDragState();
    };

    const handleGlobalDragEnd = () => {
      stopAutoScroll();
      resetDragState();
    };

    window.addEventListener("dragover", handleGlobalDragOver);
    window.addEventListener("drop", handleGlobalDrop);
    window.addEventListener("dragend", handleGlobalDragEnd);
    window.addEventListener("blur", resetDragState);

    return () => {
      window.removeEventListener("dragover", handleGlobalDragOver);
      window.removeEventListener("drop", handleGlobalDrop);
      window.removeEventListener("dragend", handleGlobalDragEnd);
      window.removeEventListener("blur", resetDragState);
    };
  }, [draggedIdx, checkAutoScroll, updatePreviewPosition, stopAutoScroll, resetDragState]);

  // Window pointerup resets dragging handle if not in drag session
  React.useEffect(() => {
    const handlePointerUp = () => {
      if (draggedIdxRef.current === null) {
        isDraggingHandleRef.current = false;
      }
    };
    window.addEventListener("pointerup", handlePointerUp);
    return () => window.removeEventListener("pointerup", handlePointerUp);
  }, []);

  // Cleanup on unmount
  React.useEffect(() => {
    return () => {
      stopAutoScroll();
    };
  }, [stopAutoScroll]);

  const lastHandledScrollRequestIdRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    if (
      scrollRequest &&
      typeof scrollRequest.index === "number" &&
      scrollRequest.index >= 0 &&
      cols > 0 &&
      lastHandledScrollRequestIdRef.current !== scrollRequest.requestId
    ) {
      lastHandledScrollRequestIdRef.current = scrollRequest.requestId;
      const currentY = typeof window !== "undefined" ? window.scrollY || window.pageYOffset || 0 : 0;
      const estimatedTargetY = Math.floor(scrollRequest.index / cols) * (defaultEstimatedHeight + GRID_GAP);
      const distance = Math.abs(currentY - estimatedTargetY);
      const isClose = distance < (typeof window !== "undefined" ? window.innerHeight * 1.2 : 800);
      const prefersReduced =
        typeof window !== "undefined" &&
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const behavior = !prefersReduced && isClose && distance > 20 ? "smooth" : "auto";

      virtualizer.scrollToIndex(scrollRequest.index, { align: "center", behavior });
      onScrollHandled?.(scrollRequest.requestId);
    }
  }, [scrollRequest, cols, virtualizer, onScrollHandled, defaultEstimatedHeight]);

  React.useEffect(() => {
    if (typeof scrollToIndex === "number" && scrollToIndex >= 0) {
      virtualizer.scrollToIndex(scrollToIndex, { align: "center", behavior: "auto" });
    }
  }, [scrollToIndex, virtualizer]);

  isReorderingRef.current = isReordering;

  const handlePointerDownHandle = React.useCallback((e: React.PointerEvent) => {
    if (e.button === 0 && !isReorderingRef.current) {
      isDraggingHandleRef.current = true;
    }
  }, []);

  if (items.length === 0) {
    return <div ref={containerRef} className={className} />;
  }

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div ref={containerRef} className={cn("relative [overflow-anchor:none]", className)}>
      {/* Floating Drag Preview */}
      {draggedIdx !== null && items[draggedIdx] && (
        <div
          ref={floatingPreviewRef}
          aria-hidden="true"
          className="pointer-events-none fixed top-0 left-0 z-50 flex translate-x-(--drag-x) translate-y-(--drag-y) items-center gap-2.5 rounded-lg border border-primary/40 bg-card/95 px-3 py-2 text-xs font-medium text-foreground shadow-2xl shadow-primary/30 ring-1 ring-primary/20 backdrop-blur-md"
          style={{ "--drag-x": DRAG_PREVIEW_HIDDEN, "--drag-y": DRAG_PREVIEW_HIDDEN }}
        >
          <GripVertical className="size-4 shrink-0 text-primary" />
          {getItemThumbnail?.(items[draggedIdx]) && (
            <img
              src={getItemThumbnail(items[draggedIdx])}
              alt=""
              className="size-7 shrink-0 rounded object-cover"
            />
          )}
          <span className="max-w-50 truncate text-xs font-semibold">
            {getItemName?.(items[draggedIdx]) ?? `Item ${draggedIdx + 1}`}
          </span>
        </div>
      )}

      <div
        role="presentation"
        className="relative h-(--virtual-size) w-full"
        style={{
          "--virtual-size": `${virtualizer.getTotalSize()}px`,
          "--card-width": `calc((100% - ${(cols - 1) * GRID_GAP}px) / ${cols})`,
        }}
      >
        {virtualItems.map((virtualItem) => {
          const itemIndex = virtualItem.index;
          const item = items[itemIndex];
          const isDragging = draggedIdx === itemIndex;
          const isDragTarget = dragOverIdx === itemIndex && draggedIdx !== null && draggedIdx !== itemIndex;
          const canDrag = Boolean(isReorderable && !isReordering);

          const dragProps: CardDragProps = {
            canDrag,
            isDragging,
            isDragTarget,
            isReordering,
            onPointerDownHandle: handlePointerDownHandle,
            onKeyDownHandle: (e) => {
              handleKeyDownReorder(e, itemIndex);
            },
          };

          return (
            <div
              key={virtualItem.key}
              data-index={itemIndex}
              ref={virtualizer.measureElement}
              draggable={canDrag}
              onDragStart={(e) => handleDragStart(e, itemIndex)}
              onDragOver={(e) => handleDragOver(e, itemIndex)}
              onDragLeave={() => {
                // Keep sticky until next target or drop
              }}
              onDrop={(e) => handleDrop(e, itemIndex)}
              onDragEnd={handleDragEnd}
              className="absolute top-0 left-(--lane-start) w-(--card-width) translate-y-(--virtual-start)"
              style={{
                "--virtual-start": `${virtualItem.start - virtualizer.options.scrollMargin}px`,
                "--lane-start": `calc(${virtualItem.lane} * (var(--card-width) + ${GRID_GAP}px))`,
              }}
            >
              {renderItem(item, itemIndex, dragProps)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
