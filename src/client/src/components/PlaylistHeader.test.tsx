import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GlobalWindow } from "happy-dom";
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
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const happyWindow = new GlobalWindow();
    (globalThis as any).window = happyWindow;
    (globalThis as any).document = happyWindow.document;
    (globalThis as any).HTMLElement = happyWindow.HTMLElement;
    (globalThis as any).HTMLInputElement = happyWindow.HTMLInputElement;
    (globalThis as any).Event = happyWindow.Event;
    (globalThis as any).KeyboardEvent = happyWindow.KeyboardEvent;
    container = happyWindow.document.createElement("div") as unknown as HTMLElement;
    happyWindow.document.body.appendChild(container as any);
    root = createRoot(container);
  });

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
    expect(playBtn).not.toBeNull();
    expect(shuffleBtn).not.toBeNull();
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

    // Simulate input change
    const propsKey = Object.keys(input).find((k) => k.startsWith("__reactProps$"));
    await act(async () => {
      if (propsKey) {
        (input as any)[propsKey].onChange({ target: { value: "chill vibes" } });
      } else {
        input.value = "chill vibes";
        input.dispatchEvent(new (window as any).Event("input", { bubbles: true }));
      }
    });

    // Save
    const saveBtn = container.querySelector("[data-testid='playlist-rename-save-btn']") as HTMLButtonElement;
    await act(async () => {
      saveBtn.click();
    });

    expect(renamePlaylist).toHaveBeenCalledWith("pl_1", "chill vibes");
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
  });

  it("opens delete confirm modal and calls deletePlaylist on confirm", async () => {
    const deletePlaylist = mock(async () => true);
    usePlayerStore.setState({ deletePlaylist } as any);

    await act(async () => {
      root.render(<PlaylistHeader playlist={mockPlaylist} items={mockItems} />);
    });

    const deleteBtn = container.querySelector("[data-testid='playlist-delete-btn']") as HTMLButtonElement;
    expect(deleteBtn).not.toBeNull();

    await act(async () => {
      deleteBtn.click();
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

    const coverBtn = container.querySelector("[data-testid='playlist-cover-btn']") as HTMLButtonElement;
    expect(coverBtn).not.toBeNull();

    await act(async () => {
      coverBtn.click();
    });

    // 1. Set track as cover
    const trackOption = document.body.querySelector("[data-testid='cover-option-track_1']") as HTMLElement;
    expect(trackOption).not.toBeNull();

    await act(async () => {
      trackOption.click();
    });

    expect(setPlaylistCover).toHaveBeenCalledWith("pl_1", "track_1");

    // 2. Open again and reset to auto mosaic
    await act(async () => {
      coverBtn.click();
    });

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

    // Rename and cover buttons should be hidden for mix playlist
    expect(container.querySelector("[data-testid='playlist-rename-btn']")).toBeNull();
    expect(container.querySelector("[data-testid='playlist-toolbar-rename-btn']")).toBeNull();
    expect(container.querySelector("[data-testid='playlist-cover-btn']")).toBeNull();
    expect(container.querySelector("[data-testid='playlist-cover-hover-btn']")).toBeNull();

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

    const breadcrumb = container.querySelector("[aria-label='Breadcrumb']");
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

  it("renders sub-playlists pill bar on root playlist and allows switching to child", async () => {
    const setActivePlaylist = mock(async () => {});
    const parentPlaylist: Playlist & { item_count: number } = {
      id: "pl_root",
      name: "Parent List",
      created_at: 1,
      updated_at: 1,
      item_count: 10,
    };

    usePlayerStore.setState({
      playlists: [
        parentPlaylist,
        { id: "pl_c1", name: "Sub 1", parent_id: "pl_root", created_at: 2, updated_at: 2, item_count: 3 },
        { id: "pl_c2", name: "Sub 2", parent_id: "pl_root", created_at: 3, updated_at: 3, item_count: 7 },
      ],
      setActivePlaylist,
    } as any);

    await act(async () => {
      root.render(<PlaylistHeader playlist={parentPlaylist} items={mockItems} />);
    });

    const pillBar = container.querySelector("[data-testid='sub-playlists-bar']");
    expect(pillBar).not.toBeNull();
    expect(pillBar?.textContent).toContain("Sub 1");
    expect(pillBar?.textContent).toContain("Sub 2");

    const pill1 = container.querySelector("[data-testid='sub-playlist-pill-pl_c1']") as HTMLButtonElement;
    expect(pill1).not.toBeNull();

    await act(async () => {
      pill1.click();
    });

    expect(setActivePlaylist).toHaveBeenCalledWith("pl_c1");
  });
});

