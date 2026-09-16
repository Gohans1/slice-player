import * as React from "react";
import { Navbar } from "./components/Navbar";
import { TrackCard } from "./components/TrackCard";
import { SliceStudio } from "./components/SliceStudio";
import { PlayerBar } from "./components/PlayerBar";
import { QueueDrawer } from "./components/QueueDrawer";
import { Music, Loader2 } from "lucide-react";

export function App() {
  const {
    tracks,
    isLoadingTracks,
    fetchTracks,
    sliceStudioTrack,
    closeSliceStudio,
    buildShuffleQueue,
  } = usePlayerStore();

  const [searchQuery, setSearchQuery] = React.useState("");
  const [isQueueOpen, setIsQueueOpen] = React.useState(false);

  // Initial load & WebSocket heartbeat
  React.useEffect(() => {
    fetchTracks();

    // Setup WebSocket connection for window lifecycle heartbeat
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    let ws: WebSocket | null = null;
    let heartbeatInterval: Timer | null = null;

    try {
      ws = new WebSocket(wsUrl);
      ws.onopen = () => {
        heartbeatInterval = setInterval(() => {
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send("ping");
          }
        }, 5000);
      };
    } catch (e) {
      console.warn("[App] WebSocket connection failed", e);
    }

    return () => {
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      if (ws) ws.close();
    };
  }, [fetchTracks]);

  // Initial queue build on first track load
  React.useEffect(() => {
    if (tracks.length > 0) {
      fetch("/api/segments")
        .then((r) => r.json())
        .then((segments) => {
          if (Array.isArray(segments) && segments.length > 0) {
            buildShuffleQueue(segments, tracks);
          }
        })
        .catch(console.error);
    }
  }, [tracks, buildShuffleQueue]);

  const handleDeleteTrack = async (id: string) => {
    if (confirm("M có chắc chắn muốn xóa bài hát này và toàn bộ các đoạn cắt liên quan?")) {
      try {
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
