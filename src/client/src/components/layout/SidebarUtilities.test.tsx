import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import i18n from "../../i18n";
import { SidebarUtilities } from "./SidebarUtilities";
import { Sidebar, SidebarFooter, SidebarProvider } from "../ui/sidebar";
import { TooltipProvider } from "../ui/tooltip";
import { useLogStore } from "../../store/useLogStore";

describe("SidebarUtilities", () => {
  let container: HTMLDivElement;
  let root: Root;
  let initialLogState: ReturnType<typeof useLogStore.getState>;
  let onOpenShortcuts: ReturnType<typeof mock>;

  beforeEach(async () => {
    await i18n.changeLanguage("en");
    initialLogState = useLogStore.getState();
    useLogStore.setState({ isDrawerOpen: false, unreadErrorCount: 0 });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    onOpenShortcuts = mock(() => {});
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    useLogStore.setState(initialLogState, true);
    await i18n.changeLanguage("en");
  });

  async function renderUtilities() {
    await act(async () => {
      root.render(
        <TooltipProvider>
          <SidebarProvider>
            <Sidebar>
              <SidebarFooter>
                <SidebarUtilities onOpenShortcuts={onOpenShortcuts} />
              </SidebarFooter>
            </Sidebar>
          </SidebarProvider>
        </TooltipProvider>
      );
    });
  }

  const item = (label: string) =>
    Array.from(container.querySelectorAll<HTMLElement>('[data-sidebar="menu-button"]')).find(
      (el) => el.textContent?.trim() === label
    )!;

  const badgeOf = (label: string) =>
    item(label).closest('[data-sidebar="menu-item"]')!.querySelector('[data-sidebar="menu-badge"]')?.textContent;

  it("toggles the log drawer and marks Logs active while it is open", async () => {
    await renderUtilities();

    await act(async () => item("System Logs").click());

    expect(useLogStore.getState().isDrawerOpen).toBe(true);
    expect(item("System Logs").hasAttribute("data-active")).toBe(true);
  });

  it("shows the unread error count on Logs", async () => {
    useLogStore.setState({ unreadErrorCount: 3 });
    await renderUtilities();

    expect(badgeOf("System Logs")).toBe("3");
    expect(item("System Logs").getAttribute("aria-label")).toBe("Logs (3 errors)");
  });

  it("opens the keyboard shortcuts", async () => {
    await renderUtilities();

    await act(async () => item("Keyboard Shortcuts").click());

    expect(onOpenShortcuts).toHaveBeenCalledTimes(1);
  });

  it("switches the interface language between English and Vietnamese", async () => {
    await renderUtilities();
    expect(badgeOf("Language")).toBe("EN");

    await act(async () => item("Language").click());

    expect(i18n.language.startsWith("vi")).toBe(true);
    expect(badgeOf("Ngôn ngữ")).toBe("VI");
  });

  it("opens library backup and restore", async () => {
    await renderUtilities();

    await act(async () => item("Backup / Transfer").click());

    expect(document.body.textContent).toContain("Library Backup & Restore");
  });
});
