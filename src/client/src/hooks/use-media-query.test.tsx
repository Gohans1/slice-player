import { describe, it, expect, afterEach } from "bun:test";
import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { useMediaQuery } from "./use-media-query";
import { happyWindow } from "../test/dom";

const setViewportWidth = (width: number) => happyWindow.happyDOM.setViewport({ width });

function Probe({ query }: { query: string }) {
  return <output>{String(useMediaQuery(query))}</output>;
}

describe("useMediaQuery", () => {
  afterEach(() => setViewportWidth(1024));

  it("follows the query as the viewport resizes", async () => {
    setViewportWidth(1024);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => root.render(<Probe query="(min-width: 1280px)" />));
    expect(container.textContent).toBe("false");

    await act(async () => setViewportWidth(1400));
    expect(container.textContent).toBe("true");

    await act(async () => setViewportWidth(1100));
    expect(container.textContent).toBe("false");

    await act(async () => root.unmount());
    container.remove();
  });
});
