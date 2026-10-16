import * as React from "react";
import { useTranslation } from "react-i18next";
import { findActivePlaylistItemIndex } from "../lib/activeItemIndex";
import { usePlayerStore } from "../store/usePlayerStore";

// Where the queue plays from, a playlist, a library page or a song list on Home: going there shows the playing song
export function usePlaybackSource() {
  const { t } = useTranslation();
  const playbackMode = usePlayerStore((s) => s.playbackMode);
  const activePlaylistPlayingId = usePlayerStore((s) => s.activePlaylistPlayingId);
  const activePlaylistPlayingName = usePlayerStore((s) => {
    if (!s.activePlaylistPlayingId) return null;
    return s.playlists.find((p) => p.id === s.activePlaylistPlayingId)?.name ?? null;
  });
  const homeShelf = usePlayerStore((s) => (!s.activePlaylistPlayingId && s.queueOrigin?.type === "home" ? s.queueOrigin.shelf : undefined));
  const activePlaylistId = usePlayerStore((s) => s.activePlaylistId);
  const activePlaylistItems = usePlayerStore((s) => s.activePlaylistItems);
  const activeTrackId = usePlayerStore((s) => s.activeTrack?.id);
  const activeSegmentId = usePlayerStore((s) => s.activeSegment?.id);
  const setActivePlaylist = usePlayerStore((s) => s.setActivePlaylist);
  const setActiveSystemCategory = usePlayerStore((s) => s.setActiveSystemCategory);
  const requestScrollToActiveTrack = usePlayerStore((s) => s.requestScrollToActiveTrack);

  const name = React.useMemo(() => {
    if (activePlaylistPlayingId) {
      return activePlaylistPlayingName || t("playlist.customHeader", "Playlists");
    }
    if (homeShelf) return homeShelf === "recently_added" ? t("home.recentlyAdded") : t("home.heavyRotation");
    return playbackMode === "slices_only"
      ? t("categories.slices", "Slices")
      : playbackMode === "original_only"
      ? t("categories.tracks", "Tracks")
      : t("categories.mixed", "Mix");
  }, [activePlaylistPlayingId, activePlaylistPlayingName, homeShelf, playbackMode, t]);

  const goToSource = React.useCallback(async () => {
    // Home's song lists are only on Home
    if (homeShelf) {
      await setActivePlaylist(null);
      setActiveSystemCategory("home");
      return;
    }
    const targetKey = activePlaylistPlayingId
      ? `playlist:${activePlaylistPlayingId}`
      : `category:${playbackMode || "mixed"}`;

    if (activePlaylistPlayingId) {
      await setActivePlaylist(activePlaylistPlayingId);
    } else {
      await setActivePlaylist(null);
      if (playbackMode) {
        setActiveSystemCategory(playbackMode);
      }
    }
    requestScrollToActiveTrack(targetKey);
  }, [activePlaylistPlayingId, homeShelf, playbackMode, setActivePlaylist, setActiveSystemCategory, requestScrollToActiveTrack]);

  // Shows the playing song where it is listed: in the open playlist when it has the song, otherwise at its source
  const reveal = React.useCallback(async () => {
    if ((!activePlaylistPlayingId || activePlaylistPlayingId === activePlaylistId) && activePlaylistId && activePlaylistItems.length > 0) {
      const activeIdx = findActivePlaylistItemIndex(activePlaylistItems, {
        activeTrackId,
        activeSegmentId,
        isFallbackSegment: !activeSegmentId || activeSegmentId.startsWith("fallback_"),
      });
      if (activeIdx >= 0) {
        requestScrollToActiveTrack(`playlist:${activePlaylistId}`);
        return;
      }
    }
    await goToSource();
  }, [activePlaylistId, activePlaylistItems, activeTrackId, activeSegmentId, activePlaylistPlayingId, goToSource, requestScrollToActiveTrack]);

  // What kind of source it is, for its icon
  const kind = activePlaylistPlayingId ? "playlist" : homeShelf ? "home" : playbackMode;

  return { name, kind, goToSource, reveal };
}
