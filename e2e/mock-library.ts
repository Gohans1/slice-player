import type { Page } from "@playwright/test";
import type { Playlist, Segment, Track } from "../src/server/types";

export interface Library {
  tracks?: Track[];
  segments?: Segment[];
  playlists?: Playlist[];
}

// Answers every /api request from memory and keeps the live-update WebSocket in the browser. Without this, Vite would
// proxy them to the API on port 3000, which may be serving a real library.
export async function mockLibrary(page: Page, library: Library) {
  const reads = new Map<string, unknown>([
    ["/api/tracks", library.tracks ?? []],
    ["/api/segments", library.segments ?? []],
    ["/api/playlists", library.playlists ?? []],
    ["/api/logs", []],
  ]);
  await page.route("**/api/**", (route) => {
    const request = route.request();
    const body = request.method() === "GET" ? reads.get(new URL(request.url()).pathname) : undefined;
    return body === undefined ? route.fulfill({ status: 404 }) : route.fulfill({ json: body });
  });
  await page.routeWebSocket("**/ws", () => {});
}

export function makeTracks(count: number): Track[] {
  return Array.from({ length: count }, (_, i) => {
    const n = String(i + 1).padStart(3, "0");
    return {
      id: `trk_${n}`,
      source_type: "local",
      source_uri: `track-${n}.mp3`,
      title: `Track ${n}`,
      artist: "E2E Artist",
      duration: 180 + i,
      status: "ready",
      volume: 0.5,
      created_at: 1_700_000_000_000 - i * 1000,
    };
  });
}
