import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { GlobalWindow } from "happy-dom";
import { VolumeSlider } from "./VolumeSlider";

describe("VolumeSlider Component", () => {
  let window: any;
  let container: HTMLDivElement;
  let root: any;

  beforeEach(() => {
    window = new GlobalWindow();
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    (globalThis as any).window = window;
    (globalThis as any).document = window.document;
    (globalThis as any).Node = window.Node;
    (globalThis as any).Element = window.Element;
    (globalThis as any).HTMLElement = window.HTMLElement;
    (globalThis as any).HTMLInputElement = window.HTMLInputElement;
    (globalThis as any).Event = window.Event;
    (globalThis as any).KeyboardEvent = window.KeyboardEvent;
    (globalThis as any).PointerEvent = window.PointerEvent;

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
    delete (globalThis as any).HTMLInputElement;
    delete (globalThis as any).Event;
    delete (globalThis as any).KeyboardEvent;
    delete (globalThis as any).PointerEvent;
  });

  it("defaults to 50 when value is undefined", () => {
    act(() => {
      root.render(<VolumeSlider />);
    });

    const input = container.querySelector("input") as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.value).toBe("0.5");
    expect(input.getAttribute("aria-valuenow")).toBe("50");
    expect(input.getAttribute("aria-valuetext")).toBe("50%");

    const tooltip = container.querySelector('[data-testid="volume-slider-tooltip"]');
    expect(tooltip).not.toBeNull();
    expect(tooltip?.textContent).toContain("50");
  });

  it("reflects given value correctly (e.g. 0.85 -> 85)", () => {
    act(() => {
      root.render(<VolumeSlider value={0.85} />);
    });

    const input = container.querySelector("input") as HTMLInputElement;
    expect(input.value).toBe("0.85");
    expect(input.getAttribute("aria-valuenow")).toBe("85");
    expect(input.getAttribute("aria-valuetext")).toBe("85%");

    const tooltip = container.querySelector('[data-testid="volume-slider-tooltip"]');
    expect(tooltip?.textContent).toContain("85");
  });

  it("shows tooltip on pointerdown (drag start) and drop feedback on pointerup (drop)", async () => {
    act(() => {
      root.render(<VolumeSlider value={0.5} />);
    });

    const input = container.querySelector("input") as HTMLInputElement;
    const tooltip = container.querySelector('[data-testid="volume-slider-tooltip"]') as HTMLDivElement;

    // Initially not active
    expect(tooltip.classList.contains("opacity-0")).toBe(true);

    // Trigger drag start (pointerdown with button 0)
    act(() => {
      const pointerDownEvent = new window.PointerEvent("pointerdown", { button: 0, bubbles: true, cancelable: true });
      input.dispatchEvent(pointerDownEvent);
    });

    expect(tooltip.classList.contains("opacity-100")).toBe(true);
    expect(tooltip.textContent).toContain("50");

    // Trigger drop (pointerup on window)
    act(() => {
      const pointerUpEvent = new window.PointerEvent("pointerup", { button: 0, bubbles: true, cancelable: true });
      window.dispatchEvent(pointerUpEvent);
    });

    // Should retain visible drop feedback
    expect(tooltip.classList.contains("opacity-100")).toBe(true);
  });

  it("calls onChange callback when input value changes", () => {
    let changedValue = -1;
    act(() => {
      root.render(
        <VolumeSlider
          value={0.5}
          onChange={(val) => {
            changedValue = val;
          }}
        />
      );
    });

    const input = container.querySelector("input") as HTMLInputElement;
    act(() => {
      const propsKey = Object.keys(input).find((k) => k.startsWith("__reactProps"));
      if (propsKey) {
        (input as any)[propsKey].onChange({ target: { value: "0.72" } });
      }
    });

    expect(changedValue).toBe(0.72);
  });

  it("shows tooltip on keyboard arrow interaction", () => {
    act(() => {
      root.render(<VolumeSlider value={0.5} />);
    });

    const input = container.querySelector("input") as HTMLInputElement;
    const tooltip = container.querySelector('[data-testid="volume-slider-tooltip"]') as HTMLDivElement;

    act(() => {
      input.focus();
      const keyEvent = new window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true });
      input.dispatchEvent(keyEvent);
    });

    expect(tooltip.classList.contains("opacity-100")).toBe(true);
  });

  it("ignores non-primary pointerdown buttons", () => {
    act(() => {
      root.render(<VolumeSlider value={0.5} />);
    });

    const input = container.querySelector("input") as HTMLInputElement;
    const tooltip = container.querySelector('[data-testid="volume-slider-tooltip"]') as HTMLDivElement;

    // Right click
    act(() => {
      const pointerDownEvent = new window.PointerEvent("pointerdown", { button: 2, bubbles: true });
      input.dispatchEvent(pointerDownEvent);
    });

    expect(tooltip.classList.contains("opacity-0")).toBe(true);
  });

  it("cleans up active drag listeners on unmount without errors", () => {
    act(() => {
      root.render(<VolumeSlider value={0.5} />);
    });

    const input = container.querySelector("input") as HTMLInputElement;

    act(() => {
      const pointerDownEvent = new window.PointerEvent("pointerdown", { button: 0, bubbles: true });
      input.dispatchEvent(pointerDownEvent);
    });

    // Unmount mid-drag
    act(() => {
      root.unmount();
    });

    // Dispatch window pointerup after unmount
    expect(() => {
      const pointerUpEvent = new window.PointerEvent("pointerup", { button: 0, bubbles: true });
      window.dispatchEvent(pointerUpEvent);
    }).not.toThrow();
  });

  it("respects disabled attribute and does not show tooltip on drag", () => {
    act(() => {
      root.render(<VolumeSlider value={0.5} disabled />);
    });

    const input = container.querySelector("input") as HTMLInputElement;
    const tooltip = container.querySelector('[data-testid="volume-slider-tooltip"]') as HTMLDivElement;

    expect(input.disabled).toBe(true);

    act(() => {
      const pointerDownEvent = new window.PointerEvent("pointerdown", { button: 0, bubbles: true });
      input.dispatchEvent(pointerDownEvent);
    });

    expect(tooltip.classList.contains("opacity-0")).toBe(true);
  });
});
