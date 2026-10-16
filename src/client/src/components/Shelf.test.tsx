import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Shelf } from "./Shelf";
import i18n from "../i18n";

describe("Shelf", () => {
  let root: Root;
  let container: HTMLElement;

  beforeEach(async () => {
    await i18n.changeLanguage("en");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        <Shelf title="Heavy Rotation" listClassName="shelf-columns-2">
          {["One", "Two", "Three"].map((name) => (
            <li key={name}>{name}</li>
          ))}
        </Shelf>
      );
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const button = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  // Lays the list out `width` wide over `scrollWidth` of items, scrolled to `scrollLeft`, as a browser would report it
  const layOut = (width: number, scrollWidth: number, scrollLeft: number) =>
    act(async () => {
      const list = container.querySelector("ul")!;
      Object.defineProperties(list, {
        clientWidth: { configurable: true, value: width },
        scrollWidth: { configurable: true, value: scrollWidth },
        scrollLeft: { configurable: true, value: scrollLeft },
      });
      list.dispatchEvent(new window.Event("scroll"));
    });

  it("has no paging while everything fits", async () => {
    await layOut(600, 600, 0);

    expect(button("Next page of Heavy Rotation") === null).toBe(true);
  });

  it("pages sideways by the width its items show in, as far as it goes", async () => {
    const list = container.querySelector("ul")!;
    // Records how far each page goes rather than scrolling
    const paged: (number | undefined)[] = [];
    Object.defineProperty(list, "scrollBy", { configurable: true, value: (options: ScrollToOptions) => paged.push(options.left) });
    // It scrolls out into the page's side margins, which a page leaves out
    list.style.paddingLeft = "24px";
    list.style.paddingRight = "24px";
    await layOut(648, 1500, 0);

    expect(button("Previous page of Heavy Rotation")?.disabled).toBe(true);
    await act(async () => button("Next page of Heavy Rotation")?.click());
    expect(paged).toEqual([600]);

    await layOut(648, 1500, 852);
    expect(button("Next page of Heavy Rotation")?.disabled).toBe(true);
    await act(async () => button("Previous page of Heavy Rotation")?.click());
    expect(paged).toEqual([600, -600]);
  });
});
