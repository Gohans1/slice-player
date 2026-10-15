import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GlobalWindow } from "happy-dom";
import i18n from "../i18n";
import { BackupModal } from "./BackupModal";
import { usePlayerStore } from "../store/usePlayerStore";

describe("BackupModal Component", () => {
  let container: HTMLDivElement;
  let root: Root;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const happyWindow = new GlobalWindow();
    (globalThis as any).window = happyWindow;
    (globalThis as any).document = happyWindow.document;
    (globalThis as any).KeyboardEvent = happyWindow.KeyboardEvent;
    (globalThis as any).HTMLElement = happyWindow.HTMLElement;
    (globalThis as any).Event = happyWindow.Event;

    container = happyWindow.document.createElement("div") as unknown as HTMLDivElement;
    happyWindow.document.body.appendChild(container as any);
    root = createRoot(container);

    originalFetch = globalThis.fetch;
    usePlayerStore.setState({
      tracks: [
        {
          id: "track_1",
          title: "Track 1",
          artist: "Artist 1",
          duration: 100,
          source_type: "youtube",
          source_uri: "uri1",
          status: "ready",
          volume: 0.5,
          created_at: 1000,
        },
      ],
      playlists: [{ id: "pl_1", name: "Playlist 1", created_at: 1000, updated_at: 1000, item_count: 0 }],
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    globalThis.fetch = originalFetch;
  });

  it("should render correctly when isOpen is true", () => {
    act(() => {
      root.render(<BackupModal isOpen={true} onClose={() => {}} />);
    });

    const text = document.body.textContent || "";
    expect(text.length).toBeGreaterThan(0);
    // Should display current library stats
    expect(text).toContain("1");
  });

  const buttonWithText = (text: string) =>
    Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes(text));

  const openRestoreTab = async () => {
    await act(async () => {
      buttonWithText("Import / Restore")?.click();
    });
  };

  it("should switch between export and import tabs", async () => {
    await i18n.changeLanguage("en");
    act(() => {
      root.render(<BackupModal isOpen={true} onClose={() => {}} />);
    });
    expect(buttonWithText("Download Backup (.tar.gz)")).toBeDefined();

    await openRestoreTab();

    expect(document.body.textContent).toContain("Restoring will replace the database");
    expect(buttonWithText("Download Backup (.tar.gz)")).toBeUndefined();
    expect(buttonWithText("Start Restore")?.disabled).toBe(true);
  });

  it("restores the library from a chosen backup file", async () => {
    await i18n.changeLanguage("en");
    const importCalls: string[] = [];
    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      if (url.toString().includes("/api/library/import")) {
        importCalls.push(init?.method ?? "GET");
        return new Response(JSON.stringify({ success: true, message: "Restored 12 tracks" }));
      }
      return new Response("[]");
    }) as any;
    act(() => {
      root.render(<BackupModal isOpen={true} onClose={() => {}} />);
    });
    await openRestoreTab();

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(fileInput, "files", { value: [new File(["tar"], "backup.tar.gz")], configurable: true });
    await act(async () => {
      fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(document.body.textContent).toContain("Selected file: backup.tar.gz");

    await act(async () => {
      buttonWithText("Start Restore")?.click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(importCalls).toEqual(["POST"]);
    expect(document.body.textContent).toContain("Restored 12 tracks");
  });

  it("should call export API when download button is clicked", async () => {
    let exportCalled = false;
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes("/api/library/export")) {
        exportCalled = true;
        return new Response(new Uint8Array([1, 2, 3, 4]), {
          headers: {
            "Content-Disposition": 'attachment; filename="backup.tar.gz"',
          },
        });
      }
      return new Response("Not found", { status: 404 });
    }) as any;

    (globalThis as any).window.URL = {
      createObjectURL: () => "blob:mock",
      revokeObjectURL: () => {},
    };

    act(() => {
      root.render(<BackupModal isOpen={true} onClose={() => {}} />);
    });

    const downloadBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.includes(".tar.gz")
    );
    expect(downloadBtn).toBeDefined();

    if (downloadBtn) {
      await act(async () => {
        downloadBtn.click();
      });
      expect(exportCalled).toBe(true);
    }
  });
});
