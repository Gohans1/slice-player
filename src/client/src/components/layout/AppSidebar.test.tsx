import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import i18n from "../../i18n";
import { AppSidebar } from "./AppSidebar";
import { SidebarProvider, SidebarTrigger } from "../ui/sidebar";
import { TooltipProvider } from "../ui/tooltip";
import { usePlayerStore } from "../../store/usePlayerStore";
import { happyWindow } from "../../test/dom";
import type { Playlist, Track } from "@/server/types";

const track = (id: string, status: Track["status"], segment_count = 0) =>
  ({ id, status, segment_count, title: id, source_type: "youtube", source_uri: "", duration: 60 }) as Track;

const playlist = (id: string, name: string, extra: Partial<Playlist> = {}) =>
  ({ id, name, created_at: 0, updated_at: 0, item_count: 2, ...extra }) as Playlist & { item_count: number };

const tick = () => new Promise((r) => setTimeout(r, 20));

const emptyJsonFetch: typeof fetch = Object.assign(async () => Response.json([]), { preconnect: () => {} });

describe("AppSidebar", () => {
  let container: HTMLDivElement;
  let root: Root;
  let initialState: ReturnType<typeof usePlayerStore.getState>;
  let fetchSpy: ReturnType<typeof spyOn>;
  let onCreatePlaylist: ReturnType<typeof mock>;

  beforeEach(() => {
    initialState = usePlayerStore.getState();
    fetchSpy = spyOn(globalThis, "fetch").mockImplementation(emptyJsonFetch);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    onCreatePlaylist = mock(() => {});
    usePlayerStore.setState({
      tracks: [track("a", "ready", 3), track("b", "ready", 1), track("c", "downloading"), track("d", "error")],
      playlists: [
        playlist("rock", "Rock"),
        playlist("rock-90s", "Rock 90s", { parent_id: "rock" }),
        playlist("empty", "Empty", { item_count: 0 }),
      ],
      activePlaylistId: null,
      activeSystemCategory: "mixed",
      activePlaylistPlayingId: null,
      activeTrack: null,
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    fetchSpy.mockRestore();
    usePlayerStore.setState(initialState, true);
  });

  async function renderSidebar() {
    await act(async () => {
      root.render(
        <TooltipProvider>
          <SidebarProvider>
            <AppSidebar onCreatePlaylist={onCreatePlaylist} searchQuery="" onSearchChange={() => {}} onOpenShortcuts={() => {}} />
          </SidebarProvider>
        </TooltipProvider>
      );
    });
  }

  const menuButton = (label: string) =>
    Array.from(container.querySelectorAll<HTMLElement>('[data-sidebar="menu-button"]')).find(
      (el) => el.textContent?.trim() === label
    )!;

  const badgeOf = (label: string) =>
    menuButton(label).closest('[data-sidebar="menu-item"]')!.querySelector('[data-sidebar="menu-badge"]')?.textContent;

  const menuItem = (label: string) =>
    Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
      (el) => el.textContent?.trim() === label
    )!;

  async function click(el: HTMLElement) {
    await act(async () => {
      el.click();
      await tick();
    });
  }

  async function openActions(name: string) {
    await click(container.querySelector<HTMLElement>(`[aria-label="More options for ${name}"]`)!);
  }

  it("lists the library categories with counts derived from the tracks", async () => {
    await renderSidebar();

    expect(badgeOf("Mix")).toBe("7");
    expect(badgeOf("Slices")).toBe("4");
    expect(badgeOf("Tracks")).toBe("3");
    expect(badgeOf("Downloading")).toBe("1");
    expect(badgeOf("Errors")).toBe("1");
  });

  it("writes large counts the way the reader's language writes numbers", async () => {
    usePlayerStore.setState({ tracks: [track("a", "ready", 1234)] });
    await renderSidebar();
    expect(badgeOf("Slices")).toBe("1,234");

    await act(async () => {
      await i18n.changeLanguage("vi");
    });
    try {
      expect(badgeOf("Lát cắt")).toBe("1.234");
    } finally {
      await act(async () => {
        await i18n.changeLanguage("en");
      });
    }
  });

  it("writes counts like the translations do in a regional language", async () => {
    usePlayerStore.setState({ tracks: [track("a", "ready", 1234567)] });
    await act(async () => {
      await i18n.changeLanguage("en-IN");
    });
    try {
      await renderSidebar();

      expect(i18n.t("categories.itemsCount", { count: 1234567 })).toBe("(12,34,567 items)");
      expect(badgeOf("Slices")).toBe("12,34,567");
    } finally {
      await act(async () => {
        await i18n.changeLanguage("en");
      });
    }
  });

  it("marks the current category active and switches category on click", async () => {
    await renderSidebar();
    expect(menuButton("Mix").hasAttribute("data-active")).toBe(true);

    await click(menuButton("Slices"));

    expect(usePlayerStore.getState().activeSystemCategory).toBe("slices_only");
    expect(menuButton("Slices").hasAttribute("data-active")).toBe(true);
    expect(menuButton("Mix").hasAttribute("data-active")).toBe(false);
  });

  it("opens the playlists overview from All Playlists, showing the playlist count", async () => {
    await renderSidebar();
    expect(badgeOf("All Playlists")).toBe("3");

    await click(menuButton("All Playlists"));

    expect(usePlayerStore.getState().activeSystemCategory).toBe("playlists");
    expect(menuButton("All Playlists").hasAttribute("data-active")).toBe(true);
  });

  it("nests sub-playlists right under their parent playlist", async () => {
    await renderSidebar();

    const parentItem = menuButton("Rock").closest('[data-sidebar="menu-item"]')!;
    const subMenu = parentItem.nextElementSibling?.querySelector('[data-sidebar="menu-sub"]');
    expect(subMenu).not.toBeNull();
    expect(subMenu!.contains(menuButton("Rock 90s"))).toBe(true);
    expect(parentItem.contains(menuButton("Rock 90s"))).toBe(false);
  });

  it("lists a sub-playlist whose parent is gone as a top-level playlist", async () => {
    usePlayerStore.setState({ playlists: [playlist("orphan", "Orphan", { parent_id: "deleted" })] });
    await renderSidebar();

    expect(menuButton("Orphan").closest('[data-sidebar="menu-sub"]')).toBeNull();
  });

  it("opens a playlist on click and marks it active", async () => {
    await renderSidebar();

    await click(menuButton("Rock 90s"));

    expect(usePlayerStore.getState().activePlaylistId).toBe("rock-90s");
    expect(menuButton("Rock 90s").hasAttribute("data-active")).toBe(true);
    expect(menuButton("Mix").hasAttribute("data-active")).toBe(false);
  });

  it("shuffles a playlist from its actions menu without opening it", async () => {
    const buildPlaylistQueue = mock(async () => {});
    usePlayerStore.setState({ buildPlaylistQueue });
    await renderSidebar();

    await openActions("Rock");
    await click(menuItem("Shuffle"));

    expect(buildPlaylistQueue).toHaveBeenCalledWith("rock", true);
    expect(usePlayerStore.getState().activePlaylistId).toBeNull();
  });

  it("disables shuffle for an empty playlist", async () => {
    await renderSidebar();

    await openActions("Empty");

    expect(menuItem("Shuffle").getAttribute("aria-disabled")).toBe("true");
  });

  it("renames a playlist inline from its actions menu", async () => {
    const renamePlaylist = mock(async () => true);
    usePlayerStore.setState({ renamePlaylist });
    await renderSidebar();

    await openActions("Rock");
    await click(menuItem("Rename"));

    const input = container.querySelector<HTMLInputElement>('[data-sidebar="input"]')!;
    expect(input.value).toBe("Rock");
    expect(document.activeElement).toBe(input);

    await act(async () => {
      // Set through the prototype so React's value tracker sees a real edit
      Reflect.set(HTMLInputElement.prototype, "value", "Rock Classics", input);
      input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    });
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await tick();
    });

    expect(renamePlaylist).toHaveBeenCalledWith("rock", "Rock Classics");
    expect(container.querySelector('[data-sidebar="input"]')).toBeNull();
  });

  for (const opener of ["actions button", "right-click"] as const) {
    it(`keeps the name field focused after another playlist's menu has been used (${opener})`, async () => {
      await renderSidebar();
      // Opening a menu from a focused button records it as somewhere focus can go back to
      const emptyActions = container.querySelector<HTMLElement>('[aria-label="More options for Empty"]')!;
      emptyActions.focus();
      await click(emptyActions);
      await act(async () => {
        document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        await tick();
      });

      if (opener === "actions button") {
        const rockActions = container.querySelector<HTMLElement>('[aria-label="More options for Rock"]')!;
        rockActions.focus();
        await click(rockActions);
      } else {
        menuButton("Rock").focus();
        await act(async () => {
          menuButton("Rock").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: 40, clientY: 40 }));
          await tick();
        });
      }
      await click(menuItem("Rename"));

      const input = container.querySelector<HTMLInputElement>('[data-sidebar="input"]');
      expect(input?.value).toBe("Rock");
      expect(document.activeElement === input).toBe(true);
    });
  }

  it("hands focus back to the actions button once a rename is over", async () => {
    await renderSidebar();
    await openActions("Rock");
    await click(menuItem("Rename"));
    await act(async () => {
      container.querySelector('[data-sidebar="input"]')?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await tick();
    });

    const rockActions = container.querySelector<HTMLElement>('[aria-label="More options for Rock"]')!;
    rockActions.focus();
    await click(rockActions);
    await act(async () => {
      document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await tick();
    });

    expect(document.activeElement === rockActions).toBe(true);
  });

  it("hands focus back to the playlist once a rename is done from the keyboard, saving it once", async () => {
    const renamePlaylist = mock(async (_id: string, _name: string) => true);
    usePlayerStore.setState({ renamePlaylist });
    await renderSidebar();

    await openActions("Rock");
    await click(menuItem("Rename"));
    const input = container.querySelector<HTMLInputElement>('[data-sidebar="input"]')!;
    await act(async () => {
      Reflect.set(HTMLInputElement.prototype, "value", "Rock Classics", input);
      input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    });
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await tick();
    });

    expect(renamePlaylist.mock.calls).toEqual([["rock", "Rock Classics"]]);
    expect(document.activeElement === menuButton("Rock")).toBe(true);
  });

  it("cancels a rename with Escape on a phone without closing the sidebar", async () => {
    happyWindow.happyDOM.setViewport({ width: 390 });
    try {
      await act(async () => {
        root.render(
          <TooltipProvider>
            <SidebarProvider>
              <SidebarTrigger />
              <AppSidebar onCreatePlaylist={onCreatePlaylist} searchQuery="" onSearchChange={() => {}} onOpenShortcuts={() => {}} />
            </SidebarProvider>
          </TooltipProvider>
        );
      });
      await click(container.querySelector<HTMLElement>('[data-sidebar="trigger"]')!);
      const sheet = () => document.querySelector('[data-mobile="true"]');
      const actions = sheet()!.querySelector<HTMLElement>('[aria-label="More options for Rock"]')!;
      actions.focus();
      await click(actions);
      await click(menuItem("Rename"));
      const input = sheet()!.querySelector<HTMLInputElement>('[data-sidebar="input"]');
      expect(document.activeElement === input).toBe(true);

      await act(async () => {
        input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
        await tick();
      });

      expect(sheet() === null).toBe(false);
      expect(sheet()?.querySelector('[data-sidebar="input"]') ?? null).toBe(null);
      const rock = Array.from(sheet()!.querySelectorAll<HTMLElement>('[data-sidebar="menu-button"]')).find((el) => el.textContent?.trim() === "Rock");
      expect(document.activeElement === rock).toBe(true);
    } finally {
      happyWindow.happyDOM.setViewport({ width: 1024 });
    }
  });

  it("cancels an inline rename with Escape", async () => {
    const renamePlaylist = mock(async () => true);
    usePlayerStore.setState({ renamePlaylist });
    await renderSidebar();

    await openActions("Rock");
    await click(menuItem("Rename"));
    const input = container.querySelector<HTMLInputElement>('[data-sidebar="input"]')!;
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await tick();
    });

    expect(renamePlaylist).not.toHaveBeenCalled();
    expect(container.querySelector('[data-sidebar="input"]')).toBeNull();
    expect(menuButton("Rock")).toBeDefined();
  });

  it("opens a playlist's actions on right-click, without opening the playlist", async () => {
    const renamePlaylist = mock(async () => true);
    usePlayerStore.setState({ renamePlaylist });
    await renderSidebar();

    await act(async () => {
      menuButton("Rock").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: 40, clientY: 40 }));
      await tick();
    });

    const items = Array.from(document.body.querySelectorAll('[role="menu"] [role="menuitem"]')).map((el) => el.textContent?.trim());
    expect(items).toEqual(["Shuffle", "Rename", "Delete playlist"]);
    expect(usePlayerStore.getState().activePlaylistId).toBeNull();

    await click(menuItem("Rename"));
    const input = container.querySelector<HTMLInputElement>('[data-sidebar="input"]');
    expect(input?.value).toBe("Rock");
    expect(document.activeElement === input).toBe(true);
  });

  it("asks for confirmation before deleting a playlist", async () => {
    await renderSidebar();

    await openActions("Rock");
    await click(menuItem("Delete playlist"));

    expect(document.body.textContent).toContain("Delete playlist?");
  });

  it("asks the app to create a playlist from the Playlists group action", async () => {
    await renderSidebar();

    await click(container.querySelector<HTMLElement>('[aria-label="New Playlist"]')!);

    expect(onCreatePlaylist).toHaveBeenCalledTimes(1);
  });

  it("shows the now-playing equalizer on the playlist that is playing", async () => {
    usePlayerStore.setState({ activePlaylistPlayingId: "rock", activeTrack: track("a", "ready", 3), isPlaying: true });
    await renderSidebar();

    expect(menuButton("Rock").innerHTML).toContain("animate-eq-1");
    expect(menuButton("Rock 90s").innerHTML).not.toContain("animate-eq-1");
    expect(menuButton("Mix").innerHTML).not.toContain("animate-eq-1");
  });

  it("shows each playlist's cover beside its name, and an icon for one without artwork", async () => {
    usePlayerStore.setState({
      playlists: [
        playlist("rock", "Rock", { cover_url: "https://i.ytimg.com/vi/rock_cover/maxresdefault.jpg" }),
        playlist("empty", "Empty", { item_count: 0 }),
      ],
    });
    await renderSidebar();

    expect(menuButton("Rock").querySelector("img")?.getAttribute("src")).toBe("https://i.ytimg.com/vi/rock_cover/mqdefault.jpg");
    expect(menuButton("Empty").querySelector("img")).toBeNull();
    expect(menuButton("Empty").querySelector("svg")).not.toBeNull();
  });
});
