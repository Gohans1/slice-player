import React from "react";
import { useTranslation } from "react-i18next";
import { ArrowUpDown, ArrowDownNarrowWide, ArrowUpNarrowWide, Shuffle } from "lucide-react";
import { usePlayerStore, type PlaylistSortMode, type PlaybackMode } from "../store/usePlayerStore";

interface PlaylistSortSelectorProps {
  className?: string;
}

export function PlaylistSortSelector({ className = "" }: PlaylistSortSelectorProps) {
  const { t } = useTranslation();
  const playlistSortMode = usePlayerStore((s) => s.playlistSortMode);
  const setPlaylistSortMode = usePlayerStore((s) => s.setPlaylistSortMode);
  const randomizePlaylistSort = usePlayerStore((s) => s.randomizePlaylistSort);
  const activePlaylistId = usePlayerStore((s) => s.activePlaylistId);
  const activeSystemCategory = usePlayerStore((s) => s.activeSystemCategory);
  const systemCategorySortMode = usePlayerStore((s) => s.systemCategorySortMode);
  const setSystemSortMode = usePlayerStore((s) => s.setSystemSortMode);
  const randomizeSystemSort = usePlayerStore((s) => s.randomizeSystemSort);

  const isBuiltInCategory =
    !activePlaylistId &&
    (activeSystemCategory === "mixed" ||
      activeSystemCategory === "slices_only" ||
      activeSystemCategory === "original_only");

  const builtInCat = isBuiltInCategory ? (activeSystemCategory as PlaybackMode) : null;

  const currentMode: PlaylistSortMode = builtInCat
    ? systemCategorySortMode[builtInCat] ?? "newest"
    : playlistSortMode;

  const handleSelect = (mode: PlaylistSortMode) => {
    if (builtInCat) {
      if (mode === "random" && currentMode === "random") {
        randomizeSystemSort(builtInCat);
      } else {
        setSystemSortMode(builtInCat, mode);
      }
    } else {
      if (mode === "random" && playlistSortMode === "random") {
        randomizePlaylistSort(activePlaylistId || undefined);
      } else {
        setPlaylistSortMode(mode);
      }
    }
  };

  const allSortOptions: Array<{
    mode: PlaylistSortMode;
    label: string;
    tooltip: string;
    icon: React.ReactNode;
    hideForBuiltIn?: boolean;
  }> = [
    {
      mode: "manual",
      label: t("playlist.sortManual", "Manual"),
      tooltip: t("playlist.sortManualTooltip", "Manual order (drag & drop enabled)"),
      icon: <ArrowUpDown className="h-3.5 w-3.5 shrink-0" />,
      hideForBuiltIn: true,
    },
    {
      mode: "newest",
      label: t("playlist.sortNewest", "Newest"),
      tooltip: t("playlist.sortNewestTooltip", "Recently added first"),
      icon: <ArrowDownNarrowWide className="h-3.5 w-3.5 shrink-0" />,
    },
    {
      mode: "oldest",
      label: t("playlist.sortOldest", "Oldest"),
      tooltip: t("playlist.sortOldestTooltip", "Earliest added first"),
      icon: <ArrowUpNarrowWide className="h-3.5 w-3.5 shrink-0" />,
    },
    {
      mode: "random",
      label: t("playlist.sortRandom", "Random"),
      tooltip:
        currentMode === "random"
          ? t("playlist.reshuffleTooltip", "Click again to reshuffle")
          : t("playlist.sortRandomTooltip", "Random order"),
      icon: <Shuffle className="h-3.5 w-3.5 shrink-0" />,
    },
  ];

  const sortOptions = isBuiltInCategory
    ? allSortOptions.filter((opt) => !opt.hideForBuiltIn)
    : allSortOptions;

  return (
    <div
      role="group"
      aria-label={t("playlist.sortLabel", "Sort playlist")}
      className={`inline-flex items-center rounded-lg border border-border bg-card/60 p-0.5 text-xs ${className}`}
    >
      {sortOptions.map((opt) => {
        const isActive = currentMode === opt.mode;
        return (
          <button
            key={opt.mode}
            type="button"
            aria-pressed={isActive}
            title={opt.tooltip}
            onClick={() => handleSelect(opt.mode)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md transition-all active:scale-95 motion-reduce:transform-none duration-100 cursor-pointer ${
              isActive
                ? "bg-secondary text-primary shadow-xs font-bold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {opt.icon}
            <span className="hidden sm:inline">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
