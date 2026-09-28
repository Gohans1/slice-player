import * as React from "react";
import { useWindowVirtualizer, defaultRangeExtractor, type Range } from "@tanstack/react-virtual";
import { GripVertical } from "lucide-react";

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

/**
 * Hook to track responsive column count matching responsive breakpoints:
 * - default (<640px): 1 column
 * - sm (640px - 767px): 2 columns
 * - md (768px - 1023px): 3 columns
 * - lg (1024px - 1365px): 4 columns
 * - xl (1366px - 1679px): 5 columns
 * - 2xl / 1080p full screen (1680px - 2047px): 6 columns
 * - 3xl / Ultrawide (2048px - 2559px): 7 columns
 * - 4K / 2K large (>= 2560px): 8 columns
 */
export function useGridColumnCount(): number {
  const getCols = React.useCallback(() => {
    if (typeof window === "undefined") return 4;
    const w = window.innerWidth > 0 ? window.innerWidth : 1024;
    if (w >= 2560) return 8;
    if (w >= 2048) return 7;
    if (w >= 1680) return 6;
    if (w >= 1366) return 5;
    if (w >= 1024) return 4;
    if (w >= 768) return 3;
    if (w >= 640) return 2;
    return 1;
  }, []);

  const [cols, setCols] = React.useState<number>(getCols);

  React.useEffect(() => {
    if (typeof window === "undefined") return;

    let rafId: number | null = null;
    const handleResize = () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        setCols(getCols());
      });
    };

    window.addEventListener("resize", handleResize, { passive: true });

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      window.removeEventListener("resize", handleResize);
    };
  }, [getCols]);

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
  const cols = useGridColumnCount();
  const containerRef = React.useRef<HTMLDivElement>(null);
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

  // Group items into rows of `cols` items
  const rows = React.useMemo(() => {
    const result: T[][] = [];
    for (let i = 0; i < items.length; i += cols) {
      result.push(items.slice(i, i + cols));
    }
    return result;
  }, [items, cols]);

  const defaultEstimatedHeight = estimateCardHeight ?? (cols === 1 ? 380 : 310);

  // Guarantee the row containing the dragged item remains mounted during window scroll
  const draggedRowIndex = draggedIdx !== null && cols > 0 ? Math.floor(draggedIdx / cols) : null;
  const rangeExtractor = React.useCallback(
    (range: Range) => {
      const active = defaultRangeExtractor(range);
      if (draggedRowIndex !== null && !active.includes(draggedRowIndex)) {
        return [...active, draggedRowIndex].sort((a, b) => a - b);
      }
      return active;
    },
    [draggedRowIndex]
  );

  const virtualizer = useWindowVirtualizer({
    count: rows.length,
    estimateSize: () => defaultEstimatedHeight,
    overscan: 4,
    scrollMargin,
    rangeExtractor,
    ...(typeof initialScrollOffset === "number" && initialScrollOffset > 0
      ? { initialOffset: initialScrollOffset }
      : {}),
    getItemKey: React.useCallback(
      (index: number) => `row_c${cols}_${index}`,
      [cols]
    ),
  });

  // Re-measure all items synchronously before paint when column count transitions across responsive breakpoints
  const prevColsRef = React.useRef(cols);
  React.useLayoutEffect(() => {
    if (prevColsRef.current !== cols) {
      prevColsRef.current = cols;
      virtualizer.measure();
    }
  }, [cols, virtualizer]);

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
      floatingPreviewRef.current.style.opacity = "1";
      floatingPreviewRef.current.style.transform = `translate3d(${clientX + 16}px, ${clientY + 16}px, 0)`;
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
      floatingPreviewRef.current.style.opacity = "0";
      floatingPreviewRef.current.style.transform = "translate3d(-9999px, -9999px, 0)";
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
        if (virtualizer?.scrollToIndex && cols > 0) {
          virtualizer.scrollToIndex(Math.floor(targetIdx / cols), { align: "auto" });
        }
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
      const rowIndex = Math.floor(scrollRequest.index / cols);
      const currentY = typeof window !== "undefined" ? window.scrollY || window.pageYOffset || 0 : 0;
      const estimatedTargetY = rowIndex * defaultEstimatedHeight;
      const distance = Math.abs(currentY - estimatedTargetY);
      const isClose = distance < (typeof window !== "undefined" ? window.innerHeight * 1.2 : 800);
      const prefersReduced =
        typeof window !== "undefined" &&
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const behavior = !prefersReduced && isClose && distance > 20 ? "smooth" : "auto";

      virtualizer.scrollToIndex(rowIndex, { align: "center", behavior });
      onScrollHandled?.(scrollRequest.requestId);
    }
  }, [scrollRequest, cols, virtualizer, onScrollHandled, defaultEstimatedHeight]);

  React.useEffect(() => {
    if (typeof scrollToIndex === "number" && scrollToIndex >= 0 && cols > 0) {
      const rowIndex = Math.floor(scrollToIndex / cols);
      virtualizer.scrollToIndex(rowIndex, { align: "center", behavior: "auto" });
    }
  }, [scrollToIndex, cols, virtualizer]);

  isReorderingRef.current = isReordering;

  const handlePointerDownHandle = React.useCallback((e: React.PointerEvent) => {
    if (e.button === 0 && !isReorderingRef.current) {
      isDraggingHandleRef.current = true;
    }
  }, []);

  if (items.length === 0) {
    return <div ref={containerRef} className={className} />;
  }

  const virtualRows = virtualizer.getVirtualItems();

  return (
    <div ref={containerRef} className={`relative ${className || ""}`} style={{ overflowAnchor: "none" }}>
      {/* Floating Drag Preview */}
      {draggedIdx !== null && items[draggedIdx] && (
        <div
          ref={floatingPreviewRef}
          className="pointer-events-none fixed top-0 left-0 z-[9999] flex items-center gap-2.5 rounded-lg border border-primary/40 bg-card/95 px-3 py-2 text-xs font-medium text-foreground shadow-2xl shadow-primary/30 ring-1 ring-primary/20 backdrop-blur-md transition-none will-change-transform"
          style={{
            opacity: 0,
            transform: "translate3d(-9999px, -9999px, 0)",
          }}
        >
          <GripVertical className="h-4 w-4 text-primary shrink-0" />
          {getItemThumbnail?.(items[draggedIdx]) && (
            <img
              src={getItemThumbnail(items[draggedIdx])}
              alt=""
              className="h-7 w-7 rounded object-cover shrink-0"
            />
          )}
          <span className="max-w-[200px] truncate text-xs font-semibold">
            {getItemName?.(items[draggedIdx]) ?? `Item ${draggedIdx + 1}`}
          </span>
        </div>
      )}

      <div
        role="presentation"
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
        }}
      >
        {virtualRows.map((virtualRow) => {
          const rowItems = rows[virtualRow.index] || [];
          const baseIndex = virtualRow.index * cols;

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
                display: "grid",
                gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
              }}
              className="gap-4 sm:gap-5 pb-4 sm:pb-5"
            >
              {rowItems.map((item, colIdx) => {
                const itemIndex = baseIndex + colIdx;
                const isDragging = draggedIdx === itemIndex;
                const isDragTarget =
                  dragOverIdx === itemIndex &&
                  draggedIdx !== null &&
                  draggedIdx !== itemIndex;
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
                    key={getItemKey(item, itemIndex)}
                    draggable={canDrag}
                    onDragStart={(e) => handleDragStart(e, itemIndex)}
                    onDragOver={(e) => handleDragOver(e, itemIndex)}
                    onDragLeave={() => {
                      // Keep sticky until next target or drop
                    }}
                    onDrop={(e) => handleDrop(e, itemIndex)}
                    onDragEnd={handleDragEnd}
                    className="h-full"
                  >
                    {renderItem(item, itemIndex, dragProps)}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
