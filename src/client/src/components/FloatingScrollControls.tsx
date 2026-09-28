import * as React from "react";
import { ChevronUp, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function safeRaf(cb: FrameRequestCallback): number {
  if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
    return window.requestAnimationFrame(cb);
  }
  return (setTimeout(cb, 16) as unknown) as number;
}

function safeCancelRaf(id: number): void {
  if (typeof window !== "undefined" && typeof window.cancelAnimationFrame === "function") {
    window.cancelAnimationFrame(id);
  } else {
    clearTimeout(id);
  }
}

export function FloatingScrollControls() {
  const { t } = useTranslation();
  const [isAtTop, setIsAtTop] = React.useState(true);
  const [isAtBottom, setIsAtBottom] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === "undefined") return;

    let rafId: number | null = null;

    const checkScrollBounds = () => {
      if (rafId !== null) return;
      rafId = safeRaf(() => {
        rafId = null;
        const currentY =
          window.scrollY ||
          window.pageYOffset ||
          document.documentElement?.scrollTop ||
          0;
        const docHeight = Math.max(
          document.documentElement?.scrollHeight || 0,
          document.body?.scrollHeight || 0
        );
        const winHeight = window.innerHeight || 0;

        setIsAtTop(currentY <= 30);
        setIsAtBottom(currentY + winHeight >= docHeight - 30);
      });
    };

    checkScrollBounds();
    window.addEventListener("scroll", checkScrollBounds, { passive: true });
    window.addEventListener("resize", checkScrollBounds, { passive: true });

    return () => {
      if (rafId !== null) safeCancelRaf(rafId);
      window.removeEventListener("scroll", checkScrollBounds);
      window.removeEventListener("resize", checkScrollBounds);
    };
  }, []);

  const scrollRafIdRef = React.useRef<number | null>(null);
  const bottomTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopSmoothScroll = React.useCallback(() => {
    if (scrollRafIdRef.current !== null) {
      safeCancelRaf(scrollRafIdRef.current);
      scrollRafIdRef.current = null;
    }
    if (bottomTimerRef.current !== null) {
      clearTimeout(bottomTimerRef.current);
      bottomTimerRef.current = null;
    }
    if (typeof window !== "undefined") {
      window.removeEventListener("wheel", stopSmoothScroll);
      window.removeEventListener("touchmove", stopSmoothScroll);
    }
  }, []);

  React.useEffect(() => {
    return () => {
      stopSmoothScroll();
    };
  }, [stopSmoothScroll]);

  const smoothScrollTo = React.useCallback(
    (targetY: number, onComplete?: () => void) => {
      if (typeof window === "undefined") return;

      stopSmoothScroll();

      const isReduced =
        typeof window !== "undefined" &&
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      const currentY =
        window.scrollY ||
        window.pageYOffset ||
        document.documentElement?.scrollTop ||
        0;

      if (isReduced || Math.abs(currentY - targetY) < 1) {
        window.scrollTo({ top: targetY, behavior: "instant" });
        onComplete?.();
        return;
      }

      window.addEventListener("wheel", stopSmoothScroll, { passive: true, once: true });
      window.addEventListener("touchmove", stopSmoothScroll, { passive: true, once: true });

      const distance = Math.abs(targetY - currentY);
      const duration = Math.min(550, Math.max(250, Math.round(Math.log(distance + 1) * 55)));
      const startTime = typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();

      const step = (time: number) => {
        const now =
          typeof time === "number" && time > 0
            ? time
            : typeof performance !== "undefined" && performance.now
              ? performance.now()
              : Date.now();
        const elapsed = Math.max(0, now - startTime);
        const progress = Math.min(1, elapsed / duration);
        const nextY = Math.round(currentY + (targetY - currentY) * easeInOutCubic(progress));

        window.scrollTo({ top: nextY, behavior: "instant" });

        if (progress < 1) {
          scrollRafIdRef.current = safeRaf(step);
        } else {
          scrollRafIdRef.current = null;
          window.removeEventListener("wheel", stopSmoothScroll);
          window.removeEventListener("touchmove", stopSmoothScroll);
          window.scrollTo({ top: targetY, behavior: "instant" });
          onComplete?.();
        }
      };

      scrollRafIdRef.current = safeRaf(step);
    },
    [stopSmoothScroll]
  );

  const handleScrollToTop = React.useCallback(() => {
    smoothScrollTo(0);
  }, [smoothScrollTo]);

  const handleScrollToBottom = React.useCallback(() => {
    if (typeof window === "undefined") return;
    const docHeight = Math.max(
      document.documentElement?.scrollHeight || 0,
      document.body?.scrollHeight || 0
    );

    smoothScrollTo(docHeight, () => {
      // In virtualized lists with dynamic card measurements, rows might adjust as rendered.
      // Ensure accurate bottom settling:
      if (bottomTimerRef.current !== null) {
        clearTimeout(bottomTimerRef.current);
      }
      bottomTimerRef.current = setTimeout(() => {
        bottomTimerRef.current = null;
        const freshHeight = Math.max(
          document.documentElement?.scrollHeight || 0,
          document.body?.scrollHeight || 0
        );
        if (freshHeight > docHeight) {
          window.scrollTo({
            top: freshHeight,
            behavior: "instant",
          });
        }
      }, 100);
    });
  }, [smoothScrollTo]);

  return (
    <aside
      aria-label={t("scroll.navigation", "Quick scroll navigation")}
      role="group"
      className="fixed z-30 bottom-24 right-4 sm:right-6 md:right-8 flex flex-col items-center bg-card/90 hover:bg-card/95 backdrop-blur-md border border-border/80 shadow-lg hover:shadow-xl rounded-full p-1 transition-all duration-200 gap-0.5 select-none animate-in fade-in zoom-in-95"
    >
      <button
        type="button"
        data-testid="scroll-to-top"
        onClick={handleScrollToTop}
        aria-label={t("scroll.scrollToTop", "Scroll to top")}
        title={t("scroll.scrollToTop", "Scroll to top")}
        className={`flex items-center justify-center h-8 w-8 rounded-full text-muted-foreground hover:text-primary hover:bg-primary/10 active:scale-90 transition-all duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
          isAtTop ? "opacity-45 hover:opacity-100" : "opacity-100"
        }`}
      >
        <ChevronUp className="h-4 w-4" />
      </button>

      <div role="separator" aria-orientation="horizontal" className="h-px w-3.5 bg-border/60 my-0.5" />

      <button
        type="button"
        data-testid="scroll-to-bottom"
        onClick={handleScrollToBottom}
        aria-label={t("scroll.scrollToBottom", "Scroll to bottom")}
        title={t("scroll.scrollToBottom", "Scroll to bottom")}
        className={`flex items-center justify-center h-8 w-8 rounded-full text-muted-foreground hover:text-primary hover:bg-primary/10 active:scale-90 transition-all duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
          isAtBottom ? "opacity-45 hover:opacity-100" : "opacity-100"
        }`}
      >
        <ChevronDown className="h-4 w-4" />
      </button>
    </aside>
  );
}
