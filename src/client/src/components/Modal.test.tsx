import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Modal } from "./Modal";
import i18n from "../i18n";

describe("Modal", () => {
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

  const renderModal = async (props: Partial<React.ComponentProps<typeof Modal>> = {}) => {
    const onClose = mock(() => {});
    await act(async () => {
      root.render(
        <Modal isOpen title="Rename playlist" description="Pick a new name" onClose={onClose} {...props}>
          <input aria-label="Name" />
        </Modal>
      );
    });
    // Base UI moves focus after the opening render commits
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    return onClose;
  };

  const dialogs = () => Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'));

  it("labels the dialog with its title and description", async () => {
    await renderModal();

    const [dialog] = dialogs();
    expect(document.getElementById(dialog?.getAttribute("aria-labelledby") ?? "")?.textContent).toBe("Rename playlist");
    expect(document.getElementById(dialog?.getAttribute("aria-describedby") ?? "")?.textContent).toBe("Pick a new name");
  });

  it("renders nothing while closed", async () => {
    await renderModal({ isOpen: false });

    expect(dialogs().length).toBe(0);
  });

  it("focuses the first field instead of the close button", async () => {
    await renderModal();

    expect(document.activeElement?.getAttribute("aria-label")).toBe("Name");
  });

  it("closes from its translated close button", async () => {
    await i18n.changeLanguage("vi");
    const onClose = await renderModal();

    const close = dialogs()[0]?.querySelector<HTMLButtonElement>('button[aria-label="Đóng"]');
    await act(async () => {
      close?.click();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape", async () => {
    const onClose = await renderModal();

    await act(async () => {
      (document.activeElement ?? document.body).dispatchEvent(
        new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      );
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
