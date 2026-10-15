import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Toaster, toast } from "../components/ui/toast";
import { flushTrackVolume, usePlayerStore } from "./usePlayerStore";
import { useLogStore } from "./useLogStore";
import i18n from "../i18n";
import type { Playlist, Track } from "@/server/types";

const originalFetch = globalThis.fetch;
const initialState = usePlayerStore.getState();
const rock: Playlist & { item_count: number } = { id: "pl_rock", name: "Rock", created_at: 1, updated_at: 1, item_count: 2 };
const failedDownload: Track = {
  id: "trk_failed",
  source_type: "youtube",
  source_uri: "https://www.youtube.com/watch?v=failed",
  title: "Failed Song",
  artist: "Artist",
  duration: 180,
  status: "error",
  error_message: "Sign in to confirm you're not a bot",
  thumbnail_url: "",
  volume: 0.5,
  created_at: 1,
};

// Every request gets this status, or fails the way fetch does when the server is down
function serverResponds(status: number) {
  globalThis.fetch = Object.assign(async () => Response.json({ error: "Nope" }, { status }), { preconnect: originalFetch.preconnect });
}

function serverUnreachable() {
  globalThis.fetch = Object.assign(
    async (): Promise<Response> => {
      throw new TypeError("Failed to fetch");
    },
    { preconnect: originalFetch.preconnect }
  );
}

// A retry the server tried and failed: it records the reason on the track, which shows it inline
function downloadFailsAgain(message: string) {
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url.endsWith("/retry")) return Response.json({ success: false, message }, { status: 400 });
      return Response.json(url.endsWith("/api/tracks") ? [{ ...failedDownload, error_message: message }] : []);
    },
    { preconnect: originalFetch.preconnect }
  );
}

const shownToasts = () => Array.from(document.querySelectorAll<HTMLElement>('[data-slot="toast"]'));

