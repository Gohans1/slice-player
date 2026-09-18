import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { GlobalWindow } from "happy-dom";
import type { Track, Segment } from "@/server/types";

// Mock WaveSurfer and RegionsPlugin
let capturedOptions: any = null;
const eventHandlers: Record<string, Function[]> = {};

const mockPlayPause = mock(async () => {});
const mockDestroy = mock(() => {});
const mockSetVolume = mock((_vol?: number) => {});
const mockSeekTo = mock(() => {});
const mockSetTime = mock((_time?: number) => {});
const mockZoom = mock((_px?: number) => {});
const mockGetCurrentTime = mock(() => 15);
const mockGetDuration = mock(() => 120);
const mockWsOn = mock((event: string, cb: Function) => {
  if (!eventHandlers[event]) {
    eventHandlers[event] = [];
  }
  eventHandlers[event].push(cb);
  return () => {};
});

mock.module("wavesurfer.js", () => {
  return {
    default: {
      create: mock((options: any) => {
        capturedOptions = options;
        return {
          playPause: mockPlayPause,
          destroy: mockDestroy,
          setVolume: mockSetVolume,
          seekTo: mockSeekTo,
          setTime: mockSetTime,
          zoom: mockZoom,
          isPlaying: () => false,
          getCurrentTime: mockGetCurrentTime,
          getDuration: mockGetDuration,
          on: mockWsOn,
        };
      }),
    },
  };
});

mock.module("wavesurfer.js/dist/plugins/regions.esm.js", () => {
  return {
    default: {
      create: mock(() => ({
        on: mock(() => {}),
        unAll: mock(() => {}),
        getRegions: mock(() => []),
        addRegion: mock(() => {}),
      })),
    },
  };
});

// Import SliceStudio and usePlayerStore after mocking
import { SliceStudio } from "./SliceStudio";
import { usePlayerStore } from "../store/usePlayerStore";
import { audioEngine } from "../lib/audio";

