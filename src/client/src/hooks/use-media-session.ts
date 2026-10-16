import * as React from "react";
import { usePlayerStore } from "../store/usePlayerStore";

// The OS media controls (the Windows media flyout, media keys) show the playing song and drive the player.
// Without handlers the browser would play/pause the audio element behind the store's back.
export function useMediaSession() {
  const activeTrack = usePlayerStore((s) => s.activeTrack);
  const activeSegment = usePlayerStore((s) => s.activeSegment);
  const isPlaying = usePlayerStore((s) => s.isPlaying);

  React.useEffect(() => {
    if (!("mediaSession" in navigator)) return undefined;
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ["play", () => void usePlayerStore.getState().resume()],
      ["pause", () => usePlayerStore.getState().pause()],
      ["previoustrack", () => usePlayerStore.getState().prevSegment()],
      ["nexttrack", () => usePlayerStore.getState().nextSegment()],
    ];
    for (const [action, handler] of handlers) navigator.mediaSession.setActionHandler(action, handler);
    return () => {
      for (const [action] of handlers) navigator.mediaSession.setActionHandler(action, null);
    };
  }, []);

  React.useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    if (!activeTrack) {
      navigator.mediaSession.metadata = null;
      return;
    }
    // Like the player bar: a slice names itself where a full track names its artist
    const isSlice = activeSegment !== null && !activeSegment.id.startsWith("fallback_");
    navigator.mediaSession.metadata = new MediaMetadata({
      title: activeTrack.title,
      artist: isSlice ? activeSegment.name : activeTrack.artist?.trim() || "",
      artwork: activeTrack.thumbnail_url ? [{ src: activeTrack.thumbnail_url }] : [],
    });
  }, [activeTrack, activeSegment]);

  React.useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.playbackState = !activeTrack ? "none" : isPlaying ? "playing" : "paused";
  }, [activeTrack, isPlaying]);
}
