import { describe, it, expect, beforeAll, beforeEach, afterEach, mock } from "bun:test";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PlaylistHeader } from "./PlaylistHeader";
import { usePlayerStore } from "../store/usePlayerStore";
import i18n from "../i18n";
import type { Playlist, PlaylistItemWithDetails } from "@/server/types";

const mockTrack1 = {
  id: "track_1",
  source_type: "youtube" as const,
  source_uri: "https://youtube.com/watch?v=1",
  title: "Song One",
  artist: "Artist A",
  duration: 200,
  thumbnail_url: "https://img.youtube.com/vi/1/hqdefault.jpg",
  status: "ready" as const,
};

const mockTrack2 = {
  id: "track_2",
  source_type: "youtube" as const,
  source_uri: "https://youtube.com/watch?v=2",
  title: "Song Two",
  artist: "Artist B",
  duration: 180,
  thumbnail_url: "https://img.youtube.com/vi/2/hqdefault.jpg",
  status: "ready" as const,
};

const mockItems: PlaylistItemWithDetails[] = [
  {
    id: "pi_1",
    playlist_id: "pl_1",
    track_id: "track_1",
    segment_id: null,
    sort_order: 1,
    added_at: 100,
    track: mockTrack1,
  },
  {
    id: "pi_2",
    playlist_id: "pl_1",
    track_id: "track_2",
    segment_id: "seg_1",
    sort_order: 2,
    added_at: 200,
    track: mockTrack2,
    segment: {
      id: "seg_1",
      track_id: "track_2",
      name: "Drop",
      start_time: 30,
      end_time: 60,
    },
  },
];

const mockPlaylist: Playlist & { item_count: number } = {
  id: "pl_1",
  name: "very low",
  created_at: 1000,
  updated_at: 1000,
  item_count: 2,
  cover_track_id: null,
  mosaic_urls: [mockTrack1.thumbnail_url, mockTrack2.thumbnail_url],
};

