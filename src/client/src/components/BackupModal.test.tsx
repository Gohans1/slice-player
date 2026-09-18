import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GlobalWindow } from "happy-dom";
import "../i18n";
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

    const text = container.textContent || "";
    expect(text.length).toBeGreaterThan(0);
    // Should display current library stats
    expect(text).toContain("1");
  });

  it("should switch between export and import tabs", async () => {
    act(() => {
      root.render(<BackupModal isOpen={true} onClose={() => {}} />);
    });

    const buttons = container.querySelectorAll("button");
    const importTabBtn = Array.from(buttons).find((b) => b.textContent?.includes("Restore") || b.textContent?.includes("Khôi phục") || b.textContent?.includes("Import") || b.textContent?.includes("Nạp"));
    expect(importTabBtn).toBeDefined();

    if (importTabBtn) {
      await act(async () => {
        importTabBtn.click();
      });

      const textAfter = container.textContent || "";
      expect(textAfter.length).toBeGreaterThan(0);
    }
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

    const downloadBtn = Array.from(container.querySelectorAll("button")).find(
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