async function settle(action: () => Promise<unknown>) {
  await act(async () => {
    await action();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

// A change the user asked for can fail after its menu or dialog has closed; the user must still hear about it
describe("failed changes", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    await i18n.changeLanguage("en");
    usePlayerStore.setState({ playlists: [rock], activePlaylistId: null, activePlaylistPlayingId: null });
    useLogStore.getState().clearLogsLocal();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(<Toaster />);
    });
  });

  afterEach(() => {
    act(() => {
      toast.close();
      root.unmount();
    });
    container.remove();
    globalThis.fetch = originalFetch;
    usePlayerStore.setState(initialState, true);
  });

  it("tells the user when the server rejects a playlist rename", async () => {
    serverResponds(500);

    await settle(() => usePlayerStore.getState().renamePlaylist(rock.id, "Metal"));

    expect(shownToasts()).toHaveLength(1);
    expect(shownToasts()[0].textContent).toContain("Failed to rename playlist");
    expect(shownToasts()[0].textContent).toContain("HTTP 500");
    // Announced right away, since the menu that started it is long gone
    expect(shownToasts()[0].getAttribute("role")).toBe("alertdialog");
  });

  it("tells the user when the server can't be reached", async () => {
    serverUnreachable();

    await settle(() => usePlayerStore.getState().deletePlaylist(rock.id));

    expect(shownToasts()).toHaveLength(1);
    expect(shownToasts()[0].textContent).toContain("Failed to delete playlist");
    expect(shownToasts()[0].textContent).toContain("Can't reach the server");
  });

  it("treats a gateway that can't reach the server as an unreachable server", async () => {
    // What the Vite dev proxy answers while the API is down
    serverResponds(502);

    await settle(() => usePlayerStore.getState().renamePlaylist(rock.id, "Metal"));

    expect(shownToasts()[0].textContent).toContain("Can't reach the server");
  });

  it("explains why a dragged song jumped back when the new order can't be saved", async () => {
    serverResponds(500);

    await settle(() => usePlayerStore.getState().reorderPlaylist(rock.id, ["item_2", "item_1"]));

    expect(shownToasts()[0].textContent).toContain("Failed to save the new order");
  });

  it("shows one toast for a change that keeps failing", async () => {
    serverResponds(500);

    await settle(() => usePlayerStore.getState().reorderPlaylist(rock.id, ["item_2", "item_1"]));
    await settle(() => usePlayerStore.getState().reorderPlaylist(rock.id, ["item_1", "item_2"]));

    expect(shownToasts()).toHaveLength(1);
  });

  it("keeps the details in System Logs", async () => {
    serverResponds(403);

    await settle(() => usePlayerStore.getState().addToPlaylist(rock.id, "trk_1"));

    const logged = useLogStore.getState().logs.filter((log) => log.level === "error");
    expect(logged).toHaveLength(1);
    expect(logged[0].message).toContain("Failed to add to playlist");
    expect(logged[0].message).toContain("HTTP 403");
  });

  it("tells the user when retrying every failed download can't reach the server", async () => {
    serverResponds(502);

    await settle(() => usePlayerStore.getState().retryAllErrors());

    expect(shownToasts()).toHaveLength(1);
    expect(shownToasts()[0].textContent).toContain("Failed to retry download");
    expect(shownToasts()[0].textContent).toContain("Can't reach the server");
  });

  it("tells the user when retrying one download can't reach the server", async () => {
    serverResponds(502);

    await settle(() => usePlayerStore.getState().retryTrack("trk_1"));

    expect(shownToasts()).toHaveLength(1);
    expect(shownToasts()[0].textContent).toContain("Failed to retry download");
  });

  it("leaves a download that failed again to its track, which shows the new reason", async () => {
    usePlayerStore.setState({ tracks: [failedDownload] });
    downloadFailsAgain("Video unavailable");

    await settle(() => usePlayerStore.getState().retryTrack(failedDownload.id));

    expect(usePlayerStore.getState().tracks.find((t) => t.id === failedDownload.id)?.error_message).toBe("Video unavailable");
    expect(shownToasts()).toHaveLength(0);
  });

  it("tells the user when the server refuses a retry without trying the download", async () => {
    serverResponds(400);

    await settle(() => usePlayerStore.getState().retryTrack(failedDownload.id));

    expect(shownToasts()).toHaveLength(1);
    expect(shownToasts()[0].textContent).toContain("HTTP 400");
  });

  it("tells the user when the volume saved on closing Slice Studio fails", async () => {
    serverResponds(500);

    // Closing Studio flushes a volume change still waiting out its debounce
    void usePlayerStore.getState().setTrackVolume("trk_1", 0.8);
    await settle(() => flushTrackVolume("trk_1"));

    expect(shownToasts()).toHaveLength(1);
    expect(shownToasts()[0].textContent).toContain("Failed to save track volume");
  });

  it("reports a volume save once when Slice Studio closes while that save is on its way", async () => {
    let requests = 0;
    let answer: (res: Response) => void = () => {};
    globalThis.fetch = Object.assign(
      async () => {
        requests++;
        return new Promise<Response>((resolve) => {
          answer = resolve;
        });
      },
      { preconnect: originalFetch.preconnect }
    );

    void usePlayerStore.getState().setTrackVolume("trk_1", 0.8);
    // The debounce runs out and the save leaves, then Studio closes before the server answers
    await new Promise((resolve) => setTimeout(resolve, 40));
    const closing = flushTrackVolume("trk_1");
    answer(Response.json({ error: "Nope" }, { status: 500 }));
    await settle(() => closing);

    expect(requests).toBe(1);
    expect(useLogStore.getState().logs.filter((log) => log.level === "error")).toHaveLength(1);
  });

  it("leaves a failed new playlist to its dialog, which shows the error itself", async () => {
    serverResponds(500);

    await settle(() => usePlayerStore.getState().createPlaylist("Metal"));

    expect(shownToasts()).toHaveLength(0);
  });
});