describe("PlaylistHeader Component (TDD)", () => {
  let root: Root;
  let container: HTMLElement;
  const original = usePlayerStore.getState();

  beforeEach(async () => {
    await i18n.changeLanguage("en");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  // Opens the "..." menu next to Play and Shuffle; its items render in a portal on document.body
  const openMoreMenu = async () => {
    const trigger = Array.from(container.querySelectorAll<HTMLElement>("button")).find((button) =>
      button.getAttribute("aria-label")?.startsWith("More actions for")
    );
    await act(async () => {
      trigger?.click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    return (testId: string) => document.querySelector<HTMLElement>(`[role="menu"] [data-testid='${testId}']`);
  };

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    usePlayerStore.setState({
      playlists: original.playlists,
      buildPlaylistQueue: original.buildPlaylistQueue,
      renamePlaylist: original.renamePlaylist,
      deletePlaylist: original.deletePlaylist,
      setPlaylistCover: original.setPlaylistCover,
      setActivePlaylist: original.setActivePlaylist,
    });
  });

  it("renders playlist title, item count, duration, and controls row", async () => {
    await act(async () => {
      root.render(<PlaylistHeader playlist={mockPlaylist} items={mockItems} />);
    });

    const header = container.querySelector("[data-testid='playlist-header']");
    expect(header).not.toBeNull();
    expect(header?.textContent).toContain("very low");
    expect(header?.textContent).toContain("2 items");

    // Controls toolbar exists in the lower row
    const controls = container.querySelector("[data-testid='playlist-controls-row']");
    expect(controls).not.toBeNull();

    // Play & Shuffle buttons inside controls
    const playBtn = controls?.querySelector("[data-testid='playlist-play-btn']") as HTMLButtonElement;
    const shuffleBtn = controls?.querySelector("[data-testid='playlist-shuffle-btn']") as HTMLButtonElement;
    // Like Apple Music, both carry a visible label
    expect(playBtn?.textContent).toContain("Play");
    expect(shuffleBtn?.textContent).toContain("Shuffle");
  });

  it("starts an inline rename from the more menu", async () => {
    await act(async () => {
      root.render(<PlaylistHeader playlist={mockPlaylist} items={mockItems} />);
    });

    const menuItem = await openMoreMenu();
    await act(async () => {
      menuItem("playlist-menu-rename")?.click();
    });

    expect(container.querySelector<HTMLInputElement>("[data-testid='playlist-inline-rename-input']")?.value).toBe("very low");
  });

  it("triggers buildPlaylistQueue when Play or Shuffle button is clicked", async () => {
    const buildPlaylistQueue = mock(async () => {});
    usePlayerStore.setState({ buildPlaylistQueue } as any);

    await act(async () => {
      root.render(<PlaylistHeader playlist={mockPlaylist} items={mockItems} />);
    });

    const playBtn = container.querySelector("[data-testid='playlist-play-btn']") as HTMLButtonElement;
    await act(async () => {
      playBtn.click();
    });
    expect(buildPlaylistQueue).toHaveBeenCalledWith("pl_1", false);

    const shuffleBtn = container.querySelector("[data-testid='playlist-shuffle-btn']") as HTMLButtonElement;
    await act(async () => {
      shuffleBtn.click();
    });
    expect(buildPlaylistQueue).toHaveBeenCalledWith("pl_1", true);
  });

  it("supports inline rename: switches to input on rename click, calls renamePlaylist on save", async () => {
    const renamePlaylist = mock(async () => true);
    usePlayerStore.setState({ renamePlaylist } as any);

    await act(async () => {
      root.render(<PlaylistHeader playlist={mockPlaylist} items={mockItems} />);
    });

    const renameBtn = container.querySelector("[data-testid='playlist-rename-btn']") as HTMLButtonElement;
    expect(renameBtn).not.toBeNull();

    await act(async () => {
      renameBtn.click();
    });

    const input = container.querySelector("[data-testid='playlist-inline-rename-input']") as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.value).toBe("very low");

    // Type a new name: the native setter bypasses React's value tracker so the input event reaches onChange
    await act(async () => {
      Reflect.set(Object.getPrototypeOf(input), "value", "chill vibes", input);
      input.dispatchEvent(new window.Event("input", { bubbles: true }));
    });

    // Save
    const saveBtn = container.querySelector("[data-testid='playlist-rename-save-btn']") as HTMLButtonElement;
    await act(async () => {
      saveBtn.click();
    });

    expect(renamePlaylist).toHaveBeenCalledWith("pl_1", "chill vibes");
    // Keyboard focus lands back on the rename button instead of falling to the page
    expect(document.activeElement?.getAttribute("data-testid")).toBe("playlist-rename-btn");
  });

  it("cancels inline rename on Escape key without calling renamePlaylist", async () => {
    const renamePlaylist = mock(async () => true);
    usePlayerStore.setState({ renamePlaylist } as any);

    await act(async () => {
      root.render(<PlaylistHeader playlist={mockPlaylist} items={mockItems} />);
    });

    const renameBtn = container.querySelector("[data-testid='playlist-rename-btn']") as HTMLButtonElement;
    await act(async () => {
      renameBtn.click();
    });

    const input = container.querySelector("[data-testid='playlist-inline-rename-input']") as HTMLInputElement;
    await act(async () => {
      input.dispatchEvent(new (window as any).KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(renamePlaylist).not.toHaveBeenCalled();
    // Input should be gone and title restored
    expect(container.querySelector("[data-testid='playlist-inline-rename-input']")).toBeNull();
    expect(document.activeElement?.getAttribute("data-testid")).toBe("playlist-rename-btn");
  });

  it("opens delete confirm modal and calls deletePlaylist on confirm", async () => {
    const deletePlaylist = mock(async () => true);
    usePlayerStore.setState({ deletePlaylist } as any);

    await act(async () => {
      root.render(<PlaylistHeader playlist={mockPlaylist} items={mockItems} />);
    });

    const deleteItem = (await openMoreMenu())("playlist-menu-delete");
    expect(deleteItem).not.toBeNull();

    await act(async () => {
      deleteItem?.click();
    });

    // Confirm modal should be open in document.body
    const dialog = document.body.querySelector("[role='dialog']");
    expect(dialog).not.toBeNull();
    const confirmBtn = (dialog?.querySelector("[data-testid='delete-playlist-submit-btn']") ||
      dialog?.querySelector("button[type='submit']")) as HTMLButtonElement | null;
    expect(confirmBtn).not.toBeNull();

    await act(async () => {
      confirmBtn?.click();
    });

    expect(deletePlaylist).toHaveBeenCalledWith("pl_1");
  });

  it("allows setting cover track or resetting cover to mosaic", async () => {
    const setPlaylistCover = mock(async () => true);
    usePlayerStore.setState({ setPlaylistCover } as any);

    await act(async () => {
      root.render(<PlaylistHeader playlist={mockPlaylist} items={mockItems} />);
    });

    const openCoverPicker = async () => {
      const coverItem = (await openMoreMenu())("playlist-menu-cover");
      expect(coverItem).not.toBeNull();
      await act(async () => {
        coverItem?.click();
      });
    };
    await openCoverPicker();

    // 1. Set track as cover
    const trackOption = document.body.querySelector("[data-testid='cover-option-track_1']") as HTMLElement;
    expect(trackOption).not.toBeNull();
    // The playlist has no chosen cover yet, so the automatic mosaic is the current one
    expect(document.body.querySelector("[data-testid='cover-option-reset']")?.getAttribute("aria-current")).toBe("true");
    expect(trackOption.hasAttribute("aria-current")).toBe(false);

    await act(async () => {
      trackOption.click();
    });

    expect(setPlaylistCover).toHaveBeenCalledWith("pl_1", "track_1");

    // 2. Open again and reset to auto mosaic
    await openCoverPicker();

    const resetOption = document.body.querySelector("[data-testid='cover-option-reset']") as HTMLElement;
    expect(resetOption).not.toBeNull();

    await act(async () => {
      resetOption.click();
    });

    expect(setPlaylistCover).toHaveBeenCalledWith("pl_1", null);
  });

  it("renders mix playlist badge, source names, calls onEditSources, and hides rename/cover options", async () => {
    const onEditSources = mock();
    const mixPlaylist: Playlist & { item_count: number } = {
      id: "pl_mix",
      name: "Chill + Gym",
      created_at: 1000,
      updated_at: 1000,
      item_count: 5,
      is_mix: true,
      source_ids: ["pl_src1", "pl_src2"],
    };

    usePlayerStore.setState({
      playlists: [
        { id: "pl_src1", name: "Chill Tracks", created_at: 1, updated_at: 1, item_count: 0 },
        { id: "pl_src2", name: "Gym Pump", created_at: 2, updated_at: 2, item_count: 0 },
        mixPlaylist,
      ],
    });

    await act(async () => {
      root.render(<PlaylistHeader playlist={mixPlaylist} items={mockItems} onEditSources={onEditSources} />);
    });

    const header = container.querySelector("[data-testid='playlist-header']");
    expect(header?.textContent).toContain("Mix");
    expect(header?.textContent).toContain("Chill Tracks · Gym Pump");

    // Rename and cover options should be hidden for mix playlist
    expect(container.querySelectorAll("[data-testid='playlist-rename-btn']").length).toBe(0);
    expect(container.querySelectorAll("[data-testid='playlist-cover-hover-btn']").length).toBe(0);
    const menuItem = await openMoreMenu();
    expect(menuItem("playlist-menu-rename") === null).toBe(true);
    expect(menuItem("playlist-menu-cover") === null).toBe(true);
    expect(menuItem("playlist-menu-delete") === null).toBe(false);
    await act(async () => {
      document.activeElement?.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    // Edit sources button exists and triggers callback
    const editSourcesBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.getAttribute("aria-label")?.includes("Chill + Gym") || b.textContent?.includes("Edit Sources")
    );
    expect(editSourcesBtn).toBeDefined();

    await act(async () => {
      editSourcesBtn?.click();
    });

    expect(onEditSources).toHaveBeenCalled();
  });

  it("disables Play and Shuffle buttons when playlist is empty", async () => {
    const emptyPlaylist: Playlist & { item_count: number } = {
      id: "pl_empty",
      name: "Empty Playlist",
      created_at: 1000,
      updated_at: 1000,
      item_count: 0,
      cover_track_id: null,
    };

    await act(async () => {
      root.render(<PlaylistHeader playlist={emptyPlaylist} items={[]} />);
    });

    const playBtn = container.querySelector("[data-testid='playlist-play-btn']") as HTMLButtonElement;
    const shuffleBtn = container.querySelector("[data-testid='playlist-shuffle-btn']") as HTMLButtonElement;

    expect(playBtn.disabled).toBe(true);
    expect(shuffleBtn.disabled).toBe(true);
  });

  it("renders breadcrumb for child playlist and allows navigating to parent", async () => {
    const setActivePlaylist = mock(async () => {});
    usePlayerStore.setState({
      playlists: [
        { id: "pl_parent", name: "Rock Parent", created_at: 1, updated_at: 1, item_count: 5 },
        { id: "pl_child", name: "Guitar Solos", parent_id: "pl_parent", created_at: 2, updated_at: 2, item_count: 2 },
      ],
      setActivePlaylist,
    } as any);

    const childPlaylist: Playlist & { item_count: number } = {
      id: "pl_child",
      name: "Guitar Solos",
      parent_id: "pl_parent",
      created_at: 2,
      updated_at: 2,
      item_count: 2,
    };

    await act(async () => {
      root.render(<PlaylistHeader playlist={childPlaylist} items={mockItems} />);
    });

    const breadcrumb = container.querySelector("[data-slot='breadcrumb']");
    expect(breadcrumb).not.toBeNull();
    expect(breadcrumb?.textContent).toContain("Rock Parent");
    expect(breadcrumb?.textContent).toContain("Guitar Solos");

    const parentLink = breadcrumb?.querySelector("button");
    expect(parentLink).not.toBeNull();

    await act(async () => {
      parentLink?.click();
    });

    expect(setActivePlaylist).toHaveBeenCalledWith("pl_parent");
  });

  // Like a playlist folder in Apple Music: a playlist's sub-playlists show as tiles above its songs
  describe("sub-playlists", () => {
    const parent: Playlist & { item_count: number } = { id: "pl_root", name: "Parent List", created_at: 1, updated_at: 1, item_count: 10 };
    const sub1: Playlist & { item_count: number } = { id: "pl_c1", name: "Sub 1", parent_id: "pl_root", created_at: 2, updated_at: 2, item_count: 3 };
    const sub2: Playlist & { item_count: number } = { id: "pl_c2", name: "Sub 2", parent_id: "pl_root", created_at: 3, updated_at: 3, item_count: 7 };
    const mix: Playlist & { item_count: number } = { id: "mix_1", name: "Night", created_at: 4, updated_at: 4, item_count: 10, is_mix: true, source_ids: ["pl_root", "pl_c1"] };

    const renderHeader = (playlist: Playlist & { item_count: number }) =>
      act(async () => {
        root.render(<PlaylistHeader playlist={playlist} items={mockItems} />);
      });
    const shelf = () => {
      const heading = Array.from(container.querySelectorAll("h2")).find((h) => h.textContent === "Sub-playlists");
      return heading?.closest("section") ?? null;
    };
    const menuTexts = () => Array.from(document.querySelectorAll('[role="menu"] [role="menuitem"]')).map((el) => el.textContent?.trim());
    const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
    // The header loads the New Playlist dialog's code when it first opens; loading it here lets it open at once
    beforeAll(async () => {
      await import("./CreatePlaylistModal");
    });
    // The parent the New Playlist dialog starts on
    const newPlaylistParent = async () => {
      await act(tick);
      return document.querySelector("[role='dialog'] [role='combobox']")?.textContent ?? "";
    };

    it("shows a playlist's sub-playlists as tiles that open them", async () => {
      const setActivePlaylist = mock(async (_id: string | null) => {});
      usePlayerStore.setState({ playlists: [parent, sub1, sub2], setActivePlaylist });
      await renderHeader(parent);

      expect(Array.from(shelf()?.querySelectorAll("h3") ?? []).map((h) => h.textContent)).toEqual(["Sub 1", "Sub 2"]);
      expect(shelf()?.textContent).toContain("7 items");
      await act(async () => {
        shelf()?.querySelector<HTMLButtonElement>("button[aria-label='Open playlist Sub 1']")?.click();
      });

      expect(setActivePlaylist.mock.calls).toEqual([["pl_c1"]]);
    });

    it("starts a new sub-playlist of the playlist from its More menu", async () => {
      usePlayerStore.setState({ playlists: [parent, sub1] });
      await renderHeader(parent);

      await openMoreMenu();
      await act(async () => {
        Array.from(document.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]'))
          .find((el) => el.textContent?.trim() === "New Sub-playlist")
          ?.click();
      });

      expect(await newPlaylistParent()).toContain("Parent List");
    });

    it("starts a new sub-playlist from the tile after the sub-playlists", async () => {
      usePlayerStore.setState({ playlists: [parent, sub1] });
      await renderHeader(parent);

      await act(async () => {
        Array.from(shelf()?.querySelectorAll("button") ?? [])
          .find((b) => b.textContent?.trim() === "New Sub-playlist")
          ?.click();
      });

      expect(await newPlaylistParent()).toContain("Parent List");
    });

    it("leaves out the section for a playlist without sub-playlists, keeping New Sub-playlist in its menu", async () => {
      usePlayerStore.setState({ playlists: [parent] });
      await renderHeader(parent);

      expect(shelf()).toBe(null);
      expect(container.textContent).not.toContain("Sub-playlists");
      await openMoreMenu();
      expect(menuTexts()).toContain("New Sub-playlist");
    });

    it("offers no sub-playlists inside a sub-playlist or a mix", async () => {
      usePlayerStore.setState({ playlists: [parent, sub1, mix] });

      await renderHeader(sub1);
      await openMoreMenu();
      expect(menuTexts()).not.toContain("New Sub-playlist");
      expect(shelf()).toBe(null);
      await act(async () => root.unmount());
      root = createRoot(container);

      await renderHeader(mix);
      await openMoreMenu();
      expect(menuTexts()).not.toContain("New Sub-playlist");
      expect(shelf()).toBe(null);
    });
  });
});

