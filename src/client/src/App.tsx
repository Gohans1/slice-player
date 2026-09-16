import * as React from "react";
import { usePlayerStore } from "./store/usePlayerStore";
import { Navbar } from "./components/Navbar";
import { TrackCard } from "./components/TrackCard";
import { SliceStudio } from "./components/SliceStudio";
import { PlayerBar } from "./components/PlayerBar";
import { QueueDrawer } from "./components/QueueDrawer";
import { Music, Loader2 } from "lucide-react";

export function App() {
  const tracks = usePlayerStore((s) => s.tracks);
  const isLoadingTracks = usePlayerStore((s) => s.isLoadingTracks);
  const fetchTracks = usePlayerStore((s) => s.fetchTracks);
  const sliceStudioTrack = usePlayerStore((s) => s.sliceStudioTrack);
  const closeSliceStudio = usePlayerStore((s) => s.closeSliceStudio);
  const buildShuffleQueue = usePlayerStore((s) => s.buildShuffleQueue);
  const queue = usePlayerStore((s) => s.queue);
  const activeTrack = usePlayerStore((s) => s.activeTrack);
  const pause = usePlayerStore((s) => s.pause);

  const [searchQuery, setSearchQuery] = React.useState("");
  const [isQueueOpen, setIsQueueOpen] = React.useState(false);

  // Initial load & WebSocket heartbeat with auto-reconnect
  React.useEffect(() => {
    fetchTracks();

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    let ws: WebSocket | null = null;
    let heartbeatInterval: Timer | null = null;
    let reconnectTimeout: Timer | null = null;
    let isUnmounted = false;

    function connectWs() {
      if (isUnmounted) return;
      try {
        ws = new WebSocket(wsUrl);
        ws.onopen = () => {
          heartbeatInterval = setInterval(() => {
            if (ws?.readyState === WebSocket.OPEN) {
              ws.send("ping");
            }
          }, 5000);
        };
        ws.onclose = () => {
          if (heartbeatInterval) clearInterval(heartbeatInterval);
          if (!isUnmounted) {
            reconnectTimeout = setTimeout(connectWs, 2000);
          }
        };
        ws.onerror = () => {
          if (ws) ws.close();
        };
      } catch {
        if (!isUnmounted) {
          reconnectTimeout = setTimeout(connectWs, 3000);
        }
      }
    }

    connectWs();

    return () => {
      isUnmounted = true;
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (ws) ws.close();
    };
  }, [fetchTracks]);

  // Initial queue build on first track load only if queue is empty
  React.useEffect(() => {
    if (tracks.length > 0 && queue.length === 0) {
      fetch("/api/segments")
        .then((r) => r.json())
        .then((segments) => {
          if (Array.isArray(segments) && segments.length > 0) {
            buildShuffleQueue(segments, tracks);
          }
        })
        .catch(console.error);
    }
  }, [tracks.length, queue.length, buildShuffleQueue, tracks]);

  const handleDeleteTrack = async (id: string) => {
    if (confirm("Bạn có chắc chắn muốn xóa bài hát này và toàn bộ các đoạn cắt liên quan?")) {
      try {
        if (activeTrack?.id === id) {
          pause();
        }
        const res = await fetch(`/api/tracks/${id}`, { method: "DELETE" });
        if (res.ok) {
          await fetchTracks();
        }
      } catch (e) {
        console.error(e);
      }
    }
  };

  const filteredTracks = React.useMemo(() => {
    if (!searchQuery.trim()) return tracks;
    const q = searchQuery.toLowerCase();
    return tracks.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        (t.artist && t.artist.toLowerCase().includes(q))
    );
  }, [tracks, searchQuery]);

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground pb-24">
      <Navbar searchQuery={searchQuery} onSearchChange={setSearchQuery} />

      <main className="flex-1 max-w-7xl mx-auto w-full p-4 sm:p-6 lg:p-8">
        {/* Top Banner / Library Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
              <span>Thư Viện Nhạc</span>
              <span className="text-sm font-normal text-muted-foreground font-mono">
                ({tracks.length} bài)
              </span>
            </h1>
            <p className="text-xs text-muted-foreground mt-1">
              Dán link YouTube hoặc thêm file FLAC để bắt đầu chia đoạn và nghe shuffle ngẫu nhiên.
            </p>
          </div>
        </div>

        {/* Loading State */}
        {isLoadingTracks && tracks.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-16">
            <Loader2 className="h-8 w-8 animate-spin text-primary mb-3" />
            <p className="text-sm text-muted-foreground">Đang tải danh sách bài hát...</p>
          </div>
        ) : filteredTracks.length === 0 ? (
          /* Empty State */
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border p-12 text-center bg-card/40">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary mb-4 border border-primary/20">
              <Music className="h-7 w-7" />
            </div>
            <h2 className="text-lg font-semibold text-foreground">
              {searchQuery ? "Không tìm thấy bài hát nào" : "Chưa có bài hát nào trong thư viện"}
            </h2>
            <p className="text-xs text-muted-foreground mt-1 max-w-md">
              {searchQuery
                ? "Thử tìm kiếm với từ khóa khác hoặc xóa bộ lọc tìm kiếm."
                : "Bắt đầu bằng cách thêm 1 link YouTube (video hoặc playlist) hoặc file FLAC từ máy."}
            </p>
          </div>
        ) : (
          /* Track Grid */
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-5">
            {filteredTracks.map((track) => (
              <TrackCard
                key={track.id}
                track={track}
                onDelete={handleDeleteTrack}
              />
            ))}
          </div>
        )}
      </main>

      {/* Slice Studio Modal */}
      {sliceStudioTrack && (
        <SliceStudio
          track={sliceStudioTrack}
          onClose={() => {
            closeSliceStudio();
            fetchTracks();
          }}
        />
      )}

      {/* Queue Drawer */}
      <QueueDrawer
        isOpen={isQueueOpen}
        onClose={() => setIsQueueOpen(false)}
      />

      {/* Player Bar */}
      <PlayerBar
        onToggleQueue={() => setIsQueueOpen((prev) => !prev)}
        isQueueOpen={isQueueOpen}
      />
    </div>
  );
}
