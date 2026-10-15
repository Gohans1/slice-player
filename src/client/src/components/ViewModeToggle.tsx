import * as React from "react";
import { LayoutGrid, List } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import type { PlayerState } from "../store/usePlayerStore";

type ViewMode = PlayerState["viewMode"];

const VIEW_MODES: ViewMode[] = ["grid", "list"];

interface ViewModeToggleProps {
  value: ViewMode;
  onValueChange: (mode: ViewMode) => void;
}

export function ViewModeToggle({ value, onValueChange }: ViewModeToggleProps) {
  const { t } = useTranslation();

  return (
    <ToggleGroup
      aria-label={t("library.viewMode")}
      variant="outline"
      spacing={0}
      value={[value]}
      onValueChange={(next) => {
        // Pressing the current view again would leave none pressed; the library always has one
        const mode = VIEW_MODES.find((m) => m === next[0]);
        if (mode) onValueChange(mode);
      }}
    >
      <ToggleGroupItem value="grid" title={t("library.gridTooltip")}>
        <LayoutGrid />
        {t("library.grid")}
      </ToggleGroupItem>
      <ToggleGroupItem value="list" title={t("library.tableTooltip")}>
        <List />
        {t("library.table")}
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
