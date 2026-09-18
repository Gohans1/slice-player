import { describe, it, expect, afterEach } from "bun:test";
import i18n from "./i18n";

describe("i18n configuration & translation", () => {
  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("should have correct configuration options", () => {
    const fallback = i18n.options.fallbackLng;
    const isEnFallback = Array.isArray(fallback) ? fallback.includes("en") : fallback === "en";
    expect(isEnFallback).toBe(true);

    const supported = i18n.options.supportedLngs;
    expect(Array.isArray(supported) && supported.includes("en")).toBe(true);
    expect(Array.isArray(supported) && supported.includes("vi")).toBe(true);
    expect(i18n.options.load).toBe("languageOnly");
  });

  it("should translate English content accurately", async () => {
    await i18n.changeLanguage("en");
    expect(i18n.t("app.title")).toBe("SLICE PLAYER");
    expect(i18n.t("nav.playlists")).toBe("Playlists");
    expect(i18n.t("localModal.statusSuccess")).toBe("Success");
  });

  it("should translate into Vietnamese when language is changed to vi", async () => {
    await i18n.changeLanguage("vi");
    expect(i18n.language).toBe("vi");
    expect(i18n.t("nav.playlists")).toBe("Danh Sách");
    expect(i18n.t("app.errorBoundary.title")).toBe("Đã xảy ra lỗi giao diện");
    expect(i18n.t("localModal.statusSuccess")).toBe("Thành công");
  });

  it("should correctly interpolate variables in both languages", async () => {
    await i18n.changeLanguage("en");
    expect(i18n.t("nav.shufflePlaylist", { name: "Acoustic Hits" })).toBe("Shuffle Acoustic Hits");

    await i18n.changeLanguage("vi");
    expect(i18n.t("nav.shufflePlaylist", { name: "Acoustic Hits" })).toBe("Xáo trộn Acoustic Hits");
    expect(i18n.t("localModal.processingProgress", { current: 1, total: 5 })).toBe("Đang nạp file (1/5)...");
  });

  it("should handle pluralization correctly", async () => {
    await i18n.changeLanguage("en");
    expect(i18n.t("nav.systemLogsUnread", { count: 1 })).toBe("Logs (1 error)");
    expect(i18n.t("nav.systemLogsUnread", { count: 3 })).toBe("Logs (3 errors)");

    await i18n.changeLanguage("vi");
    expect(i18n.t("nav.systemLogsUnread", { count: 1 })).toBe("Nhật ký (1 lỗi)");
    expect(i18n.t("nav.systemLogsUnread", { count: 3 })).toBe("Nhật ký (3 lỗi)");
  });

  it("should fallback gracefully if a key is missing", () => {
    // @ts-expect-error testing missing key fallback
    expect(i18n.t("non.existent.key")).toBe("non.existent.key");
  });

  it("should synchronize document.documentElement.lang if document is available", async () => {
    if (typeof document !== "undefined") {
      await i18n.changeLanguage("vi");
      expect(document.documentElement.lang).toBe("vi");

      await i18n.changeLanguage("en");
      expect(document.documentElement.lang).toBe("en");
    }
  });
});
