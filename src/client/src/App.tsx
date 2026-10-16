import * as React from "react";
import { useTranslation } from "react-i18next";
import { usePlayerStore, createQueueItem, type PlaybackMode, type QueueItem } from "./store/usePlayerStore";
import { ImportActions } from "./components/ImportActions";
import { MasterVolume } from "./components/MasterVolume";
import { TrackCard } from "./components/TrackCard";
const SliceStudio = React.lazy(() => import("./components/SliceStudio").then((m) => ({ default: m.SliceStudio })));
import { PlayerBar } from "./components/PlayerBar";
import { QueueDrawer, QueuePanel } from "./components/QueueDrawer";
const LogDrawer = React.lazy(() => import("./components/LogDrawer").then((m) => ({ default: m.LogDrawer })));
const CreatePlaylistModal = React.lazy(() => import("./components/CreatePlaylistModal").then((m) => ({ default: m.CreatePlaylistModal })));
const MixPlaylistModal = React.lazy(() => import("./components/MixPlaylistModal").then((m) => ({ default: m.MixPlaylistModal })));
const ShortcutsModal = React.lazy(() => import("./components/ShortcutsModal").then((m) => ({ default: m.ShortcutsModal })));
import { PlaylistTableView } from "./components/PlaylistTableView";
import { PlaylistGrid } from "./components/PlaylistGrid";
import { PlaylistHeader } from "./components/PlaylistHeader";
import { PlaylistItemCard } from "./components/PlaylistItemCard";
import { SliceCard } from "./components/SliceCard";
import { VirtualizedCardGrid } from "./components/VirtualizedCardGrid";
import { EmptyState } from "./components/EmptyState";
import { Music, Scissors, AlertCircle, Check, RefreshCw, SearchX } from "lucide-react";
import { audioEngine } from "./lib/audio";
import { filterTracks, searchItems } from "./lib/search";
import { showsItemsOf } from "./lib/mixPlaylist";
import { cn, compareDownloadingTracks, createDefaultFullSegment } from "./lib/utils";
import {
  findActivePlaylistItemIndex,
  findActiveMixedItemIndex,
  findActiveSliceItemIndex,
  findActiveTrackIndex,
} from "./lib/activeItemIndex";
import { PlaylistSortSelector } from "./components/PlaylistSortSelector";
import { ViewModeToggle } from "./components/ViewModeToggle";
import { LibrarySkeleton } from "./components/LibrarySkeleton";
import {
  getSortedPlaylistItems,
  getSortedMixedItems,
  getSortedSliceItems,
  getSortedTracks,
  type MixedItem,
} from "./lib/playlistSort";
import { Alert, AlertDescription, AlertTitle } from "./components/ui/alert";
import { Button } from "./components/ui/button";
import { SidebarInset, SidebarTrigger } from "./components/ui/sidebar";
import { AppShell, MAIN_CONTENT_ID } from "./components/layout/AppShell";
import { useQueueVisibility } from "./hooks/use-queue-visibility";
import { useHeightCssVar } from "./hooks/use-height-css-var";
import { BulkActionBar } from "./components/BulkActionBar";
import { FloatingScrollControls } from "./components/FloatingScrollControls";
import { ConfirmModal } from "./components/ConfirmModal";
import { useSelectionStore, type SelectedItem } from "./store/useSelectionStore";
import { useLogStore } from "./store/useLogStore";
import { getViewScrollKey } from "./store/usePlayerStore";
import { isDialogOpen } from "./lib/dialog";
import { sendChange } from "./lib/sendChange";
import type { Playlist, Segment, Track } from "@/server/types";

const getItemEntityId = (item: { id: string }) => item.id;

const isPlayable = (track: Track) => track.status === "ready" && (track.duration ?? 0) > 0;

// A view's play queue, built when a card is played rather than on every keystroke of a search
function sliceQueueOf(items: { id: string; segment: Segment; track: Track }[]): QueueItem[] {
  return items.filter((it) => isPlayable(it.track)).map((it) => createQueueItem(it.segment, it.track, it.id));
}

function mixedQueueOf(items: MixedItem[]): QueueItem[] {
  return items
    .filter((it) => isPlayable(it.track))
    .map((it) =>
      it.type === "slice" && it.segment
        ? createQueueItem(it.segment, it.track, it.id)
        : createQueueItem(createDefaultFullSegment(it.track), it.track, it.id)
    );
}

function trackQueueOf(tracks: Track[]): QueueItem[] {
  return tracks.filter(isPlayable).map((track) => createQueueItem(createDefaultFullSegment(track), track, track.id));
}

