import { serverEvents } from "./events";

/** Keep the event-to-WebSocket boundary testable without starting the HTTP server. */
export function forwardServerEvents(broadcast: (message: object) => void): () => void {
  const subscriptions = [
    "track_updated", "track_created", "track_deleted", "tracks_deleted",
    "segment_deleted", "segment_updated", "segments_deleted",
    "playlist_created", "playlist_updated", "playlist_deleted", "playlist_items_changed",
    "app_log", "logs_cleared", "library_restored",
  ].map((type) => {
    const listener = (payload: Record<string, unknown> = {}) => broadcast({ type, ...payload });
    serverEvents.on(type, listener);
    return { type, listener };
  });
  return () => {
    for (const { type, listener } of subscriptions) serverEvents.off(type, listener);
  };
}
