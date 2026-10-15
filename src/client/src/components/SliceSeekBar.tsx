import * as React from "react";
import { useTranslation } from "react-i18next";
import { Slider } from "./ui/slider";
import { usePlayerStore, type Segment } from "../store/usePlayerStore";
import { DEFAULT_SLICE_COLOR, formatTime } from "../lib/utils";

interface SliceSeekBarProps {
  segment: Segment;
}

// Scrubber for the playing slice. Positions are seconds from the slice start.
// Playback pauses while scrubbing and the seek happens on release.
export function SliceSeekBar({ segment }: SliceSeekBarProps) {
  const { t } = useTranslation();
  const currentTime = usePlayerStore((s) => s.currentTime);
  const seek = usePlayerStore((s) => s.seek);
  const togglePlay = usePlayerStore((s) => s.togglePlay);

  // Where the finger is while scrubbing; null otherwise
  const [scrubPosition, setScrubPosition] = React.useState<number | null>(null);
  const isScrubbingRef = React.useRef(false);
  const resumeAfterScrubRef = React.useRef(false);

  const duration = Math.max(0, segment.end_time - segment.start_time);
  const playedPosition = Math.max(0, Math.min(duration, currentTime - segment.start_time));
  const position = scrubPosition ?? playedPosition;

  // A new slice ends any scrub that was in progress
  const [scrubbedSegmentId, setScrubbedSegmentId] = React.useState(segment.id);
  if (scrubbedSegmentId !== segment.id) {
    setScrubbedSegmentId(segment.id);
    setScrubPosition(null);
    isScrubbingRef.current = false;
    resumeAfterScrubRef.current = false;
  }

  // Seeking exactly to the end would skip to the next slice
  const seekTo = (offset: number) => {
    const margin = Math.min(0.05, duration * 0.02);
    seek(Math.max(segment.start_time, Math.min(segment.end_time - margin, segment.start_time + offset)));
  };

  const handleKeyDownCapture = (e: React.KeyboardEvent) => {
    if (duration <= 0) return;
    const arrowStep = Math.min(5, Math.max(0.1, duration * 0.05));
    const direction = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
    if (direction !== undefined) {
      // Arrows move a share of the slice; the slider's own step stays fine-grained for dragging
      e.preventDefault();
      seekTo(playedPosition + direction * arrowStep);
    } else if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      togglePlay();
    }
  };

  const timeClass = "w-14 shrink-0 font-mono text-2xs text-muted-foreground tabular-nums";

  return (
    <div
      onKeyDownCapture={handleKeyDownCapture}
      // The played part of the bar takes the slice colour
      style={{ "--primary": segment.color || DEFAULT_SLICE_COLOR }}
      className="flex w-full max-w-xl items-center gap-2"
    >
      <span className={`${timeClass} text-right`}>{formatTime(position)}</span>
      <Slider
        value={[position]}
        min={0}
        max={duration || 1}
        step={0.01}
        largeStep={Math.min(15, Math.max(1, duration * 0.2))}
        disabled={duration <= 0}
        getAriaLabel={() => t("player.seekAria", "Seek slice")}
        getAriaValueText={() => `${formatTime(position)} / ${formatTime(duration)}`}
        onValueChange={(next, details) => {
          // Keyboard changes are committed straight away and seek in onValueCommitted
          if (details.reason === "keyboard" || details.reason === "input-change") return;
          const offset = Array.isArray(next) ? next[0] : next;
          if (!isScrubbingRef.current) {
            isScrubbingRef.current = true;
            const { isPlaying, pause } = usePlayerStore.getState();
            resumeAfterScrubRef.current = isPlaying;
            if (isPlaying) pause();
          }
          setScrubPosition(offset);
        }}
        onValueCommitted={(next) => {
          const offset = Array.isArray(next) ? next[0] : next;
          const shouldResume = resumeAfterScrubRef.current;
          isScrubbingRef.current = false;
          resumeAfterScrubRef.current = false;
          setScrubPosition(null);
          seekTo(offset);
          if (shouldResume) usePlayerStore.getState().resume();
        }}
      />
      <span className={timeClass}>{formatTime(duration)}</span>
    </div>
  );
}
