import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CreatePlaylistModal } from "./CreatePlaylistModal";
import { usePlayerStore } from "../store/usePlayerStore";
import i18n from "../i18n";

describe("CreatePlaylistModal", () => {
  let root: Root;
  let container: HTMLElement;
  const original = usePlayerStore.getState();

  beforeEach(async () => {
    await i18n.changeLanguage("en");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    usePlayerStore.setState({
      playlists: [{ id: "pl_root", name: "Road Trip", created_at: 1, updated_at: 1, item_count: 2 }],
    });
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    container.remove();
    usePlayerStore.setState({ playlists: original.playlists, createPlaylist: original.createPlaylist });
  });

  // The control a <label> points at, the way assistive tech finds it
  const controlLabelled = (text: string) => {
    const label = Array.from(document.querySelectorAll("label")).find((l) => l.textContent?.trim() === text);
    const id = label?.getAttribute("for");
    return id ? document.getElementById(id) : null;
  };

  it("labels the name and parent playlist fields", async () => {
    await act(async () => {
      root.render(<CreatePlaylistModal isOpen onClose={() => {}} />);
    });

    expect(controlLabelled("Name")?.tagName).toBe("INPUT");
    expect(controlLabelled("Parent playlist (optional)")).not.toBeNull();
  });

  it("creates the playlist under the chosen parent", async () => {
    const createPlaylist = mock(async (name: string) => ({ id: "pl_new", name, created_at: 2, updated_at: 2, item_count: 0 }));
    usePlayerStore.setState({ createPlaylist: createPlaylist as never });
    const onCreated = mock((_id: string) => {});
    await act(async () => {
      root.render(<CreatePlaylistModal isOpen onClose={() => {}} onCreated={onCreated} initialParentId="pl_root" />);
    });

    const input = controlLabelled("Name") as HTMLInputElement;
    // happy-dom nodes reject Bun's global Event, so events come from the DOM window
    await act(async () => {
      Reflect.set(Object.getPrototypeOf(input), "value", "Night Drive", input);
      input.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
    expect(document.body.textContent).toContain("Road Trip");
    await act(async () => {
      input.form?.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(createPlaylist).toHaveBeenCalledWith("Night Drive", "pl_root");
    expect(onCreated).toHaveBeenCalledWith("pl_new");
  });
});
