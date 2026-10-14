import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useHeightCssVar } from "./use-height-css-var";

// happy-dom has no layout, so heights come from a data attribute
const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight")!;

function Bar({ height }: { height: number }) {
  const ref = useHeightCssVar("--test-bar-height");
  // A different element per height, like a bar that swaps its idle and active layouts
  return height > 60 ? <footer ref={ref} data-height={height} /> : <div ref={ref} data-height={height} />;
}

const published = () => document.documentElement.style.getPropertyValue("--test-bar-height");

describe("useHeightCssVar", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get(this: HTMLElement) {
        return Number(this.dataset.height ?? 0);
      },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", offsetHeight);
    document.documentElement.style.removeProperty("--test-bar-height");
  });

  it("publishes the element height as a CSS variable on the root element", async () => {
    await act(async () => root.render(<Bar height={91} />));

    expect(published()).toBe("91px");
  });

  it("follows the element when the component swaps to a different one", async () => {
    await act(async () => root.render(<Bar height={91} />));
    await act(async () => root.render(<Bar height={49} />));

    expect(published()).toBe("49px");
  });

  it("removes the variable when the element unmounts", async () => {
    await act(async () => root.render(<Bar height={91} />));
    await act(async () => root.render(<></>));

    expect(published()).toBe("");
  });
});
