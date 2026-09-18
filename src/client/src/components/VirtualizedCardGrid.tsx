import * as React from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";

export interface VirtualizedCardGridProps<T> {
  items: T[];
  getItemKey: (item: T, index: number) => string;
  renderItem: (item: T, index: number) => React.ReactNode;
  className?: string;
  estimateCardHeight?: number;
}

/**
 * Hook to track responsive column count matching Tailwind breakpoints:
 * - default (<640px): 1 column
 * - sm (640px - 767px): 2 columns
 * - md (768px - 1023px): 3 columns
 * - lg+ (>= 1024px): 4 columns
 */
export function useGridColumnCount(): number {
  const getCols = React.useCallback(() => {
    if (typeof window === "undefined") return 4;
    const w = window.innerWidth > 0 ? window.innerWidth : 1024;
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
}: VirtualizedCardGridProps<T>) {
  const cols = useGridColumnCount();
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = React.useState(0);

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

  const virtualizer = useWindowVirtualizer({
    count: rows.length,
    estimateSize: () => defaultEstimatedHeight,
    overscan: 4,
    scrollMargin,
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

  if (items.length === 0) {
    return <div ref={containerRef} className={className} />;
  }

  const virtualRows = virtualizer.getVirtualItems();

  return (
    <div ref={containerRef} className={className}>
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
                return (
                  <React.Fragment key={getItemKey(item, itemIndex)}>
                    {renderItem(item, itemIndex)}
                  </React.Fragment>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
