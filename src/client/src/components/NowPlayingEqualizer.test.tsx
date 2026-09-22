import { describe, it, expect } from "bun:test";
import * as React from "react";
import { renderToString } from "react-dom/server";
import { NowPlayingEqualizer } from "./NowPlayingEqualizer";

describe("NowPlayingEqualizer", () => {
  it("renders with 3 animated bars by default", () => {
    const html = renderToString(<NowPlayingEqualizer />);
    expect(html).toContain("animate-eq-1");
    expect(html).toContain("animate-eq-2");
    expect(html).toContain("animate-eq-3");
    expect(html).not.toContain("animate-pulse");
    expect(html).toContain("aria-hidden=\"true\"");
  });

  it("renders non-animated state when isAnimated is false", () => {
    const html = renderToString(<NowPlayingEqualizer isAnimated={false} />);
    expect(html).not.toContain("animate-eq-1");
    expect(html).not.toContain("animate-eq-2");
    expect(html).not.toContain("animate-eq-3");
    expect(html).not.toContain("animate-pulse");
    expect(html).toContain("h-1.5");
    expect(html).toContain("h-2");
  });

  it("applies custom className", () => {
    const html = renderToString(<NowPlayingEqualizer className="text-primary my-test-class" />);
    expect(html).toContain("my-test-class");
    expect(html).toContain("text-primary");
  });
});
