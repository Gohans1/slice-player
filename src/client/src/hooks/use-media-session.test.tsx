import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useMediaSession } from "./use-media-session";
import { usePlayerStore } from "../store/usePlayerStore";
import { createDefaultFullSegment } from "../lib/utils";
import type { Segment, Track } from "@/server/types";

// happy-dom has no Media Session, so the browser side is a fake that records what the app tells it
class FakeMediaSession {
  metadata: MediaMetadataInit | null = null;
  playbackState: MediaSessionPlaybackState = "none";
  handlers = new Map<MediaSessionAction, MediaSessionActionHandler | null>();
  setActionHandler(action: MediaSessionAction, handler: MediaSessionActionHandler | null) {
    this.handlers.set(action, handler);
  }
}

class FakeMediaMetadata {
  title = "";
  artist = "";
  artwork: MediaImage[] = [];
  constructor(init: MediaMetadataInit) {
    Object.assign(this, init);
  }
}

const track: Track = {
  id: "trk_session",
  source_type: "youtube",
  source_uri: "https://www.youtube.com/watch?v=session",
  title: "Session Song",
  artist: "Session Artist",
  duration: 200,
  status: "ready",
  thumbnail_url: "https://i.ytimg.com/vi/session/maxresdefault.jpg",
  volume: 0.5,
};

const slice: Segment = { id: "seg_chorus", track_id: track.id, name: "Chorus", start_time: 30, end_time: 60 };

function Probe() {
  useMediaSession();
  return null;
}

const { pause: originalPause, resume: originalResume, nextSegment: originalNext, prevSegment: originalPrev } = usePlayerStore.getState();

describe("useMediaSession", () => {
  let container: HTMLDivElement;
  let root: Root;
  let session: FakeMediaSession;

  const play = (state: Partial<ReturnType<typeof usePlayerStore.getState>>) => act(async () => usePlayerStore.setState(state));

  beforeEach(async () => {
    session = new FakeMediaSession();
    Object.defineProperty(navigator, "mediaSession", { value: session, configurable: true });
    Object.assign(globalThis, { MediaMetadata: FakeMediaMetadata });
    usePlayerStore.setState({ activeTrack: null, activeSegment: null, isPlaying: false });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<Probe />));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    Reflect.deleteProperty(navigator, "mediaSession");
    Reflect.deleteProperty(globalThis, "MediaMetadata");
    usePlayerStore.setState({
      activeTrack: null,
      activeSegment: null,
      isPlaying: false,
      pause: originalPause,
      resume: originalResume,
      nextSegment: originalNext,
      prevSegment: originalPrev,
    });
  });

  it("shows the playing track with its artist and cover", async () => {
    await play({ activeTrack: track, activeSegment: createDefaultFullSegment(track), isPlaying: true });

    expect(session.metadata).toMatchObject({
      title: "Session Song",
      artist: "Session Artist",
      artwork: [{ src: "https://i.ytimg.com/vi/session/maxresdefault.jpg" }],
    });
    expect(session.playbackState).toBe("playing");
  });

  it("names the slice in place of the artist, as the player bar does", async () => {
    await play({ activeTrack: track, activeSegment: slice, isPlaying: true });

    expect(session.metadata).toMatchObject({ title: "Session Song", artist: "Chorus" });
  });

  it("reports a pause, and clears everything once nothing is loaded", async () => {
    await play({ activeTrack: track, activeSegment: slice, isPlaying: false });
    expect(session.playbackState).toBe("paused");

    await play({ activeTrack: null, activeSegment: null });
    expect(session.metadata).toBeNull();
    expect(session.playbackState).toBe("none");
  });

  it("lets the OS media controls and media keys drive the player", async () => {
    const pause = mock(() => {});
    const resume = mock(async () => {});
    const nextSegment = mock(() => {});
    const prevSegment = mock(() => {});
    await play({ activeTrack: track, activeSegment: slice, pause, resume, nextSegment, prevSegment });

    const press = (action: MediaSessionAction) => session.handlers.get(action)?.({ action });
    press("play");
    press("pause");
    press("nexttrack");
    press("previoustrack");

    expect(resume).toHaveBeenCalledTimes(1);
    expect(pause).toHaveBeenCalledTimes(1);
    expect(nextSegment).toHaveBeenCalledTimes(1);
    expect(prevSegment).toHaveBeenCalledTimes(1);
  });
});
