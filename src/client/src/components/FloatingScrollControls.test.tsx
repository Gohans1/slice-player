import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GlobalWindow } from "happy-dom";
import "../i18n";
import { FloatingScrollControls } from "./FloatingScrollControls";

describe("FloatingScrollControls Component", () => {
  let container: HTMLDivElement;
  let root: Root;
  let happyWindow: GlobalWindow;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    happyWindow = new GlobalWindow();
    (happyWindow as any).requestAnimationFrame = (cb: any) => setTimeout(cb, 0);
    (happyWindow as any).cancelAnimationFrame = (id: any) => clearTimeout(id);
    (globalThis as any).window = happyWindow;
    (globalThis as any).document = happyWindow.document;
    (globalThis as any).HTMLElement = happyWindow.HTMLElement;
    (globalThis as any).HTMLButtonElement = happyWindow.HTMLButtonElement;

    container = happyWindow.document.createElement("div") as unknown as HTMLDivElement;
    happyWindow.document.body.appendChild(container as any);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  // React commits a render when its act() scope ends, and the controls measure the page one frame
  // after that, assuming the top until then; this lets that frame run
  const measurePage = () =>
    act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

  it("renders scroll to top and scroll to bottom buttons with accessible labels", () => {
    act(() => {
      root.render(<FloatingScrollControls />);
    });

    const topBtn = container.querySelector('[data-testid="scroll-to-top"]') as HTMLButtonElement | null;
    const bottomBtn = container.querySelector('[data-testid="scroll-to-bottom"]') as HTMLButtonElement | null;

    expect(topBtn).not.toBeNull();
    expect(bottomBtn).not.toBeNull();
    expect(topBtn?.getAttribute("aria-label")).toBeTruthy();
    expect(bottomBtn?.getAttribute("aria-label")).toBeTruthy();
  });

  it("disables the button for whichever end of the page is already showing", async () => {
    Object.defineProperty(happyWindow.document.documentElement, "scrollHeight", { value: 12500, configurable: true });
    Object.defineProperty(happyWindow, "innerHeight", { value: 800, configurable: true });
    Object.defineProperty(happyWindow, "scrollY", { value: 0, configurable: true, writable: true });

    await act(async () => {
      root.render(<FloatingScrollControls />);
    });
    await measurePage();

    const topBtn = container.querySelector('[data-testid="scroll-to-top"]') as HTMLButtonElement;
    const bottomBtn = container.querySelector('[data-testid="scroll-to-bottom"]') as HTMLButtonElement;
    expect(topBtn.disabled).toBe(true);
    expect(bottomBtn.disabled).toBe(false);

    await act(async () => {
      (happyWindow as any).scrollY = 12500 - 800;
      happyWindow.dispatchEvent(new happyWindow.Event("scroll"));
    });
    await measurePage();

    expect(topBtn.disabled).toBe(false);
    expect(bottomBtn.disabled).toBe(true);
  });

  it("re-measures when the page grows without scrolling", async () => {
    // Library rows render after the controls mount, which changes the page height but fires no scroll event
    const resizeCallbacks: Array<() => void> = [];
    const OriginalResizeObserver = globalThis.ResizeObserver;
    (globalThis as any).ResizeObserver = class {
      constructor(callback: () => void) {
        resizeCallbacks.push(callback);
      }
      observe() {}
      disconnect() {}
    };
    try {
      Object.defineProperty(happyWindow.document.documentElement, "scrollHeight", { value: 800, configurable: true });
      Object.defineProperty(happyWindow, "innerHeight", { value: 800, configurable: true });

      await act(async () => {
        root.render(<FloatingScrollControls />);
      });
      await measurePage();
      const bottomBtn = container.querySelector('[data-testid="scroll-to-bottom"]') as HTMLButtonElement;
      expect(bottomBtn.disabled).toBe(true);

      Object.defineProperty(happyWindow.document.documentElement, "scrollHeight", { value: 12500, configurable: true });
      await act(async () => {
        resizeCallbacks.forEach((callback) => callback());
      });
      await measurePage();

      expect(bottomBtn.disabled).toBe(false);
    } finally {
      globalThis.ResizeObserver = OriginalResizeObserver;
    }
  });

  it("clicking scroll to bottom invokes window.scrollTo towards document height", async () => {
    let scrollToArgs: any = null;
    happyWindow.scrollTo = ((options: any) => {
      scrollToArgs = options;
    }) as any;

    // Mock document scrollHeight
    Object.defineProperty(happyWindow.document.documentElement, "scrollHeight", {
      value: 12500,
      configurable: true,
    });

    await act(async () => {
      root.render(<FloatingScrollControls />);
    });

    const bottomBtn = container.querySelector('[data-testid="scroll-to-bottom"]') as HTMLButtonElement;
    await act(async () => {
      bottomBtn.click();
      await new Promise((r) => setTimeout(r, 650));
    });

    expect(scrollToArgs).not.toBeNull();
    expect(scrollToArgs.top).toBeGreaterThanOrEqual(12500);
  });

  it("clicking scroll to top from large scroll offset drives scroll to 0 via RAF without aborting", async () => {
    let lastScrollToTop = -1;
    let currentY = 50000;

    happyWindow.scrollTo = ((options: any) => {
      const top = typeof options === "object" ? options.top : options;
      lastScrollToTop = top;
      currentY = top;
    }) as any;

    Object.defineProperty(happyWindow, "scrollY", {
      get: () => currentY,
      configurable: true,
    });

    await act(async () => {
      root.render(<FloatingScrollControls />);
    });
    await measurePage();

    const topBtn = container.querySelector('[data-testid="scroll-to-top"]') as HTMLButtonElement;
    await act(async () => {
      topBtn.click();
      await new Promise((r) => setTimeout(r, 650));
    });

    expect(lastScrollToTop).toBe(0);
  });

  it("aborts smooth scroll animation immediately when user triggers a wheel event", async () => {
    let currentY = 20000;
    const recordedScrollTops: number[] = [];

    happyWindow.scrollTo = ((options: any) => {
      const top = typeof options === "object" ? options.top : options;
      recordedScrollTops.push(top);
      currentY = top;
    }) as any;

    Object.defineProperty(happyWindow, "scrollY", {
      get: () => currentY,
      configurable: true,
    });

    await act(async () => {
      root.render(<FloatingScrollControls />);
    });
    await measurePage();

    const topBtn = container.querySelector('[data-testid="scroll-to-top"]') as HTMLButtonElement;
    await act(async () => {
      topBtn.click();
      await new Promise((r) => setTimeout(r, 30));
      happyWindow.dispatchEvent(new happyWindow.Event("wheel"));
      await new Promise((r) => setTimeout(r, 650));
    });

    const recordedCount = recordedScrollTops.length;
    // The animation started before the wheel stopped it
    expect(recordedCount).toBeGreaterThan(0);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    // Animation did not continue after wheel event was dispatched
    expect(recordedScrollTops.length).toBe(recordedCount);
  });
});
