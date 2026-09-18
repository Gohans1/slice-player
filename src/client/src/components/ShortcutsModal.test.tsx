import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GlobalWindow } from "happy-dom";
import { ShortcutsModal } from "./ShortcutsModal";
import i18n from "../i18n";

describe("ShortcutsModal Component", () => {
  let happyWindow: any;
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    await i18n.changeLanguage("en");
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    happyWindow = new GlobalWindow();
    (globalThis as any).window = happyWindow;
    (globalThis as any).document = happyWindow.document;
    (globalThis as any).KeyboardEvent = happyWindow.KeyboardEvent;
    (globalThis as any).HTMLElement = happyWindow.HTMLElement;

    container = happyWindow.document.createElement("div") as unknown as HTMLDivElement;
    happyWindow.document.body.appendChild(container);
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
    delete (globalThis as any).KeyboardEvent;
    delete (globalThis as any).HTMLElement;
  });

  it("renders keyboard shortcuts when open", () => {
    act(() => {
      root.render(<ShortcutsModal isOpen={true} onClose={() => {}} />);
    });

    expect(container.textContent).toContain("Keyboard Shortcuts");
    expect(container.textContent).toContain("Playback Controls");
    expect(container.textContent).toContain("Space");
    expect(container.textContent).toContain("Slice Studio");
  });

  it("does not render when closed", () => {
    act(() => {
      root.render(<ShortcutsModal isOpen={false} onClose={() => {}} />);
    });

    expect(container.textContent).toBe("");
  });

  it("calls onClose when close button is clicked", () => {
    let closed = false;
    act(() => {
      root.render(<ShortcutsModal isOpen={true} onClose={() => { closed = true; }} />);
    });

    const closeBtn = Array.from(container.querySelectorAll("button")).find(
      (btn) => btn.textContent?.includes("Close")
    );
    expect(closeBtn).toBeDefined();

    act(() => {
      closeBtn?.click();
    });

    expect(closed).toBe(true);
  });
});
