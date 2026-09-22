import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GlobalWindow } from "happy-dom";
import "../i18n";
import { YoutubeIngestModal } from "./YoutubeIngestModal";
import { usePlayerStore } from "../store/usePlayerStore";

describe("YoutubeIngestModal Component", () => {
  let container: HTMLDivElement;
  let root: Root;
  let happyWindow: any;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    happyWindow = new GlobalWindow();
    (globalThis as any).window = happyWindow;
    (globalThis as any).document = happyWindow.document;
    (globalThis as any).KeyboardEvent = happyWindow.KeyboardEvent;
    (globalThis as any).HTMLElement = happyWindow.HTMLElement;
    (globalThis as any).HTMLTextAreaElement = happyWindow.HTMLTextAreaElement;
    (globalThis as any).HTMLInputElement = happyWindow.HTMLInputElement;
    (globalThis as any).HTMLFormElement = happyWindow.HTMLFormElement;
    (globalThis as any).HTMLButtonElement = happyWindow.HTMLButtonElement;
    (globalThis as any).Event = happyWindow.Event;

    container = happyWindow.document.createElement("div") as unknown as HTMLDivElement;
    happyWindow.document.body.appendChild(container as any);
    root = createRoot(container);

    usePlayerStore.setState({
      fetchTracks: mock(async () => {}),
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("renders when isOpen is true", () => {
    act(() => {
      root.render(<YoutubeIngestModal isOpen={true} onClose={() => {}} />);
    });

    const titleEl = happyWindow.document.querySelector("h2");
    expect(titleEl).toBeDefined();
    expect(titleEl?.textContent).toContain("YouTube");
  });

  it("requires confirmation popup before cancelling active ingestion queue", async () => {
    let abortCalled = false;
    let pendingResolve: ((value: any) => void) | null = null;

    // Mock fetch that hangs so the queue stays in processing state
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock((url: any, init?: any) => {
      if (init?.signal) {
        init.signal.addEventListener("abort", () => {
          abortCalled = true;
        });
      }
      return new Promise((resolve) => {
        pendingResolve = resolve;
      });
    }) as any;

    try {
      act(() => {
        root.render(<YoutubeIngestModal isOpen={true} onClose={() => {}} />);
      });

      // Find textarea and submit button
      const textarea = happyWindow.document.querySelector("textarea") as HTMLTextAreaElement;
      expect(textarea).toBeDefined();

      const form = happyWindow.document.querySelector("form") as HTMLFormElement;
      expect(form).toBeDefined();

      const propsKey = Object.keys(textarea).find((k) => k.startsWith("__reactProps$"))!;
      expect(propsKey).toBeDefined();

      act(() => {
        (textarea as any)[propsKey].onChange({ target: { value: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" } });
      });

      act(() => {
        (textarea as any)[propsKey].onKeyDown({
          key: "Enter",
          shiftKey: false,
          nativeEvent: { isComposing: false },
          keyCode: 13,
          preventDefault: () => {},
        });
      });

      // Now queue is processing -> Cancel button should be visible
      const buttons = Array.from(happyWindow.document.querySelectorAll("button")) as HTMLButtonElement[];
      const cancelBtn = buttons.find((b) =>
        b.textContent?.includes("Cancel") || b.textContent?.includes("Hủy")
      );
      expect(cancelBtn).toBeDefined();

      // Click the Cancel button
      act(() => {
        cancelBtn?.click();
      });

      // ConfirmModal popup should now be rendered!
      // In ConfirmModal, we expect description warning about stopping YouTube audio
      const bodyText = happyWindow.document.body.textContent || "";
      const hasConfirmWarning =
        bodyText.includes("Are you sure you want to stop fetching") ||
        bodyText.includes("Bạn có chắc chắn muốn dừng quá trình lấy nhạc");
      expect(hasConfirmWarning).toBe(true);

      // Verify that the queue was NOT cancelled yet!
      expect(abortCalled).toBe(false);

      // Find the "Continue" / "Keep Going" button in ConfirmModal to cancel the confirmation
      const allButtonsNow = Array.from(
        happyWindow.document.querySelectorAll("button")
      ) as HTMLButtonElement[];
      const keepGoingBtn = allButtonsNow.find(
        (b) =>
          b.textContent?.includes("Continue") ||
          b.textContent?.includes("Tiếp tục")
      );
      expect(keepGoingBtn).toBeDefined();

      act(() => {
        keepGoingBtn?.click();
      });

      // ConfirmModal should now be closed, queue still running!
      expect(abortCalled).toBe(false);

      // Now click cancel again and actually confirm it!
      act(() => {
        cancelBtn?.click();
      });

      const confirmStopBtn = Array.from(
        happyWindow.document.querySelectorAll("button")
      ).find(
        (b: any) =>
          b.textContent?.includes("Stop") ||
          b.textContent?.includes("Dừng")
      ) as HTMLButtonElement;
      expect(confirmStopBtn).toBeDefined();

      act(() => {
        confirmStopBtn.click();
      });

      // Now abort MUST have been triggered!
      expect(abortCalled).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("pressing Escape when ConfirmModal is open only closes ConfirmModal and keeps YoutubeIngestModal open", () => {
    let isModalClosed = false;

    // Mock fetch that hangs
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() => new Promise(() => {})) as any;

    try {
      act(() => {
        root.render(
          <YoutubeIngestModal
            isOpen={true}
            onClose={() => {
              isModalClosed = true;
            }}
          />
        );
      });

      const form = happyWindow.document.querySelector("form") as HTMLFormElement;
      const textarea = happyWindow.document.querySelector("textarea") as HTMLTextAreaElement;
      expect(form).toBeDefined();

      const propsKey = Object.keys(textarea).find((k) => k.startsWith("__reactProps$"))!;
      expect(propsKey).toBeDefined();

      act(() => {
        (textarea as any)[propsKey].onChange({ target: { value: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" } });
      });

      act(() => {
        (textarea as any)[propsKey].onKeyDown({
          key: "Enter",
          shiftKey: false,
          nativeEvent: { isComposing: false },
          keyCode: 13,
          preventDefault: () => {},
        });
      });

      const cancelBtn = Array.from(
        happyWindow.document.querySelectorAll("button")
      ).find((b: any) =>
        b.textContent?.includes("Cancel") || b.textContent?.includes("Hủy")
      ) as HTMLButtonElement;

      act(() => {
        cancelBtn?.click();
      });

      // Confirm modal is now visible
      let bodyText = happyWindow.document.body.textContent || "";
      expect(
        bodyText.includes("Are you sure you want to stop") ||
          bodyText.includes("Bạn có chắc chắn muốn dừng")
      ).toBe(true);

      // Press Escape
      act(() => {
        const escEvent = new happyWindow.KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
        });
        happyWindow.document.dispatchEvent(escEvent);
      });

      // Confirm modal should be closed
      bodyText = happyWindow.document.body.textContent || "";
      expect(
        bodyText.includes("Are you sure you want to stop") ||
          bodyText.includes("Bạn có chắc chắn muốn dừng")
      ).toBe(false);

      // YoutubeIngestModal itself should NOT have been closed!
      expect(isModalClosed).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
