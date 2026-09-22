import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GlobalWindow } from "happy-dom";
import "../i18n";
import { App } from "../App";
import { usePlayerStore } from "../store/usePlayerStore";
import type { Track } from "@/server/types";

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

describe("Error Category Retry All & BeforeUnload Warning", () => {
  let container: HTMLDivElement;
  let root: Root;
  let happyWindow: GlobalWindow;
  let originalFetch: typeof globalThis.fetch;

  const mockErrorTracks: Track[] = [
    {
      id: "err_1",
      source_type: "youtube",
      source_uri: "https://www.youtube.com/watch?v=err1",
      title: "Error Song 1",
      artist: "Artist 1",
      duration: 180,
      status: "error",
      error_message: "Network error",
      thumbnail_url: "",
      volume: 0.5,
      created_at: 1000,
    },
    {
      id: "err_2",
      source_type: "youtube",
      source_uri: "https://www.youtube.com/watch?v=err2",
      title: "Error Song 2",
      artist: "Artist 2",
      duration: 200,
      status: "error",
      error_message: "Process timeout",
      thumbnail_url: "",
      volume: 0.5,
      created_at: 2000,
    },
  ];

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    happyWindow = new GlobalWindow();
    (globalThis as any).window = happyWindow;
    (globalThis as any).document = happyWindow.document;
    (globalThis as any).KeyboardEvent = happyWindow.KeyboardEvent;
    (globalThis as any).HTMLElement = happyWindow.HTMLElement;
    (globalThis as any).HTMLButtonElement = happyWindow.HTMLButtonElement;
    (globalThis as any).Event = happyWindow.Event;

    container = happyWindow.document.createElement("div") as unknown as HTMLDivElement;
    happyWindow.document.body.appendChild(container as any);
    root = createRoot(container);

    originalFetch = globalThis.fetch;
    globalThis.fetch = ((url: any) => {
      const urlStr = String(url);
      if (urlStr === "/api/tracks") {
        return Promise.resolve(new Response(JSON.stringify(mockErrorTracks), { status: 200 }));
      }
      if (urlStr === "/api/playlists") {
        return Promise.resolve(new Response("[]", { status: 200 }));
      }
      if (urlStr === "/api/segments") {
        return Promise.resolve(new Response("[]", { status: 200 }));
      }
      if (urlStr === "/api/tracks/retry-all") {
        return Promise.resolve(new Response(JSON.stringify({ success: true, requeued: 2 }), { status: 200 }));
      }
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as any;

    usePlayerStore.setState({
      tracks: mockErrorTracks,
      activeSystemCategory: "error_only",
      activePlaylistId: null,
      viewMode: "grid",
      isRetryingAll: false,
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    globalThis.fetch = originalFetch;
  });

  it("renders Retry All button in error_only view and triggers retryAllErrors on click", async () => {
    let retryAllCalled = false;
    globalThis.fetch = ((url: any, options?: RequestInit) => {
      const urlStr = String(url);
      if (urlStr === "/api/tracks/retry-all" && options?.method === "POST") {
        retryAllCalled = true;
        return Promise.resolve(new Response(JSON.stringify({ success: true, requeued: 2 }), { status: 200 }));
      }
      if (urlStr === "/api/tracks") {
        return Promise.resolve(new Response(JSON.stringify(mockErrorTracks), { status: 200 }));
      }
      return Promise.resolve(new Response("[]", { status: 200 }));
    }) as any;

    await act(async () => {
      root.render(<App />);
    });

    const retryBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Retry All") || b.textContent?.includes("Thử lại tất cả")
    );
    expect(retryBtn).toBeDefined();
    expect(retryBtn?.textContent).toContain("2");

    await act(async () => {
      retryBtn?.click();
    });

    expect(retryAllCalled).toBe(true);
  });

  it("triggers beforeunload warning when downloads are active", async () => {
    const activeDlTracks: Track[] = [
      {
        id: "dl_1",
        source_type: "youtube",
        source_uri: "https://www.youtube.com/watch?v=dl1",
        title: "Downloading Song",
        artist: "Artist",
        duration: 180,
        status: "downloading",
        thumbnail_url: "",
        volume: 0.5,
      },
    ];

    globalThis.fetch = ((url: any) => {
      const urlStr = String(url);
      if (urlStr === "/api/tracks") {
        return Promise.resolve(new Response(JSON.stringify(activeDlTracks), { status: 200 }));
      }
      return Promise.resolve(new Response("[]", { status: 200 }));
    }) as any;

    usePlayerStore.setState({
      tracks: activeDlTracks,
      activeSystemCategory: "mixed",
    });

    await act(async () => {
      root.render(<App />);
    });

    const beforeUnloadEvent = new (happyWindow as any).Event("beforeunload", {
      cancelable: true,
    }) as BeforeUnloadEvent;

    let preventDefaultCalled = false;
    beforeUnloadEvent.preventDefault = () => {
      preventDefaultCalled = true;
    };

    happyWindow.dispatchEvent(beforeUnloadEvent as any);

    expect(preventDefaultCalled).toBe(true);
    expect(beforeUnloadEvent.returnValue).toBe("");
  });

  it("does NOT trigger beforeunload warning when no downloads are active", async () => {
    usePlayerStore.setState({
      tracks: [
        {
          id: "ready_1",
          source_type: "youtube",
          source_uri: "https://www.youtube.com/watch?v=ready1",
          title: "Ready Song",
          artist: "Artist",
          duration: 180,
          status: "ready",
          thumbnail_url: "",
          volume: 0.5,
        },
      ],
      activeSystemCategory: "mixed",
    });

    await act(async () => {
      root.render(<App />);
    });

    const beforeUnloadEvent = new (happyWindow as any).Event("beforeunload", {
      cancelable: true,
    }) as BeforeUnloadEvent;

    let preventDefaultCalled = false;
    beforeUnloadEvent.preventDefault = () => {
      preventDefaultCalled = true;
    };

    expect(preventDefaultCalled).toBe(false);
  });

  it("disables button and shows retrying text when isRetryingAll is true", async () => {
    usePlayerStore.setState({
      tracks: mockErrorTracks,
      activeSystemCategory: "error_only",
      isRetryingAll: true,
    });

    await act(async () => {
      root.render(<App />);
    });

    const retryBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Retrying") || b.textContent?.includes("Đang thử lại")
    );
    expect(retryBtn).toBeDefined();
    expect(retryBtn?.disabled).toBe(true);
  });

  it("triggers beforeunload warning when isRetryingAll is true even without downloading tracks", async () => {
    usePlayerStore.setState({
      tracks: mockErrorTracks,
      activeSystemCategory: "error_only",
      isRetryingAll: true,
    });

    await act(async () => {
      root.render(<App />);
    });

    const beforeUnloadEvent = new (happyWindow as any).Event("beforeunload", {
      cancelable: true,
    }) as BeforeUnloadEvent;

    let preventDefaultCalled = false;
    beforeUnloadEvent.preventDefault = () => {
      preventDefaultCalled = true;
    };

    happyWindow.dispatchEvent(beforeUnloadEvent as any);

    expect(preventDefaultCalled).toBe(true);
  });
});
