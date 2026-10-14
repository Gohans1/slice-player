import { describe, it, expect, afterEach } from "bun:test";
import { isDialogOpen } from "./dialog";

describe("isDialogOpen", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  const addDialog = (role: string, attributes: Record<string, string> = {}) => {
    const dialog = document.createElement("div");
    dialog.setAttribute("role", role);
    for (const [name, value] of Object.entries(attributes)) dialog.setAttribute(name, value);
    document.body.appendChild(dialog);
  };

  it("is false with no dialog on the page", () => {
    expect(isDialogOpen()).toBe(false);
  });

  it("counts alert dialogs as well as dialogs", () => {
    addDialog("alertdialog");
    expect(isDialogOpen()).toBe(true);
  });

  it("ignores dialogs matching the exception", () => {
    addDialog("dialog", { "data-drawer": "log-drawer" });
    expect(isDialogOpen('[data-drawer="log-drawer"]')).toBe(false);

    addDialog("alertdialog");
    expect(isDialogOpen('[data-drawer="log-drawer"]')).toBe(true);
  });
});
