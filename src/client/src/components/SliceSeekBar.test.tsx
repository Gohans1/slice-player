import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SliceSeekBar } from "./SliceSeekBar";
import { usePlayerStore, type Segment } from "../store/usePlayerStore";
import i18n from "../i18n";

// A 50 second slice that starts 100 seconds into its track
const segment: Segment = { id: "seg_1", track_id: "trk_1", name: "Chorus", start_time: 100, end_time: 150 };

describe("SliceSeekBar", () => {
  let container: HTMLDivElement;
  let root: Root;
  let originalState: ReturnType<typeof usePlayerStore.getState>;
  const seek = mock((_time: number) => {});
  const pause = mock(() => {});
  const resume = mock(() => {});
  const togglePlay = mock(() => {});

  beforeEach(async () => {
    await i18n.changeLanguage("en");
    originalState = usePlayerStore.getState();
    for (const fn of [seek, pause, resume, togglePlay]) fn.mockClear();
    usePlayerStore.setState({ currentTime: 110, isPlaying: true, seek, pause, resume, togglePlay } as any);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    usePlayerStore.setState(originalState, true);
  });

  const renderBar = async () => {
    await act(async () => {
      root.render(<SliceSeekBar segment={segment} />);
    });
    return container.querySelector<HTMLInputElement>('input[type="range"]');
  };

  const press = async (target: HTMLElement | null, key: string) => {
    await act(async () => {
      target?.focus();
      target?.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    });
  };

  it("labels the slider with the position inside the slice", async () => {
    const input = await renderBar();

    expect(input?.getAttribute("aria-label")).toBe("Seek slice");
    expect(input?.getAttribute("aria-valuetext")).toBe("00:10.0 / 00:50.0");
    expect(container.textContent).toContain("00:10.0");
    expect(container.textContent).toContain("00:50.0");
  });

  it("seeks by 5% of the slice with the arrow keys", async () => {
    const input = await renderBar();

    await press(input, "ArrowRight");
    expect(seek).toHaveBeenLastCalledWith(112.5);

    await press(input, "ArrowLeft");
    expect(seek).toHaveBeenLastCalledWith(107.5);
  });

  it("jumps to the start with Home and stops just short of the end with End", async () => {
    const input = await renderBar();

    await press(input, "Home");
    expect(seek).toHaveBeenLastCalledWith(100);

    await press(input, "End");
    // Seeking exactly to the end would skip to the next slice
    expect(seek.mock.calls.at(-1)?.[0]).toBeCloseTo(149.95, 5);
  });

  it("toggles playback with Space", async () => {
    const input = await renderBar();

    await press(input, " ");

    expect(togglePlay).toHaveBeenCalledTimes(1);
    expect(seek).not.toHaveBeenCalled();
  });

  it("pauses while scrubbing, seeks on release and resumes playback", async () => {
    await renderBar();
    const control = container.querySelector('[data-slot="slider-track"]')?.parentElement;
    Object.defineProperty(control, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 0, right: 100, top: 0, bottom: 10, width: 100, height: 10, x: 0, y: 0, toJSON: () => {} }),
    });

    await act(async () => {
      control?.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, clientX: 40, clientY: 5 }));
    });
    expect(pause).toHaveBeenCalledTimes(1);
    expect(seek).not.toHaveBeenCalled();
    // The labels follow the finger before the seek happens
    expect(container.textContent).toContain("00:20.0");

    await act(async () => {
      document.dispatchEvent(new window.PointerEvent("pointerup", { bubbles: true, button: 0, clientX: 40, clientY: 5 }));
    });
    expect(seek).toHaveBeenLastCalledWith(120);
    expect(resume).toHaveBeenCalledTimes(1);
  });
});
