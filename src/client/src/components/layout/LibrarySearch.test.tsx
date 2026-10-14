import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import "../../i18n";
import { LibrarySearch } from "./LibrarySearch";
import { Sidebar, SidebarHeader, SidebarProvider } from "../ui/sidebar";
import { TooltipProvider } from "../ui/tooltip";

const tick = () => new Promise((r) => setTimeout(r, 50));

function Harness({ initial, defaultOpen, onChange }: { initial: string; defaultOpen: boolean; onChange: (q: string) => void }) {
  const [query, setQuery] = React.useState(initial);
  return (
    <TooltipProvider>
      <SidebarProvider defaultOpen={defaultOpen}>
        <Sidebar collapsible="icon">
          <SidebarHeader>
            <LibrarySearch
              value={query}
              onChange={(q) => {
                onChange(q);
                setQuery(q);
              }}
            />
          </SidebarHeader>
        </Sidebar>
      </SidebarProvider>
    </TooltipProvider>
  );
}

describe("LibrarySearch", () => {
  let container: HTMLDivElement;
  let root: Root;
  let onChange: ReturnType<typeof mock>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    onChange = mock(() => {});
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    document.querySelectorAll('[data-test-extra]').forEach((el) => el.remove());
  });

  async function renderSearch({ initial = "", defaultOpen = true } = {}) {
    await act(async () => {
      root.render(<Harness initial={initial} defaultOpen={defaultOpen} onChange={onChange} />);
    });
    return container.querySelector<HTMLInputElement>('input[type="search"]')!;
  }

  async function press(target: EventTarget, init: KeyboardEventInit) {
    await act(async () => {
      target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
      await tick();
    });
  }

  it("filters as you type", async () => {
    const input = await renderSearch();

    await act(async () => {
      Reflect.set(HTMLInputElement.prototype, "value", "lofi", input);
      input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    });

    expect(onChange).toHaveBeenLastCalledWith("lofi");
    expect(input.value).toBe("lofi");
  });

  it("clears the query from the clear button and keeps focus in the field", async () => {
    const input = await renderSearch({ initial: "lofi" });

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Clear search"]')!.click();
    });

    expect(input.value).toBe("");
    expect(document.activeElement).toBe(input);
  });

  it("clears the query on the first Escape and leaves the field on the second", async () => {
    const input = await renderSearch({ initial: "lofi" });
    input.focus();

    await press(input, { key: "Escape" });
    expect(input.value).toBe("");
    expect(document.activeElement).toBe(input);

    await press(input, { key: "Escape" });
    expect(document.activeElement).not.toBe(input);
  });

  it("focuses the field with / and with Ctrl+K", async () => {
    const input = await renderSearch();

    await press(document.body, { key: "/" });
    expect(document.activeElement).toBe(input);

    input.blur();
    await press(document.body, { key: "k", ctrlKey: true });
    expect(document.activeElement).toBe(input);
  });

  it("leaves / alone while typing in another field or with a dialog open", async () => {
    const input = await renderSearch();
    const other = document.createElement("input");
    other.setAttribute("data-test-extra", "");
    document.body.appendChild(other);
    other.focus();

    await press(other, { key: "/" });
    expect(document.activeElement).toBe(other);

    other.blur();
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("data-test-extra", "");
    document.body.appendChild(dialog);

    await press(document.body, { key: "/" });
    expect(document.activeElement).not.toBe(input);
  });

  it("expands a collapsed sidebar to focus the field", async () => {
    const input = await renderSearch({ defaultOpen: false });
    expect(container.querySelector('[data-slot="sidebar"]')!.getAttribute("data-state")).toBe("collapsed");

    await press(document.body, { key: "/" });

    expect(container.querySelector('[data-slot="sidebar"]')!.getAttribute("data-state")).toBe("expanded");
    expect(document.activeElement).toBe(input);
  });
});
