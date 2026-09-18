import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GlobalWindow } from "happy-dom";
import { LogDrawer } from "./LogDrawer";
import { useLogStore } from "../store/useLogStore";

describe("LogDrawer Component", () => {
  let container: any;
  let root: any;

  beforeEach(() => {
    const happyWindow = new GlobalWindow();
    (globalThis as any).window = happyWindow;
    (globalThis as any).document = happyWindow.document;
    (globalThis as any).KeyboardEvent = happyWindow.KeyboardEvent;
    (globalThis as any).HTMLElement = happyWindow.HTMLElement;

    container = happyWindow.document.createElement("div");
    happyWindow.document.body.appendChild(container);
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
  });

  it("does not render when isOpen is false", () => {
    act(() => {
      root.render(<LogDrawer isOpen={false} onClose={() => {}} />);
    });
    expect(container.innerHTML).toBe("");
  });

  it("renders log drawer with title and all log entries when isOpen is true", () => {
    act(() => {
      root.render(<LogDrawer isOpen={true} onClose={() => {}} />);
    });

    expect(container.textContent).toMatch(/System Logs|Nhật Ký Hoạt Động/);
    expect(container.textContent).toContain("Đang tải video YouTube test");
    expect(container.textContent).toContain("Lỗi phát file âm thanh");
    expect(container.textContent).toContain("WebSocket đã kết nối");
    expect(container.textContent).toMatch(/1 error|1 lỗi/);
  });

  it("calls onClose when Escape key is pressed", () => {
    let closed = false;
    act(() => {
      root.render(<LogDrawer isOpen={true} onClose={() => { closed = true; }} />);
    });

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });

    expect(closed).toBe(true);
  });

  it("filters logs by category tabs", () => {
    act(() => {
      root.render(<LogDrawer isOpen={true} onClose={() => {}} />);
    });

    // Switch to error tab
    act(() => {
      useLogStore.getState().setFilterCategory("error");
    });

    expect(container.textContent).toContain("Lỗi phát file âm thanh");
    expect(container.textContent).not.toContain("Đang tải video YouTube test");
    expect(container.textContent).not.toContain("WebSocket đã kết nối");
  });

  it("filters logs by text search query", () => {
    act(() => {
      root.render(<LogDrawer isOpen={true} onClose={() => {}} />);
    });

    act(() => {
      useLogStore.getState().setSearchQuery("WebSocket");
    });

    expect(container.textContent).toContain("WebSocket đã kết nối");
    expect(container.textContent).not.toContain("Đang tải video YouTube test");
    expect(container.textContent).not.toContain("Lỗi phát file âm thanh");
  });

  it("matches Vietnamese logs using unaccented queries", () => {
    act(() => {
      root.render(<LogDrawer isOpen={true} onClose={() => {}} />);
    });

    act(() => {
      useLogStore.getState().setSearchQuery("tai video");
    });

    expect(container.textContent).toContain("Đang tải video YouTube test");
    expect(container.textContent).not.toContain("Lỗi phát file âm thanh");

    act(() => {
      useLogStore.getState().setSearchQuery("loi phat");
    });

    expect(container.textContent).toContain("Lỗi phát file âm thanh");
    expect(container.textContent).not.toContain("Đang tải video YouTube test");
  });

  it("clears logs when clear button is clicked", () => {
    act(() => {
      root.render(<LogDrawer isOpen={true} onClose={() => {}} />);
    });

    const clearBtn = (container.querySelector('button[title="Clear all logs"], button[title="Xóa toàn bộ nhật ký"]') ||
      container.querySelector('button[aria-label*="clear" i]')) as HTMLButtonElement;
    expect(clearBtn).not.toBeNull();

    act(() => {
      clearBtn.click();
    });

    expect(useLogStore.getState().logs.length).toBe(0);
    expect(container.textContent).toMatch(/Events will appear here|Chưa có sự kiện nào được ghi nhận|Các sự kiện sẽ hiển thị/);
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
    expect(container.textContent).toContain("Circular log test");
    expect(container.textContent).toContain("Error object log test");
    expect(container.textContent).toContain("Circular Error test");
    expect(container.textContent).toContain("Nested Error cause test");

    // Search query should safely handle circular error details
    act(() => {
      useLogStore.getState().setSearchQuery("Circular");
    });
    expect(container.textContent).toContain("Circular log test");
    expect(container.textContent).toContain("Circular Error test");
  });

  it("resets auto-scroll and updates aria-pressed when auto-scroll button is clicked", () => {
    act(() => {
      root.render(<LogDrawer isOpen={true} onClose={() => {}} />);
    });

    const autoScrollBtn = (container.querySelector('button[aria-label="Scroll"], button[aria-label="Tự động cuộn"]') ||
      container.querySelector('button[aria-pressed]')) as HTMLButtonElement;
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
