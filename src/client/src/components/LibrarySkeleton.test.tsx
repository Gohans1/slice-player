import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { LibrarySkeleton } from "./LibrarySkeleton";
import i18n from "../i18n";

describe("LibrarySkeleton", () => {
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

  it("announces loading once and hides the placeholders from assistive tech", async () => {
    await act(async () => {
      root.render(<LibrarySkeleton viewMode="list" />);
    });

    const statuses = Array.from(container.querySelectorAll("[role=status]")).filter(
      (el) => !el.closest("[aria-hidden=true]")
    );
    expect(statuses.map((el) => el.textContent?.trim())).toEqual(["Loading tracks…"]);
    expect(container.querySelector("[data-slot=skeleton]")?.closest("[aria-hidden=true]")).not.toBeNull();
  });
});
