import * as React from "react";

// Tailwind's xl: room for the full sidebar, the library and the docked queue side by side
export const WIDE_LAYOUT_QUERY = "(min-width: 1280px)";

// Tailwind's sm: wide enough for a table row's actions to sit inline instead of in its "..." menu
export const INLINE_ROW_ACTIONS_QUERY = "(min-width: 640px)";

export function useMediaQuery(query: string) {
  const subscribe = React.useCallback(
    (onChange: () => void) => {
      const mediaQueryList = window.matchMedia(query);
      mediaQueryList.addEventListener("change", onChange);
      return () => mediaQueryList.removeEventListener("change", onChange);
    },
    [query]
  );
  return React.useSyncExternalStore(subscribe, () => window.matchMedia(query).matches);
}
