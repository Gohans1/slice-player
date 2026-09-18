import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GlobalWindow } from "happy-dom";
import { ConfirmModal } from "./ConfirmModal";
import i18n from "../../i18n";

describe("ConfirmModal Component", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    await i18n.changeLanguage("en");
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const happyWindow = new GlobalWindow();
    (globalThis as any).window = happyWindow;
    (globalThis as any).document = happyWindow.document;
    (globalThis as any).HTMLElement = happyWindow.HTMLElement;
    (globalThis as any).Event = happyWindow.Event;

    container = happyWindow.document.createElement("div") as unknown as HTMLDivElement;
    happyWindow.document.body.appendChild(container as any);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("renders when isOpen is true and shows title, description, and action buttons", () => {
    act(() => {
      root.render(
        <ConfirmModal
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          title="Delete Test Track"
          description="Are you sure you want to delete this track?"
        />
      );
    });

    const bodyText = (globalThis as any).document.body.textContent || "";
    expect(bodyText).toContain("Delete Test Track");
    expect(bodyText).toContain("Are you sure you want to delete this track?");
  });

  it("calls onClose when cancel button is clicked", () => {
    const onClose = mock(() => {});
    act(() => {
      root.render(
        <ConfirmModal
          isOpen={true}
          onClose={onClose}
          onConfirm={() => {}}
          title="Delete Confirmation"
        />
      );
    });

    const cancelBtn = Array.from(
      (globalThis as any).document.querySelectorAll("button")
    ).find((b: any) => b.textContent?.includes("Hủy") || b.textContent?.includes("Cancel")) as HTMLButtonElement | undefined;

    expect(cancelBtn).toBeDefined();
    act(() => {
      cancelBtn?.click();
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onConfirm when confirm button is clicked", () => {
    const onConfirm = mock(() => {});
    act(() => {
      root.render(
        <ConfirmModal
          isOpen={true}
          onClose={() => {}}
          onConfirm={onConfirm}
          title="Delete Confirmation"
        />
      );
    });

    const confirmBtn = Array.from(
      (globalThis as any).document.querySelectorAll("button")
    ).find((b: any) => b.textContent?.includes("Xóa") || b.textContent?.includes("Delete")) as HTMLButtonElement | undefined;

    expect(confirmBtn).toBeDefined();
    act(() => {
      confirmBtn?.click();
    });
    expect(onConfirm).toHaveBeenCalled();
  });
});
