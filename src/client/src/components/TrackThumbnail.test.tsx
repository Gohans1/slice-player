import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { GlobalWindow } from "happy-dom";
import { TrackThumbnail } from "./TrackThumbnail";

describe("TrackThumbnail Component", () => {
  let window: any;
  let container: any;
  let root: any;

  beforeEach(() => {
    window = new GlobalWindow();
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    (globalThis as any).window = window;
    (globalThis as any).document = window.document;
    (globalThis as any).Node = window.Node;
    (globalThis as any).Element = window.Element;
    (globalThis as any).HTMLElement = window.HTMLElement;
    (globalThis as any).HTMLImageElement = window.HTMLImageElement;

    container = window.document.createElement("div");
    window.document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
    delete (globalThis as any).window;
    delete (globalThis as any).document;
    delete (globalThis as any).Node;
    delete (globalThis as any).Element;
    delete (globalThis as any).HTMLElement;
    delete (globalThis as any).HTMLImageElement;
  });

  it("renders img tag when valid src is provided", () => {
    const html = renderToStaticMarkup(
      <TrackThumbnail
        src="https://i.ytimg.com/vi/test_id/maxresdefault.jpg"
        alt="Test title"
      />
    );

    expect(html).toContain("<img");
    expect(html).toContain('src="https://i.ytimg.com/vi/test_id/maxresdefault.jpg"');
    expect(html).toContain('alt="Test title"');
  });

  it("renders default Disc placeholder when src is null, undefined, or empty/whitespace", () => {
    const htmlNull = renderToStaticMarkup(<TrackThumbnail src={null} />);
    const htmlUndefined = renderToStaticMarkup(<TrackThumbnail src={undefined} />);
    const htmlWhitespace = renderToStaticMarkup(<TrackThumbnail src="   " />);

    expect(htmlNull).toContain("lucide-disc");
    expect(htmlNull).not.toContain("<img");
    expect(htmlUndefined).toContain("lucide-disc");
    expect(htmlWhitespace).toContain("lucide-disc");
  });

  it("renders custom fallback node when provided and src is missing", () => {
    const customFallback = <div data-testid="custom-fb">Custom Placeholder</div>;
    const html = renderToStaticMarkup(
      <TrackThumbnail src={null} fallback={customFallback} />
    );

    expect(html).toContain('data-testid="custom-fb"');
    expect(html).toContain("Custom Placeholder");
    expect(html).not.toContain("lucide-disc");
  });

  it("falls back to hqdefault when maxresdefault fails with onError", () => {
    act(() => {
      root.render(
        <TrackThumbnail src="https://i.ytimg.com/vi/test_123/maxresdefault.jpg" />
      );
    });

    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img.src).toBe("https://i.ytimg.com/vi/test_123/maxresdefault.jpg");

    // Simulate error event
    act(() => {
      img.dispatchEvent(new window.Event("error"));
    });

    const updatedImg = container.querySelector("img");
    expect(updatedImg).not.toBeNull();
    expect(updatedImg.src).toBe("https://i.ytimg.com/vi/test_123/hqdefault.jpg");

    // Simulate second error on hqdefault
    act(() => {
      updatedImg.dispatchEvent(new window.Event("error"));
    });

    expect(container.querySelector("img")).toBeNull();
    expect(container.innerHTML).toContain("lucide-disc");
  });

  it("catches YouTube 120x90 placeholder trap in onLoad for both ytimg and youtube.com", () => {
    act(() => {
      root.render(
        <TrackThumbnail src="https://img.youtube.com/vi/test_trap/maxresdefault.jpg" />
      );
    });

    let img = container.querySelector("img");
    expect(img).not.toBeNull();

    // Mock natural dimensions representing YouTube's 120x90 gray box
    Object.defineProperty(img, "naturalWidth", { value: 120, configurable: true });
    Object.defineProperty(img, "naturalHeight", { value: 90, configurable: true });

    act(() => {
      img.dispatchEvent(new window.Event("load"));
    });

    // Should degrade to hqdefault
    img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img.src).toBe("https://img.youtube.com/vi/test_trap/hqdefault.jpg");

    // If hqdefault also returns 120x90 (deleted/private video)
    Object.defineProperty(img, "naturalWidth", { value: 120, configurable: true });
    Object.defineProperty(img, "naturalHeight", { value: 90, configurable: true });

    act(() => {
      img.dispatchEvent(new window.Event("load"));
    });

    // Should switch to clean Disc fallback
    expect(container.querySelector("img")).toBeNull();
    expect(container.innerHTML).toContain("lucide-disc");
  });

  it("correctly replaces filename when videoId contains high-res tokens like hq720 or sddefault", () => {
    act(() => {
      root.render(
        <TrackThumbnail src="https://i.ytimg.com/vi/vid_hq720_part/maxresdefault.jpg" />
      );
    });

    const img = container.querySelector("img");
    expect(img).not.toBeNull();

    act(() => {
      img.dispatchEvent(new window.Event("error"));
    });

    const updatedImg = container.querySelector("img");
    expect(updatedImg).not.toBeNull();
    // Video ID part 'vid_hq720_part' must be preserved, only filename 'maxresdefault.jpg' changed to 'hqdefault.jpg'
    expect(updatedImg.src).toBe("https://i.ytimg.com/vi/vid_hq720_part/hqdefault.jpg");
  });

  it("catches YouTube 120x90 placeholder trap on googleusercontent.com URLs", () => {
    act(() => {
      root.render(
        <TrackThumbnail src="https://lh3.googleusercontent.com/vi/sample/maxresdefault.jpg" />
      );
    });

    const img = container.querySelector("img");
    Object.defineProperty(img, "naturalWidth", { value: 120, configurable: true });
    Object.defineProperty(img, "naturalHeight", { value: 90, configurable: true });

    act(() => {
      img.dispatchEvent(new window.Event("load"));
    });

    const updatedImg = container.querySelector("img");
    expect(updatedImg).not.toBeNull();
    expect(updatedImg.src).toBe("https://lh3.googleusercontent.com/vi/sample/hqdefault.jpg");
  });

  it("does not trigger placeholder trap on non-YouTube 120x90 images", () => {
    act(() => {
      root.render(
        <TrackThumbnail src="https://example.com/small-icon.png" />
      );
    });

    const img = container.querySelector("img");
    Object.defineProperty(img, "naturalWidth", { value: 120, configurable: true });
    Object.defineProperty(img, "naturalHeight", { value: 90, configurable: true });

    act(() => {
      img.dispatchEvent(new window.Event("load"));
    });

    // Should remain valid image
    expect(container.querySelector("img")).not.toBeNull();
    expect(container.innerHTML).not.toContain("lucide-disc");
  });

  it("does not trigger placeholder trap on non-YouTube googleusercontent images without /vi/ path", () => {
    act(() => {
      root.render(
        <TrackThumbnail src="https://lh3.googleusercontent.com/user_avatar/photo123.jpg" />
      );
    });

    const img = container.querySelector("img");
    Object.defineProperty(img, "naturalWidth", { value: 120, configurable: true });
    Object.defineProperty(img, "naturalHeight", { value: 90, configurable: true });

    act(() => {
      img.dispatchEvent(new window.Event("load"));
    });

    // Should remain valid image, not treated as broken YouTube video placeholder
    expect(container.querySelector("img")).not.toBeNull();
    expect(container.innerHTML).not.toContain("lucide-disc");
  });

  it("resets state synchronously when src prop changes", () => {
    act(() => {
      root.render(<TrackThumbnail src="https://i.ytimg.com/vi/trk_a/hqdefault.jpg" />);
    });

    let img = container.querySelector("img");
    // Fail it
    act(() => {
      img.dispatchEvent(new window.Event("error"));
    });
    expect(container.querySelector("img")).toBeNull();

    // Now parent switches to track B
    act(() => {
      root.render(<TrackThumbnail src="https://i.ytimg.com/vi/trk_b/maxresdefault.jpg" />);
    });

    img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img.src).toBe("https://i.ytimg.com/vi/trk_b/maxresdefault.jpg");
  });
});
