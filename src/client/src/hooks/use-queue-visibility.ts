import * as React from "react";
import { useMediaQuery, WIDE_LAYOUT_QUERY } from "./use-media-query";

// On wide screens the queue docks beside the library; below that it opens as an overlay sheet
export function useQueueVisibility() {
  const isDocked = useMediaQuery(WIDE_LAYOUT_QUERY);
  const [isPanelOpen, setIsPanelOpen] = React.useState(true);
  const [isSheetOpen, setIsSheetOpen] = React.useState(false);

  // The overlay belongs to narrow screens only, so docking closes it for good
  const [wasDocked, setWasDocked] = React.useState(isDocked);
  if (wasDocked !== isDocked) {
    setWasDocked(isDocked);
    if (isDocked) setIsSheetOpen(false);
  }

  const setOpen = isDocked ? setIsPanelOpen : setIsSheetOpen;
  const toggle = React.useCallback(() => setOpen((open) => !open), [setOpen]);
  const close = React.useCallback(() => setOpen(false), [setOpen]);

  return { isDocked, isOpen: isDocked ? isPanelOpen : isSheetOpen, toggle, close };
}
