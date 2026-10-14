import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { VolumeSlider } from "./VolumeSlider";
import i18n from "../i18n";

describe("VolumeSlider", () => {
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

  const renderSlider = async (props: React.ComponentProps<typeof VolumeSlider> = {}) => {
    await act(async () => {
      root.render(<VolumeSlider {...props} />);
    });
    return container.querySelector<HTMLInputElement>('input[type="range"]');
  };

  const pressKey = async (target: HTMLElement | null, key: string) => {
    await act(async () => {
      target?.focus();
      target?.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    });
  };

  it("labels the slider and reports the volume as a percentage", async () => {
    const input = await renderSlider({ value: 0.85, "aria-label": "Track volume" });

    expect(input?.getAttribute("aria-label")).toBe("Track volume");
    expect(input?.getAttribute("aria-valuenow")).toBe("85");
    expect(input?.getAttribute("aria-valuetext")).toBe("85%");
  });

  it("falls back to a translated label and 50%", async () => {
    await i18n.changeLanguage("vi");
    const input = await renderSlider();

    expect(input?.getAttribute("aria-label")).toBe(i18n.t("player.volume"));
    expect(input?.getAttribute("aria-valuetext")).toBe("50%");
  });

  it("changes the volume in 1% steps from the keyboard", async () => {
    const onChange = mock((_value: number) => {});
    const input = await renderSlider({ value: 0.5, onChange });

    await pressKey(input, "ArrowRight");
    expect(onChange).toHaveBeenLastCalledWith(0.51);

    await pressKey(input, "ArrowLeft");
    expect(onChange).toHaveBeenLastCalledWith(0.49);
  });

  it("disables the input so it can't be focused or dragged", async () => {
    const input = await renderSlider({ value: 0.5, disabled: true });

    expect(input?.disabled).toBe(true);
  });
});
