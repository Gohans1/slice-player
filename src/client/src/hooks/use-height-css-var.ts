import * as React from "react";

// Publishes an element's rendered height as a CSS variable on <html>, so fixed
// chrome (navbar, player bar) can offset sticky and fixed siblings. Returns a
// callback ref, so it follows the element when a component swaps layouts.
export function useHeightCssVar(name: `--${string}`) {
  return React.useCallback(
    (el: HTMLElement | null) => {
      if (!el) return undefined;
      const rootStyle = el.ownerDocument.documentElement.style;
      const update = () => {
        if (el.offsetHeight > 0) rootStyle.setProperty(name, `${el.offsetHeight}px`);
      };
      update();
      const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
      observer?.observe(el);
      return () => {
        observer?.disconnect();
        rootStyle.removeProperty(name);
      };
    },
    [name]
  );
}
