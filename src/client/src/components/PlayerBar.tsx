import * as React from "react";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Volume2,
  VolumeX,
  ListMusic,
  Disc,
} from "lucide-react";
import { Button } from "./ui/button";
import { formatTime } from "../lib/utils";
import { usePlayerStore } from "../store/usePlayerStore";

interface PlayerBarProps {
  onToggleQueue: () => void;
  isQueueOpen: boolean;
}

export function PlayerBar({ onToggleQueue, isQueueOpen }: PlayerBarProps) {
  const activeTrack = usePlayerStore((s) => s.activeTrack);
  const activeSegment = usePlayerStore((s) => s.activeSegment);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const isShuffle = usePlayerStore((s) => s.isShuffle);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const volume = usePlayerStore((s) => s.volume);
  const queue = usePlayerStore((s) => s.queue);
  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const nextSegment = usePlayerStore((s) => s.nextSegment);
  const prevSegment = usePlayerStore((s) => s.prevSegment);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const seek = usePlayerStore((s) => s.seek);

  const [isMuted, setIsMuted] = React.useState(false);
  const [previousVolume, setPreviousVolume] = React.useState(volume);

  const handleToggleMute = () => {
    if (isMuted) {
      setVolume(previousVolume || 0.8);
      setIsMuted(false);
    } else {
      setPreviousVolume(volume);
      setVolume(0);
      setIsMuted(true);
    }
  };

  if (!activeTrack || !activeSegment) {
    return (
      <footer className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-card/95 backdrop-blur-md px-6 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3 text-muted-foreground text-xs">
            <Disc className="h-5 w-5 opacity-40" />
            <span>Chưa chọn bài hát. Bấm vào bài hát hoặc nút "Shuffle Đoạn" để nghe.</span>
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleQueue}
            className="text-xs gap-1.5 text-muted-foreground"
          >
            <ListMusic className="h-4 w-4" />
            <span>Hàng đợi ({queue.length})</span>
          </Button>
        </div>
      </footer>
    );
  }

  const segmentDuration = activeSegment.end_time - activeSegment.start_time;
  const elapsedInSegment = Math.max(0, currentTime - activeSegment.start_time);
  const progressPercent = segmentDuration > 0 ? Math.min(100, (elapsedInSegment / segmentDuration) * 100) : 0;

  return (
    <footer className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-card/95 backdrop-blur-md px-4 sm:px-6 py-2.5 shadow-2xl">
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
        {/* Track & Segment Info */}
        <div className="flex items-center gap-3 w-full sm:w-1/3 min-w-0">
          <div className="relative h-11 w-11 rounded-md overflow-hidden bg-muted shrink-0 border border-border">
            {activeTrack.thumbnail_url ? (
              <img
                src={activeTrack.thumbnail_url}
                alt={activeTrack.title}
                className="h-full w-full object-cover"
              />
            ) : (
              <Disc className="h-full w-full p-2 text-muted-foreground opacity-60" />
            )}
            <div
              className="absolute bottom-0 left-0 right-0 h-1"
              style={{ backgroundColor: activeSegment.color || "#4385BE" }}
            />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-xs text-foreground truncate">
                {activeTrack.title}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs font-medium text-flexoki-blue truncate">
                {activeSegment.name}
              </span>
              <span className="text-[10px] text-muted-foreground font-mono">
                [{formatTime(activeSegment.start_time)} → {formatTime(activeSegment.end_time)}]
              </span>
            </div>
          </div>
        </div>

        {/* Center Controls & Progress */}
        <div className="flex flex-col items-center gap-1.5 w-full sm:w-2/5">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleShuffle}
              className={`h-8 w-8 rounded-full ${
                isShuffle
                  ? "text-flexoki-green hover:text-flexoki-green hover:bg-flexoki-green/10"
                  : "text-muted-foreground"
              }`}
              title={isShuffle ? "Chế độ Shuffle các đoạn: BẬT" : "Chế độ Shuffle: TẮT"}
            >
              <Shuffle className="h-4 w-4" />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              onClick={prevSegment}
              className="h-8 w-8 rounded-full text-foreground hover:bg-accent"
              title="Đoạn trước"
            >
              <SkipBack className="h-4 w-4" />
            </Button>

            <Button
              variant="default"
              size="icon"
              onClick={togglePlay}
              className="h-9 w-9 rounded-full bg-primary text-primary-foreground shadow-md hover:scale-105 transition-transform"
              title={isPlaying ? "Tạm dừng" : "Tiếp tục phát"}
            >
              {isPlaying ? (
                <Pause className="h-4 w-4 fill-current" />
              ) : (
                <Play className="h-4 w-4 fill-current translate-x-0.5" />
              )}
            </Button>

            <Button
              variant="ghost"
              size="icon"
              onClick={nextSegment}
              className="h-8 w-8 rounded-full text-foreground hover:bg-accent"
              title="Đoạn kế tiếp"
            >
              <SkipForward className="h-4 w-4" />
            </Button>
          </div>

          {/* Segment Progress Bar */}
          <div className="flex items-center gap-2 w-full max-w-md text-[10px] font-mono text-muted-foreground">
            <span className="w-10 text-right">{formatTime(elapsedInSegment)}</span>
            <div
              onClick={(e) => {
                if (!activeSegment || segmentDuration <= 0) return;
                const rect = e.currentTarget.getBoundingClientRect();
                if (rect.width <= 0) return;
                const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                const targetSeconds = activeSegment.start_time + ratio * segmentDuration;
                seek(targetSeconds);
              }}
              className="relative flex-1 h-2 rounded-full bg-secondary overflow-hidden cursor-pointer hover:h-2.5 transition-all"
              title="Nhấn để tua trong đoạn"
            >
              <div
                className="absolute top-0 bottom-0 left-0 rounded-full transition-all duration-100"
                style={{
                  width: `${progressPercent}%`,
                  backgroundColor: activeSegment.color || "#4385BE",
                }}
              />
            </div>
            <span className="w-10 text-left">{formatTime(segmentDuration)}</span>
          </div>
        </div>

        {/* Volume & Queue Button */}
        <div className="flex items-center justify-end gap-3 w-full sm:w-1/3">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleToggleMute}
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
            >
              {isMuted || volume === 0 ? (
                <VolumeX className="h-4 w-4" />
              ) : (
                <Volume2 className="h-4 w-4" />
              )}
            </Button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={isMuted ? 0 : volume}
              onChange={(e) => {
                const val = Number(e.target.value);
                setVolume(val);
                if (val > 0) setIsMuted(false);
              }}
              className="w-20 h-1 accent-primary cursor-pointer"
            />
          </div>

          <Button
            variant={isQueueOpen ? "secondary" : "ghost"}
            size="sm"
            onClick={onToggleQueue}
            className="text-xs gap-1.5"
          >
            <ListMusic className="h-4 w-4" />
            <span className="hidden md:inline">Hàng đợi</span>
            <span className="font-mono text-[10px] px-1 rounded bg-accent text-accent-foreground">
              {queue.length}
            </span>
          </Button>
        </div>
      </div>
    </footer>
  );
}