export function App() {
  const { t } = useTranslation();
  const tracks = usePlayerStore((s) => s.tracks);
  const isLoadingTracks = usePlayerStore((s) => s.isLoadingTracks);
  const fetchTracks = usePlayerStore((s) => s.fetchTracks);
  const sliceStudioTrack = usePlayerStore((s) => s.sliceStudioTrack);
  const closeSliceStudio = usePlayerStore((s) => s.closeSliceStudio);
  const buildShuffleQueue = usePlayerStore((s) => s.buildShuffleQueue);
  const buildPlaylistQueue = usePlayerStore((s) => s.buildPlaylistQueue);
  const queue = usePlayerStore((s) => s.queue);
  const queueIndex = usePlayerStore((s) => s.queueIndex);
  const isQueueEmpty = usePlayerStore((s) => s.queue.length === 0);
  const removeTrackFromQueue = usePlayerStore((s) => s.removeTrackFromQueue);
  const removeSegmentFromQueue = usePlayerStore((s) => s.removeSegmentFromQueue);

  // Playlist & View mode state
  const playlists = usePlayerStore((s) => s.playlists);
  const activePlaylistId = usePlayerStore((s) => s.activePlaylistId);
  const activeSystemCategory = usePlayerStore((s) => s.activeSystemCategory);
  const activePlaylistItems = usePlayerStore((s) => s.activePlaylistItems);
  const playlistSortMode = usePlayerStore((s) => s.playlistSortMode);
  const playlistRandomMap = usePlayerStore((s) => s.playlistRandomMap);
  const systemCategorySortMode = usePlayerStore((s) => s.systemCategorySortMode);
  const systemRandomMap = usePlayerStore((s) => s.systemRandomMap);
  const viewMode = usePlayerStore((s) => s.viewMode);
  const fetchPlaylists = usePlayerStore((s) => s.fetchPlaylists);
  const setActivePlaylist = usePlayerStore((s) => s.setActivePlaylist);
  const setViewMode = usePlayerStore((s) => s.setViewMode);
  const removeFromPlaylist = usePlayerStore((s) => s.removeFromPlaylist);
  const reorderPlaylist = usePlayerStore((s) => s.reorderPlaylist);
  const playPlaylistItemAtIndex = usePlayerStore((s) => s.playPlaylistItemAtIndex);
  const playSegmentInMode = usePlayerStore((s) => s.playSegmentInMode);
  const openSliceStudio = usePlayerStore((s) => s.openSliceStudio);
  const deleteSegmentsBatch = usePlayerStore((s) => s.deleteSegmentsBatch);
  const isRetryingAll = usePlayerStore((s) => s.isRetryingAll);
  const retryAllErrors = usePlayerStore((s) => s.retryAllErrors);
  const retryingTrackIds = usePlayerStore((s) => s.retryingTrackIds);
  const activeTrack = usePlayerStore((s) => s.activeTrack);
  const activeSegment = usePlayerStore((s) => s.activeSegment);
  const activeTrackScrollRequest = usePlayerStore((s) => s.activeTrackScrollRequest);

  const [segments, setSegments] = React.useState<Segment[]>([]);
  const segmentsEtagRef = React.useRef<string | null>(null);
  const segmentsDataRef = React.useRef<Segment[]>([]);

  const fetchSegments = React.useCallback(async () => {
    try {
      const headers: Record<string, string> = {};
      if (segmentsEtagRef.current) {
        headers["If-None-Match"] = segmentsEtagRef.current;
      }
      const res = await fetch("/api/segments", { headers });
      if (res.status === 304) {
        return segmentsDataRef.current;
      }
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          const etag = res.headers?.get ? res.headers.get("etag") : null;
          segmentsEtagRef.current = etag || null;
          segmentsDataRef.current = data;
          setSegments(data);
          return data;
        }
      }
    } catch {}
    return segmentsDataRef.current;
  }, []);

  const [searchQuery, setSearchQuery] = React.useState("");
  const deferredQuery = React.useDeferredValue(searchQuery);
  const { isDocked: isQueueDocked, isOpen: isQueueOpen, toggle: toggleQueue, close: closeQueue } = useQueueVisibility();
  const isQueueSheetOpen = isQueueOpen && !isQueueDocked;
  const [isShortcutsOpen, setIsShortcutsOpen] = React.useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = React.useState(false);
  // null = closed; {} = create a new mix; { mix } = edit that mix's sources
  const [mixModal, setMixModal] = React.useState<{ mix?: Playlist } | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<{
    type: "track" | "slice" | "playlist_item";
    id: string;
    title: string;
  } | null>(null);
  const [isDeletingTarget, setIsDeletingTarget] = React.useState(false);

  const isLogDrawerOpen = useLogStore((s) => s.isDrawerOpen);
  const closeLogDrawer = useLogStore((s) => s.closeDrawer);
  // The drawer loads lazily on first open, then stays mounted so it can animate closed
  const [hasOpenedLogDrawer, setHasOpenedLogDrawer] = React.useState(isLogDrawerOpen);
  if (isLogDrawerOpen && !hasOpenedLogDrawer) setHasOpenedLogDrawer(true);

  // Mutual exclusion: the log drawer and the queue sheet are never open together.
  // The docked queue panel is part of the layout, so it stays.
  React.useEffect(() => {
    if (isLogDrawerOpen && !isQueueDocked) {
      closeQueue();
    }
  }, [isLogDrawerOpen, isQueueDocked, closeQueue]);

  const prevQueueSheetRef = React.useRef(isQueueSheetOpen);
  React.useEffect(() => {
    const queueSheetJustOpened = !prevQueueSheetRef.current && isQueueSheetOpen;
    prevQueueSheetRef.current = isQueueSheetOpen;

    if (queueSheetJustOpened && isLogDrawerOpen) {
      closeLogDrawer();
    }
  }, [isQueueSheetOpen, isLogDrawerOpen, closeLogDrawer]);

  // Initial load & WebSocket heartbeat with auto-reconnect
  React.useEffect(() => {
    fetchTracks();
    fetchPlaylists();
    fetchSegments();

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    let ws: WebSocket | null = null;
    let heartbeatInterval: any = null;
    let reconnectTimeout: any = null;
    let isUnmounted = false;

    let wsDebounceTimer: any = null;
    let playlistWsDebounceTimer: any = null;
    let pendingSegmentReconciliation = false;

    function scheduleLibraryRefresh(reconcileSegments: boolean, delay: number) {
      pendingSegmentReconciliation ||= reconcileSegments;
      clearTimeout(wsDebounceTimer);
      wsDebounceTimer = setTimeout(() => {
        const reconcile = pendingSegmentReconciliation;
        pendingSegmentReconciliation = false;
        fetchTracks(reconcile);
        fetchSegments();
        fetchPlaylists();
        const activePl = usePlayerStore.getState().activePlaylistId;
        if (activePl) setActivePlaylist(activePl, true);
      }, delay);
    }

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
          // Re-sync server logs on connect/reconnect
          fetch("/api/logs?limit=200")
            .then((r) => (r.ok ? r.json() : []))
            .then((logs) => {
              if (Array.isArray(logs)) {
                useLogStore.getState().setLogs(logs);
              }
            })
            .catch(() => {});
        };
        ws.onmessage = (event) => {
          if (event.data === "pong") return;
          try {
            const data = JSON.parse(event.data);
            if (data.type === "app_log") {
              useLogStore.getState().addLog(data);
              return;
            }
            if (data.type === "logs_cleared") {
              useLogStore.getState().clearLogsLocal();
              return;
            }
            if (data.type === "segments_deleted" && Array.isArray(data.segmentIds)) {
              usePlayerStore.getState().removeSegmentsBatchFromQueue(data.segmentIds);
            } else {
              const segmentId = data.segmentId || data.data?.segmentId;
              if (data.type === "segment_deleted" && segmentId) {
                removeSegmentFromQueue(segmentId);
              }
            }
            if (data.type === "tracks_deleted" && Array.isArray(data.trackIds)) {
              usePlayerStore.getState().removeTracksBatchFromQueue(data.trackIds);
            } else {
              const trackId = data.trackId || data.data?.trackId;
              if (data.type === "track_deleted" && trackId) {
                removeTrackFromQueue(trackId);
              }
            }
            if (data.type === "track_updated") {
              window.dispatchEvent(new CustomEvent("app:track_updated", { detail: data }));
            }
            if (data.type === "segment_updated") {
              window.dispatchEvent(new CustomEvent("app:segment_updated", { detail: data }));
            }
            if (
              data.type === "playlist_created" ||
              data.type === "playlist_updated" ||
              data.type === "playlist_deleted" ||
              data.type === "playlist_items_changed"
            ) {
              const plId = data.playlistId || data.playlist_id || data.playlist?.id;
              const storeState = usePlayerStore.getState();
              if (data.type === "playlist_deleted") {
                if (plId) {
                  const selState = useSelectionStore.getState();
                  const toDeselect = Array.from(selState.selectedItems.values())
                    .filter((it) => it.playlistId === plId)
                    .map((it) => it.id);
                  if (toDeselect.length > 0) selState.deselectTracks(toDeselect);
                }
                if (plId === storeState.activePlaylistId) {
                  setActivePlaylist(null);
                }
                if (plId === storeState.activePlaylistPlayingId) {
                  audioEngine.unload();
                  const curMode = storeState.playbackMode;
                  const fallbackQueue = storeState.queuesByMode[curMode] || [];
                  usePlayerStore.setState({
                    queue: fallbackQueue,
                    queueIndex: fallbackQueue.length > 0 ? 0 : -1,
                    activeTrack: null,
                    activeSegment: null,
                    isPlaying: false,
                    currentTime: 0,
                    activePlaylistPlayingId: null,
                    activePlaylistOriginalQueue: [],
                  });
                }
              }
              clearTimeout(playlistWsDebounceTimer);
              playlistWsDebounceTimer = setTimeout(() => {
                fetchPlaylists();
                const freshActive = usePlayerStore.getState().activePlaylistId;
                if (freshActive && (!plId || showsItemsOf(freshActive, plId, usePlayerStore.getState().playlists))) {
                  setActivePlaylist(freshActive, true);
                }
              }, 150);
            }
            if (
              data.type === "track_updated" ||
              data.type === "track_created" ||
              data.type === "track_deleted" ||
              data.type === "tracks_deleted" ||
              data.type === "segment_deleted" ||
              data.type === "segments_deleted" ||
              data.type === "segment_updated"
            ) {
              scheduleLibraryRefresh(data.type !== "track_updated" || data.reason !== "volume", 250);
            }
            if (data.type === "library_restored") {
              scheduleLibraryRefresh(true, 100);
            }
          } catch {}
        };
        ws.onclose = () => {
          if (heartbeatInterval) clearInterval(heartbeatInterval);
          if (!isUnmounted) {
            reconnectTimeout = setTimeout(connectWs, 2000);
          }
        };
        ws.onerror = () => {
          // Socket error transitions immediately to onclose
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
      if (wsDebounceTimer) clearTimeout(wsDebounceTimer);
      if (playlistWsDebounceTimer) clearTimeout(playlistWsDebounceTimer);
      if (ws) ws.close();
    };
  }, [fetchTracks, fetchSegments, fetchPlaylists, setActivePlaylist, removeSegmentFromQueue, removeTrackFromQueue]);

  // Polling interval if any track is downloading or queued to ensure UI updates
  const hasPendingDownloads = tracks.some(
    (t) => t.status === "downloading" || t.status === "queued"
  );
  React.useEffect(() => {
    if (!hasPendingDownloads) return;

    const interval = setInterval(() => {
      fetchTracks(false);
    }, 2500);

    return () => clearInterval(interval);
  }, [hasPendingDownloads, fetchTracks]);

  // Initial queue build on first track load only once per session
  const hasAttemptedQueueBuildRef = React.useRef(false);
  const hasReadyTracks = React.useMemo(() => tracks.some((t) => t.status === "ready" && t.duration > 0), [tracks]);
  React.useEffect(() => {
    if (hasReadyTracks && isQueueEmpty && !hasAttemptedQueueBuildRef.current) {
      hasAttemptedQueueBuildRef.current = true;
      fetchSegments()
        .then((segments) => {
          if (Array.isArray(segments)) {
            if (usePlayerStore.getState().queue.length === 0) {
              buildShuffleQueue(segments, tracks);
            }
          }
        })
        .catch((e) => {
          hasAttemptedQueueBuildRef.current = false;
          console.error(e);
        });
    }
  }, [hasReadyTracks, isQueueEmpty, buildShuffleQueue, tracks, fetchSegments]);

  // Global shortcuts: `~`/`F2` for Logs, `?` for Shortcuts, `Q` for Queue, `Space` for Play/Pause
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // A focused element that already handled the key (a table row's Space/Enter, for one) owns it
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;

      const otherModalOpen = Boolean(
        usePlayerStore.getState().sliceStudioTrack || isDialogOpen('[data-drawer="log-drawer"]')
      );
      if (otherModalOpen) return;

      if (e.key === "F2") {
        e.preventDefault();
        useLogStore.getState().toggleDrawer();
        return;
      }

      const target = e.target as HTMLElement | null;
      const isInput =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
      if (isInput) return;

      if (e.key === "~" || e.key === "`") {
        e.preventDefault();
        useLogStore.getState().toggleDrawer();
        return;
      }

      if (e.key === "?" || (e.shiftKey && e.key === "/")) {
        e.preventDefault();
        setIsShortcutsOpen(true);
        return;
      }

      if (e.key === "q" || e.key === "Q") {
        e.preventDefault();
        toggleQueue();
        return;
      }

      if (e.code === "Space" || e.key === " " || e.key === "Spacebar") {
        if (target?.closest("button, [role='button'], [role='tab'], a[href]")) {
          return;
        }
        e.preventDefault();
        void usePlayerStore.getState().togglePlay();
        return;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleQueue]);

  const handleDeleteTrack = React.useCallback(
    (id: string) => {
      const trk = usePlayerStore.getState().tracks.find((t) => t.id === id);
      setDeleteTarget({
        type: "track",
        id,
        title: trk?.title || id,
      });
    },
    []
  );

  const handleDeleteSlice = React.useCallback(
    (id: string) => {
      const seg = segments.find((s) => s.id === id);
      setDeleteTarget({
        type: "slice",
        id,
        title: seg?.name || id,
      });
    },
    [segments]
  );

  const handleConfirmDelete = React.useCallback(async () => {
    if (!deleteTarget || isDeletingTarget) return;
    setIsDeletingTarget(true);
    try {
      if (deleteTarget.type === "track") {
        // Playback and the queues change only once the server has deleted it, as bulk delete does:
        // a delete that fails leaves the track playing and queued
        if (await sendChange("deleteTracks", `/api/tracks/${encodeURIComponent(deleteTarget.id)}`, { method: "DELETE" })) {
          if (usePlayerStore.getState().activeTrack?.id === deleteTarget.id) {
            audioEngine.unload();
          }
          removeTrackFromQueue(deleteTarget.id);
          await fetchTracks(true);
        }
      } else if (deleteTarget.type === "playlist_item") {
        if (activePlaylistId) {
          await removeFromPlaylist(activePlaylistId, deleteTarget.id);
        }
      } else {
        await deleteSegmentsBatch([deleteTarget.id]);
        await fetchSegments();
      }
      setDeleteTarget(null);
    } catch (e) {
      console.error(e);
    } finally {
      setIsDeletingTarget(false);
    }
  }, [deleteTarget, isDeletingTarget, removeTrackFromQueue, fetchTracks, deleteSegmentsBatch, fetchSegments, activePlaylistId, removeFromPlaylist]);


  const downloadingTracks = React.useMemo(() => {
    return tracks
      .filter((t) => t.status === "downloading" || t.status === "queued")
      .sort(compareDownloadingTracks);
  }, [tracks]);

  const hasActiveDownloads = downloadingTracks.length > 0 || isRetryingAll || Object.keys(retryingTrackIds).length > 0;
  React.useEffect(() => {
    if (!hasActiveDownloads) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [hasActiveDownloads]);

  const originalTracks = React.useMemo(() => {
    const ready = tracks.filter((t) => t.status === "ready");
    const sortedReady = getSortedTracks(
      ready,
      systemCategorySortMode.original_only,
      systemRandomMap.original_only
    );
    return [...downloadingTracks, ...sortedReady];
  }, [tracks, downloadingTracks, systemCategorySortMode.original_only, systemRandomMap.original_only]);

  const errorTracks = React.useMemo(() => {
    return tracks.filter((t) => t.status === "error");
  }, [tracks]);

  const filteredTracks = React.useMemo(() => {
    return filterTracks(originalTracks, deferredQuery);
  }, [originalTracks, deferredQuery]);

  const filteredDownloadingTracks = React.useMemo(() => {
    return filterTracks(downloadingTracks, deferredQuery);
  }, [downloadingTracks, deferredQuery]);

  const filteredErrorTracks = React.useMemo(() => {
    return filterTracks(errorTracks, deferredQuery);
  }, [errorTracks, deferredQuery]);

  const activePl = React.useMemo(() => {
    return playlists.find((p) => p.id === activePlaylistId);
  }, [playlists, activePlaylistId]);

  // Derived slice items for "slices_only" category
  const allSliceItems = React.useMemo(() => {
    const trackMap = new Map(tracks.map((t) => [t.id, t]));
    const items: { id: string; segment: Segment; track: Track }[] = [];
    for (const seg of segments) {
      if (seg.id.startsWith("fallback_")) continue;
      const trk = trackMap.get(seg.track_id);
      if (trk && trk.status === "ready") {
        items.push({ id: seg.id, segment: seg, track: trk });
      }
    }
    return getSortedSliceItems(
      items,
      systemCategorySortMode.slices_only,
      systemRandomMap.slices_only
    );
  }, [segments, tracks, systemCategorySortMode.slices_only, systemRandomMap.slices_only]);

  const filteredSliceItems = React.useMemo(() => {
    return searchItems(allSliceItems, deferredQuery, (item) => ({
      title: item.segment?.name,
      artist: item.track?.artist,
      segmentName: item.track?.title,
      createdAt: item.segment?.created_at,
    }));
  }, [allSliceItems, deferredQuery]);

  const allMixedItems = React.useMemo<MixedItem[]>(() => {
    const pendingItems: MixedItem[] = downloadingTracks.map((t) => ({
      type: "track",
      id: `track_${t.id}`,
      track: t,
      createdAt: t.created_at || 0,
    }));

    const readyItems: MixedItem[] = [];
    for (const t of tracks) {
      if (t.status === "ready") {
        readyItems.push({
          type: "track",
          id: `track_${t.id}`,
          track: t,
          createdAt: t.created_at || 0,
        });
      }
    }

    for (const item of allSliceItems) {
      readyItems.push({
        type: "slice",
        id: `slice_${item.segment.id}`,
        segment: item.segment,
        track: item.track,
        createdAt: item.segment.created_at || 0,
      });
    }

    const sortedReady = getSortedMixedItems(
      readyItems,
      systemCategorySortMode.mixed,
      systemRandomMap.mixed
    );

    return [...pendingItems, ...sortedReady];
  }, [downloadingTracks, tracks, allSliceItems, systemCategorySortMode.mixed, systemRandomMap.mixed]);

  const filteredMixedItems = React.useMemo(() => {
    return searchItems(allMixedItems, deferredQuery, (item) => {
      if (item.type === "slice") {
        return {
          title: item.segment.name,
          artist: item.track.artist,
          segmentName: item.track.title,
          createdAt: item.createdAt,
        };
      }
      return {
        title: item.track.title,
        artist: item.track.artist,
        createdAt: item.createdAt,
      };
    });
  }, [allMixedItems, deferredQuery]);

  const currentPlaylist = React.useMemo(() => {
    return playlists.find((p) => p.id === activePlaylistId);
  }, [playlists, activePlaylistId]);

  const builtInItemIds = React.useMemo(() => {
    if (activePlaylistId) return undefined;
    if (activeSystemCategory === "mixed") {
      return allMixedItems.map((it) => it.id);
    }
    if (activeSystemCategory === "slices_only") {
      return allSliceItems.map((it) => it.id);
    }
    if (activeSystemCategory === "original_only") {
      return originalTracks.map((it) => it.id);
    }
    return undefined;
  }, [activePlaylistId, activeSystemCategory, allMixedItems, allSliceItems, originalTracks]);

  const sortedPlaylistItems = React.useMemo(() => {
    if (!activePlaylistId) return [];
    return getSortedPlaylistItems(
      activePlaylistItems,
      playlistSortMode,
      playlistRandomMap[activePlaylistId],
      currentPlaylist?.is_custom_ordered
    );
  }, [activePlaylistId, activePlaylistItems, playlistSortMode, playlistRandomMap, currentPlaylist?.is_custom_ordered]);

  const displayedPlaylistItems = React.useMemo(() => {
    if (!activePlaylistId) return [];
    return searchItems(sortedPlaylistItems, deferredQuery, (item) => ({
      title: item.segment?.name || item.track?.title,
      artist: item.track?.artist,
      segmentName: item.segment ? item.track?.title : undefined,
      createdAt: item.added_at,
    }));
  }, [activePlaylistId, sortedPlaylistItems, deferredQuery]);

  // Cards are memoized, so their handlers must be stable: an inline closure re-renders every visible card
  // each time the grid renders, which is every frame while the sidebar animates
  const playFromQueue = React.useCallback(
    (mode: PlaybackMode, viewQueue: QueueItem[], segment: Segment, track: Track) => {
      const query = deferredQuery.trim();
      const index = viewQueue.findIndex((q) => q.segment.id === segment.id);
      return playSegmentInMode(
        mode,
        segment,
        track,
        viewQueue,
        index >= 0 ? index : undefined,
        query ? { type: "search", query, count: viewQueue.length, mode } : { type: "system", mode }
      );
    },
    [deferredQuery, playSegmentInMode]
  );
  const handlePlaySlice = React.useCallback(
    (segment: Segment, track: Track) => playFromQueue("slices_only", sliceQueueOf(filteredSliceItems), segment, track),
    [playFromQueue, filteredSliceItems]
  );
  const handlePlayMixedSlice = React.useCallback(
    (segment: Segment, track: Track) => playFromQueue("mixed", mixedQueueOf(filteredMixedItems), segment, track),
    [playFromQueue, filteredMixedItems]
  );
  const handlePlayMixedTrack = React.useCallback(
    (track: Track) => playFromQueue("mixed", mixedQueueOf(filteredMixedItems), createDefaultFullSegment(track), track),
    [playFromQueue, filteredMixedItems]
  );
  const handlePlayTrack = React.useCallback(
    (track: Track) => playFromQueue("original_only", trackQueueOf(filteredTracks), createDefaultFullSegment(track), track),
    [playFromQueue, filteredTracks]
  );

  const currentViewKey = getViewScrollKey(activePlaylistId, activeSystemCategory);

  const [gridScrollRequest, setGridScrollRequest] = React.useState<{ index: number; requestId: number } | null>(null);
  const lastHandledGridScrollRequestIdRef = React.useRef<number | null>(null);

  const handleGridScrollHandled = React.useCallback((id: number) => {
    setGridScrollRequest((prev) => (prev?.requestId === id ? null : prev));
    usePlayerStore.getState().clearActiveTrackScrollRequest();
  }, []);

  React.useEffect(() => {
    if (viewMode !== "grid" || !activeTrackScrollRequest) return;
    if (lastHandledGridScrollRequestIdRef.current === activeTrackScrollRequest.id) return;
    if (Date.now() - activeTrackScrollRequest.timestamp > 2000) return;
    if (activeTrackScrollRequest.targetKey && activeTrackScrollRequest.targetKey !== currentViewKey) return;

    let targetIdx = -1;
    const isFallback = !activeSegment || activeSegment.id.startsWith("fallback_");

    if (activePlaylistId) {
      const currentQueueItemId = queueIndex >= 0 ? queue[queueIndex]?.queueItemId : undefined;
      targetIdx = findActivePlaylistItemIndex(displayedPlaylistItems, {
        currentQueueItemId,
        activeTrackId: activeTrack?.id,
        activeSegmentId: activeSegment?.id,
        isFallbackSegment: isFallback,
      });
    } else if (activeSystemCategory === "mixed") {
      targetIdx = findActiveMixedItemIndex(filteredMixedItems, {
        activeTrackId: activeTrack?.id,
        activeSegmentId: activeSegment?.id,
        isFallbackSegment: isFallback,
      });
    } else if (activeSystemCategory === "slices_only") {
      targetIdx = findActiveSliceItemIndex(filteredSliceItems, activeSegment?.id);
    } else if (activeSystemCategory === "original_only") {
      targetIdx = findActiveTrackIndex(filteredTracks, activeTrack?.id, isFallback);
    }

    if (targetIdx >= 0) {
      lastHandledGridScrollRequestIdRef.current = activeTrackScrollRequest.id;
      setGridScrollRequest({ index: targetIdx, requestId: activeTrackScrollRequest.id });
    }
  }, [
    viewMode,
    activeTrackScrollRequest,
    currentViewKey,
    activePlaylistId,
    activeSystemCategory,
    displayedPlaylistItems,
    filteredMixedItems,
    filteredSliceItems,
    filteredTracks,
    activeTrack?.id,
    activeSegment?.id,
    queueIndex,
    queue,
  ]);

  const handlePlayPlaylistItem = React.useCallback(
    (itemId: string) => {
      if (activePlaylistId) {
        if (deferredQuery.trim()) {
          buildPlaylistQueue(activePlaylistId, false, itemId, false, {
            type: "search",
            query: deferredQuery.trim(),
            count: displayedPlaylistItems.length,
            playlistId: activePlaylistId,
          });
        } else {
          playPlaylistItemAtIndex(activePlaylistId, itemId);
        }
      }
    },
    [activePlaylistId, buildPlaylistQueue, playPlaylistItemAtIndex, deferredQuery, displayedPlaylistItems.length]
  );

  const handleDeletePlaylistItem = React.useCallback(
    (itemId: string, name: string) => {
      if (!activePlaylistId) return;
      setDeleteTarget({
        type: "playlist_item",
        id: itemId,
        title: name,
      });
    },
    [activePlaylistId]
  );

  const handleGridReorder = React.useCallback(
    async (fromIdx: number, toIdx: number) => {
      if (!activePlaylistId || Boolean(deferredQuery.trim()) || playlistSortMode !== "manual") return;
      if (fromIdx === toIdx) return;
      if (
        fromIdx < 0 ||
        fromIdx >= displayedPlaylistItems.length ||
        toIdx < 0 ||
        toIdx >= displayedPlaylistItems.length
      ) {
        return;
      }
      const newItems = [...displayedPlaylistItems];
      const [moved] = newItems.splice(fromIdx, 1);
      newItems.splice(toIdx, 0, moved);
      const newIds = newItems.map((it) => it.id);
      await reorderPlaylist(activePlaylistId, newIds);
    },
    [activePlaylistId, deferredQuery, playlistSortMode, displayedPlaylistItems, reorderPlaylist]
  );

  const isSearching = Boolean(deferredQuery.trim());

  const displayedPlaylists = React.useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    return q ? playlists.filter((p) => p.name.toLowerCase().includes(q)) : playlists;
  }, [playlists, deferredQuery]);
  const isLibraryEmpty = tracks.length === 0;

  const visibleItems = React.useMemo<SelectedItem[]>(() => {
    if (activePlaylistId) {
      return displayedPlaylistItems.map((it) => ({
        id: it.id,
        type: "playlist_item" as const,
        trackId: it.track?.id || "",
        segmentId: it.segment?.id || null,
        playlistId: activePlaylistId,
        title: it.segment ? it.segment.name : (it.track?.title || ""),
      }));
    }
    switch (activeSystemCategory) {
      case "original_only":
        return filteredTracks.map((t) => ({
          id: t.id,
          type: "track" as const,
          trackId: t.id,
          title: t.title,
        }));
      case "slices_only":
        return filteredSliceItems.map((it) => ({
          id: it.segment.id,
          type: "slice" as const,
          trackId: it.track.id,
          segmentId: it.segment.id,
          title: it.segment.name,
        }));
      case "mixed":
        return filteredMixedItems.map((it) =>
          it.type === "slice"
            ? {
                id: it.segment.id,
                type: "slice" as const,
                trackId: it.track.id,
                segmentId: it.segment.id,
                title: it.segment.name,
              }
            : {
                id: it.track.id,
                type: "track" as const,
                trackId: it.track.id,
                title: it.track.title,
              }
        );
      case "downloading_only":
        return filteredDownloadingTracks.map((t) => ({
          id: t.id,
          type: "track" as const,
          trackId: t.id,
          title: t.title,
        }));
      case "error_only":
        return filteredErrorTracks.map((t) => ({
          id: t.id,
          type: "track" as const,
          trackId: t.id,
          title: t.title,
        }));
      default:
        return [];
    }
  }, [
    activePlaylistId,
    activeSystemCategory,
    displayedPlaylistItems,
    filteredTracks,
    filteredSliceItems,
    filteredMixedItems,
    filteredDownloadingTracks,
    filteredErrorTracks,
  ]);

  const visibleTrackIds = React.useMemo(() => {
    return visibleItems.map((item) => item.id);
  }, [visibleItems]);

  // Prune ghost IDs when tracks, segments, or playlist items change
  React.useEffect(() => {
    const validIds = new Set<string>();
    for (const t of tracks) validIds.add(t.id);
    for (const s of segments) validIds.add(s.id);
    for (const pi of activePlaylistItems) validIds.add(pi.id);
    useSelectionStore.getState().pruneSelection(validIds, activePlaylistId);
  }, [tracks, segments, activePlaylistItems, activePlaylistId]);

  // View scroll position persistence & restoration per playlist / view
  const currentViewKeyRef = React.useRef(currentViewKey);
  currentViewKeyRef.current = currentViewKey;
  const viewModeRef = React.useRef(viewMode);
  viewModeRef.current = viewMode;
  const isSearchingRef = React.useRef(isSearching);
  isSearchingRef.current = isSearching;
  const pendingScrollRestoreRef = React.useRef<{ key: string; targetY: number } | null>(null);

  // Track window scroll continuously to save position of currently visible view
  React.useEffect(() => {
    let rafId: number | null = null;
    const safeRaf = (cb: () => void) => {
      if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
        return window.requestAnimationFrame(cb);
      }
      return (setTimeout(cb, 16) as unknown) as number;
    };
    const safeCancelRaf = (id: number) => {
      if (typeof window !== "undefined" && typeof window.cancelAnimationFrame === "function") {
        window.cancelAnimationFrame(id);
      } else {
        clearTimeout(id);
      }
    };

    const handleScroll = () => {
      if (rafId !== null) return;
      if (typeof window === "undefined") return;
      if (isSearchingRef.current) return;
      if (pendingScrollRestoreRef.current) return;
      rafId = safeRaf(() => {
        rafId = null;
        if (isSearchingRef.current) return;
        if (pendingScrollRestoreRef.current) return;
        const y = window.scrollY || window.pageYOffset || document.documentElement?.scrollTop || 0;
        const baseKey = currentViewKeyRef.current;
        const mode = viewModeRef.current;
        const store = usePlayerStore.getState();
        store.saveViewScrollPosition(`${baseKey}:${mode}`, y);
        store.saveViewScrollPosition(baseKey, y);
      });
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      if (rafId !== null) safeCancelRaf(rafId);
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  const targetScrollY = React.useMemo(() => {
    if (isSearching) return 0;
    const store = usePlayerStore.getState();
    const fullKey = `${currentViewKey}:${viewMode}`;
    return store.viewScrollPositions[fullKey] ?? store.viewScrollPositions[currentViewKey] ?? 0;
  }, [currentViewKey, viewMode, isSearching]);

  const isPendingActiveTrackScroll = Boolean(
    activeTrackScrollRequest &&
      Date.now() - activeTrackScrollRequest.timestamp <= 2000 &&
      (!activeTrackScrollRequest.targetKey || activeTrackScrollRequest.targetKey === currentViewKey)
  );

  const lastRestoredViewRef = React.useRef<string | null>(null);

  React.useLayoutEffect(() => {
    if (isSearching) {
      lastRestoredViewRef.current = null;
      return;
    }

    const fullKey = `${currentViewKey}:${viewMode}`;
    const isViewTransition = lastRestoredViewRef.current !== fullKey;
    lastRestoredViewRef.current = fullKey;

    if (!isViewTransition) return;

    if (isPendingActiveTrackScroll) {
      pendingScrollRestoreRef.current = null;
      return;
    }

    if (targetScrollY <= 0) {
      pendingScrollRestoreRef.current = null;
      if (typeof window !== "undefined") {
        window.scrollTo({ top: 0, behavior: "instant" });
      }
      return;
    }

    pendingScrollRestoreRef.current = { key: currentViewKey, targetY: targetScrollY };
    if (typeof window !== "undefined") {
      window.scrollTo({ top: targetScrollY, behavior: "instant" });
    }
  }, [currentViewKey, viewMode, targetScrollY, isSearching, isPendingActiveTrackScroll]);

  // When items load or change (e.g. custom playlist items finish fetching), ensure scroll is restored
  const currentItemCount = activePlaylistId ? activePlaylistItems.length : (visibleItems.length || 0);
  React.useEffect(() => {
    if (isPendingActiveTrackScroll) return;
    if (currentItemCount > 0 && pendingScrollRestoreRef.current?.key === currentViewKey) {
      const y = pendingScrollRestoreRef.current.targetY;
      pendingScrollRestoreRef.current = null;
      if (typeof window !== "undefined") {
        const safeRaf = typeof window.requestAnimationFrame === "function" ? window.requestAnimationFrame : (cb: () => void) => setTimeout(cb, 0);
        safeRaf(() => {
          window.scrollTo({ top: y, behavior: "instant" });
        });
      }
    }
  }, [currentItemCount, currentViewKey, isPendingActiveTrackScroll]);

  // Read by the content's scroll-margin and the page title's scroll timeline, so both account for the sticky toolbar
  const toolbarRef = useHeightCssVar("--library-toolbar-height");

  const headerMeta = React.useMemo(() => {
    if (activePl) {
      return {
        title: activePl.name,
        count: t("categories.itemsCount", { count: activePlaylistItems.length }),
        description: t("categories.customDesc"),
      };
    }
    switch (activeSystemCategory) {
      case "playlists":
        return {
          title: t("categories.playlists"),
          count: `(${t("playlist.customCount", { count: playlists.length })})`,
          description: t("categories.playlistsDesc"),
        };
      case "slices_only":
        return {
          title: t("categories.slices"),
          count: isSearching
            ? t("categories.slicesCountFiltered", { filtered: filteredSliceItems.length, total: allSliceItems.length })
            : t("categories.slicesCount", { count: allSliceItems.length }),
          description: t("categories.slicesDesc"),
        };
      case "original_only":
        return {
          title: t("categories.tracks"),
          count: isSearching
            ? t("categories.tracksCountFiltered", { filtered: filteredTracks.length, total: originalTracks.length })
            : t("categories.tracksCount", { count: originalTracks.length }),
          description: t("categories.tracksDesc"),
        };
      case "downloading_only":
        return {
          title: t("categories.downloading"),
          count: isSearching
            ? t("categories.tracksCountFiltered", { filtered: filteredDownloadingTracks.length, total: downloadingTracks.length })
            : t("categories.tracksCount", { count: downloadingTracks.length }),
          description: t("categories.downloadingDesc"),
        };
      case "error_only":
        return {
          title: t("categories.errors"),
          count: isSearching
            ? t("categories.tracksCountFiltered", { filtered: filteredErrorTracks.length, total: errorTracks.length })
            : t("categories.tracksCount", { count: errorTracks.length }),
          description: t("categories.errorsDesc"),
        };
      case "mixed":
      default:
        return {
          title: t("categories.mixed"),
          count: isSearching
            ? t("categories.itemsCountFiltered", { filtered: filteredMixedItems.length, total: allMixedItems.length })
            : t("categories.itemsCount", { count: allMixedItems.length }),
          description: t("categories.mixedDesc"),
        };
    }
  }, [
    activePl,
    activePlaylistItems.length,
    activeSystemCategory,
    isSearching,
    filteredSliceItems.length,
    allSliceItems.length,
    filteredTracks.length,
    originalTracks.length,
    filteredDownloadingTracks.length,
    downloadingTracks.length,
    filteredErrorTracks.length,
    errorTracks.length,
    filteredMixedItems.length,
    allMixedItems.length,
    playlists.length,
    t,
  ]);

  return (
    <AppShell
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      onCreatePlaylist={() => setIsCreateModalOpen(true)}
      onOpenShortcuts={() => setIsShortcutsOpen(true)}
    >
      <SidebarInset id={MAIN_CONTENT_ID} className="min-w-0">
        {/* Sticky toolbar: view title, sort and view mode, library actions, master volume.
            A container, so control labels give way to icons when the column is narrow rather than wrapping */}
        <header ref={toolbarRef} data-testid="sticky-library-header" className="@container sticky top-0 z-30 w-full bg-background/95 backdrop-blur-md border-b border-border/80 shadow-xs">
          <div className="w-full px-4 sm:px-6 lg:px-8 py-2">
            {/* Title on the left; controls wrap below it when the column is narrow */}
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
              <div className="flex flex-1 items-center gap-2.5 min-w-48">
                <SidebarTrigger />
                {/* The page names itself in a large title (a playlist in its header); like Apple Music, the name joins the toolbar once that title scrolls under it */}
                <div className="reveal-past-page-title flex min-w-0 items-center gap-2.5">
                  <h1 id="library-view-title" className="text-base sm:text-lg font-bold tracking-tight text-foreground flex items-center gap-2 shrink-0 max-w-xs">
                    <span className="truncate">{headerMeta.title}</span>
                    <span className="sr-only sm:not-sr-only text-xs font-normal text-muted-foreground tabular-nums shrink-0" aria-live="polite" aria-atomic="true">
                      {headerMeta.count}
                    </span>
                  </h1>
                  {headerMeta.description && (
                    <span className="text-xs text-muted-foreground truncate min-w-0 hidden md:inline border-l border-border/60 pl-2.5">
                      {headerMeta.description}
                    </span>
                  )}
                </div>
              </div>

              {/* Sort, view mode, library actions and master volume */}
              <div className="flex flex-wrap items-center justify-end gap-2">
                {(activePlaylistId || activeSystemCategory === "mixed" || activeSystemCategory === "slices_only" || activeSystemCategory === "original_only") && (
                  <PlaylistSortSelector builtInItemIds={builtInItemIds} />
                )}
                <ViewModeToggle value={viewMode} onValueChange={setViewMode} />
                <ImportActions />
                <div className="hidden xl:flex">
                  <MasterVolume />
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* Content Area */}
        <div className="clear-sticky-bars w-full px-4 sm:px-6 lg:px-8 pt-4 sm:pt-6 pb-6">
          <div
            id="main-library-panel"
            role="region"
            key={`${activePlaylistId || activeSystemCategory || "mixed"}_${viewMode}`}
            aria-labelledby="library-view-title"
            className="animate-in fade-in duration-150 ease-out motion-reduce:animate-none"
          >
        {/* Library views open with a large title like Apple Music's pages; a playlist's header plays that part */}
        {!activePlaylistId && (
          <div className="mb-6 flex flex-col gap-1">
            <div className="page-title-timeline flex flex-wrap items-baseline gap-x-2">
              <h2 className="text-2xl font-bold text-foreground">{headerMeta.title}</h2>
              <span className="text-xs text-muted-foreground tabular-nums">{headerMeta.count}</span>
            </div>
            {headerMeta.description && <p className="text-2xs font-semibold text-muted-foreground">{headerMeta.description}</p>}
          </div>
        )}
        {isLoadingTracks && isLibraryEmpty ? (
          <LibrarySkeleton viewMode={viewMode} />
        ) : activePlaylistId ? (
          /* Custom Playlist Active */
          <>
          {activePl && (
            <PlaylistHeader
              playlist={activePl}
              items={activePlaylistItems}
              onEditSources={() => setMixModal({ mix: activePl })}
            />
          )}
          {viewMode === "list" ? (
            <PlaylistTableView
              key={`playlist_table_${activePlaylistId}`}
              searchQuery={deferredQuery}
              onDeletePlaylistItem={handleDeletePlaylistItem}
              initialScrollOffset={targetScrollY}
            />
          ) : activePlaylistItems.length === 0 ? (
            <EmptyState
              icon={Music}
              title={t("library.emptyPlaylistTitle")}
              description={t("library.emptyPlaylistDesc", { name: activePl?.name })}
            />
          ) : displayedPlaylistItems.length === 0 && isSearching ? (
            <EmptyState
              icon={SearchX}
              title={t("library.noResultsTitle")}
              description={t("library.noResultsDesc")}
            >
              <Button variant="outline" onClick={() => setSearchQuery("")}>
                {t("library.clearSearch")}
              </Button>
            </EmptyState>
          ) : (
            <VirtualizedCardGrid
              key={`playlist_${activePlaylistId}`}
              items={displayedPlaylistItems}
              getItemKey={getItemEntityId}
              getItemName={(item) => (item.segment ? item.segment.name : item.track?.title || "")}
              getItemThumbnail={(item) => item.track?.thumbnail_url}
              isReorderable={Boolean(activePlaylistId && !activePl?.is_mix && playlistSortMode === "manual" && !deferredQuery.trim())}
              onReorder={handleGridReorder}
              scrollRequest={gridScrollRequest}
              onScrollHandled={handleGridScrollHandled}
              initialScrollOffset={targetScrollY}
              className={`transition-opacity duration-150 ${searchQuery !== deferredQuery ? "opacity-70" : "opacity-100"}`}
              renderItem={(item, idx, dragProps) => (
                <PlaylistItemCard
                  key={item.id}
                  item={item}
                  index={idx}
                  totalItems={displayedPlaylistItems.length}
                  visibleItemIds={visibleItems}
                  onPlay={handlePlayPlaylistItem}
                  onDelete={activePl?.is_mix ? undefined : handleDeletePlaylistItem}
                  dragProps={dragProps}
                />
              )}
            />
          )}
          </>
        ) : activeSystemCategory === "playlists" ? (
          /* Playlists library: one cover card per custom playlist */
          displayedPlaylists.length === 0 && isSearching ? (
            <EmptyState
              icon={SearchX}
              title={t("library.noResultsTitle")}
              description={t("library.noResultsDesc")}
            >
              <Button variant="outline" onClick={() => setSearchQuery("")}>
                {t("library.clearSearch")}
              </Button>
            </EmptyState>
          ) : (
            <PlaylistGrid
              playlists={displayedPlaylists}
              onOpen={(id) => setActivePlaylist(id)}
              onCreate={() => setIsCreateModalOpen(true)}
              onMix={() => setMixModal({})}
              onEditSources={(mix) => setMixModal({ mix })}
            />
          )
        ) : activeSystemCategory === "slices_only" ? (
          /* Slices Only Category */
          allSliceItems.length === 0 ? (
            <EmptyState
              icon={Scissors}
              title={t("library.noSlicesTitle")}
              description={t("library.noSlicesDesc")}
            />
          ) : filteredSliceItems.length === 0 && isSearching ? (
            <EmptyState
              icon={SearchX}
              title={t("library.noSlicesSearchTitle")}
              description={t("library.noSlicesSearchDesc")}
            >
              <Button variant="outline" onClick={() => setSearchQuery("")}>
                {t("library.clearSearch")}
              </Button>
            </EmptyState>
          ) : viewMode === "list" ? (
            <PlaylistTableView
              sliceItems={filteredSliceItems}
              searchQuery={deferredQuery}
              onDeleteSlice={handleDeleteSlice}
              initialScrollOffset={targetScrollY}
            />
          ) : (
            <VirtualizedCardGrid
              key="slices_only"
              items={filteredSliceItems}
              getItemKey={getItemEntityId}
              scrollRequest={gridScrollRequest}
              onScrollHandled={handleGridScrollHandled}
              initialScrollOffset={targetScrollY}
              className={`transition-opacity duration-150 ${searchQuery !== deferredQuery ? "opacity-70" : "opacity-100"}`}
              renderItem={(item) => (
                <SliceCard
                  key={item.id}
                  segment={item.segment}
                  track={item.track}
                  visibleItemIds={visibleItems}
                  onPlay={handlePlaySlice}
                  onOpenStudio={openSliceStudio}
                  onDelete={handleDeleteSlice}
                />
              )}
            />
          )
        ) : activeSystemCategory === "mixed" ? (
          /* Mixed Category (Trộn Cả 2) */
          isLibraryEmpty || allMixedItems.length === 0 ? (
            <EmptyState
              icon={Music}
              title={t("library.emptyLibraryTitle")}
              description={t("library.emptyLibraryDesc")}
            />
          ) : filteredMixedItems.length === 0 && isSearching ? (
            <EmptyState
              icon={SearchX}
              title={t("library.noResultsTitle")}
              description={t("library.noResultsDesc")}
            >
              <Button variant="outline" onClick={() => setSearchQuery("")}>
                {t("library.clearSearch")}
              </Button>
            </EmptyState>
          ) : viewMode === "list" ? (
            <PlaylistTableView
              mixedItems={filteredMixedItems}
              searchQuery={deferredQuery}
              onDeleteTrack={handleDeleteTrack}
              onDeleteSlice={handleDeleteSlice}
              initialScrollOffset={targetScrollY}
            />
          ) : (
            <VirtualizedCardGrid
              key="mixed"
              items={filteredMixedItems}
              getItemKey={getItemEntityId}
              scrollRequest={gridScrollRequest}
              onScrollHandled={handleGridScrollHandled}
              initialScrollOffset={targetScrollY}
              className={`transition-opacity duration-150 ${searchQuery !== deferredQuery ? "opacity-70" : "opacity-100"}`}
              renderItem={(item) =>
                item.type === "slice" ? (
                  <SliceCard
                    key={item.id}
                    segment={item.segment}
                    track={item.track}
                    visibleItemIds={visibleItems}
                    onPlay={handlePlayMixedSlice}
                    onOpenStudio={openSliceStudio}
                    onDelete={handleDeleteSlice}
                  />
                ) : (
                  <TrackCard
                    key={item.id}
                    track={item.track}
                    onDelete={handleDeleteTrack}
                    visibleTrackIds={visibleItems}
                    onPlay={handlePlayMixedTrack}
                  />
                )
              }
            />
          )
        ) : activeSystemCategory === "downloading_only" ? (
          /* Downloading Only Category (Đang Tải) */
          downloadingTracks.length === 0 ? (
            <EmptyState
              icon={Check}
              tone="success"
              title={t("categories.noDownloadingTitle")}
              description={t("categories.noDownloadingDesc")}
            />
          ) : filteredDownloadingTracks.length === 0 && isSearching ? (
            <EmptyState
              icon={SearchX}
              title={t("library.noResultsTitle")}
              description={t("library.noResultsDesc")}
            >
              <Button variant="outline" onClick={() => setSearchQuery("")}>
                {t("library.clearSearch")}
              </Button>
            </EmptyState>
          ) : viewMode === "list" ? (
            <PlaylistTableView
              filteredTracks={filteredDownloadingTracks}
              searchQuery={deferredQuery}
              onDeleteTrack={handleDeleteTrack}
              initialScrollOffset={targetScrollY}
            />
          ) : (
            <VirtualizedCardGrid
              key="downloading_only"
              items={filteredDownloadingTracks}
              getItemKey={getItemEntityId}
              initialScrollOffset={targetScrollY}
              className={`transition-opacity duration-150 ${searchQuery !== deferredQuery ? "opacity-70" : "opacity-100"}`}
              renderItem={(track) => (
                <TrackCard
                  key={track.id}
                  track={track}
                  onDelete={handleDeleteTrack}
                  visibleTrackIds={visibleItems}
                />
              )}
            />
          )
        ) : activeSystemCategory === "error_only" ? (
          /* Error Only Category (Bài Lỗi) */
          errorTracks.length === 0 ? (
            <EmptyState
              icon={Check}
              tone="success"
              title={t("categories.noErrorsTitle")}
              description={t("categories.noErrorsDesc")}
            />
          ) : filteredErrorTracks.length === 0 && isSearching ? (
            <EmptyState
              icon={SearchX}
              title={t("library.noResultsTitle")}
              description={t("library.noResultsDesc")}
            >
              <Button variant="outline" onClick={() => setSearchQuery("")}>
                {t("library.clearSearch")}
              </Button>
            </EmptyState>
          ) : (
            <div className="space-y-4">
              <Alert variant="destructive">
                <AlertCircle />
                <AlertTitle>{t("categories.errorsDesc")}</AlertTitle>
                <AlertDescription>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={isRetryingAll}
                    onClick={() => retryAllErrors()}
                    className="mt-1.5"
                  >
                    <RefreshCw data-icon="inline-start" className={cn(isRetryingAll && "animate-spin")} />
                    {isRetryingAll ? t("categories.retryingAll") : t("categories.retryAll", { count: errorTracks.length })}
                  </Button>
                </AlertDescription>
              </Alert>

              {viewMode === "list" ? (
                <PlaylistTableView
                  filteredTracks={filteredErrorTracks}
                  searchQuery={deferredQuery}
                  onDeleteTrack={handleDeleteTrack}
                  initialScrollOffset={targetScrollY}
                />
              ) : (
                <VirtualizedCardGrid
                  key="error_only"
                  items={filteredErrorTracks}
                  getItemKey={getItemEntityId}
                  initialScrollOffset={targetScrollY}
                  className={`transition-opacity duration-150 ${searchQuery !== deferredQuery ? "opacity-70" : "opacity-100"}`}
                  renderItem={(track) => (
                    <TrackCard
                      key={track.id}
                      track={track}
                      onDelete={handleDeleteTrack}
                      visibleTrackIds={visibleItems}
                    />
                  )}
                />
              )}
            </div>
          )
        ) : isLibraryEmpty || originalTracks.length === 0 ? (
          /* Empty Library State (No tracks in DB) */
          <EmptyState
            icon={Music}
            title={t("library.emptyLibraryTitle")}
            description={t("library.emptyLibraryDesc")}
          />
        ) : filteredTracks.length === 0 ? (
          /* No search results found */
          <EmptyState
            icon={SearchX}
            title={t("library.noResultsTitle")}
            description={t("library.noResultsDesc")}
          >
            <Button variant="outline" onClick={() => setSearchQuery("")}>
              {t("library.clearSearch")}
            </Button>
          </EmptyState>
        ) : viewMode === "list" ? (
          <PlaylistTableView
            filteredTracks={filteredTracks}
            searchQuery={deferredQuery}
            onDeleteTrack={handleDeleteTrack}
            initialScrollOffset={targetScrollY}
          />
        ) : (
          /* Track Grid */
          <VirtualizedCardGrid
            key="original_only"
            items={filteredTracks}
            getItemKey={getItemEntityId}
            scrollRequest={gridScrollRequest}
            onScrollHandled={handleGridScrollHandled}
            initialScrollOffset={targetScrollY}
            className={`transition-opacity duration-150 ${searchQuery !== deferredQuery ? "opacity-70" : "opacity-100"}`}
            renderItem={(track) => (
              <TrackCard
                key={track.id}
                track={track}
                onDelete={handleDeleteTrack}
                visibleTrackIds={visibleItems}
                onPlay={handlePlayTrack}
              />
            )}
          />
        )}
          </div>
        </div>

        {/* The player capsule floats over the foot of this column, and the bulk action bar over the capsule */}
        <PlayerBar
          onToggleQueue={toggleQueue}
          isQueueOpen={isQueueOpen}
          isQueueDocked={isQueueDocked}
        />
        <BulkActionBar visibleTrackIds={visibleTrackIds} visibleItems={visibleItems} />
      </SidebarInset>

      {isQueueDocked && isQueueOpen && <QueuePanel onClose={closeQueue} />}

      {/* Slice Studio Modal */}
      {sliceStudioTrack && (
        <React.Suspense fallback={null}>
          <SliceStudio
            track={sliceStudioTrack}
            onClose={() => {
              closeSliceStudio();
              fetchSegments();
              setTimeout(() => {
                fetchTracks();
              }, 100);
            }}
          />
        </React.Suspense>
      )}

      {/* Confirm Delete Modal */}
      {deleteTarget && (
        <ConfirmModal
          isOpen={!!deleteTarget}
          onClose={() => !isDeletingTarget && setDeleteTarget(null)}
          onConfirm={handleConfirmDelete}
          isLoading={isDeletingTarget}
          title={
            deleteTarget.type === "track"
              ? t("library.confirmDeleteTrack", "Delete track?")
              : deleteTarget.type === "playlist_item"
              ? t("library.confirmDeletePlaylistItemTitle", "Remove from playlist?")
              : t("library.confirmDeleteSlice", "Delete slice?")
          }
          description={
            deleteTarget.type === "track"
              ? t("library.confirmDeleteTrackDetail", {
                  title: deleteTarget.title,
                  defaultValue: `Delete "${deleteTarget.title}" and all its associated slices from your local library?`,
                })
              : deleteTarget.type === "playlist_item"
              ? t("library.confirmDeletePlaylistItem", {
                  name: deleteTarget.title,
                  defaultValue: `Remove "${deleteTarget.title}" from playlist?`,
                })
              : t("library.confirmDeleteSliceDetail", {
                  title: deleteTarget.title,
                  defaultValue: `Delete slice "${deleteTarget.title}"?`,
                })
          }
          confirmText={t("common.delete", "Delete")}
          cancelText={t("common.cancel", "Cancel")}
          variant="destructive"
        />
      )}

      {/* Create Playlist Modal */}
      {isCreateModalOpen && (
        <React.Suspense fallback={null}>
          <CreatePlaylistModal
            isOpen={isCreateModalOpen}
            onClose={() => setIsCreateModalOpen(false)}
            onCreated={(id) => {
              setActivePlaylist(id);
            }}
          />
        </React.Suspense>
      )}

      {/* Mix Playlist Modal (create, or edit an open mix's sources) */}
      {mixModal && (
        <React.Suspense fallback={null}>
          <MixPlaylistModal
            isOpen
            mix={mixModal.mix}
            onClose={() => setMixModal(null)}
            onCreated={(id) => setActivePlaylist(id)}
          />
        </React.Suspense>
      )}

      {/* Queue sheet for screens too narrow to dock it */}
      {!isQueueDocked && <QueueDrawer isOpen={isQueueOpen} onClose={closeQueue} />}

      {/* Activity & Error Log Drawer (Slide-over) */}
      {hasOpenedLogDrawer && (
        <React.Suspense fallback={null}>
          <LogDrawer isOpen={isLogDrawerOpen} onClose={closeLogDrawer} />
        </React.Suspense>
      )}

      {/* Keyboard Shortcuts Cheatsheet Modal */}
      {isShortcutsOpen && (
        <React.Suspense fallback={null}>
          <ShortcutsModal
            isOpen={isShortcutsOpen}
            onClose={() => setIsShortcutsOpen(false)}
          />
        </React.Suspense>
      )}

      {/* Quick Scroll Navigation Widget (Floating Controls) */}
      {/* Clear the docked queue panel (w-80) plus the usual right-8 gap */}
      <FloatingScrollControls className={isQueueDocked && isQueueOpen ? "md:right-88" : undefined} />
    </AppShell>
  );
}
