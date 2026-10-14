import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import i18n from "../i18n";
import { MasterVolume } from "./MasterVolume";
import { usePlayerStore } from "../store/usePlayerStore";

describe("MasterVolume", () => {
  let container: HTMLDivElement;
  let root: Root;
  let initialMasterVolume: number;

  beforeEach(async () => {
    await i18n.changeLanguage("en");
    initialMasterVolume = usePlayerStore.getState().masterVolume;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    usePlayerStore.setState({ masterVolume: initialMasterVolume });
  });

  it("controls the global master volume, muting and restoring the previous level", async () => {
    usePlayerStore.setState({ masterVolume: 0.8 });
    await act(async () => {
      root.render(<MasterVolume />);
    });

    const slider = container.querySelector<HTMLInputElement>('input[type="range"][aria-label="Master volume"]');
    expect(slider).not.toBeNull();
    expect(slider?.getAttribute("aria-valuenow")).toBe("80");

    await act(async () => {
      slider!.value = "0.35";
      slider!.dispatchEvent(new InputEvent("input", { bubbles: true }));
    });
    expect(usePlayerStore.getState().masterVolume).toBe(0.35);

    const muteBtn = container.querySelector<HTMLButtonElement>('button[aria-label="Mute all audio"]');
    expect(muteBtn).not.toBeNull();
    await act(async () => {
      muteBtn!.click();
    });
    expect(usePlayerStore.getState().masterVolume).toBe(0);

    const unmuteBtn = container.querySelector<HTMLButtonElement>('button[aria-label="Unmute all audio"]');
    expect(unmuteBtn).not.toBeNull();
    await act(async () => {
      unmuteBtn!.click();
    });
    expect(usePlayerStore.getState().masterVolume).toBe(0.35);
  });

  it("unmutes to the 50% default when the session started muted", async () => {
    usePlayerStore.setState({ masterVolume: 0 });
    await act(async () => {
      root.render(<MasterVolume />);
    });

    const unmuteBtn = container.querySelector<HTMLButtonElement>('button[aria-label="Unmute all audio"]');
    expect(unmuteBtn).not.toBeNull();
    await act(async () => {
      unmuteBtn!.click();
    });
    expect(usePlayerStore.getState().masterVolume).toBe(0.5);
  });
});
