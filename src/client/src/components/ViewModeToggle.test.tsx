import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ViewModeToggle } from "./ViewModeToggle";
import i18n from "../i18n";

describe("ViewModeToggle", () => {
  let root: Root;
  let container: HTMLElement;

  beforeEach(async () => {
    await i18n.changeLanguage("en");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  const button = (name: string) =>
    Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.trim() === name) as HTMLButtonElement;

  it("marks the current view as pressed", async () => {
    await act(async () => {
      root.render(<ViewModeToggle value="list" onValueChange={() => {}} />);
    });

    expect(button("Grid").getAttribute("aria-pressed")).toBe("false");
    expect(button("List").getAttribute("aria-pressed")).toBe("true");
  });

  it("switches views and keeps one pressed when the current view is clicked again", async () => {
    const onValueChange = mock((_mode: "grid" | "list") => {});
    await act(async () => {
      root.render(<ViewModeToggle value="list" onValueChange={onValueChange} />);
    });

    await act(async () => {
      button("List").click();
    });
    expect(onValueChange).not.toHaveBeenCalled();

    await act(async () => {
      button("Grid").click();
    });
    expect(onValueChange).toHaveBeenCalledWith("grid");
  });

  it("names each view for assistive tech, since narrow toolbars show only the icons", async () => {
    await act(async () => {
      root.render(<ViewModeToggle value="list" onValueChange={() => {}} />);
    });

    expect(button("Grid").getAttribute("aria-label")).toBe("Grid");
    expect(button("List").getAttribute("aria-label")).toBe("List");
  });
});
