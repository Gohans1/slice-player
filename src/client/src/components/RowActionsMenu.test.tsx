import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import * as React from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createAppRoot } from "../test/app-root";
import { RowActionsMenu } from "./RowActionsMenu";
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
