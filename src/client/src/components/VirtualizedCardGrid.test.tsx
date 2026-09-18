import { describe, it, expect, afterEach } from "bun:test";
import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { GlobalWindow } from "happy-dom";
import { VirtualizedCardGrid, useGridColumnCount } from "./VirtualizedCardGrid";

describe("VirtualizedCardGrid Component", () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const originalWindow = (globalThis as any).window;
  const originalDocument = (globalThis as any).document;
  const originalRAF = (globalThis as any).requestAnimationFrame;
  const originalCAF = (globalThis as any).cancelAnimationFrame;

  afterEach(() => {
    (globalThis as any).window = originalWindow;
    (globalThis as any).document = originalDocument;
    (globalThis as any).requestAnimationFrame = originalRAF;
    (globalThis as any).cancelAnimationFrame = originalCAF;
  });

  it("renders virtualized items and calculates rows", async () => {
    const happyWindow = new GlobalWindow({ url: "http://localhost:3000" });
    (globalThis as any).window = happyWindow;
    (globalThis as any).document = happyWindow.document;
    (globalThis as any).requestAnimationFrame = (cb: any) => setTimeout(cb, 0);
    (globalThis as any).cancelAnimationFrame = (id: any) => clearTimeout(id);

    const container = happyWindow.document.createElement("div");
    happyWindow.document.body.appendChild(container);
    const root = createRoot(container as any);

    const testItems = Array.from({ length: 50 }, (_, i) => ({ id: `item_${i}`, title: `Item ${i}` }));

    await act(async () => {
      root.render(
        <VirtualizedCardGrid
          items={testItems}
          getItemKey={(item) => item.id}
          renderItem={(item) => <div className="card-item">{item.title}</div>}
        />
      );
    });

    const cardElements = container.querySelectorAll(".card-item");
    expect(cardElements.length).toBeGreaterThan(0);

    await act(async () => {
      root.unmount();
    });
  });

  it("handles empty items array gracefully by preserving container ref", async () => {
    const happyWindow = new GlobalWindow({ url: "http://localhost:3000" });
    (globalThis as any).window = happyWindow;
    (globalThis as any).document = happyWindow.document;
    (globalThis as any).requestAnimationFrame = (cb: any) => setTimeout(cb, 0);
    (globalThis as any).cancelAnimationFrame = (id: any) => clearTimeout(id);

    const container = happyWindow.document.createElement("div");
    happyWindow.document.body.appendChild(container);
    const root = createRoot(container as any);

    await act(async () => {
      root.render(
        <VirtualizedCardGrid
          items={[]}
          getItemKey={(item: any) => item.id}
          renderItem={(item: any) => <div className="card-item">{item.id}</div>}
        />
      );
    });

    // Container is preserved for scrollMargin measurements, but 0 item cards exist
    expect(container.querySelectorAll(".card-item").length).toBe(0);
    expect(container.querySelector("[data-index]")).toBeNull();
    expect(container.children.length).toBe(1);

    await act(async () => {
      root.unmount();
    });
  });

  it("calculates column counts based on responsive breakpoints", async () => {
    const happyWindow = new GlobalWindow({ url: "http://localhost:3000" });
    (globalThis as any).window = happyWindow;
    (globalThis as any).document = happyWindow.document;
    (globalThis as any).requestAnimationFrame = (cb: any) => setTimeout(cb, 0);
    (globalThis as any).cancelAnimationFrame = (id: any) => clearTimeout(id);

    function TestColComponent() {
      const cols = useGridColumnCount();
      return <div data-testid="col-count">{cols}</div>;
    }

    const container = happyWindow.document.createElement("div");
    happyWindow.document.body.appendChild(container);
    const root = createRoot(container as any);

    happyWindow.innerWidth = 1200;
    await act(async () => {
      root.render(<TestColComponent />);
    });
    expect(container.querySelector("[data-testid='col-count']")?.textContent).toBe("4");

    await act(async () => {
      root.unmount();
    });
  });
});
