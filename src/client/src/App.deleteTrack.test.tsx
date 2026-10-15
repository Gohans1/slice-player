import { afterEach, beforeEach, expect, it } from "bun:test";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { App } from "./App";
import { toast } from "./components/ui/toast";
import { usePlayerStore, resetEtagCache, createQueueItem } from "./store/usePlayerStore";
import { createDefaultFullSegment } from "./lib/utils";
import type { Track } from "@/server/types";

const originalFetch = globalThis.fetch;
const initialStore = usePlayerStore.getState();
const song: Track = { id: "trk-song", source_type: "local", source_uri: "song.opus", title: "Song", duration: 60, status: "ready", segment_count: 0, created_at: 1 };
let deleteStatus = 200;
let deleted = false;
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  deleteStatus = 200;
  deleted = false;
  resetEtagCache();
  globalThis.fetch = Object.assign(
    async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url === `/api/tracks/${song.id}` && init?.method === "DELETE") {
        deleted = deleteStatus === 200;
        return Response.json({}, { status: deleteStatus });
      }
      if (url === "/api/tracks") return Response.json(deleted ? [] : [song]);
      return Response.json([]);
    },
    { preconnect: originalFetch.preconnect }
  );
  const queued = createQueueItem(createDefaultFullSegment(song), song, song.id);
  usePlayerStore.setState({ ...initialStore, tracks: [], activePlaylistId: null, activeSystemCategory: "original_only", viewMode: "grid",
    queue: [queued], queueIndex: -1, activeTrack: null, activeSegment: null, isPlaying: false });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    toast.close();
    root.unmount();
  });
  container.remove();
  globalThis.fetch = originalFetch;
  usePlayerStore.setState(initialStore);
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 30));
const buttonNamed = (name: string) => Array.from(document.querySelectorAll<HTMLElement>("button, [role='menuitem']")).find((el) => el.textContent?.trim() === name);

// The track ids in the current queue and in the queue kept for each playback mode
function queues() {
  const { queue, queuesByMode } = usePlayerStore.getState();
  const ids = (items: typeof queue) => items.map((item) => item.track.id);
  return { current: ids(queue), ...Object.fromEntries(Object.entries(queuesByMode).map(([mode, items]) => [mode, ids(items)])) };
}

// Returns the queues as they stood just before the delete
async function deleteSongFromItsMenu() {
  await act(async () => {
    root.render(<App />);
    await tick();
  });
  const before = queues();
  await act(async () => {
    container.querySelector<HTMLElement>(`button[aria-label="More options for ${song.title}"]`)?.click();
    await tick();
  });
  await act(async () => {
    buttonNamed("Delete track")?.click();
    await tick();
  });
  await act(async () => {
    buttonNamed("Delete")?.click();
    await tick();
  });
  return before;
}
const shownToasts = () => Array.from(document.querySelectorAll<HTMLElement>('[data-slot="toast"]'));

it("removes a deleted track from every queue", async () => {
  const before = await deleteSongFromItsMenu();

  expect(before.current).toContain(song.id);
  expect(deleted).toBe(true);
  expect(Object.values(queues()).flat()).not.toContain(song.id);
  expect(shownToasts()).toHaveLength(0);
});

it("keeps a track queued and tells the user when the server won't delete it", async () => {
  deleteStatus = 500;

  const before = await deleteSongFromItsMenu();

  expect(queues()).toEqual(before);
  expect(shownToasts()).toHaveLength(1);
  expect(shownToasts()[0].textContent).toContain("Failed to delete track");
});
