import React from "react";
import { useTranslation } from "react-i18next";
import { ArrowUpDown, ArrowDownNarrowWide, ArrowUpNarrowWide, Shuffle } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import { usePlayerStore, type PlaylistSortMode, type PlaybackMode } from "../store/usePlayerStore";

interface PlaylistSortSelectorProps {
  builtInItemIds?: string[];
}

export function PlaylistSortSelector({ builtInItemIds }: PlaylistSortSelectorProps) {
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
        randomizeSystemSort(builtInCat, builtInItemIds);
      } else {
        setSystemSortMode(builtInCat, mode, builtInItemIds);
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
      icon: <ArrowUpDown />,
      hideForBuiltIn: true,
    },
    {
      mode: "newest",
      label: t("playlist.sortNewest", "Newest"),
      tooltip: t("playlist.sortNewestTooltip", "Recently added first"),
      icon: <ArrowDownNarrowWide />,
    },
    {
      mode: "oldest",
      label: t("playlist.sortOldest", "Oldest"),
      tooltip: t("playlist.sortOldestTooltip", "Earliest added first"),
      icon: <ArrowUpNarrowWide />,
    },
    {
      mode: "random",
      label: t("playlist.sortRandom", "Random"),
      tooltip:
        currentMode === "random"
          ? t("playlist.reshuffleTooltip", "Click again to reshuffle")
          : t("playlist.sortRandomTooltip", "Random order"),
      icon: <Shuffle />,
    },
  ];

  const sortOptions = isBuiltInCategory
    ? allSortOptions.filter((opt) => !opt.hideForBuiltIn)
    : allSortOptions;

  return (
    <ToggleGroup
      aria-label={t("playlist.sortLabel", "Sort playlist")}
      variant="outline"
      spacing={0}
      value={[currentMode]}
      // Pressing the current option again arrives with nothing pressed; for Random that means reshuffle
      onValueChange={(next) => handleSelect(sortOptions.find((opt) => opt.mode === next[0])?.mode ?? currentMode)}
    >
      {sortOptions.map((opt) => (
        // Narrow toolbars show only the icon, so the name can't come from the label text
        <ToggleGroupItem key={opt.mode} value={opt.mode} aria-label={opt.label} title={opt.tooltip}>
          {opt.icon}
          <span className="hidden @6xl:inline">{opt.label}</span>
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
