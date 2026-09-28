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

  it("clicking scroll to top invokes window.scrollTo with top: 0", () => {
    let scrollToArgs: any = null;
    happyWindow.scrollTo = ((options: any) => {
      scrollToArgs = options;
    }) as any;

    act(() => {
      root.render(<FloatingScrollControls />);
    });

    const topBtn = container.querySelector('[data-testid="scroll-to-top"]') as HTMLButtonElement;
    act(() => {
      topBtn.click();
    });

    expect(scrollToArgs).not.toBeNull();
    expect(scrollToArgs.top).toBe(0);
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

    const topBtn = container.querySelector('[data-testid="scroll-to-top"]') as HTMLButtonElement;
    await act(async () => {
      topBtn.click();
      await new Promise((r) => setTimeout(r, 30));
      happyWindow.dispatchEvent(new happyWindow.Event("wheel"));
      await new Promise((r) => setTimeout(r, 650));
    });

    const recordedCount = recordedScrollTops.length;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    // Animation did not continue after wheel event was dispatched
    expect(recordedScrollTops.length).toBe(recordedCount);
  });
});
