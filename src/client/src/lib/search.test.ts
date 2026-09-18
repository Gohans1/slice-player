import { describe, expect, it } from "bun:test";
import { normalizeVi, filterTracks } from "./search";

describe("normalizeVi", () => {
  it("normalizes empty or null values", () => {
    expect(normalizeVi("")).toBe("");
    expect(normalizeVi(null)).toBe("");
    expect(normalizeVi(undefined)).toBe("");
  });

  it("removes Vietnamese diacritics and converts to lowercase", () => {
    expect(normalizeVi("Sơn Tùng M-TP")).toBe("son tung m-tp");
    expect(normalizeVi("Hà Anh Tuấn")).toBe("ha anh tuan");
    expect(normalizeVi("Đen Vâu")).toBe("den vau");
    expect(normalizeVi("ĐƯỜNG ĐUA")).toBe("duong dua");
    expect(normalizeVi("Nơi Này Có Anh")).toBe("noi nay co anh");
  });
});

describe("filterTracks", () => {
  const sampleTracks = [
    { id: "1", title: "Em Của Ngày Hôm Qua", artist: "Sơn Tùng M-TP" },
    { id: "2", title: "Cơn Mưa Ngang Qua", artist: "Sơn Tùng M-TP" },
    { id: "3", title: "Nấu Ăn Cho Em", artist: "Đen Vâu" },
    { id: "4", title: "Tháng Tư Là Lời Nói Dối Của Em", artist: "Hà Anh Tuấn" },
    { id: "5", title: "Waiting For You", artist: "MONO" },
    { id: "6", title: "Track Without Artist", artist: undefined },
  ];

  it("returns all tracks when query is empty or only whitespace", () => {
    expect(filterTracks(sampleTracks, "")).toEqual(sampleTracks);
    expect(filterTracks(sampleTracks, "   ")).toEqual(sampleTracks);
  });

  it("returns empty array when tracks input is empty", () => {
    expect(filterTracks([], "anything")).toEqual([]);
  });

  it("finds tracks without accents when query has no accents", () => {
    const results = filterTracks(sampleTracks, "son tung");
    expect(results.length).toBe(2);
    expect(results[0].title).toBe("Em Của Ngày Hôm Qua");
    expect(results[1].title).toBe("Cơn Mưa Ngang Qua");
  });

  it("finds tracks when query has full accents", () => {
    const results = filterTracks(sampleTracks, "Hôm Qua");
    expect(results.length).toBe(1);
    expect(results[0].title).toBe("Em Của Ngày Hôm Qua");
  });

  it("finds tracks with special characters like Đ/đ", () => {
    const results1 = filterTracks(sampleTracks, "den vau");
    expect(results1.length).toBe(1);
    expect(results1[0].artist).toBe("Đen Vâu");

    const results2 = filterTracks(sampleTracks, "nau an");
    expect(results2.length).toBe(1);
    expect(results2[0].title).toBe("Nấu Ăn Cho Em");
  });

  it("supports multi-token queries in any order", () => {
    const results = filterTracks(sampleTracks, "hom qua em");
    expect(results.length).toBe(1);
    expect(results[0].title).toBe("Em Của Ngày Hôm Qua");
  });

  it("handles punctuation and special characters in queries safely", () => {
    const results1 = filterTracks(sampleTracks, "Sơn Tùng,");
    expect(results1.length).toBe(2);

    const results2 = filterTracks(sampleTracks, "[waiting]");
    expect(results2.length).toBe(1);
    expect(results2[0].title).toBe("Waiting For You");

    const results3 = filterTracks(sampleTracks, "(Em)?");
    expect(results3.length).toBe(3);
  });

  it("matches tokens across title and artist combined", () => {
    const results = filterTracks(sampleTracks, "ha anh tuan loi noi doi");
    expect(results.length).toBe(1);
    expect(results[0].title).toBe("Tháng Tư Là Lời Nói Dối Của Em");
  });

  it("handles track with undefined artist gracefully", () => {
    const results = filterTracks(sampleTracks, "without artist");
    expect(results.length).toBe(1);
    expect(results[0].id).toBe("6");
  });

  it("returns empty array when no track matches", () => {
    const results = filterTracks(sampleTracks, "random unknown xyz song");
    expect(results.length).toBe(0);
  });

  it("handles queries consisting exclusively of punctuation without resetting to all tracks", () => {
    const results = filterTracks(sampleTracks, "???");
    expect(results.length).toBe(0);
  });
});
