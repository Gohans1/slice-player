import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Toaster, toast } from "../components/ui/toast";
import { usePlayerStore } from "./usePlayerStore";
import { useLogStore } from "./useLogStore";
import i18n from "../i18n";
import type { Playlist } from "@/server/types";

const originalFetch = globalThis.fetch;
const initialState = usePlayerStore.getState();
const rock: Playlist & { item_count: number } = { id: "pl_rock", name: "Rock", created_at: 1, updated_at: 1, item_count: 2 };

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

  it("leaves a failed new playlist to its dialog, which shows the error itself", async () => {
    serverResponds(500);

    await settle(() => usePlayerStore.getState().createPlaylist("Metal"));

    expect(shownToasts()).toHaveLength(0);
  });
});
