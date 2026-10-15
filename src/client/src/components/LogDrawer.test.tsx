import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { LogDrawer } from "./LogDrawer";
import { useLogStore } from "../store/useLogStore";

describe("LogDrawer Component", () => {
  let container: any;
  let root: any;

  // The drawer renders in a portal on document.body
  const page = () => document.body;
  const drawer = () => document.querySelector<HTMLElement>('[data-drawer="log-drawer"]');
  // Focus moves into the drawer after the opening render commits
  const settle = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    useLogStore.setState({
      logs: [
        {
          id: "log_1",
          timestamp: Date.now() - 5000,
          level: "info",
          category: "download",
          message: "Đang tải video YouTube test",
        },
        {
          id: "log_2",
          timestamp: Date.now() - 2000,
          level: "error",
          category: "playback",
          message: "Lỗi phát file âm thanh",
          details: { code: 404, reason: "Not found" },
        },
        {
          id: "log_3",
          timestamp: Date.now() - 1000,
          level: "success",
          category: "system",
          message: "WebSocket đã kết nối",
        },
      ],
      unreadErrorCount: 0,
      filterCategory: "all",
      searchQuery: "",
      isDrawerOpen: true,
      autoScroll: true,
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    document.querySelectorAll("[data-test-opener]").forEach((el) => el.remove());
  });

  it("does not render when isOpen is false", () => {
    act(() => {
      root.render(<LogDrawer isOpen={false} onClose={() => {}} />);
    });
    expect(drawer() === null).toBe(true);
  });

  it("renders log drawer with title and all log entries when isOpen is true", () => {
    act(() => {
      root.render(<LogDrawer isOpen={true} onClose={() => {}} />);
    });

    expect(page().textContent).toMatch(/System Logs|Nhật Ký Hoạt Động/);
    expect(page().textContent).toContain("Đang tải video YouTube test");
    expect(page().textContent).toContain("Lỗi phát file âm thanh");
    expect(page().textContent).toContain("WebSocket đã kết nối");
    expect(page().textContent).toMatch(/1 error|1 lỗi/);
  });

  it("calls onClose when Escape key is pressed", async () => {
    let closed = false;
    act(() => {
      root.render(<LogDrawer isOpen={true} onClose={() => { closed = true; }} />);
    });
    await settle();

    act(() => {
      (document.activeElement ?? document.body).dispatchEvent(
        new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      );
    });

    expect(closed).toBe(true);
  });

  it("opens as a labelled modal dialog with the search field focused", async () => {
    act(() => {
      root.render(<LogDrawer isOpen={true} onClose={() => {}} />);
    });
    await settle();

    expect(drawer()?.getAttribute("role")).toBe("dialog");
    const title = document.getElementById(drawer()?.getAttribute("aria-labelledby") ?? "");
    expect(title?.textContent).toMatch(/System Logs|Nhật Ký Hoạt Động/);
    // The rest of the page is hidden from assistive tech while the drawer is open
    expect(container.getAttribute("aria-hidden")).toBe("true");
    expect(document.activeElement?.tagName).toBe("INPUT");
    expect(drawer()?.contains(document.activeElement)).toBe(true);
  });

  it("returns focus to what opened it once closed", async () => {
    const opener = document.createElement("button");
    opener.setAttribute("data-test-opener", "");
    document.body.appendChild(opener);
    opener.focus();

    act(() => {
      root.render(<LogDrawer isOpen={true} onClose={() => {}} />);
    });
    await settle();
    act(() => {
      root.render(<LogDrawer isOpen={false} onClose={() => {}} />);
    });
    await settle();

    expect(document.activeElement === opener).toBe(true);
  });

  it("filters logs by category tabs", () => {
    act(() => {
      root.render(<LogDrawer isOpen={true} onClose={() => {}} />);
    });

    // Switch to error tab
    act(() => {
      useLogStore.getState().setFilterCategory("error");
    });

    expect(page().textContent).toContain("Lỗi phát file âm thanh");
    expect(page().textContent).not.toContain("Đang tải video YouTube test");
    expect(page().textContent).not.toContain("WebSocket đã kết nối");
  });

  it("filters logs by text search query", () => {
    act(() => {
      root.render(<LogDrawer isOpen={true} onClose={() => {}} />);
    });

    act(() => {
      useLogStore.getState().setSearchQuery("WebSocket");
    });

    expect(page().textContent).toContain("WebSocket đã kết nối");
    expect(page().textContent).not.toContain("Đang tải video YouTube test");
    expect(page().textContent).not.toContain("Lỗi phát file âm thanh");
  });

  it("matches Vietnamese logs using unaccented queries", () => {
    act(() => {
      root.render(<LogDrawer isOpen={true} onClose={() => {}} />);
    });

    act(() => {
      useLogStore.getState().setSearchQuery("tai video");
    });

    expect(page().textContent).toContain("Đang tải video YouTube test");
    expect(page().textContent).not.toContain("Lỗi phát file âm thanh");

    act(() => {
      useLogStore.getState().setSearchQuery("loi phat");
    });

    expect(page().textContent).toContain("Lỗi phát file âm thanh");
    expect(page().textContent).not.toContain("Đang tải video YouTube test");
  });

  it("clears logs when clear button is clicked", () => {
    act(() => {
      root.render(<LogDrawer isOpen={true} onClose={() => {}} />);
    });

    const clearBtn = (page().querySelector('button[title="Clear all logs"], button[title="Xóa toàn bộ nhật ký"]') ||
      page().querySelector('button[aria-label*="clear" i]')) as HTMLButtonElement;
    expect(clearBtn).not.toBeNull();

    act(() => {
      clearBtn.click();
    });

    expect(useLogStore.getState().logs.length).toBe(0);
    expect(page().textContent).toMatch(/Events will appear here|Chưa có sự kiện nào được ghi nhận|Các sự kiện sẽ hiển thị/);
  });

  it("handles circular objects and Error instances safely without crashing", () => {
    const circularObj: any = { name: "loop" };
    circularObj.self = circularObj;

    const testError = new Error("Custom test error message");
    const circularError: any = new Error("Circular error message");
    circularError.self = circularError;
    circularError.cause = circularError;

    const nestedError = new Error("Outer error", { cause: new Error("Inner cause description") });

    act(() => {
      useLogStore.getState().addLog({
        level: "error",
        category: "system",
        message: "Circular log test",
        details: circularObj,
      });
      useLogStore.getState().addLog({
        level: "error",
        category: "playback",
        message: "Error object log test",
        details: testError,
      });
      useLogStore.getState().addLog({
        level: "error",
        category: "system",
        message: "Circular Error test",
        details: circularError,
      });
      useLogStore.getState().addLog({
        level: "error",
        category: "download",
        message: "Nested Error cause test",
        details: nestedError,
      });
    });

    act(() => {
      root.render(<LogDrawer isOpen={true} onClose={() => {}} />);
    });

    // Should render without throwing
    expect(page().textContent).toContain("Circular log test");
    expect(page().textContent).toContain("Error object log test");
    expect(page().textContent).toContain("Circular Error test");
    expect(page().textContent).toContain("Nested Error cause test");

    // Search query should safely handle circular error details
    act(() => {
      useLogStore.getState().setSearchQuery("Circular");
    });
    expect(page().textContent).toContain("Circular log test");
    expect(page().textContent).toContain("Circular Error test");
  });

  it("resets auto-scroll and updates aria-pressed when auto-scroll button is clicked", () => {
    act(() => {
      root.render(<LogDrawer isOpen={true} onClose={() => {}} />);
    });

    const autoScrollBtn = (page().querySelector('button[aria-label="Scroll"], button[aria-label="Tự động cuộn"]') ||
      page().querySelector('button[aria-pressed]')) as HTMLButtonElement;
    expect(autoScrollBtn).toBeTruthy();
    expect(autoScrollBtn.getAttribute("aria-pressed")).toBe("true");

    act(() => {
      autoScrollBtn.click();
    });
    expect(useLogStore.getState().autoScroll).toBe(false);
    expect(autoScrollBtn.getAttribute("aria-pressed")).toBe("false");

    act(() => {
      autoScrollBtn.click();
    });
    expect(useLogStore.getState().autoScroll).toBe(true);
    expect(autoScrollBtn.getAttribute("aria-pressed")).toBe("true");
  });
});
