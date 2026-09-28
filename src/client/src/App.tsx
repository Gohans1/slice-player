import * as React from "react";
import { useTranslation } from "react-i18next";
import { usePlayerStore, createQueueItem, type QueueItem } from "./store/usePlayerStore";
import { Navbar } from "./components/Navbar";
import { TrackCard } from "./components/TrackCard";
const SliceStudio = React.lazy(() => import("./components/SliceStudio").then((m) => ({ default: m.SliceStudio })));
import { PlayerBar } from "./components/PlayerBar";
import { QueueDrawer } from "./components/QueueDrawer";
const LogDrawer = React.lazy(() => import("./components/LogDrawer").then((m) => ({ default: m.LogDrawer })));
import { PlaylistDrawer } from "./components/PlaylistDrawer";
const CreatePlaylistModal = React.lazy(() => import("./components/CreatePlaylistModal").then((m) => ({ default: m.CreatePlaylistModal })));
const MixPlaylistModal = React.lazy(() => import("./components/MixPlaylistModal").then((m) => ({ default: m.MixPlaylistModal })));
const ShortcutsModal = React.lazy(() => import("./components/ShortcutsModal").then((m) => ({ default: m.ShortcutsModal })));
import { PlaylistTableView } from "./components/PlaylistTableView";
import { PlaylistGrid } from "./components/PlaylistGrid";
import { PlaylistHeader } from "./components/PlaylistHeader";
import { PlaylistItemCard } from "./components/PlaylistItemCard";
import { SliceCard } from "./components/SliceCard";
import { VirtualizedCardGrid } from "./components/VirtualizedCardGrid";
import { Music, Loader2, LayoutGrid, List, ListMusic, Plus, Scissors, Disc, Shuffle, AlertCircle, Check, Folder, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { audioEngine } from "./lib/audio";
import { filterTracks, searchItems } from "./lib/search";
import { showsItemsOf } from "./lib/mixPlaylist";
import { compareDownloadingTracks, cn, createDefaultFullSegment } from "./lib/utils";
import {
  findActivePlaylistItemIndex,
  findActiveMixedItemIndex,
  findActiveSliceItemIndex,
  findActiveTrackIndex,
} from "./lib/activeItemIndex";
import { PlaylistSortSelector } from "./components/PlaylistSortSelector";
import {
  getSortedPlaylistItems,
  getSortedMixedItems,
  getSortedSliceItems,
  getSortedTracks,
  type MixedItem,
} from "./lib/playlistSort";
import { Button } from "./components/ui/button";
import { BulkActionBar } from "./components/BulkActionBar";
import { FloatingScrollControls } from "./components/FloatingScrollControls";
import { ConfirmModal } from "./components/ui/ConfirmModal";
import { useSelectionStore, type SelectedItem } from "./store/useSelectionStore";
import { useLogStore } from "./store/useLogStore";
import { getViewScrollKey } from "./store/usePlayerStore";
import type { Playlist, Segment, Track } from "@/server/types";

const getItemEntityId = (item: { id: string }) => item.id;

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
  const setActiveSystemCategory = usePlayerStore((s) => s.setActiveSystemCategory);
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

  // Built-in tabs fold state (persisted to localStorage)
  const [isBuiltInFolded, setIsBuiltInFolded] = React.useState<boolean>(() => {
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        const saved = window.localStorage.getItem("slice_player_builtin_folded");
        return saved !== null ? JSON.parse(saved) : false;
      }
    } catch {}
    return false;
  });

  const handleToggleBuiltInFold = React.useCallback(() => {
    const next = !isBuiltInFolded;
    setIsBuiltInFolded(next);
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.setItem("slice_player_builtin_folded", JSON.stringify(next));
      }
    } catch {}
    if (next && activePlaylistId === null && activeSystemCategory !== "mixed" && activeSystemCategory !== "playlists") {
      setActiveSystemCategory("mixed");
    }
  }, [isBuiltInFolded, activePlaylistId, activeSystemCategory, setActiveSystemCategory]);

  // Auto-unfold if a non-mixed built-in category is explicitly navigated to
  React.useEffect(() => {
    if (activePlaylistId === null && activeSystemCategory !== "mixed" && activeSystemCategory !== "playlists" && isBuiltInFolded) {
      setIsBuiltInFolded(false);
      try {
        if (typeof window !== "undefined" && window.localStorage) {
          window.localStorage.setItem("slice_player_builtin_folded", "false");
        }
      } catch {}
    }
  }, [activePlaylistId, activeSystemCategory, isBuiltInFolded]);

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
  const [isQueueOpen, setIsQueueOpen] = React.useState(false);
  const [isShortcutsOpen, setIsShortcutsOpen] = React.useState(false);
  const [isPlaylistDrawerOpen, setIsPlaylistDrawerOpen] = React.useState(false);
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

  // Mutual exclusion: ensure only one major drawer is open at a time
  React.useEffect(() => {
    if (isLogDrawerOpen) {
      setIsQueueOpen(false);
      setIsPlaylistDrawerOpen(false);
    }
  }, [isLogDrawerOpen]);

  const prevQueueRef = React.useRef(isQueueOpen);
  const prevPlaylistRef = React.useRef(isPlaylistDrawerOpen);
  React.useEffect(() => {
    const queueJustOpened = !prevQueueRef.current && isQueueOpen;
    const playlistJustOpened = !prevPlaylistRef.current && isPlaylistDrawerOpen;
    prevQueueRef.current = isQueueOpen;
    prevPlaylistRef.current = isPlaylistDrawerOpen;

    if ((queueJustOpened || playlistJustOpened) && isLogDrawerOpen) {
      closeLogDrawer();
    }
  }, [isQueueOpen, isPlaylistDrawerOpen, isLogDrawerOpen, closeLogDrawer]);

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
              const shouldReconcileSegments = data.type !== "track_updated" || data.reason !== "volume";
              clearTimeout(wsDebounceTimer);
              wsDebounceTimer = setTimeout(() => {
                fetchTracks(shouldReconcileSegments);
                fetchSegments();
                fetchPlaylists();
                const activePl = usePlayerStore.getState().activePlaylistId;
                if (activePl) {
                  setActivePlaylist(activePl, true);
                }
              }, 250);
            }
            if (data.type === "library_restored") {
              clearTimeout(wsDebounceTimer);
              wsDebounceTimer = setTimeout(() => {
                fetchTracks(true);
                fetchSegments();
                fetchPlaylists();
                const activePl = usePlayerStore.getState().activePlaylistId;
                if (activePl) {
                  setActivePlaylist(activePl, true);
                }
              }, 100);
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
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const otherModalOpen = Boolean(
        usePlayerStore.getState().sliceStudioTrack ||
        document.querySelector('[role="dialog"]:not([data-drawer="log-drawer"])')
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
        setIsQueueOpen((prev) => !prev);
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
  }, []);

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
        if (usePlayerStore.getState().activeTrack?.id === deleteTarget.id) {
          audioEngine.unload();
        }
        removeTrackFromQueue(deleteTarget.id);
        const res = await fetch(`/api/tracks/${encodeURIComponent(deleteTarget.id)}`, { method: "DELETE" });
        if (res.ok) {
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

  const sliceQueue = React.useMemo<QueueItem[]>(() => {
    return filteredSliceItems
      .filter((it) => it.track.status === "ready" && (it.track.duration ?? 0) > 0)
      .map((it) => createQueueItem(it.segment, it.track, it.id));
  }, [filteredSliceItems]);

  const mixedQueue = React.useMemo<QueueItem[]>(() => {
    return filteredMixedItems
      .filter((it) => it.track.status === "ready" && (it.track.duration ?? 0) > 0)
      .map((it) =>
        it.type === "slice" && it.segment
          ? createQueueItem(it.segment, it.track, it.id)
          : createQueueItem(createDefaultFullSegment(it.track), it.track, it.id)
      );
  }, [filteredMixedItems]);

  const originalQueue = React.useMemo<QueueItem[]>(() => {
    return filteredTracks
      .filter((t) => t.status === "ready" && (t.duration ?? 0) > 0)
      .map((t) => createQueueItem(createDefaultFullSegment(t), t, t.id));
  }, [filteredTracks]);

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

  const handleTablistKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Home" && e.key !== "End") {
      return;
    }
    const tabs = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    if (tabs.length === 0) return;
    const currentIndex = tabs.findIndex((tab) => tab === document.activeElement);
    if (currentIndex === -1) return;

    e.preventDefault();
    let nextIndex = currentIndex;
    if (e.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % tabs.length;
    } else if (e.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    } else if (e.key === "Home") {
      nextIndex = 0;
    } else if (e.key === "End") {
      nextIndex = tabs.length - 1;
    }

    const nextTab = tabs[nextIndex];
    if (nextTab) {
      nextTab.focus();
      nextTab.click();
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground pb-24">
      <Navbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onTogglePlaylistDrawer={() => setIsPlaylistDrawerOpen((prev) => !prev)}
        onOpenShortcuts={() => setIsShortcutsOpen(true)}
      />

      <main className="flex-1 w-full pb-28 sm:pb-32">
        {/* Sticky Library Header & Navigation Bar (Always follows scroll, pushed up & compact) */}
        <div data-testid="sticky-library-header" className="sticky top-[var(--navbar-height,61px)] z-30 w-full bg-background/95 backdrop-blur-md border-b border-border/80 shadow-xs">
          <div className="w-full px-4 sm:px-6 lg:px-8 py-2">
            {/* Top Row: Compact Title & View Mode Switcher */}
            <div className="flex items-center justify-between gap-3 mb-1.5">
              <div className="flex items-center gap-2.5 min-w-0">
                <h1 className="text-base sm:text-lg font-bold tracking-tight text-foreground flex items-center gap-2 min-w-0">
                  <span className="truncate">{headerMeta.title}</span>
                  <span className="sr-only sm:not-sr-only text-xs font-normal text-muted-foreground font-mono shrink-0" aria-live="polite" aria-atomic="true">
                    {headerMeta.count}
                  </span>
                </h1>
                {headerMeta.description && (
                  <span className="text-xs text-muted-foreground truncate hidden md:inline border-l border-border/60 pl-2.5">
                    {headerMeta.description}
                  </span>
                )}
              </div>

              {/* View Mode Switcher & Playlist Sort Selector */}
              <div className="flex items-center gap-2 shrink-0">
                {(activePlaylistId || activeSystemCategory === "mixed" || activeSystemCategory === "slices_only" || activeSystemCategory === "original_only") && (
                  <PlaylistSortSelector builtInItemIds={builtInItemIds} />
                )}
                <span className="text-xs text-muted-foreground font-medium hidden sm:inline">{t("library.viewMode")}</span>
                <div role="group" aria-label={t("library.viewMode")} className="inline-flex rounded-lg border border-border bg-card/60 p-0.5">
                  <button
                    type="button"
                    aria-pressed={viewMode === "grid"}
                    onClick={() => setViewMode("grid")}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md transition-all active:scale-95 motion-reduce:transform-none duration-100 cursor-pointer ${
                      viewMode === "grid"
                        ? "bg-secondary text-primary shadow-xs font-bold"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                    title={t("library.gridTooltip")}
                  >
                    <LayoutGrid className="h-3.5 w-3.5" />
                    <span>{t("library.grid")}</span>
                  </button>
                  <button
                    type="button"
                    aria-pressed={viewMode === "list"}
                    onClick={() => setViewMode("list")}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md transition-all active:scale-95 motion-reduce:transform-none duration-100 cursor-pointer ${
                      viewMode === "list"
                        ? "bg-secondary text-primary shadow-xs font-bold"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                    title={t("library.tableTooltip")}
                  >
                    <List className="h-3.5 w-3.5" />
                    <span>{t("library.table")}</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Bottom Row: Horizontal Pill Tabs Bar */}
            <div className="flex items-center justify-between gap-2 pt-0.5">
          <div className="flex items-center gap-2 overflow-x-auto scrollbar-none min-w-0 pr-2">
            <div
              role="tablist"
              aria-label={t("library.tabsAria", "Library categories and playlists")}
              onKeyDown={handleTablistKeyDown}
              className="flex items-center gap-2 min-w-0 shrink-0"
            >
              {/* Playlists: library of custom playlists as cover cards */}
              <button
                type="button"
                role="tab"
                id="tab-category-playlists"
                aria-controls="main-library-panel"
                aria-selected={activePlaylistId === null && activeSystemCategory === "playlists"}
                tabIndex={activePlaylistId === null && activeSystemCategory === "playlists" ? 0 : -1}
                onClick={() => setActiveSystemCategory("playlists")}
                className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs transition-all active:scale-95 motion-reduce:transform-none duration-100 cursor-pointer shrink-0 ${
                  activePlaylistId === null && activeSystemCategory === "playlists"
                    ? "bg-primary text-primary-foreground font-bold shadow-xs"
                    : "bg-primary/10 text-primary font-semibold hover:bg-primary/20 border border-primary/40"
                }`}
              >
                <ListMusic className="h-3.5 w-3.5" />
                <span>{t("categories.playlists")}</span>
                <span className="font-mono text-2xs opacity-80">({playlists.length})</span>
              </button>

              <div role="presentation" aria-hidden="true" className="h-4 w-px bg-border/80 mx-0.5 shrink-0 self-center" />

              {/* System category: Mix (Always visible, primary anchor) */}
              <button
                type="button"
                role="tab"
                id="tab-category-mixed"
                aria-controls="main-library-panel"
                aria-selected={activePlaylistId === null && activeSystemCategory === "mixed"}
                tabIndex={activePlaylistId === null && activeSystemCategory === "mixed" ? 0 : -1}
                onClick={() => setActiveSystemCategory("mixed")}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs transition-all active:scale-95 motion-reduce:transform-none duration-100 cursor-pointer shrink-0 ${
                  activePlaylistId === null && activeSystemCategory === "mixed"
                    ? "bg-primary text-primary-foreground font-bold shadow-xs"
                    : "bg-secondary/70 text-foreground/90 font-medium hover:bg-secondary hover:text-foreground border border-border/70"
                }`}
              >
                <Shuffle className="h-3 w-3" />
                <span className="font-semibold">{t("categories.mixed")}</span>
                <span className="font-mono text-2xs opacity-80">({allMixedItems.length})</span>
              </button>

              {/* Folded toggle button right next to Mix when folded */}
              {isBuiltInFolded && (
                <button
                  type="button"
                  onClick={handleToggleBuiltInFold}
                  aria-label={t("library.unfoldBuiltIn")}
                  title={t("library.unfoldBuiltIn")}
                  className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full text-xs font-medium bg-secondary/50 hover:bg-secondary text-muted-foreground hover:text-foreground border border-border/50 hover:border-border transition-all active:scale-95 motion-reduce:transform-none duration-100 cursor-pointer shrink-0"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                  <span className="font-mono text-2xs opacity-80">4</span>
                  {errorTracks.length > 0 ? (
                    <span className="relative flex h-2 w-2 ml-0.5" title={t("categories.errors")}>
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-destructive"></span>
                    </span>
                  ) : downloadingTracks.length > 0 ? (
                    <Loader2 className="h-2.5 w-2.5 animate-spin text-primary ml-0.5" />
                  ) : null}
                </button>
              )}

              {/* Collapsible System category pills */}
              {!isBuiltInFolded && (
                <div className="flex items-center gap-2 shrink-0 animate-in fade-in zoom-in-95 duration-150 motion-reduce:animate-none">
                  <button
                    type="button"
                    role="tab"
                    id="tab-category-slices_only"
                    aria-controls="main-library-panel"
                    aria-selected={activePlaylistId === null && activeSystemCategory === "slices_only"}
                    tabIndex={activePlaylistId === null && activeSystemCategory === "slices_only" ? 0 : -1}
                    onClick={() => setActiveSystemCategory("slices_only")}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all active:scale-95 motion-reduce:transform-none duration-100 cursor-pointer shrink-0 ${
                      activePlaylistId === null && activeSystemCategory === "slices_only"
                        ? "bg-primary text-primary-foreground font-bold shadow-xs"
                        : "bg-secondary/60 text-muted-foreground hover:bg-secondary hover:text-foreground border border-border/50"
                    }`}
                  >
                    <Scissors className="h-3 w-3" />
                    <span>{t("categories.slices")}</span>
                    <span className="font-mono text-2xs opacity-80">({allSliceItems.length})</span>
                  </button>

                  <button
                    type="button"
                    role="tab"
                    id="tab-category-original_only"
                    aria-controls="main-library-panel"
                    aria-selected={activePlaylistId === null && activeSystemCategory === "original_only"}
                    tabIndex={activePlaylistId === null && activeSystemCategory === "original_only" ? 0 : -1}
                    onClick={() => setActiveSystemCategory("original_only")}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all active:scale-95 motion-reduce:transform-none duration-100 cursor-pointer shrink-0 ${
                      activePlaylistId === null && activeSystemCategory === "original_only"
                        ? "bg-primary text-primary-foreground font-bold shadow-xs"
                        : "bg-secondary/60 text-muted-foreground hover:bg-secondary hover:text-foreground border border-border/50"
                    }`}
                  >
                    <Disc className="h-3 w-3" />
                    <span>{t("categories.tracks")}</span>
                    <span className="font-mono text-2xs opacity-80">({originalTracks.length})</span>
                  </button>

                  <button
                    type="button"
                    role="tab"
                    id="tab-category-downloading_only"
                    aria-controls="main-library-panel"
                    aria-selected={activePlaylistId === null && activeSystemCategory === "downloading_only"}
                    tabIndex={activePlaylistId === null && activeSystemCategory === "downloading_only" ? 0 : -1}
                    onClick={() => setActiveSystemCategory("downloading_only")}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all active:scale-95 motion-reduce:transform-none duration-100 cursor-pointer shrink-0 ${
                      activePlaylistId === null && activeSystemCategory === "downloading_only"
                        ? "bg-primary text-primary-foreground font-bold shadow-xs"
                        : "bg-secondary/60 text-muted-foreground hover:bg-secondary hover:text-foreground border border-border/50"
                    }`}
                  >
                    <Loader2 className={`h-3 w-3 ${downloadingTracks.length > 0 ? "animate-spin" : ""}`} />
                    <span>{t("categories.downloading")}</span>
                    <span className="font-mono text-2xs opacity-80">({downloadingTracks.length})</span>
                  </button>

                  <button
                    type="button"
                    role="tab"
                    id="tab-category-error_only"
                    aria-controls="main-library-panel"
                    aria-selected={activePlaylistId === null && activeSystemCategory === "error_only"}
                    tabIndex={activePlaylistId === null && activeSystemCategory === "error_only" ? 0 : -1}
                    onClick={() => setActiveSystemCategory("error_only")}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all active:scale-95 motion-reduce:transform-none duration-100 cursor-pointer shrink-0 ${
                      activePlaylistId === null && activeSystemCategory === "error_only"
                        ? "bg-primary text-primary-foreground font-bold shadow-xs"
                        : "bg-secondary/60 text-muted-foreground hover:bg-secondary hover:text-foreground border border-border/50"
                    }`}
                  >
                    <AlertCircle className={`h-3 w-3 ${errorTracks.length > 0 && activeSystemCategory !== "error_only" ? "text-destructive" : ""}`} />
                    <span>{t("categories.errors")}</span>
                    <span className="font-mono text-2xs opacity-80">({errorTracks.length})</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleToggleBuiltInFold}
                    aria-label={t("library.foldBuiltIn")}
                    title={t("library.foldBuiltIn")}
                    className="inline-flex items-center justify-center h-7 w-7 rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary/80 border border-border/40 hover:border-border/80 transition-all active:scale-95 motion-reduce:transform-none duration-100 cursor-pointer shrink-0"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}

              {/* Open playlist pill (the Playlists tab is the way in; this shows where you are) */}
              {activePl && (
                <>
                  <div role="presentation" aria-hidden="true" className="h-4 w-px bg-border/80 mx-1 shrink-0 self-center" />
                  <button
                    type="button"
                    role="tab"
                    id={`tab-playlist-${activePl.id}`}
                    aria-controls="main-library-panel"
                    aria-selected={true}
                    tabIndex={0}
                    onClick={() => setActivePlaylist(activePl.id)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all active:scale-95 motion-reduce:transform-none duration-100 cursor-pointer shrink-0 bg-primary text-primary-foreground shadow-xs"
                  >
                    <Folder className="h-3 w-3 shrink-0 text-primary-foreground" />
                    <span>{activePl.name}</span>
                    <span className="font-mono text-2xs opacity-80">({activePl.item_count || 0})</span>
                  </button>
                </>
              )}
            </div>

            <div role="presentation" className="h-4 w-px bg-border/80 mx-1 shrink-0" />

            <button
              type="button"
              onClick={() => setIsCreateModalOpen(true)}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium text-primary border border-dashed border-primary/40 hover:bg-primary/10 transition-colors cursor-pointer shrink-0"
            >
              <Plus className="h-3 w-3" />
              <span>{t("library.newPlaylist")}</span>
            </button>
          </div>

            </div>
          </div>
        </div>

        {/* Content Area */}
        <div className="w-full px-4 sm:px-6 lg:px-8 pt-4 sm:pt-6">
          <div
            id="main-library-panel"
            role="tabpanel"
            key={`${activePlaylistId || activeSystemCategory || "mixed"}_${viewMode}`}
            aria-labelledby={activePlaylistId ? `tab-playlist-${activePlaylistId}` : `tab-category-${activeSystemCategory || "mixed"}`}
            className="animate-in fade-in duration-150 ease-out motion-reduce:animate-none"
          >
        {isLoadingTracks && isLibraryEmpty ? (
          <div className="flex flex-col items-center justify-center py-6 px-4 animate-in fade-in duration-200">
            <div className="w-full grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 min-[2048px]:grid-cols-7 min-[2560px]:grid-cols-8 gap-4 mb-6">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="rounded-xl border border-border/50 bg-card/40 p-3 space-y-3 animate-pulse">
                  <div className="aspect-video w-full rounded-lg bg-secondary/60" />
                  <div className="h-4 w-3/4 rounded bg-secondary/60" />
                  <div className="h-3 w-1/2 rounded bg-secondary/40" />
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <p className="text-sm">{t("library.loading")}</p>
            </div>
          </div>
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
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border p-12 text-center bg-card/40 animate-in fade-in zoom-in-95 duration-200">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary mb-4 border border-primary/20">
                <Music className="h-7 w-7" />
              </div>
              <h2 className="text-lg font-semibold text-foreground">
                {t("library.emptyPlaylistTitle")}
              </h2>
              <p className="text-xs text-muted-foreground mt-1 max-w-md">
                {t("library.emptyPlaylistDesc", { name: activePl?.name })}
              </p>
            </div>
          ) : displayedPlaylistItems.length === 0 && isSearching ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border p-12 text-center bg-card/40 animate-in fade-in zoom-in-95 duration-200">
              <h2 className="text-lg font-semibold text-foreground">{t("library.noResultsTitle")}</h2>
              <p className="text-xs text-muted-foreground mt-1">{t("library.noResultsDesc")}</p>
              <Button variant="outline" size="sm" onClick={() => setSearchQuery("")} className="mt-4 text-xs">
                {t("library.clearSearch")}
              </Button>
            </div>
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
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border p-12 text-center bg-card/40 animate-in fade-in zoom-in-95 duration-200">
              <h2 className="text-lg font-semibold text-foreground">{t("library.noResultsTitle")}</h2>
              <p className="text-xs text-muted-foreground mt-1">{t("library.noResultsDesc")}</p>
              <Button variant="outline" size="sm" onClick={() => setSearchQuery("")} className="mt-4 text-xs">
                {t("library.clearSearch")}
              </Button>
            </div>
          ) : (
            <PlaylistGrid
              playlists={displayedPlaylists}
              onOpen={(id) => setActivePlaylist(id)}
              onCreate={() => setIsCreateModalOpen(true)}
              onMix={() => setMixModal({})}
            />
          )
        ) : activeSystemCategory === "slices_only" ? (
          /* Slices Only Category */
          allSliceItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border p-12 text-center bg-card/40 animate-in fade-in zoom-in-95 duration-200">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary mb-4 border border-primary/20">
                <Scissors className="h-7 w-7" />
              </div>
              <h2 className="text-lg font-semibold text-foreground">
                {t("library.noSlicesTitle")}
              </h2>
              <p className="text-xs text-muted-foreground mt-1 max-w-md">
                {t("library.noSlicesDesc")}
              </p>
            </div>
          ) : filteredSliceItems.length === 0 && isSearching ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border p-12 text-center bg-card/40 animate-in fade-in zoom-in-95 duration-200">
              <h2 className="text-lg font-semibold text-foreground">{t("library.noSlicesSearchTitle")}</h2>
              <p className="text-xs text-muted-foreground mt-1">{t("library.noSlicesSearchDesc")}</p>
              <Button variant="outline" size="sm" onClick={() => setSearchQuery("")} className="mt-4 text-xs">
                {t("library.clearSearch")}
              </Button>
            </div>
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
              renderItem={(item, idx) => {
                const qIdx = sliceQueue.findIndex((q) => q.segment.id === item.segment.id);
                return (
                  <SliceCard
                    key={item.id}
                    index={idx}
                    segment={item.segment}
                    track={item.track}
                    onPlay={() =>
                      playSegmentInMode(
                        "slices_only",
                        item.segment,
                        item.track,
                        sliceQueue,
                        qIdx >= 0 ? qIdx : undefined,
                        deferredQuery.trim()
                          ? { type: "search", query: deferredQuery.trim(), count: sliceQueue.length, mode: "slices_only" }
                          : { type: "system", mode: "slices_only" }
                      )
                    }
                    onOpenStudio={() => openSliceStudio(item.track)}
                    onDelete={handleDeleteSlice}
                  />
                );
              }}
            />
          )
        ) : activeSystemCategory === "mixed" ? (
          /* Mixed Category (Trộn Cả 2) */
          isLibraryEmpty || allMixedItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border p-12 text-center bg-card/40 animate-in fade-in zoom-in-95 duration-200">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary mb-4 border border-primary/20">
                <Music className="h-7 w-7" />
              </div>
              <h2 className="text-lg font-semibold text-foreground">
                {t("library.emptyLibraryTitle")}
              </h2>
              <p className="text-xs text-muted-foreground mt-1 max-w-md">
                {t("library.emptyLibraryDesc")}
              </p>
            </div>
          ) : filteredMixedItems.length === 0 && isSearching ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border p-12 text-center bg-card/40 animate-in fade-in zoom-in-95 duration-200">
              <h2 className="text-lg font-semibold text-foreground">{t("library.noResultsTitle")}</h2>
              <p className="text-xs text-muted-foreground mt-1">{t("library.noResultsDesc")}</p>
              <Button variant="outline" size="sm" onClick={() => setSearchQuery("")} className="mt-4 text-xs">
                {t("library.clearSearch")}
              </Button>
            </div>
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
              renderItem={(item, idx) => {
                if (item.type === "slice") {
                  const qIdx = mixedQueue.findIndex((q) => q.segment.id === item.segment.id);
                  return (
                    <SliceCard
                      key={item.id}
                      index={idx}
                      badgeLabel={t("table.slices")}
                      segment={item.segment}
                      track={item.track}
                      visibleItemIds={visibleItems}
                      onPlay={() =>
                        playSegmentInMode(
                          "mixed",
                          item.segment,
                          item.track,
                          mixedQueue,
                          qIdx >= 0 ? qIdx : undefined,
                          deferredQuery.trim()
                            ? { type: "search", query: deferredQuery.trim(), count: mixedQueue.length, mode: "mixed" }
                            : { type: "system", mode: "mixed" }
                        )
                      }
                      onOpenStudio={() => openSliceStudio(item.track)}
                      onDelete={handleDeleteSlice}
                    />
                  );
                }
                const qIdx = mixedQueue.findIndex(
                  (q) => q.track.id === item.track.id && q.segment.id.startsWith("fallback_")
                );
                return (
                  <TrackCard
                    key={item.id}
                    track={item.track}
                    onDelete={handleDeleteTrack}
                    visibleTrackIds={visibleItems}
                    onPlay={() =>
                      playSegmentInMode(
                        "mixed",
                        createDefaultFullSegment(item.track),
                        item.track,
                        mixedQueue,
                        qIdx >= 0 ? qIdx : undefined,
                        deferredQuery.trim()
                          ? { type: "search", query: deferredQuery.trim(), count: mixedQueue.length, mode: "mixed" }
                          : { type: "system", mode: "mixed" }
                      )
                    }
                  />
                );
              }}
            />
          )
        ) : activeSystemCategory === "downloading_only" ? (
          /* Downloading Only Category (Đang Tải) */
          downloadingTracks.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border p-12 text-center bg-card/40 animate-in fade-in zoom-in-95 duration-200">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary mb-4 border border-primary/20">
                <Check className="h-7 w-7 text-flexoki-green" />
              </div>
              <h2 className="text-lg font-semibold text-foreground">
                {t("categories.noDownloadingTitle")}
              </h2>
              <p className="text-xs text-muted-foreground mt-1 max-w-md">
                {t("categories.noDownloadingDesc")}
              </p>
            </div>
          ) : filteredDownloadingTracks.length === 0 && isSearching ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border p-12 text-center bg-card/40 animate-in fade-in zoom-in-95 duration-150 ease-out motion-reduce:animate-none">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary mb-4 border border-primary/20">
                <Loader2 className="h-7 w-7 text-muted-foreground" />
              </div>
              <h2 className="text-lg font-semibold text-foreground">{t("library.noResultsTitle")}</h2>
              <p className="text-xs text-muted-foreground mt-1">{t("library.noResultsDesc")}</p>
              <Button variant="outline" size="sm" onClick={() => setSearchQuery("")} className="mt-4 text-xs">
                {t("library.clearSearch")}
              </Button>
            </div>
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
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border p-12 text-center bg-card/40 animate-in fade-in zoom-in-95 duration-150 ease-out motion-reduce:animate-none">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary mb-4 border border-primary/20">
                <Check className="h-7 w-7 text-flexoki-green" />
              </div>
              <h2 className="text-lg font-semibold text-foreground">
                {t("categories.noErrorsTitle")}
              </h2>
              <p className="text-xs text-muted-foreground mt-1 max-w-md">
                {t("categories.noErrorsDesc")}
              </p>
            </div>
          ) : filteredErrorTracks.length === 0 && isSearching ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border p-12 text-center bg-card/40 animate-in fade-in zoom-in-95 duration-150 ease-out motion-reduce:animate-none">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary mb-4 border border-primary/20">
                <AlertCircle className="h-7 w-7 text-muted-foreground" />
              </div>
              <h2 className="text-lg font-semibold text-foreground">{t("library.noResultsTitle")}</h2>
              <p className="text-xs text-muted-foreground mt-1">{t("library.noResultsDesc")}</p>
              <Button variant="outline" size="sm" onClick={() => setSearchQuery("")} className="mt-4 text-xs">
                {t("library.clearSearch")}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl bg-destructive/10 border border-destructive/25 text-foreground">
                <div className="flex items-center gap-2.5">
                  <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
                  <span className="text-xs sm:text-sm font-medium">
                    {t("categories.errorsDesc")}
                  </span>
                  <span className="text-xs text-muted-foreground font-mono">
                    ({errorTracks.length})
                  </span>
                </div>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={isRetryingAll}
                  onClick={() => retryAllErrors()}
                  className="gap-1.5 text-xs font-semibold shadow-xs"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${isRetryingAll ? "animate-spin" : ""}`} />
                  <span>{isRetryingAll ? t("categories.retryingAll") : t("categories.retryAll", { count: errorTracks.length })}</span>
                </Button>
              </div>

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
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border p-12 text-center bg-card/40 animate-in fade-in zoom-in-95 duration-150 ease-out motion-reduce:animate-none">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary mb-4 border border-primary/20">
              <Music className="h-7 w-7" />
            </div>
            <h2 className="text-lg font-semibold text-foreground">
              {t("library.emptyLibraryTitle")}
            </h2>
            <p className="text-xs text-muted-foreground mt-1 max-w-md">
              {t("library.emptyLibraryDesc")}
            </p>
          </div>
        ) : filteredTracks.length === 0 ? (
          /* No search results found */
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border p-12 text-center bg-card/40 animate-in fade-in zoom-in-95 duration-150 ease-out motion-reduce:animate-none">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary mb-4 border border-primary/20">
              <Music className="h-7 w-7" />
            </div>
            <h2 className="text-lg font-semibold text-foreground">
              {t("library.noResultsTitle")}
            </h2>
            <p className="text-xs text-muted-foreground mt-1 max-w-md">
              {t("library.noResultsDesc")}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSearchQuery("")}
              className="mt-4 text-xs"
            >
              {t("library.clearSearch")}
            </Button>
          </div>
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
            renderItem={(track) => {
              const qIdx = originalQueue.findIndex((q) => q.track.id === track.id && q.segment.id.startsWith("fallback_"));
              return (
                <TrackCard
                  key={track.id}
                  track={track}
                  onDelete={handleDeleteTrack}
                  visibleTrackIds={visibleItems}
                  onPlay={() =>
                    playSegmentInMode(
                      "original_only",
                      createDefaultFullSegment(track),
                      track,
                      originalQueue,
                      qIdx >= 0 ? qIdx : undefined,
                      deferredQuery.trim()
                        ? { type: "search", query: deferredQuery.trim(), count: originalQueue.length, mode: "original_only" }
                        : { type: "system", mode: "original_only" }
                    )
                  }
                />
              );
            }}
          />
        )}
          </div>
        </div>
      </main>

      {/* Bulk Action Floating Bar */}
      <BulkActionBar visibleTrackIds={visibleTrackIds} visibleItems={visibleItems} />

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

      {/* Playlist Drawer (Left) */}
      <PlaylistDrawer
        isOpen={isPlaylistDrawerOpen}
        onClose={() => setIsPlaylistDrawerOpen(false)}
        onOpenCreateModal={() => setIsCreateModalOpen(true)}
      />

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

      {/* Queue Drawer (Right) */}
      <QueueDrawer
        isOpen={isQueueOpen}
        onClose={() => setIsQueueOpen(false)}
      />

      {/* Activity & Error Log Drawer (Slide-over) */}
      {isLogDrawerOpen && (
        <React.Suspense fallback={null}>
          <LogDrawer
            isOpen={isLogDrawerOpen}
            onClose={closeLogDrawer}
          />
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
      <FloatingScrollControls />

      {/* Player Bar */}
      <PlayerBar
        onToggleQueue={() => setIsQueueOpen((prev) => !prev)}
        isQueueOpen={isQueueOpen}
      />
    </div>
  );
}
