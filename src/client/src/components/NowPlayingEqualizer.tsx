import * as React from "react";
import { cn } from "../lib/utils";

export interface NowPlayingEqualizerProps {
  className?: string;
  barClassName?: string;
  isAnimated?: boolean;
}

export function NowPlayingEqualizer({
  className,
  barClassName,
  isAnimated = true,
}: NowPlayingEqualizerProps) {
  return (
    <span
      className={cn("inline-flex items-end gap-0.5 h-3 shrink-0", className)}
      aria-hidden="true"
    >
      <span
        className={cn(
          "w-0.5 bg-current rounded-full",
          isAnimated ? "h-3 animate-eq-1" : "h-1.5",
          barClassName
        )}
      />
      <span
        className={cn(
          "w-0.5 bg-current rounded-full",
          isAnimated ? "h-3 animate-eq-2" : "h-3",
          barClassName
        )}
      />
      <span
        className={cn(
          "w-0.5 bg-current rounded-full",
          isAnimated ? "h-3 animate-eq-3" : "h-2",
          barClassName
        )}
      />
    </span>
  );
}
