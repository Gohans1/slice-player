import { X, Play, Shuffle, Music, Trash2 } from "lucide-react";
import { Button } from "./ui/button";
import { formatDuration } from "../lib/utils";
import { usePlayerStore } from "../store/usePlayerStore";

interface QueueDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export function QueueDrawer({ isOpen, onClose }: QueueDrawerProps) {
  const queue = usePlayerStore((s) => s.queue);
  const activeSegment = usePlayerStore((s) => s.activeSegment);
  const playSegment = usePlayerStore((s) => s.playSegment);
  const removeSegmentFromQueue = usePlayerStore((s) => s.removeSegmentFromQueue);
  const buildShuffleQueue = usePlayerStore((s) => s.buildShuffleQueue);
  const tracks = usePlayerStore((s) => s.tracks);

  if (!isOpen) return null;

  const handleReshuffle = async () => {
    try {
      const res = await fetch("/api/segments");
      if (res.ok) {
        const allSegments = await res.json();
        buildShuffleQueue(allSegments, tracks);
      }
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full max-w-sm border-l border-border bg-card/95 backdrop-blur-md p-5 shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-border">
        <div className="flex items-center gap-2">
          <Music className="h-5 w-5 text-primary" />
          <h2 className="font-bold text-base text-foreground">Hàng Đợi Phát</h2>
          <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-accent text-accent-foreground">
            {queue.length}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleReshuffle}
            className="h-8 text-xs gap-1 text-flexoki-green"
            title="Xáo trộn lại thứ tự phát"
          >
            <Shuffle className="h-3.5 w-3.5" />
            <span>Xáo trộn</span>
          </Button>

          <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8 rounded-full">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Queue items list */}
      <div className="flex-1 overflow-y-auto py-3 space-y-2">
        {queue.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-center text-muted-foreground p-4">
            <Music className="h-8 w-8 opacity-30 mb-2" />
            <p className="text-sm">Hàng đợi đang trống</p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              Bấm "Shuffle Đoạn" trên thanh menu để tạo danh sách ngẫu nhiên các đoạn.
            </p>
          </div>
        ) : (
          queue.map((item, idx) => {
            const isCurrent = activeSegment?.id === item.segment.id;
            const segDuration = item.segment.end_time - item.segment.start_time;

            return (
              <div
                key={`${item.segment.id}-${idx}`}
                onClick={() => playSegment(item.segment, item.track)}
                className={`group flex items-center justify-between gap-3 p-2.5 rounded-lg border cursor-pointer transition-all ${
                  isCurrent
                    ? "border-primary bg-primary/10 shadow-sm"
                    : "border-border/50 bg-background/50 hover:bg-accent/40 hover:border-border"
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <div className="relative h-9 w-9 rounded overflow-hidden bg-muted shrink-0 border border-border">
                    {item.track.thumbnail_url ? (
                      <img
                        src={item.track.thumbnail_url}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-xs font-mono">
                        {idx + 1}
                      </div>
                    )}
                    <div
                      className="absolute bottom-0 left-0 right-0 h-0.5"
                      style={{ backgroundColor: item.segment.color || "#4385BE" }}
                    />
                  </div>

                  <div className="min-w-0 flex-1">
                    <p
                      className={`text-xs font-medium truncate ${
                        isCurrent ? "text-primary font-semibold" : "text-foreground"
                      }`}
                    >
                      {item.segment.name}
                    </p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {item.track.title}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {formatDuration(segDuration)}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeSegmentFromQueue(item.segment.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-all"
                    title="Xóa khỏi hàng đợi"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                    <Play className="h-3.5 w-3.5 fill-current text-primary" />
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
