import * as React from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "./ui/button";
import { ButtonGroup } from "./ui/button-group";
import { cn } from "../lib/utils";

interface ShelfProps {
  title: string;
  // A line under the title, such as the period the shelf covers
  description?: string;
  // Beside the paging buttons, such as Play and Shuffle
  actions?: React.ReactNode;
  // The columns a page shows (shelf-columns-<n>, by container size) and, for songs, the rows
  listClassName: string;
  // List items
  children: React.ReactNode;
}

// A titled row of items that scrolls sideways a page at a time, like the shelves on Apple Music's Home
export function Shelf({ title, description, actions, listClassName, children }: ShelfProps) {
  const { t } = useTranslation();
  const headingId = React.useId();
  const listRef = React.useRef<HTMLUListElement>(null);
  const [edges, setEdges] = React.useState({ atStart: true, atEnd: true });

  // Paging stops at either end, and a shelf whose items all fit has none
  const measure = React.useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    const atStart = list.scrollLeft <= 1;
    const atEnd = list.scrollLeft + list.clientWidth >= list.scrollWidth - 1;
    setEdges((prev) => (prev.atStart === atStart && prev.atEnd === atEnd ? prev : { atStart, atEnd }));
  }, []);

  // Items come and go between renders, and the shelf narrows as the sidebar or the queue opens
  React.useLayoutEffect(measure);
  React.useEffect(() => {
    const observer = new ResizeObserver(measure);
    if (listRef.current) observer.observe(listRef.current);
    return () => observer.disconnect();
  }, [measure]);

  // A page is the width the items show in, inside the margins the list scrolls out into; their snap points settle it on the next column
  const page = (direction: 1 | -1) => {
    const list = listRef.current;
    if (!list) return;
    const { paddingLeft, paddingRight } = getComputedStyle(list);
    list.scrollBy({ left: direction * (list.clientWidth - parseFloat(paddingLeft) - parseFloat(paddingRight)) });
  };
  const previousLabel = t("home.previousPage", { name: title });
  const nextLabel = t("home.nextPage", { name: title });

  return (
    <section aria-labelledby={headingId} className="@container flex flex-col gap-3">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h3 id={headingId} className="text-base font-bold text-foreground">
            {title}
          </h3>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {actions}
          {/* Touch swipes the list instead, as in Apple Music on iPhone */}
          {!(edges.atStart && edges.atEnd) && (
            <ButtonGroup className="pointer-coarse:hidden">
              <Button variant="ghost" size="icon-sm" disabled={edges.atStart} onClick={() => page(-1)} aria-label={previousLabel} title={previousLabel}>
                <ChevronLeft />
              </Button>
              <Button variant="ghost" size="icon-sm" disabled={edges.atEnd} onClick={() => page(1)} aria-label={nextLabel} title={nextLabel}>
                <ChevronRight />
              </Button>
            </ButtonGroup>
          )}
        </div>
      </div>
      {/* Scrolls out into the page's side margins as Apple Music's shelves do: items line up with the page, and the next
          one peeks in. Padded above and below by the width of a focus ring, which the scroller would otherwise clip */}
      <ul
        ref={listRef}
        onScroll={measure}
        className={cn(
          "-mx-(--page-gutter) -my-1 grid snap-x snap-mandatory scroll-px-(--page-gutter) grid-flow-col overflow-x-auto overscroll-x-contain px-(--page-gutter) py-1 [scrollbar-width:none] *:snap-start motion-safe:scroll-smooth",
          listClassName
        )}
      >
        {children}
      </ul>
    </section>
  );
}
