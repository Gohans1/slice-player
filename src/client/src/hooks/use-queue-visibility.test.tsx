import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useQueueVisibility } from "./use-queue-visibility";
import { happyWindow } from "../test/dom";

const setViewportWidth = (width: number) => happyWindow.happyDOM.setViewport({ width });

function Probe() {
  const queue = useQueueVisibility();
  return (
    <>
      <output>{JSON.stringify({ isDocked: queue.isDocked, isOpen: queue.isOpen })}</output>
      <button data-action="toggle" onClick={queue.toggle} />
      <button data-action="close" onClick={queue.close} />
    </>
  );
}

describe("useQueueVisibility", () => {
  let container: HTMLDivElement;
  let root: Root;

  const state = () => JSON.parse(container.querySelector("output")?.textContent ?? "null");
  const press = (action: string) =>
    act(async () => {
      container.querySelector<HTMLButtonElement>(`button[data-action="${action}"]`)?.click();
    });
  const resize = (width: number) => act(async () => setViewportWidth(width));

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    setViewportWidth(1024);
  });

  it("docks the queue open beside the library on wide screens", async () => {
    setViewportWidth(1400);
    await act(async () => root.render(<Probe />));
    expect(state()).toEqual({ isDocked: true, isOpen: true });

    await press("toggle");
    expect(state()).toEqual({ isDocked: true, isOpen: false });

    await press("toggle");
    await press("close");
    expect(state()).toEqual({ isDocked: true, isOpen: false });
  });

  it("opens the queue as an overlay on narrow screens only when asked", async () => {
    setViewportWidth(1024);
    await act(async () => root.render(<Probe />));
    expect(state()).toEqual({ isDocked: false, isOpen: false });

    await press("toggle");
    expect(state()).toEqual({ isDocked: false, isOpen: true });

    await press("close");
    expect(state()).toEqual({ isDocked: false, isOpen: false });
  });

  it("drops the overlay once the screen is wide enough to dock, keeping the docked choice", async () => {
    // happy-dom's MediaQueryList assumes the query starts unmatched and misses a first
    // matched-to-unmatched change, so start narrow
    setViewportWidth(1024);
    await act(async () => root.render(<Probe />));
    await press("toggle");
    expect(state()).toEqual({ isDocked: false, isOpen: true });

    await resize(1400);
    expect(state()).toEqual({ isDocked: true, isOpen: true });
    await press("toggle");
    expect(state()).toEqual({ isDocked: true, isOpen: false });

    // The overlay does not pop back open when the screen narrows again
    await resize(1024);
    expect(state()).toEqual({ isDocked: false, isOpen: false });

    await resize(1400);
    expect(state()).toEqual({ isDocked: true, isOpen: false });
  });
});
