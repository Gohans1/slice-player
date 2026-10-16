import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { HomePage } from "./HomePage";
import { useHomeStore } from "../store/useHomeStore";
import { usePlayerStore } from "../store/usePlayerStore";
import i18n from "../i18n";
import type { HomeSummary, Playlist, Track } from "@/server/types";

const track = (id: string, created_at: number): Track => ({ id, title: `Song ${id}`, artist: "Band", duration: 200, source_type: "youtube", source_uri: id, status: "ready", created_at });
const tracks = [track("a", 1), track("b", 2)];
const road: Playlist & { item_count: number } = { id: "road", name: "Road", created_at: 1, updated_at: 1, item_count: 2 };
const history: HomeSummary = {
  recently_played: [
    { source_type: "original_only", playlist_id: null },
    { source_type: "playlist", playlist_id: "road" },
  ],
  heavy_rotation: [
    { track_id: "b", plays: 4 },
    { track_id: "a", plays: 1 },
  ],
  top_playlists: [{ playlist_id: "road", plays: 3 }],
};
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("HomePage", () => {
  let root: Root;
  let container: HTMLElement;
  let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;
  let respond: () => Promise<Response>;
  const original = usePlayerStore.getState();
  const onPlayPage = mock((_mode: string, _choice: string) => {});

  beforeEach(async () => {
    await i18n.changeLanguage("en");
    respond = async () => Response.json(history);
    fetchSpy = spyOn(globalThis, "fetch").mockImplementation(Object.assign(() => respond(), { preconnect: () => {} }));
    useHomeStore.setState({ summary: null, failed: false });
    usePlayerStore.setState({ tracks, playlists: [road], activeTrack: null, isPlaying: false });
    onPlayPage.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    fetchSpy.mockRestore();
    usePlayerStore.setState({
      buildPlaylistQueue: original.buildPlaylistQueue,
      queuePlaylist: original.queuePlaylist,
      playSegmentInMode: original.playSegmentInMode,
      playModeQueue: original.playModeQueue,
    });
  });

  const renderHome = () =>
    act(async () => {
      root.render(<HomePage onPlayPage={onPlayPage} />);
      await tick();
    });
  const shelfTitles = () => Array.from(container.querySelectorAll("section h3")).map((el) => el.textContent);
  const shelf = (title: string) => Array.from(container.querySelectorAll("section")).find((el) => el.querySelector("h3")?.textContent === title)!;
  const button = (label: string, within: ParentNode = container) => within.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  const click = (el: HTMLElement | null | undefined) =>
    act(async () => {
      el?.click();
      await tick();
    });

  it("shows what was played lately and most, then what was added", async () => {
    await renderHome();

    expect(shelfTitles()).toEqual(["Recently Played", "Heavy Rotation", "Top Playlists", "Recently Added"]);
    expect(Array.from(shelf("Recently Played").querySelectorAll("h4")).map((el) => el.textContent)).toEqual(["Tracks", "Road"]);
    expect(Array.from(shelf("Heavy Rotation").querySelectorAll("li")).map((el) => el.textContent)).toEqual([
      "Play Song bBand4 plays",
      "Play Song aBand1 play",
    ]);
  });

  it("until something has been played, shows what was added and says where plays will show", async () => {
    respond = async () => Response.json({ recently_played: [], heavy_rotation: [], top_playlists: [] });
    await renderHome();

    expect(shelfTitles()).toEqual(["Recently Added"]);
    expect(container.textContent).toContain("Play some music, and what you listen to shows up here.");
  });

  it("plays Heavy Rotation from the song chosen, as a list started from Home", async () => {
    const playSegmentInMode = mock(async (..._args: unknown[]) => {});
    usePlayerStore.setState({ playSegmentInMode: playSegmentInMode as never });
    await renderHome();

    const rows = shelf("Heavy Rotation").querySelectorAll<HTMLButtonElement>("li button");
    await click(rows[1]);

    const [mode, segment, played, queue, index, origin] = playSegmentInMode.mock.calls[0] as [string, { id: string }, Track, { track: Track }[], number, unknown];
    expect([mode, segment.id, played.id, index]).toEqual(["original_only", "fallback_a", "a", 1]);
    expect(queue.map((item) => item.track.id)).toEqual(["b", "a"]);
    expect(origin).toEqual({ type: "home", shelf: "heavy_rotation", mode: "original_only", fromHome: true });
  });

  it("plays and queues a playlist as started from Home", async () => {
    const buildPlaylistQueue = mock(async (..._args: unknown[]) => {});
    const queuePlaylist = mock(async (..._args: unknown[]) => {});
    usePlayerStore.setState({ buildPlaylistQueue: buildPlaylistQueue as never, queuePlaylist: queuePlaylist as never });
    await renderHome();

    await click(button("Play Road", shelf("Recently Played")));
    await click(button("More options for Road", shelf("Recently Played")));
    await click(Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find((el) => el.textContent === "Play Next"));

    expect(buildPlaylistQueue.mock.calls).toEqual([["road", false, 0, false, { type: "playlist", playlistId: "road", fromHome: true }]]);
    expect(queuePlaylist.mock.calls).toEqual([["road", "next", { fromHome: true }]]);
  });

  it("plays a library page as that page lists its songs", async () => {
    await renderHome();

    await click(button("Play Tracks"));

    expect(onPlayPage.mock.calls).toEqual([["original_only", "play"]]);
  });

  it("offers to try again when the listening history can't be loaded", async () => {
    respond = async () => new Response(null, { status: 500 });
    const logged = spyOn(console, "error").mockImplementation(() => {});
    try {
      await renderHome();
      expect(container.textContent).toContain("Couldn't load your listening history.");

      respond = async () => Response.json(history);
      await click(Array.from(container.querySelectorAll("button")).find((el) => el.textContent === "Try Again"));
    } finally {
      logged.mockRestore();
    }

    expect(shelfTitles()).toContain("Heavy Rotation");
  });
});
