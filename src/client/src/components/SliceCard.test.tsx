import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { GlobalWindow } from "happy-dom";
import { SliceCard } from "./SliceCard";
import type { Track, Segment } from "@/server/types";
import i18n from "../i18n";

describe("SliceCard Component", () => {
  let window: any;
  let container: any;
  let root: any;

  beforeEach(async () => {
    await i18n.changeLanguage("en");
    window = new GlobalWindow();
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    (globalThis as any).window = window;
    (globalThis as any).document = window.document;
    (globalThis as any).Node = window.Node;
    (globalThis as any).Element = window.Element;
    (globalThis as any).HTMLElement = window.HTMLElement;
    (globalThis as any).HTMLImageElement = window.HTMLImageElement;

    container = window.document.createElement("div");
    window.document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
    delete (globalThis as any).window;
    delete (globalThis as any).document;
    delete (globalThis as any).Node;
    delete (globalThis as any).Element;
    delete (globalThis as any).HTMLElement;
    delete (globalThis as any).HTMLImageElement;
  });

  const baseTrack: Track = {
    id: "trk_1",
    source_type: "youtube",
    source_uri: "https://www.youtube.com/watch?v=123",
    title: "Test Track",
    artist: "Artist Name",
    duration: 200,
    thumbnail_url: "",
    status: "ready",
    volume: 0.5,
  };

  const baseSegment: Segment = {
    id: "seg_1",
    track_id: "trk_1",
    name: "Chorus Slice",
    start_time: 10,
    end_time: 35,
  };

  it("renders segment name, track title, and delete button when onDelete is provided", () => {
    const onDelete = mock(() => {});
    act(() => {
      root.render(
        <SliceCard
          segment={baseSegment}
          track={baseTrack}
          index={0}
          onPlay={() => {}}
          onOpenStudio={() => {}}
          onDelete={onDelete}
        />
      );
    });

    expect(container.textContent).toContain("Chorus Slice");
    expect(container.textContent).toContain("Test Track");

    const deleteBtn = container.querySelector('button[title="Delete slice"]');
    expect(deleteBtn).not.toBeNull();

    act(() => {
      deleteBtn.click();
    });

    expect(onDelete).toHaveBeenCalledWith("seg_1");
  });

  it("does not render delete button when onDelete is omitted", () => {
    act(() => {
      root.render(
        <SliceCard
          segment={baseSegment}
          track={baseTrack}
          index={0}
          onPlay={() => {}}
          onOpenStudio={() => {}}
        />
      );
    });

    const deleteBtn = container.querySelector('button[title="Delete slice"]');
    expect(deleteBtn).toBeNull();
  });

  it("triggers onPlay and onOpenStudio when respective buttons are clicked", () => {
    const onPlay = mock(() => {});
    const onOpenStudio = mock(() => {});
    act(() => {
      root.render(
        <SliceCard
          segment={baseSegment}
          track={baseTrack}
          index={0}
          onPlay={onPlay}
          onOpenStudio={onOpenStudio}
        />
      );
    });

    const studioBtn = container.querySelector('button[title="Open Slice Studio"]');
    expect(studioBtn).not.toBeNull();
    act(() => {
      studioBtn.click();
    });
    expect(onOpenStudio).toHaveBeenCalledTimes(1);

    const playBtn = container.querySelector('button[title=\'Play slice "Chorus Slice"\']');
    expect(playBtn).not.toBeNull();
    act(() => {
      playBtn.click();
    });
    expect(onPlay).toHaveBeenCalledTimes(1);
  });
});
