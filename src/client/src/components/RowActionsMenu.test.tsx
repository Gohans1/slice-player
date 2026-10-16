import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import * as React from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createAppRoot } from "../test/app-root";
import { RowActionsMenu, RowContextMenu } from "./RowActionsMenu";
import type { Track } from "@/server/types";
import i18n from "../i18n";

const youtubeTrack = (id: string, title: string): Track => ({
  id,
  source_type: "youtube",
  source_uri: `https://www.youtube.com/watch?v=${id}`,
  title,
  artist: "Artist Name",
  duration: 180,
  thumbnail_url: "",
  status: "ready",
  volume: 0.5,
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Two rows share the one menu that RowActionsMenuProvider mounts, as rows of a table or grid do
describe("RowActionsMenu", () => {
  let container: HTMLElement;
  let root: Root;
  const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");

  beforeEach(async () => {
    await i18n.changeLanguage("en");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createAppRoot(container);
    act(() => {
      root.render(
        <>
          <RowActionsMenu name="Song A" track={youtubeTrack("yt_a", "Song A")} canAddToPlaylist={false} />
          <RowActionsMenu name="Song B" track={youtubeTrack("yt_b", "Song B")} canAddToPlaylist={false} />
        </>
      );
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard);
  });

  const trigger = (name: string) => container.querySelector<HTMLElement>(`button[aria-label="More options for ${name}"]`)!;
  const menuItem = (label: string) =>
    Array.from(document.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]')).find((item) => item.textContent?.includes(label));

  const press = async (element: HTMLElement) => {
    await act(async () => {
      element.click();
      await sleep(20);
    });
  };

  const closeMenu = async () => {
    await act(async () => {
      (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await sleep(20);
    });
  };

  const useClipboard = (writeText: (text: string) => Promise<void>) => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  };

  it("doesn't let a copied link close the menu of a row opened right after", async () => {
    useClipboard(mock(() => Promise.resolve()));

    await press(trigger("Song A"));
    await press(menuItem("Copy YouTube link")!);
    expect(menuItem("Copied link!")).toBeDefined();
    await closeMenu();
    await press(trigger("Song B"));
    expect(trigger("Song B").getAttribute("aria-expanded")).toBe("true");

    // Past the delay after which Song A's menu would have closed itself
    await act(async () => {
      await sleep(1000);
    });

    expect(trigger("Song B").getAttribute("aria-expanded")).toBe("true");
  });

  it("doesn't mark the next row's link copied when an earlier copy finishes late", async () => {
    let finishCopy = () => {};
    useClipboard(mock(() => new Promise<void>((resolve) => (finishCopy = resolve))));

    await press(trigger("Song A"));
    await press(menuItem("Copy YouTube link")!);
    await closeMenu();
    await press(trigger("Song B"));
    await act(async () => {
      finishCopy();
      await sleep(20);
    });

    expect(menuItem("Copied link!")).toBeUndefined();
    expect(menuItem("Copy YouTube link")).toBeDefined();
  });
});

// Like Apple Music, right-clicking a song (or long-pressing it) opens the same menu as its "..." button, at the pointer
describe("RowContextMenu", () => {
  let container: HTMLElement;
  let root: Root;
  const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");

  const renderList = (options: { disabledRow?: string } = {}) => {
    act(() => {
      root.render(
        <RowContextMenu>
          <div role="row" data-testid="header-row">
            <span>Title</span>
          </div>
          {["Song A", "Song B"].map((name) => (
            <div role="row" key={name}>
              <span>{name}</span>
              <RowActionsMenu
                name={name}
                track={youtubeTrack(name === "Song A" ? "yt_a" : "yt_b", name)}
                canAddToPlaylist={false}
                disabled={options.disabledRow === name}
              />
            </div>
          ))}
          <div data-slot="media-tile">
            <span>Song C</span>
            <RowActionsMenu name="Song C" track={youtubeTrack("yt_c", "Song C")} canAddToPlaylist={false} />
          </div>
          <p data-testid="gap">Between rows</p>
        </RowContextMenu>
      );
    });
  };

  beforeEach(async () => {
    await i18n.changeLanguage("en");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createAppRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard);
  });

  const textIn = (text: string) =>
    Array.from(container.querySelectorAll<HTMLElement>("span, p")).find((element) => element.textContent === text)!;
  const rightClick = async (element: HTMLElement) => {
    await act(async () => {
      element.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: 40, clientY: 40 }));
      await sleep(20);
    });
  };
  const menuItems = () => Array.from(document.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]'));
  // Rows show their menu is open the way they do for the "..." menu
  const rowsMarkedOpen = () =>
    Array.from(container.querySelectorAll('[role="row"], [data-slot="media-tile"]'))
      .filter((row) => row.querySelector("[data-context-menu-open]"))
      .map((row) => row.querySelector("span")?.textContent);

  it("opens the menu of the row or tile under the pointer", async () => {
    const writeText = mock((_text: string) => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderList();

    await rightClick(textIn("Song B"));
    expect(menuItems().map((item) => item.textContent)).toEqual(["Copy YouTube link"]);
    expect(rowsMarkedOpen()).toEqual(["Song B"]);
    await act(async () => {
      menuItems()[0]?.click();
      await sleep(20);
    });
    expect(writeText.mock.calls.map(([text]) => text)).toEqual(["https://www.youtube.com/watch?v=yt_b"]);

    await act(async () => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await sleep(50);
    });
    expect(rowsMarkedOpen()).toEqual([]);

    await rightClick(textIn("Song C"));
    await act(async () => {
      menuItems()[0]?.click();
      await sleep(20);
    });
    expect(writeText.mock.calls.map(([text]) => text).at(-1)).toBe("https://www.youtube.com/watch?v=yt_c");
  });

  it("opens no menu outside a row, or for a row whose actions are off", async () => {
    renderList({ disabledRow: "Song A" });

    await rightClick(textIn("Title"));
    await rightClick(textIn("Between rows"));
    await rightClick(textIn("Song A"));

    expect(document.querySelector('[role="menu"]') === null).toBe(true);
  });
});
