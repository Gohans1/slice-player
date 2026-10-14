import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ConfirmModal } from "./ConfirmModal";
import i18n from "../../i18n";

describe("ConfirmModal Component", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    await i18n.changeLanguage("en");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  const renderConfirm = async (props: Partial<React.ComponentProps<typeof ConfirmModal>> = {}) => {
    await act(async () => {
      root.render(
        <ConfirmModal isOpen={true} onClose={() => {}} onConfirm={() => {}} title="Delete Confirmation" {...props} />
      );
    });
    // Base UI moves focus after the opening render commits
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
  };

  const findButton = (label: string) =>
    Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.includes(label));

  const pressEscape = () => {
    act(() => {
      (document.activeElement ?? document.body).dispatchEvent(
        new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      );
    });
  };

  it("renders when isOpen is true and shows title, description, and action buttons", async () => {
    await renderConfirm({ title: "Delete Test Track", description: "Are you sure you want to delete this track?" });

    const bodyText = document.body.textContent || "";
    expect(bodyText).toContain("Delete Test Track");
    expect(bodyText).toContain("Are you sure you want to delete this track?");
  });

  it("asks with an alert dialog that focuses Cancel first", async () => {
    await renderConfirm();

    expect(document.querySelectorAll('[role="alertdialog"]').length).toBe(1);
    expect(document.activeElement?.textContent).toBe("Cancel");
  });

  it("dismisses on Escape unless the action is still running", async () => {
    const onClose = mock(() => {});

    await renderConfirm({ onClose, isLoading: true });
    pressEscape();
    expect(onClose).not.toHaveBeenCalled();

    await renderConfirm({ onClose, isLoading: false });
    pressEscape();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when cancel button is clicked", async () => {
    const onClose = mock(() => {});
    await renderConfirm({ onClose });

    const cancelBtn = findButton("Cancel");
    expect(cancelBtn).toBeDefined();
    act(() => {
      cancelBtn?.click();
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onConfirm when confirm button is clicked", async () => {
    const onConfirm = mock(() => {});
    await renderConfirm({ onConfirm });

    const confirmBtn = findButton("Delete");
    expect(confirmBtn).toBeDefined();
    act(() => {
      confirmBtn?.click();
    });
    expect(onConfirm).toHaveBeenCalled();
  });
});
