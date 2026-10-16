import { afterEach, beforeEach, expect, it } from "bun:test";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { App } from "./App";
import { usePlayerStore, resetEtagCache } from "./store/usePlayerStore";
import type { Segment, Track } from "@/server/types";

class TestSocket {
  static OPEN = 1;
  static instances: TestSocket[] = [];
  readyState = 1;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  constructor() { TestSocket.instances.push(this); }
  send() {}
  close() {}
  emit(data: object) { this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(data) })); }
}
const originalSocket = globalThis.WebSocket;
const originalCustomEvent = globalThis.CustomEvent;
const originalFetch = globalThis.fetch;
const initialStore = usePlayerStore.getState();
const track: Track = { id: "ws-track", source_type: "local", source_uri: "track.opus", title: "Track", duration: 60, status: "ready", segment_count: 0 };
const slice: Segment = { id: "ws-slice", track_id: track.id, name: "New slice", start_time: 10, end_time: 20 };
let segments: Segment[] = [];
let homeRequests = 0;
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  segments = [];
  homeRequests = 0;
  TestSocket.instances = [];
  resetEtagCache();
  // Browser CustomEvent must belong to the happy-dom window, not Bun\'s native EventTarget realm.
  Object.assign(globalThis, { WebSocket: TestSocket, CustomEvent: window.CustomEvent });
  globalThis.fetch = Object.assign(async (input: Parameters<typeof fetch>[0]) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === "/api/tracks") return Response.json([{ ...track, segment_count: segments.length }]);
    if (url === "/api/segments") return Response.json(segments);
    if (url === "/api/home") homeRequests++;
    return Response.json([]);
  }, { preconnect: originalFetch.preconnect });
  usePlayerStore.setState({ ...initialStore, tracks: [], queue: [], queueIndex: -1,
    queuesByMode: { mixed: [], slices_only: [], original_only: [] },
    initializedModes: { mixed: false, slices_only: false, original_only: false },
    playbackMode: "mixed", activeTrack: null, activeSegment: null, activePlaylistId: null,
    activePlaylistPlayingId: null, activeSystemCategory: "original_only", viewMode: "list", isPlaying: false });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  Object.assign(globalThis, { WebSocket: originalSocket, fetch: originalFetch, CustomEvent: originalCustomEvent });
  usePlayerStore.setState(initialStore);
});

// Home stays where it was if open, so its shelves would go on showing the old history
it("brings Home's listening history up to date when a backup is restored", async () => {
  await act(async () => { root.render(<App />); });
  const before = homeRequests;

  await act(async () => { TestSocket.instances[0].emit({ type: "library_restored" }); });

  expect(homeRequests).toBe(before + 1);
});

for (const event of [{ type: "track_updated", trackId: track.id }, { type: "library_restored" }]) {
  it(`does not downgrade ${event.type} reconciliation when a volume event arrives last`, async () => {
    await act(async () => { root.render(<App />); });
    expect(usePlayerStore.getState().queuesByMode.mixed.some((item) => item.segment.id === "fallback_" + track.id)).toBe(true);
    segments = [slice];
    let unsubscribe = () => {};
    const refreshed = new Promise<void>((fulfill) => {
      unsubscribe = usePlayerStore.subscribe((state) => {
        if (state.tracks[0]?.segment_count === 1) fulfill();
      });
    });
    try {
      await act(async () => {
        const socket = TestSocket.instances[0];
        socket.emit(event);
        socket.emit({ type: "track_updated", trackId: track.id, reason: "volume" });
        await refreshed;
      });
      expect(usePlayerStore.getState().queuesByMode.mixed.some((item) => item.segment.id === slice.id)).toBe(true);
    } finally {
      unsubscribe();
    }
  });
}
