import * as React from "react";
import { useTranslation } from "react-i18next";
import { Skeleton } from "./ui/skeleton";
import { Spinner } from "./ui/spinner";
import type { PlayerState } from "../store/usePlayerStore";

const PLACEHOLDERS = Array.from({ length: 8 }, (_, i) => i);

interface LibrarySkeletonProps {
  viewMode: PlayerState["viewMode"];
}

// First-load placeholders shaped like the view that's about to appear, so nothing jumps when tracks arrive
export function LibrarySkeleton({ viewMode }: LibrarySkeletonProps) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-6">
      {viewMode === "grid" ? (
        <div aria-hidden="true" className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-4">
          {PLACEHOLDERS.map((n) => (
            <div key={n} className="flex flex-col gap-2">
              <Skeleton className="aspect-video w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          ))}
        </div>
      ) : (
        <div aria-hidden="true" className="flex flex-col">
          {PLACEHOLDERS.map((n) => (
            <div key={n} className="flex h-12.5 items-center gap-3 px-2">
              <Skeleton className="aspect-video h-8" />
              <div className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-3.5 w-2/5" />
                <Skeleton className="h-3 w-1/4" />
              </div>
              <Skeleton className="h-3 w-10" />
            </div>
          ))}
        </div>
      )}
      <p role="status" className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <Spinner aria-hidden="true" />
        {t("library.loading")}
      </p>
    </div>
  );
}
