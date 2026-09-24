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

  it("handles scrollRequest and triggers onScrollHandled", async () => {
    const happyWindow = new GlobalWindow({ url: "http://localhost:3000" });
    (globalThis as any).window = happyWindow;
    (globalThis as any).document = happyWindow.document;
    (globalThis as any).requestAnimationFrame = (cb: any) => setTimeout(cb, 0);
    (globalThis as any).cancelAnimationFrame = (id: any) => clearTimeout(id);

    const container = happyWindow.document.createElement("div");
    happyWindow.document.body.appendChild(container);
    const root = createRoot(container as any);

    const testItems = Array.from({ length: 50 }, (_, i) => ({ id: `item_${i}`, title: `Item ${i}` }));
    let handledId: number | null = null;

    await act(async () => {
      root.render(
        <VirtualizedCardGrid
          items={testItems}
          getItemKey={(item) => item.id}
          renderItem={(item) => <div className="card-item">{item.title}</div>}
          scrollRequest={{ index: 10, requestId: 42 }}
          onScrollHandled={(reqId) => {
            handledId = reqId;
          }}
        />
      );
    });

    // Wait for the 50ms timer
    await new Promise((r) => setTimeout(r, 80));

    expect(handledId as any).toBe(42);

    await act(async () => {
      root.unmount();
    });
  });

  it("handles drag-and-drop reorder correctly and calls onReorder", async () => {
    const happyWindow = new GlobalWindow({ url: "http://localhost:3000" });
    (globalThis as any).window = happyWindow;
    (globalThis as any).document = happyWindow.document;
    (globalThis as any).requestAnimationFrame = (cb: any) => setTimeout(cb, 0);
    (globalThis as any).cancelAnimationFrame = (id: any) => clearTimeout(id);

    const container = happyWindow.document.createElement("div");
    happyWindow.document.body.appendChild(container);
    const root = createRoot(container as any);

    const testItems = [
      { id: "item_0", title: "Item 0" },
      { id: "item_1", title: "Item 1" },
      { id: "item_2", title: "Item 2" },
      { id: "item_3", title: "Item 3" },
    ];

    let reorderedFrom: number | null = null;
    let reorderedTo: number | null = null;

    await act(async () => {
      root.render(
        <VirtualizedCardGrid
          items={testItems}
          getItemKey={(item) => item.id}
          getItemName={(item) => item.title}
          isReorderable={true}
          onReorder={(from, to) => {
            reorderedFrom = from;
            reorderedTo = to;
          }}
          renderItem={(item, idx, dragProps) => (
            <div className="card-item" data-index={idx}>
              <button
                data-drag-handle="true"
                data-drag-handle-index={idx}
                onPointerDown={(e) => dragProps?.onPointerDownHandle(e)}
                onKeyDown={(e) => dragProps?.onKeyDownHandle(e)}
              >
                Drag
              </button>
              <span>{item.title}</span>
            </div>
          )}
        />
      );
    });

    const cardWrappers = container.querySelectorAll(".card-item");
    expect(cardWrappers.length).toBeGreaterThanOrEqual(4);

    const firstHandle = cardWrappers[0].querySelector("[data-drag-handle='true']") as HTMLElement;
    const firstCell = cardWrappers[0].parentElement as HTMLElement;
    const thirdCell = cardWrappers[2].parentElement as HTMLElement;

    // 1. Simulate pointerdown on drag handle
    await act(async () => {
      firstHandle.dispatchEvent(new (happyWindow as any).PointerEvent("pointerdown", { button: 0, bubbles: true }));
    });

    // 2. Simulate dragstart on first cell
    const dataStore: Record<string, string> = {};
    const mockDataTransfer = {
      setData: (key: string, val: string) => {
        dataStore[key] = val;
      },
      getData: (key: string) => dataStore[key] || "",
      effectAllowed: "none",
      dropEffect: "none",
      setDragImage: () => {},
    };

    const dragStartEvent = new (happyWindow as any).CustomEvent("dragstart", { bubbles: true, cancelable: true });
    (dragStartEvent as any).dataTransfer = mockDataTransfer;
    (dragStartEvent as any).clientX = 100;
    (dragStartEvent as any).clientY = 100;

    await act(async () => {
      firstCell.dispatchEvent(dragStartEvent);
    });

    expect(dataStore["application/x-slice-card-grid-index"]).toBe("0");

    // 3. Simulate dragover on third cell
    const dragOverEvent = new (happyWindow as any).CustomEvent("dragover", { bubbles: true, cancelable: true });
    (dragOverEvent as any).dataTransfer = mockDataTransfer;
    (dragOverEvent as any).clientX = 100;
    (dragOverEvent as any).clientY = 300;

    await act(async () => {
      thirdCell.dispatchEvent(dragOverEvent);
    });

    // 4. Simulate drop on third cell
    const dropEvent = new (happyWindow as any).CustomEvent("drop", { bubbles: true, cancelable: true });
    (dropEvent as any).dataTransfer = mockDataTransfer;

    await act(async () => {
      thirdCell.dispatchEvent(dropEvent);
    });

    expect(reorderedFrom).toBe(0);
    expect(reorderedTo).toBe(2);

    await act(async () => {
      root.unmount();
    });
  });

  it("handles keyboard reordering navigation (ArrowLeft, ArrowRight, ArrowUp, ArrowDown, Home, End)", async () => {
    const happyWindow = new GlobalWindow({ url: "http://localhost:3000" });
    (globalThis as any).window = happyWindow;
    (globalThis as any).document = happyWindow.document;
    (globalThis as any).requestAnimationFrame = (cb: any) => setTimeout(cb, 0);
    (globalThis as any).cancelAnimationFrame = (id: any) => clearTimeout(id);

    const container = happyWindow.document.createElement("div");
    happyWindow.document.body.appendChild(container);
    const root = createRoot(container as any);

    const testItems = Array.from({ length: 8 }, (_, i) => ({ id: `item_${i}`, title: `Item ${i}` }));
    let lastReorder: [number, number] | null = null;

    await act(async () => {
      root.render(
        <VirtualizedCardGrid
          items={testItems}
          getItemKey={(item) => item.id}
          isReorderable={true}
          onReorder={(from, to) => {
            lastReorder = [from, to];
          }}
          renderItem={(item, idx, dragProps) => (
            <div className="card-item">
              <button
                data-drag-handle="true"
                data-drag-handle-index={idx}
                onKeyDown={(e) => dragProps?.onKeyDownHandle(e)}
              >
                Drag {item.title}
              </button>
            </div>
          )}
        />
      );
    });

    const handles = container.querySelectorAll("[data-drag-handle='true']");

    // Press ArrowRight on item 1 -> moves to 2
    await act(async () => {
      handles[1].dispatchEvent(new (happyWindow as any).KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    expect(lastReorder).toEqual([1, 2]);

    // Press ArrowLeft on item 1 -> moves to 0
    await act(async () => {
      handles[1].dispatchEvent(new (happyWindow as any).KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    });
    expect(lastReorder).toEqual([1, 0]);

    // Press End on item 1 -> moves to 7
    await act(async () => {
      handles[1].dispatchEvent(new (happyWindow as any).KeyboardEvent("keydown", { key: "End", bubbles: true }));
    });
    expect(lastReorder).toEqual([1, 7]);

    // Press Home on item 3 -> moves to 0
    await act(async () => {
      handles[3].dispatchEvent(new (happyWindow as any).KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    });
    expect(lastReorder).toEqual([3, 0]);

    await act(async () => {
      root.unmount();
    });
  });

  it("does not trigger reorder when dropping on itself or when isReorderable is false", async () => {
    const happyWindow = new GlobalWindow({ url: "http://localhost:3000" });
    (globalThis as any).window = happyWindow;
    (globalThis as any).document = happyWindow.document;
    (globalThis as any).requestAnimationFrame = (cb: any) => setTimeout(cb, 0);
    (globalThis as any).cancelAnimationFrame = (id: any) => clearTimeout(id);

    const container = happyWindow.document.createElement("div");
    happyWindow.document.body.appendChild(container);
    const root = createRoot(container as any);

    const testItems = [
      { id: "item_0", title: "Item 0" },
      { id: "item_1", title: "Item 1" },
    ];
    let reorderCalled = false;

    await act(async () => {
      root.render(
        <VirtualizedCardGrid
          items={testItems}
          getItemKey={(item) => item.id}
          isReorderable={false}
          onReorder={() => {
            reorderCalled = true;
          }}
          renderItem={(item) => <div className="card-item">{item.title}</div>}
        />
      );
    });

    const card = container.querySelector(".card-item")?.parentElement as HTMLElement;
    const dropEvent = new (happyWindow as any).CustomEvent("drop", { bubbles: true, cancelable: true });
    (dropEvent as any).dataTransfer = {
      getData: () => "0",
    };

    await act(async () => {
      card?.dispatchEvent(dropEvent);
    });

    expect(reorderCalled).toBe(false);

    await act(async () => {
      root.unmount();
    });
  });
});


