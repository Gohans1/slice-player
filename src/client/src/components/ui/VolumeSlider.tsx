import * as React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "../../lib/utils";

export interface VolumeSliderProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "defaultValue"> {
  /**
   * Volume value from 0 to 1 (default: 0.5, i.e. 50%)
   */
  value?: number;
  /**
   * Fallback default value from 0 to 1 if value is undefined (default: 0.5)
   */
  defaultValue?: number;
  /**
   * Callback fired when volume changes
   */
  onChange?: (value: number) => void;
  /**
   * Additional className for the input element
   */
  sliderClassName?: string;
}

export const VolumeSlider = React.forwardRef<HTMLInputElement, VolumeSliderProps>(
  (
    {
      value,
      defaultValue = 0.5,
      onChange,
      className,
      sliderClassName,
      disabled,
      min = 0,
      max = 1,
      step = 0.01,
      "aria-label": customAriaLabel,
      ...props
    },
    ref
  ) => {
    const { t } = useTranslation();
    const ariaLabel = customAriaLabel ?? t("player.volume", "Volume");
    // 50 is default (0.5 * 100 = 50)
    const rawVal = typeof value === "number" && Number.isFinite(value) ? value : defaultValue;
    const safeValue = Math.max(0, Math.min(1, rawVal));
    const displayPercent = Math.round(safeValue * 100);

    const [isDragging, setIsDragging] = React.useState(false);
    const [isHovered, setIsHovered] = React.useState(false);
    const [isFocused, setIsFocused] = React.useState(false);
    const [showDropFeedback, setShowDropFeedback] = React.useState(false);
    const [showKeyFeedback, setShowKeyFeedback] = React.useState(false);

    const dropTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const keyTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const cleanupPointerRef = React.useRef<(() => void) | null>(null);
    const lastEmittedValueRef = React.useRef<number | null>(null);

    React.useEffect(() => {
      return () => {
        cleanupPointerRef.current?.();
        if (dropTimeoutRef.current !== null) {
          clearTimeout(dropTimeoutRef.current);
        }
        if (keyTimeoutRef.current !== null) {
          clearTimeout(keyTimeoutRef.current);
        }
      };
    }, []);

    const handlePointerDown = (e: React.PointerEvent<HTMLInputElement>) => {
      // Primary button only
      if (disabled || e.button !== 0) return;

      setIsDragging(true);
      setShowDropFeedback(false);
      if (dropTimeoutRef.current !== null) {
        clearTimeout(dropTimeoutRef.current);
        dropTimeoutRef.current = null;
      }

      cleanupPointerRef.current?.();

      const handlePointerUpWindow = () => {
        setIsDragging(false);
        // Retain number visibility on drop for user confirmation
        setShowDropFeedback(true);
        if (dropTimeoutRef.current !== null) {
          clearTimeout(dropTimeoutRef.current);
        }
        dropTimeoutRef.current = setTimeout(() => {
          setShowDropFeedback(false);
          dropTimeoutRef.current = null;
        }, 600);

        if (typeof window !== "undefined") {
          window.removeEventListener("pointerup", handlePointerUpWindow);
          window.removeEventListener("pointercancel", handlePointerUpWindow);
        }
        cleanupPointerRef.current = null;
      };

      cleanupPointerRef.current = () => {
        if (typeof window !== "undefined") {
          window.removeEventListener("pointerup", handlePointerUpWindow);
          window.removeEventListener("pointercancel", handlePointerUpWindow);
        }
        cleanupPointerRef.current = null;
      };

      if (typeof window !== "undefined") {
        window.addEventListener("pointerup", handlePointerUpWindow);
        window.addEventListener("pointercancel", handlePointerUpWindow);
      }

      props.onPointerDown?.(e);
    };

    const handleValueUpdate = (valStr: string) => {
      const num = Number(valStr);
      if (Number.isFinite(num) && num !== lastEmittedValueRef.current) {
        lastEmittedValueRef.current = num;
        onChange?.(num);
      }
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      handleValueUpdate(e.target.value);
    };

    const handleInput = (e: React.FormEvent<HTMLInputElement>) => {
      handleValueUpdate((e.target as HTMLInputElement).value);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (
        e.key === "ArrowLeft" ||
        e.key === "ArrowRight" ||
        e.key === "ArrowUp" ||
        e.key === "ArrowDown" ||
        e.key === "PageUp" ||
        e.key === "PageDown" ||
        e.key === "Home" ||
        e.key === "End"
      ) {
        setShowKeyFeedback(true);
        if (keyTimeoutRef.current !== null) {
          clearTimeout(keyTimeoutRef.current);
        }
        keyTimeoutRef.current = setTimeout(() => {
          setShowKeyFeedback(false);
          keyTimeoutRef.current = null;
        }, 800);
      }
      props.onKeyDown?.(e);
    };

    const isVisible =
      !disabled && (isDragging || isHovered || isFocused || showDropFeedback || showKeyFeedback);

    // Dynamic horizontal alignment matching native range thumb center
    const thumbOffset = (50 - displayPercent) * 0.14;

    return (
      <div
        className={cn("relative flex items-center group", className)}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* Floating Number Badge (aria-hidden to avoid duplicate live region spam; input has aria-valuenow) */}
        <div
          data-testid="volume-slider-tooltip"
          aria-hidden="true"
          className={cn(
            "absolute -top-7 -translate-x-1/2 pointer-events-none z-30 flex flex-col items-center select-none",
            isDragging
              ? "transition-none opacity-100 scale-100 translate-y-0"
              : "transition-[opacity,transform] duration-150 ease-out",
            isVisible
              ? "opacity-100 scale-100 translate-y-0"
              : "opacity-0 scale-95 translate-y-1 pointer-events-none"
          )}
          style={{
            left: `clamp(10px, calc(${displayPercent}% + ${thumbOffset}px), calc(100% - 10px))`,
          }}
        >
          <span className="px-1.5 py-0.5 rounded text-2xs font-mono font-bold bg-primary text-primary-foreground shadow-md leading-none">
            {displayPercent}
          </span>
          <div className="w-1.5 h-1.5 bg-primary rotate-45 -mt-0.5 shadow-sm" />
        </div>

        {/* Accessible Range Input */}
        <input
          ref={ref}
          {...props}
          type="range"
          min={min}
          max={max}
          step={step}
          value={safeValue}
          disabled={disabled}
          aria-label={ariaLabel}
          aria-valuemin={typeof min === "number" ? min * 100 : 0}
          aria-valuemax={typeof max === "number" ? max * 100 : 100}
          aria-valuenow={displayPercent}
          aria-valuetext={`${displayPercent}%`}
          onPointerDown={handlePointerDown}
          onChange={handleChange}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onFocus={(e) => {
            setIsFocused(true);
            props.onFocus?.(e);
          }}
          onBlur={(e) => {
            setIsFocused(false);
            props.onBlur?.(e);
          }}
          className={cn(
            "w-full h-1 accent-primary cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded-sm",
            sliderClassName
          )}
        />
      </div>
    );
  }
);

VolumeSlider.displayName = "VolumeSlider";
