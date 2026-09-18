import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";

if (typeof globalThis.Audio === "undefined" || !(globalThis.Audio.prototype as any)?.removeAttribute) {
  (globalThis as any).Audio = class {
    crossOrigin = "";
    preload = "";
    currentTime = 0;
    src = "";
    addEventListener() {}
    removeEventListener() {}
    pause() {}
    play() {
      return Promise.resolve();
    }
    load() {}
    removeAttribute(attr: string) {
      if (attr === "src") this.src = "";
    }
  };
}

import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { GlobalWindow } from "happy-dom";
import { PlaylistItemCardComponent } from "./PlaylistItemCard";
import type { Track, Segment, PlaylistItemWithDetails } from "@/server/types";

const dummyTrack: Track = {
  id: "trk_card_1",
  source_type: "youtube",
  source_uri: "yt_card_1",
  title: "Card Test Track",
  artist: "Card Artist",
  duration: 180,
  thumbnail_url: "https://example.com/thumb.jpg",
  status: "ready",
  volume: 0.5,
};

const dummySegment: Segment = {
  id: "seg_card_1",
  track_id: "trk_card_1",
  name: "Card Slice 1",
  start_time: 10,
  end_time: 50,
  created_at: 1000,
};

const dummyPlaylistItem: PlaylistItemWithDetails = {
  id: "pli_card_1",
  playlist_id: "pl_card_1",
  track_id: "trk_card_1",
  segment_id: "seg_card_1",
  sort_order: 0,
  added_at: 1000,
  track: dummyTrack,
  segment: dummySegment,
};

describe("PlaylistItemCardComponent", () => {
  let window: InstanceType<typeof GlobalWindow>;
  let document: Document;
  let container: HTMLDivElement;
  let root: any;

  beforeEach(() => {
    window = new GlobalWindow();
    document = window.document as unknown as Document;
    (globalThis as any).window = window;
    (globalThis as any).document = document;
    (globalThis as any).navigator = window.navigator;

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("renders AddToPlaylist button in playlist item card", async () => {
    await act(async () => {
      root.render(
        <PlaylistItemCardComponent
          item={dummyPlaylistItem}
          index={0}
          onPlay={mock()}
          onDelete={mock()}
        />
      );
    });

    const addButtons = container.querySelectorAll("button[title='Thêm vào danh sách'], button[title='Add to Playlist']");
    expect(addButtons.length).toBe(1);
  });
});
