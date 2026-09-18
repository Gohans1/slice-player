import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { GlobalWindow } from "happy-dom";
import { TrackCard } from "./TrackCard";
import type { Track } from "@/server/types";
import i18n from "../i18n";

describe("TrackCard Component - Status & Thumbnail Indicators", () => {
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
    id: "yt_test1",
    source_type: "youtube",
    source_uri: "https://www.youtube.com/watch?v=test1",
    title: "Test Track In Queue",
    artist: "Artist Name",
    duration: 180,
    thumbnail_url: "https://i.ytimg.com/vi/test1/maxresdefault.jpg",
    status: "queued",
    volume: 0.5,
  };

  it("renders 'Queued...' overlay and badge when track status is queued", () => {
    act(() => {
      root.render(<TrackCard track={baseTrack} onDelete={() => {}} />);
    });

    const textContent = container.textContent || "";
    expect(textContent).toContain("Queued...");
    expect(textContent).toContain("In download queue");
    expect(textContent).not.toContain("Slice");
  });

  it("renders 'Downloading audio...' overlay and badge when track status is downloading", () => {
    const downloadingTrack: Track = { ...baseTrack, status: "downloading" };
    act(() => {
      root.render(<TrackCard track={downloadingTrack} onDelete={() => {}} />);
    });

    const textContent = container.textContent || "";
    expect(textContent).toContain("Downloading audio...");
    expect(textContent).not.toContain("Slice");
  });

  it("renders error overlay and retry button when track status is error", () => {
    const errorTrack: Track = {
      ...baseTrack,
      status: "error",
      error_message: "Network unreachable",
    };
    act(() => {
      root.render(<TrackCard track={errorTrack} onDelete={() => {}} />);
    });

    const textContent = container.textContent || "";
    expect(textContent).toContain("Download failed");
    expect(textContent).toContain("Network unreachable");
    expect(textContent).toContain("Retry");
  });

  it("renders ready state with active buttons and without queue/downloading overlays", () => {
    const readyTrack: Track = { ...baseTrack, status: "ready" };
    act(() => {
      root.render(<TrackCard track={readyTrack} onDelete={() => {}} />);
    });

    const textContent = container.textContent || "";
    expect(textContent).toContain("Slice");
    expect(textContent).not.toContain("Queued...");
    expect(textContent).not.toContain("Downloading audio...");
  });

  it("renders active playing equalizer badge and border when current track is playing", async () => {
    const { usePlayerStore } = await import("../store/usePlayerStore");
    const readyTrack: Track = { ...baseTrack, status: "ready" };

    act(() => {
      usePlayerStore.setState({
        isPlaying: true,
        activeTrack: readyTrack,
      });
      root.render(<TrackCard track={readyTrack} onDelete={() => {}} />);
    });

    const textContent = container.textContent || "";
    expect(textContent).toContain("Playing");

    // Clean up store state inside act
    act(() => {
      usePlayerStore.setState({
        isPlaying: false,
        activeTrack: null,
      });
    });
  });
});
