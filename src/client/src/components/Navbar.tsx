import * as React from "react";
import { Music2, FolderPlus, Shuffle, Search, AlertCircle, Loader2 } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Modal } from "./ui/modal";
import { usePlayerStore } from "../store/usePlayerStore";
import type { Segment } from "@/server/types";

function YoutubeIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
  );
}

interface NavbarProps {
  searchQuery: string;
  onSearchChange: (q: string) => void;
}

export function Navbar({ searchQuery, onSearchChange }: NavbarProps) {
  const tracks = usePlayerStore((s) => s.tracks);
  const fetchTracks = usePlayerStore((s) => s.fetchTracks);
  const buildShuffleQueue = usePlayerStore((s) => s.buildShuffleQueue);
  const playSegment = usePlayerStore((s) => s.playSegment);

  const [isYtModalOpen, setIsYtModalOpen] = React.useState(false);
  const [ytUrl, setYtUrl] = React.useState("");
  const [isYtLoading, setIsYtLoading] = React.useState(false);
  const [ytError, setYtError] = React.useState<string | null>(null);

  const [isLocalModalOpen, setIsLocalModalOpen] = React.useState(false);
  const [localPath, setLocalPath] = React.useState("");
  const [isLocalLoading, setIsLocalLoading] = React.useState(false);
  const [localError, setLocalError] = React.useState<string | null>(null);

  const handleIngestYoutube = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ytUrl.trim()) return;

    setIsYtLoading(true);
    setYtError(null);

    try {
      const res = await fetch("/api/tracks/ingest-youtube", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: ytUrl.trim() }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        setYtError(data.message || data.error || "Lỗi khi nạp link YouTube");
      } else {
        setYtUrl("");
        setIsYtModalOpen(false);
        await fetchTracks();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setYtError(`Lỗi kết nối: ${msg}`);
    } finally {
      setIsYtLoading(false);
    }
  };

  const handleIngestLocal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!localPath.trim()) return;

    setIsLocalLoading(true);
    setLocalError(null);

    try {
      const res = await fetch("/api/tracks/ingest-local", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: localPath.trim() }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        setLocalError(data.message || data.error || "Lỗi khi nạp file local");
      } else {
        setLocalPath("");
        setIsLocalModalOpen(false);
        await fetchTracks();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setLocalError(`Lỗi kết nối: ${msg}`);
    } finally {
      setIsLocalLoading(false);
    }
  };

  const handleQuickShuffle = async () => {
    try {
      const res = await fetch("/api/segments");
      if (res.ok) {
        const allSegments: Segment[] = await res.json();
        const readyTrackMap = new Map(tracks.filter((t) => t.status === "ready").map((t) => [t.id, t]));
        const validSegments = allSegments.filter((s) => readyTrackMap.has(s.track_id));

        if (validSegments.length > 0) {
          buildShuffleQueue(validSegments, tracks);
          const q = usePlayerStore.getState().queue;
          const first = q[0];
          if (first?.segment && first?.track) {
            playSegment(first.segment, first.track);
          }
        } else if (tracks.length > 0) {
          // Fallback: create default full-track virtual segments
          const fallbackSegments = tracks
            .filter((t) => t.status === "ready" && t.duration > 0)
            .map((t) => ({
              id: `fallback_${t.id}`,
              track_id: t.id,
              name: "Toàn bài",
              start_time: 0,
              end_time: t.duration,
              color: "#4385BE",
              sort_order: 0,
            }));
          if (fallbackSegments.length > 0) {
            buildShuffleQueue(fallbackSegments, tracks);
            const q = usePlayerStore.getState().queue;
            const first = q[0];
            if (first?.segment && first?.track) {
              playSegment(first.segment, first.track);
            }
          }
        }
      }
    } catch (e) {
      console.error("[Navbar] Shuffle error:", e);
    }
  };

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-card/80 backdrop-blur-md px-6 py-3">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
        {/* Logo & Brand */}
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 border border-primary/30 text-primary">
            <Music2 className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-base tracking-tight text-foreground">SLICE PLAYER</span>
              <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-accent text-accent-foreground border border-border">
                Flexoki
              </span>
            </div>
            <p className="text-xs text-muted-foreground hidden sm:block">
              Phát ngẫu nhiên từng đoạn nhạc cá nhân
            </p>
          </div>
        </div>

        {/* Search bar */}
        <div className="relative flex-1 max-w-sm hidden md:block">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Tìm kiếm bài hát hoặc ca sĩ..."
            className="pl-9 bg-background/60 text-sm h-9"
          />
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleQuickShuffle}
            className="text-flexoki-green hover:text-flexoki-green hover:border-flexoki-green/40"
          >
            <Shuffle className="h-4 w-4" />
            <span className="hidden sm:inline">Shuffle Đoạn</span>
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsLocalModalOpen(true)}
            className="text-flexoki-cyan hover:text-flexoki-cyan hover:border-flexoki-cyan/40"
          >
            <FolderPlus className="h-4 w-4" />
            <span className="hidden sm:inline">+ File FLAC</span>
          </Button>

          <Button
            variant="destructive"
            size="sm"
            onClick={() => setIsYtModalOpen(true)}
          >
            <YoutubeIcon className="h-4 w-4" />
            <span className="hidden sm:inline">+ Link YouTube</span>
          </Button>
        </div>
      </div>

      {/* YouTube Modal */}
      <Modal
        isOpen={isYtModalOpen}
        onClose={() => {
          setIsYtModalOpen(false);
          setYtError(null);
        }}
        title="Thêm nhạc từ YouTube"
        description="Dán đường link Video hoặc Playlist YouTube để tải và cắt đoạn."
      >
        <form onSubmit={handleIngestYoutube} className="space-y-4">
          <div className="space-y-2">
            <Input
              value={ytUrl}
              onChange={(e) => setYtUrl(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=..."
              autoFocus
              disabled={isYtLoading}
            />
            <div className="flex items-center gap-1.5 text-xs text-flexoki-orange">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              <span>Giới hạn thời lượng: Tối đa 30 phút/bài để tối ưu bộ nhớ.</span>
            </div>
          </div>

          {ytError && (
            <div className="p-3 rounded-md bg-destructive/10 border border-destructive/30 text-xs text-destructive">
              {ytError}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsYtModalOpen(false)}
              disabled={isYtLoading}
            >
              Hủy
            </Button>
            <Button type="submit" disabled={isYtLoading || !ytUrl.trim()}>
              {isYtLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              {isYtLoading ? "Đang quét metadata..." : "Nạp bài hát"}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Local FLAC Modal */}
      <Modal
        isOpen={isLocalModalOpen}
        onClose={() => {
          setIsLocalModalOpen(false);
          setLocalError(null);
        }}
        title="Thêm bài hát từ máy (.flac)"
        description="Nhập đường dẫn tuyệt đối của file .flac trên máy m."
      >
        <form onSubmit={handleIngestLocal} className="space-y-4">
          <div className="space-y-2">
            <Input
              value={localPath}
              onChange={(e) => setLocalPath(e.target.value)}
              placeholder="C:\Music\MySong.flac"
              autoFocus
              disabled={isLocalLoading}
            />
            <p className="text-xs text-muted-foreground">
              Ví dụ: C:\Users\ADMIN\Music\bai_hat.flac
            </p>
          </div>

          {localError && (
            <div className="p-3 rounded-md bg-destructive/10 border border-destructive/30 text-xs text-destructive">
              {localError}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsLocalModalOpen(false)}
              disabled={isLocalLoading}
            >
              Hủy
            </Button>
            <Button type="submit" disabled={isLocalLoading || !localPath.trim()}>
              {isLocalLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              {isLocalLoading ? "Đang phân tích..." : "Nạp file local"}
            </Button>
          </div>
        </form>
      </Modal>
    </header>
  );
}
