import * as React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "../../lib/utils";
import { Slider } from "./slider";

interface VolumeSliderProps {
  // Volume from 0 to 1
  value?: number;
  // Used while value is undefined
  defaultValue?: number;
  onChange?: (value: number) => void;
  disabled?: boolean;
  className?: string;
  title?: string;
  "aria-label"?: string;
}

// shadcn Slider on a 0-100 scale, so keys move 1% and assistive tech hears percentages.
// A bubble shows the level while the slider is hovered, focused or dragged.
export function VolumeSlider({
  value,
  defaultValue = 0.5,
  onChange,
  disabled,
  className,
  title,
  "aria-label": ariaLabel,
}: VolumeSliderProps) {
  const { t } = useTranslation();
  const label = ariaLabel ?? t("player.volume", "Volume");
  const volume = typeof value === "number" && Number.isFinite(value) ? value : defaultValue;
  const percent = Math.round(Math.max(0, Math.min(1, volume)) * 100);

  return (
    <div
      title={title}
      style={{ "--volume-level": `${percent}%` } as React.CSSProperties}
      className={cn("group/volume relative flex items-center", className)}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute bottom-full left-(--volume-level) mb-2 -translate-x-1/2 rounded-sm bg-primary px-1.5 py-0.5 font-mono text-2xs leading-none font-bold text-primary-foreground opacity-0 shadow-md transition-opacity duration-150 group-hover/volume:opacity-100 group-focus-within/volume:opacity-100 group-has-data-dragging/volume:opacity-100 group-has-data-disabled/volume:hidden"
      >
        {percent}
      </span>
      <Slider
        value={[percent]}
        min={0}
        max={100}
        step={1}
        disabled={disabled}
        getAriaLabel={() => label}
        getAriaValueText={(_formatted, level) => `${level}%`}
        onValueChange={(next) => {
          const level = Array.isArray(next) ? next[0] : next;
          if (typeof level === "number" && level !== percent) onChange?.(level / 100);
        }}
      />
    </div>
  );
}
