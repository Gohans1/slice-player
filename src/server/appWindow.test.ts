import { describe, it, expect } from "bun:test";
import { findAppBrowser } from "./appWindow";

const windowsEnv = {
  "ProgramFiles(x86)": "C:\\Program Files (x86)",
  ProgramFiles: "C:\\Program Files",
  LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local",
};

describe("findAppBrowser", () => {
  it("prefers Edge, which every Windows install ships", () => {
    const installed = new Set([
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    ]);

    expect(findAppBrowser(windowsEnv, (path) => installed.has(path))).toBe(
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
    );
  });

  it("falls back to a per-user Chrome when Edge is missing", () => {
    const installed = new Set(["C:\\Users\\me\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe"]);

    expect(findAppBrowser(windowsEnv, (path) => installed.has(path))).toBe(
      "C:\\Users\\me\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe"
    );
  });

  it("returns null when no Chromium browser is installed", () => {
    expect(findAppBrowser(windowsEnv, () => false)).toBeNull();
  });
});