describe("SliceStudio Keyboard & Playback Interactions", () => {
  let window: any;
  let container: HTMLDivElement;
  let root: any;
  let originalFetch: any;

  const mockTrack: Track = {
    id: "test-track-1",
    title: "Test Track",
    artist: "Test Artist",
    duration: 120,
    source_type: "youtube",
    source_uri: "https://youtube.com/watch?v=123",
    status: "ready",
    volume: 0.5,
    peaks_json: JSON.stringify([0.1, 0.2, 0.3]),
    thumbnail_url: "",
    file_path: undefined,
    error_message: null,
    created_at: 0,
  };

  beforeEach(() => {
    window = new GlobalWindow();
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    (globalThis as any).window = window;
    (globalThis as any).document = window.document;
    (globalThis as any).Node = window.Node;
    (globalThis as any).Element = window.Element;
    (globalThis as any).HTMLElement = window.HTMLElement;
    (globalThis as any).HTMLInputElement = window.HTMLInputElement;
    (globalThis as any).HTMLButtonElement = window.HTMLButtonElement;
    (globalThis as any).HTMLSelectElement = window.HTMLSelectElement;
    (globalThis as any).HTMLTextAreaElement = window.HTMLTextAreaElement;
    (globalThis as any).Event = window.Event;
    (globalThis as any).KeyboardEvent = window.KeyboardEvent;
    (globalThis as any).PointerEvent = window.PointerEvent;

    capturedOptions = null;
    for (const key of Object.keys(eventHandlers)) {
      delete eventHandlers[key];
    }

    originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async (url: string) => {
      if (typeof url === "string" && url.includes("/segments")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response(JSON.stringify(mockTrack), { status: 200 });
    }) as any;

    container = window.document.createElement("div");
    window.document.body.appendChild(container);
    root = createRoot(container);
    mockPlayPause.mockClear();
    mockSetVolume.mockClear();
    mockSeekTo.mockClear();
    mockDestroy.mockClear();
    mockGetCurrentTime.mockClear();
    mockGetDuration.mockClear();
    usePlayerStore.setState({
      tracks: [{ ...mockTrack }],
      sliceStudioTrack: null,
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    globalThis.fetch = originalFetch;
    delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
    delete (globalThis as any).window;
    delete (globalThis as any).document;
    delete (globalThis as any).Node;
    delete (globalThis as any).Element;
    delete (globalThis as any).HTMLElement;
    delete (globalThis as any).HTMLInputElement;
    delete (globalThis as any).HTMLButtonElement;
    delete (globalThis as any).HTMLSelectElement;
    delete (globalThis as any).HTMLTextAreaElement;
    delete (globalThis as any).Event;
    delete (globalThis as any).KeyboardEvent;
    delete (globalThis as any).PointerEvent;
  });

  it("configures WaveSurfer with dragToSeek enabled", async () => {
    const handleClose = mock(() => {});
    await act(async () => {
      root.render(<SliceStudio track={mockTrack} onClose={handleClose} />);
    });

    expect(capturedOptions).not.toBeNull();
    expect(capturedOptions.dragToSeek).toBe(true);
  });

  it("toggles wave play/pause when Space key is pressed outside inputs", async () => {
    const handleClose = mock(() => {});
    await act(async () => {
      root.render(<SliceStudio track={mockTrack} onClose={handleClose} />);
    });

    const spaceEvent = new window.KeyboardEvent("keydown", {
      code: "Space",
      key: " ",
      bubbles: true,
      cancelable: true,
    });

    await act(async () => {
      window.document.dispatchEvent(spaceEvent);
    });

    expect(mockPlayPause).toHaveBeenCalledTimes(1);
    expect(spaceEvent.defaultPrevented).toBe(true);
  });

  it("ignores repeated Space key events (e.repeat === true)", async () => {
    const handleClose = mock(() => {});
    await act(async () => {
      root.render(<SliceStudio track={mockTrack} onClose={handleClose} />);
    });

    const repeatSpaceEvent = new window.KeyboardEvent("keydown", {
      code: "Space",
      key: " ",
      repeat: true,
      bubbles: true,
      cancelable: true,
    });

    await act(async () => {
      window.document.dispatchEvent(repeatSpaceEvent);
    });

    expect(mockPlayPause).toHaveBeenCalledTimes(0);
    expect(repeatSpaceEvent.defaultPrevented).toBe(false);
  });

  it("ignores Space key with modifier keys (ctrlKey, altKey, metaKey, shiftKey)", async () => {
    const handleClose = mock(() => {});
    await act(async () => {
      root.render(<SliceStudio track={mockTrack} onClose={handleClose} />);
    });

    for (const mod of ["ctrlKey", "altKey", "metaKey", "shiftKey"] as const) {
      const event = new window.KeyboardEvent("keydown", {
        code: "Space",
        key: " ",
        [mod]: true,
        bubbles: true,
        cancelable: true,
      });

      await act(async () => {
        window.document.dispatchEvent(event);
      });

      expect(mockPlayPause).toHaveBeenCalledTimes(0);
      expect(event.defaultPrevented).toBe(false);
    }
  });

  it("ignores Space key when e.isComposing is true (IME input)", async () => {
    const handleClose = mock(() => {});
    await act(async () => {
      root.render(<SliceStudio track={mockTrack} onClose={handleClose} />);
    });

    const imeEvent = new window.KeyboardEvent("keydown", {
      code: "Space",
      key: " ",
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(imeEvent, "isComposing", { value: true, writable: false });

    await act(async () => {
      window.document.dispatchEvent(imeEvent);
    });

    expect(mockPlayPause).toHaveBeenCalledTimes(0);
    expect(imeEvent.defaultPrevented).toBe(false);
  });

  it("ignores Space key when e.defaultPrevented is true", async () => {
    const handleClose = mock(() => {});
    await act(async () => {
      root.render(<SliceStudio track={mockTrack} onClose={handleClose} />);
    });

    const preventedEvent = new window.KeyboardEvent("keydown", {
      code: "Space",
      key: " ",
      bubbles: true,
      cancelable: true,
    });
    preventedEvent.preventDefault();

    await act(async () => {
      window.document.dispatchEvent(preventedEvent);
    });

    expect(mockPlayPause).toHaveBeenCalledTimes(0);
  });

  it("does not intercept Space key when target is interactive element (button, select, input, textarea, summary, ARIA roles)", async () => {
    const handleClose = mock(() => {});
    await act(async () => {
      root.render(<SliceStudio track={mockTrack} onClose={handleClose} />);
    });

    const elements = [
      window.document.createElement("input"),
      window.document.createElement("textarea"),
      window.document.createElement("button"),
      window.document.createElement("select"),
      window.document.createElement("summary"),
    ];

    const roles = ["button", "menuitem", "checkbox", "switch", "radio", "tab", "combobox", "option", "slider", "textbox"];
    for (const role of roles) {
      const el = window.document.createElement("div");
      el.setAttribute("role", role);
      elements.push(el);
    }

    const editable = window.document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    elements.push(editable);

    for (const el of elements) {
      window.document.body.appendChild(el);

      const spaceEvent = new window.KeyboardEvent("keydown", {
        code: "Space",
        key: " ",
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(spaceEvent, "target", { value: el, writable: false });

      await act(async () => {
        window.document.dispatchEvent(spaceEvent);
      });

      expect(mockPlayPause).toHaveBeenCalledTimes(0);
      expect(spaceEvent.defaultPrevented).toBe(false);

      el.remove();
    }
  });

  it("does not intercept Space key when target is a Text node inside a contenteditable element", async () => {
    const handleClose = mock(() => {});
    await act(async () => {
      root.render(<SliceStudio track={mockTrack} onClose={handleClose} />);
    });

    const editable = window.document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    const textNode = window.document.createTextNode("sample text");
    editable.appendChild(textNode);
    window.document.body.appendChild(editable);

    const spaceEvent = new window.KeyboardEvent("keydown", {
      code: "Space",
      key: " ",
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(spaceEvent, "target", { value: textNode, writable: false });

    await act(async () => {
      window.document.dispatchEvent(spaceEvent);
    });

    expect(mockPlayPause).toHaveBeenCalledTimes(0);
    expect(spaceEvent.defaultPrevented).toBe(false);

    editable.remove();
  });

  it("does not intercept Space key when document.activeElement is an interactive element even if target is document.body", async () => {
    const handleClose = mock(() => {});
    await act(async () => {
      root.render(<SliceStudio track={mockTrack} onClose={handleClose} />);
    });

    const button = window.document.createElement("button");
    window.document.body.appendChild(button);
    button.focus();
    Object.defineProperty(window.document, "activeElement", { value: button, configurable: true });

    const spaceEvent = new window.KeyboardEvent("keydown", {
      code: "Space",
      key: " ",
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(spaceEvent, "target", { value: window.document.body, writable: false });

    await act(async () => {
      window.document.dispatchEvent(spaceEvent);
    });

    expect(mockPlayPause).toHaveBeenCalledTimes(0);
    expect(spaceEvent.defaultPrevented).toBe(false);

    button.remove();
    Object.defineProperty(window.document, "activeElement", { value: window.document.body, configurable: true });
  });

  it("recognizes legacy Spacebar key name", async () => {
    const handleClose = mock(() => {});
    await act(async () => {
      root.render(<SliceStudio track={mockTrack} onClose={handleClose} />);
    });

    const spacebarEvent = new window.KeyboardEvent("keydown", {
      key: "Spacebar",
      bubbles: true,
      cancelable: true,
    });

    await act(async () => {
      window.document.dispatchEvent(spacebarEvent);
    });

    expect(mockPlayPause).toHaveBeenCalledTimes(1);
    expect(spacebarEvent.defaultPrevented).toBe(true);
  });

  it("updates playhead and clears preview on direct waveform click interaction", async () => {
    const handleClose = mock(() => {});
    await act(async () => {
      root.render(<SliceStudio track={mockTrack} onClose={handleClose} />);
    });

    const interactionHandlers = eventHandlers["interaction"] || [];
    expect(interactionHandlers.length).toBeGreaterThan(0);

    await act(async () => {
      interactionHandlers[0](45);
    });

    expect(container.textContent).toContain("00:45");
  });

  it("cleans up keydown listener upon unmount", async () => {
    const handleClose = mock(() => {});
    await act(async () => {
      root.render(<SliceStudio track={mockTrack} onClose={handleClose} />);
    });

    await act(async () => {
      root.unmount();
    });

    const spaceEvent = new window.KeyboardEvent("keydown", {
      code: "Space",
      key: " ",
      bubbles: true,
      cancelable: true,
    });

    window.document.dispatchEvent(spaceEvent);
    expect(mockPlayPause).toHaveBeenCalledTimes(0);
  });

  it("handles realistic WaveSurfer drag scrubbing sequence without playhead oscillation", async () => {
    const handleClose = mock(() => {});
    await act(async () => {
      root.render(<SliceStudio track={mockTrack} onClose={handleClose} />);
    });

    const dragStartHandlers = eventHandlers["dragstart"] || [];
    const interactionHandlers = eventHandlers["interaction"] || [];
    const dragHandlers = eventHandlers["drag"] || [];
    const dragEndHandlers = eventHandlers["dragend"] || [];
    const timeUpdateHandlers = eventHandlers["timeupdate"] || [];

    expect(dragStartHandlers.length).toBeGreaterThan(0);
    expect(dragHandlers.length).toBeGreaterThan(0);
    expect(dragEndHandlers.length).toBeGreaterThan(0);

    // 1. User starts dragging at 25% (30s)
    await act(async () => {
      dragStartHandlers[0]();
    });

    // 2. WaveSurfer emits interaction first (with stale audio time in ws.getCurrentTime() => 15)
    await act(async () => {
      interactionHandlers[0](30);
    });

    // 3. WaveSurfer emits drag(0.25)
    await act(async () => {
      dragHandlers[0](0.25);
    });

    expect(container.textContent).toContain("00:30");

    // 4. Stale interaction tick during drag must be ignored and not stomp playhead back to 15s
    await act(async () => {
      interactionHandlers[0](); // calls ws.getCurrentTime() => 15
    });

    expect(container.textContent).toContain("00:30");

    // 5. timeupdate during drag must be ignored
    await act(async () => {
      timeUpdateHandlers[0](15);
    });

    expect(container.textContent).toContain("00:30");

    // 6. User drags further to 75% (90s) and releases pointer
    await act(async () => {
      dragHandlers[0](0.75);
      dragEndHandlers[0](0.75);
    });

    expect(container.textContent).toContain("01:30");
    // Verify seekTo is called upon release to immediately synchronize audio engine
    expect(mockSeekTo).toHaveBeenCalledWith(0.75);

    // 7. Normal timeupdate resumes updating playhead after dragging ends
    await act(async () => {
      timeUpdateHandlers[0](95);
    });

    expect(container.textContent).toContain("01:35");
  });

  it("calls onClose when Escape key is pressed", async () => {
    const handleClose = mock(() => {});
    await act(async () => {
      root.render(<SliceStudio track={mockTrack} onClose={handleClose} />);
    });

    const escapeEvent = new window.KeyboardEvent("keydown", {
      key: "Escape",
      code: "Escape",
      bubbles: true,
      cancelable: true,
    });

    await act(async () => {
      window.document.dispatchEvent(escapeEvent);
    });

    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it("synchronizes WaveSurfer volume using quadratic curve volumeToGain (0.5 -> 0.25)", async () => {
    const handleClose = mock(() => {});
    await act(async () => {
      root.render(<SliceStudio track={mockTrack} onClose={handleClose} />);
    });

    // mockTrack has volume: 0.5. With quadratic curve (0.5^2), WaveSurfer should receive 0.25
    expect(mockSetVolume).toHaveBeenCalledWith(0.25);
  });

  it("toggles mute and restores previous volume on second click", async () => {
    const handleClose = mock(() => {});
    await act(async () => {
      root.render(<SliceStudio track={mockTrack} onClose={handleClose} />);
    });

    const muteBtn = (container.querySelector("button[aria-label='Mute'], button[aria-label='Tắt âm']") ||
      container.querySelector("button[aria-label*='Mute' i]")) as HTMLButtonElement;
    expect(muteBtn).not.toBeNull();

    // Click mute
    await act(async () => {
      muteBtn.click();
    });

    expect((mockSetVolume.mock.calls as any[]).at(-1)?.[0]).toBe(0);

    // Unmute
    const unmuteBtn = (container.querySelector("button[aria-label='Unmute'], button[aria-label='Bật âm thanh']") ||
      container.querySelector("button[aria-label*='Unmute' i]")) as HTMLButtonElement;
    expect(unmuteBtn).not.toBeNull();
    await act(async () => {
      unmuteBtn.click();
    });

    expect((mockSetVolume.mock.calls as any[]).at(-1)?.[0]).toBeCloseTo(0.25, 4);
  });

  it("updates volume when volume slider is dragged", async () => {
    const handleClose = mock(() => {});
    await act(async () => {
      root.render(<SliceStudio track={mockTrack} onClose={handleClose} />);
    });

    const slider = container.querySelector("input[type='range']") as HTMLInputElement;
    expect(slider).not.toBeNull();

    await act(async () => {
      slider.value = "0.8";
      slider.dispatchEvent(new window.Event("input", { bubbles: true }));
      slider.dispatchEvent(new window.Event("change", { bubbles: true }));
    });

    // 0.8^2 = 0.64
    expect((mockSetVolume.mock.calls as any[]).at(-1)?.[0]).toBeCloseTo(0.64, 4);
  });

  it("reacts to store track updates when mounted standalone without sliceStudioTrack", async () => {
    usePlayerStore.setState({
      sliceStudioTrack: null,
      tracks: [mockTrack],
    });

    const handleClose = mock(() => {});
    await act(async () => {
      root.render(<SliceStudio track={mockTrack} onClose={handleClose} />);
    });

    // Update track in store directly
    await act(async () => {
      await usePlayerStore.getState().setTrackVolume(mockTrack.id, 0.7);
    });

    // 0.7^2 = 0.49
    expect((mockSetVolume.mock.calls as any[]).at(-1)?.[0]).toBeCloseTo(0.49, 4);
  });

  it("AudioEngine.init() resets audioEl.volume to 1.0 to prevent double attenuation", () => {
    const origAudioContext = window.AudioContext;
    const origGainNode = (audioEngine as any).volumeGainNode;
    const origAudioCtx = (audioEngine as any).audioCtx;
    const origInitialized = (audioEngine as any).isInitialized;

    try {
      window.AudioContext = class {
        createMediaElementSource() { return { connect() {} }; }
        createGain() { return { gain: { value: 1, cancelScheduledValues() {}, setValueAtTime() {} }, connect() {} }; }
        destination = {};
      };
      (audioEngine as any).isInitialized = false;
      audioEngine.setVolume(0.5);
      audioEngine.init();
      expect((audioEngine as any).audioEl.volume).toBe(1.0);
    } finally {
      window.AudioContext = origAudioContext;
      (audioEngine as any).volumeGainNode = origGainNode;
      (audioEngine as any).audioCtx = origAudioCtx;
      (audioEngine as any).isInitialized = origInitialized;
    }
  });

  it("supports zooming waveform with Zoom In, Zoom Out, and Fit toggle", async () => {
    const handleClose = mock(() => {});
    await act(async () => {
      root.render(<SliceStudio track={mockTrack} onClose={handleClose} />);
    });

    const zoomInBtn = (container.querySelector("button[aria-label*='Zoom in' i], button[aria-label*='Phóng to' i]")) as HTMLButtonElement;
    const zoomOutBtn = (container.querySelector("button[aria-label*='Zoom out' i], button[aria-label*='Thu nhỏ' i]")) as HTMLButtonElement;
    const zoomFitBtn = (container.querySelector("button[title*='Fit' i], button[title*='Vừa khung' i]")) as HTMLButtonElement;

    expect(zoomInBtn).not.toBeNull();
    expect(zoomOutBtn).not.toBeNull();
    expect(zoomFitBtn).not.toBeNull();
    expect(zoomOutBtn.disabled).toBe(true);

    // Click zoom in
    await act(async () => {
      zoomInBtn.click();
    });
    expect(mockZoom).toHaveBeenCalledWith(20);
    expect(zoomOutBtn.disabled).toBe(false);

    // Click zoom in again
    await act(async () => {
      zoomInBtn.click();
    });
    expect(mockZoom).toHaveBeenCalledWith(40);

    // Click fit to reset
    await act(async () => {
      zoomFitBtn.click();
    });
    expect(mockZoom).toHaveBeenCalledWith(0);
  });

  it("supports Ctrl + Wheel to zoom waveform", async () => {
    const handleClose = mock(() => {});
    await act(async () => {
      root.render(<SliceStudio track={mockTrack} onClose={handleClose} />);
    });

    const waveContainer = container.querySelector("div.rounded-lg.bg-background");
    expect(waveContainer).not.toBeNull();

    // Zoom in with Ctrl + Wheel
    await act(async () => {
      const wheelEvent = new window.Event("wheel", { bubbles: true, cancelable: true });
      (wheelEvent as any).ctrlKey = true;
      (wheelEvent as any).deltaY = -100;
      waveContainer?.dispatchEvent(wheelEvent);
    });
    expect(mockZoom).toHaveBeenCalledWith(20);
  });

  it("clamps Arrow keys at track boundaries (0 and duration)", async () => {
    const handleClose = mock(() => {});
    await act(async () => {
      root.render(<SliceStudio track={mockTrack} onClose={handleClose} />);
    });

    mockGetCurrentTime.mockImplementation(() => 0);
    await act(async () => {
      const event = new window.KeyboardEvent("keydown", {
        key: "ArrowLeft",
        bubbles: true,
        cancelable: true,
      });
      window.document.dispatchEvent(event);
    });
    expect(mockSetTime).toHaveBeenCalledWith(0);

    mockGetCurrentTime.mockImplementation(() => 120);
    await act(async () => {
      const event = new window.KeyboardEvent("keydown", {
        key: "ArrowRight",
        bubbles: true,
        cancelable: true,
      });
      window.document.dispatchEvent(event);
    });
    expect(mockSetTime).toHaveBeenCalledWith(120);

    mockGetCurrentTime.mockImplementation(() => 15);
  });

  it("nudges playhead forward and backward with ArrowLeft and ArrowRight", async () => {
    const handleClose = mock(() => {});
    await act(async () => {
      root.render(<SliceStudio track={mockTrack} onClose={handleClose} />);
    });

    // ArrowRight: 15 + 0.1 = 15.1
    await act(async () => {
      const event = new window.KeyboardEvent("keydown", {
        key: "ArrowRight",
        bubbles: true,
        cancelable: true,
      });
      window.document.dispatchEvent(event);
    });
    expect(mockSetTime).toHaveBeenCalledWith(15.1);

    // ArrowLeft: 15 - 0.1 = 14.9
    await act(async () => {
      const event = new window.KeyboardEvent("keydown", {
        key: "ArrowLeft",
        bubbles: true,
        cancelable: true,
      });
      window.document.dispatchEvent(event);
    });
    expect(mockSetTime).toHaveBeenCalledWith(14.9);

    // Shift + ArrowRight: 15 + 1.0 = 16.0
    await act(async () => {
      const event = new window.KeyboardEvent("keydown", {
        key: "ArrowRight",
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });
      window.document.dispatchEvent(event);
    });
    expect(mockSetTime).toHaveBeenCalledWith(16);

    // Shift + ArrowLeft: 15 - 1.0 = 14.0
    await act(async () => {
      const event = new window.KeyboardEvent("keydown", {
        key: "ArrowLeft",
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });
      window.document.dispatchEvent(event);
    });
    expect(mockSetTime).toHaveBeenCalledWith(14);
  });

  it("does not intercept Arrow keys when focused on input", async () => {
    const handleClose = mock(() => {});
    await act(async () => {
      root.render(<SliceStudio track={mockTrack} onClose={handleClose} />);
    });

    mockSetTime.mockClear();

    const input = window.document.createElement("input");
    window.document.body.appendChild(input);
    input.focus();

    await act(async () => {
      const event = new window.KeyboardEvent("keydown", {
        key: "ArrowRight",
        bubbles: true,
        cancelable: true,
      });
      input.dispatchEvent(event);
    });

    expect(mockSetTime).not.toHaveBeenCalled();
    input.remove();
  });

  it("allows Arrow keys when a button is focused and supports repeat keys", async () => {
    const handleClose = mock(() => {});
    await act(async () => {
      root.render(<SliceStudio track={mockTrack} onClose={handleClose} />);
    });

    mockSetTime.mockClear();

    const button = container.querySelector("button") as HTMLButtonElement;
    expect(button).not.toBeNull();
    button.focus();

    // ArrowRight with e.repeat = true while button is focused
    await act(async () => {
      const event = new window.KeyboardEvent("keydown", {
        key: "ArrowRight",
        repeat: true,
        bubbles: true,
        cancelable: true,
      });
      window.document.dispatchEvent(event);
    });

    expect(mockSetTime).toHaveBeenCalledWith(15.1);
  });

  it("nudges segment start and end boundaries with -0.1s and +0.1s buttons", async () => {
    const mockSegment: Segment = {
      id: "seg-nudge-1",
      track_id: "test-track-1",
      name: "Test Slice",
      start_time: 10.0,
      end_time: 20.0,
      color: "#4385BE",
    };

    globalThis.fetch = mock(async (url: string) => {
      if (typeof url === "string" && url.includes("/segments")) {
        return new Response(JSON.stringify([mockSegment]), { status: 200 });
      }
      return new Response(JSON.stringify(mockTrack), { status: 200 });
    }) as any;

    await act(async () => {
      root.render(<SliceStudio track={mockTrack} onClose={() => {}} />);
    });

    // Wait for segments to load and render
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    const nudgeButtons = Array.from(container.querySelectorAll("button")).filter(
      (b) => b.textContent === "-0.1s" || b.textContent === "+0.1s"
    );
    expect(nudgeButtons.length).toBe(4); // 2 for start, 2 for end

    // Click +0.1s on start boundary
    await act(async () => {
      nudgeButtons[1].click(); // start +0.1s
    });

    expect(container.textContent).toContain("00:10.1");

    // Click -0.1s on end boundary
    await act(async () => {
      nudgeButtons[2].click(); // end -0.1s
    });

    expect(container.textContent).toContain("00:19.9");
  });
});
