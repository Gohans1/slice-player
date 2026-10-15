import { afterEach, beforeEach, expect, it } from "bun:test";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { App } from "./App";
import { usePlayerStore, resetEtagCache, type PlayerState } from "./store/usePlayerStore";
import type { Segment, Track } from "@/server/types";

const originalFetch = globalThis.fetch;
const initialStore = usePlayerStore.getState();
const first: Track = { id: "trk-first", source_type: "local", source_uri: "a.opus", title: "First", duration: 60, status: "ready", segment_count: 0, created_at: 2 };
const second: Track = { id: "trk-second", source_type: "local", source_uri: "b.opus", title: "Second", duration: 90, status: "ready", segment_count: 1, created_at: 1 };
const chorus: Segment = { id: "seg-chorus", track_id: second.id, name: "Chorus", start_time: 10, end_time: 20, created_at: 3 };
// Newest of all, shown as a downloading card, but it can't play yet so no queue may hold it
const pending: Track = { id: "trk-pending", source_type: "youtube", source_uri: "https://www.youtube.com/watch?v=p", title: "Pending", duration: 30, status: "downloading", segment_count: 0, created_at: 4 };
let plays: Parameters<PlayerState["playSegmentInMode"]>[] = [];
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  plays = [];
  resetEtagCache();
  globalThis.fetch = Object.assign(async (input: Parameters<typeof fetch>[0]) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === "/api/tracks") return Response.json([pending, first, second]);
    if (url === "/api/segments") return Response.json([chorus]);
    return Response.json([]);
  }, { preconnect: originalFetch.preconnect });
  usePlayerStore.setState({ ...initialStore, tracks: [], activePlaylistId: null, viewMode: "grid", isPlaying: false,
    activeTrack: null, activeSegment: null,
    playSegmentInMode: async (...args) => {
      plays.push(args);
    } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  globalThis.fetch = originalFetch;
  usePlayerStore.setState(initialStore);
});

async function renderAndPlay(title: string, search?: string) {
  await act(async () => {
    root.render(<App />);
  });
  if (search) {
    const field = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(field, search);
      field.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
  }
  const play = container.querySelector<HTMLButtonElement>(`button[title='${title}']`);
  expect(play).not.toBeNull();
  await act(async () => {
    play?.click();
  });
  expect(plays).toHaveLength(1);
  const [mode, segment, track, queue = [], index, origin] = plays[0];
  return { mode, segment, track, queue: queue.map((item) => item.segment.id), index, origin };
}

it("plays a track card from the Tracks grid within that view's queue", async () => {
  usePlayerStore.setState({ activeSystemCategory: "original_only" });
  const { mode, segment, track, queue, index, origin } = await renderAndPlay("Play Second");

  expect(mode).toBe("original_only");
  expect(track.id).toBe(second.id);
  expect(segment.id).toBe(`fallback_${second.id}`);
  expect(queue).toEqual([`fallback_${first.id}`, `fallback_${second.id}`]);
  expect(index).toBe(1);
  expect(origin).toEqual({ type: "system", mode: "original_only" });
});

it("plays a slice card from the Mix grid within that view's queue", async () => {
  usePlayerStore.setState({ activeSystemCategory: "mixed" });
  const { mode, segment, track, queue, index, origin } = await renderAndPlay('Play slice "Chorus"');

  expect(mode).toBe("mixed");
  expect(track.id).toBe(second.id);
  expect(segment.id).toBe(chorus.id);
  expect(queue).toEqual([chorus.id, `fallback_${first.id}`, `fallback_${second.id}`]);
  expect(index).toBe(0);
  expect(origin).toEqual({ type: "system", mode: "mixed" });
});

it("plays a slice card from the Slices grid within that view's queue", async () => {
  usePlayerStore.setState({ activeSystemCategory: "slices_only" });
  const { mode, segment, track, queue, index, origin } = await renderAndPlay('Play slice "Chorus"');

  expect(mode).toBe("slices_only");
  expect(track.id).toBe(second.id);
  expect(segment.id).toBe(chorus.id);
  expect(queue).toEqual([chorus.id]);
  expect(index).toBe(0);
  expect(origin).toEqual({ type: "system", mode: "slices_only" });
});

it("names the search as the queue's origin when playing a card from search results", async () => {
  usePlayerStore.setState({ activeSystemCategory: "mixed" });
  const { mode, track, queue, index, origin } = await renderAndPlay("Play First", "First");

  expect(mode).toBe("mixed");
  expect(track.id).toBe(first.id);
  expect(queue).toEqual([`fallback_${first.id}`]);
  expect(index).toBe(0);
  expect(origin).toEqual({ type: "search", query: "First", count: 1, mode: "mixed" });
});
