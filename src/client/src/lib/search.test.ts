import { describe, expect, it } from "bun:test";
import { normalizeVi, filterTracks, searchItems } from "./search";

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

  describe("adversarial edge cases & compact matching", () => {
    const edgeTracks = [
      { id: "e1", title: "Cao Ốc 20", artist: "B ray" },
      { id: "e2", title: "Xin Đừng Nhấc Máy", artist: "B-Ray" },
      { id: "e3", title: "Do For Love", artist: "BRay" },
      { id: "e4", title: "Cơn Mưa Ngang Qua", artist: "Sơn Tùng M-TP" },
      { id: "e5", title: "Don't Côi", artist: "RPT MCK" },
      { id: "e6", title: "Hồng Nhan", artist: "K-ICM" },
      { id: "e7", title: "Chilling In Hanoi", artist: "Lo-fi Beats" },
      { id: "e8", title: "Praise the Lord", artist: "A$AP Rocky" },
      { id: "e9", title: "Hit Here", artist: "Unknown" },
      { id: "e10", title: "Don’t Stop", artist: "Various Artists" },
      { id: "e11", title: "Bài Ca Hy Vọng", artist: "Ｂ Ｒａｙ" },
      { id: "e12", title: "Ray of Light", artist: "Madonna" },
    ];

    it("matches 'bray' against 'B ray', 'B-Ray', 'BRay', and full-width 'Ｂ Ｒａｙ'", () => {
      const results = filterTracks(edgeTracks, "bray");
      const matchedIds = results.map((t) => t.id);
      expect(matchedIds).toContain("e1");
      expect(matchedIds).toContain("e2");
      expect(matchedIds).toContain("e3");
      expect(matchedIds).toContain("e11");
    });

    it("matches 'mtp' or 'son tung mtp' against 'Sơn Tùng M-TP'", () => {
      const res1 = filterTracks(edgeTracks, "mtp");
      expect(res1.some((t) => t.id === "e4")).toBe(true);

      const res2 = filterTracks(edgeTracks, "son tung mtp");
      expect(res2.some((t) => t.id === "e4")).toBe(true);
    });

    it("matches queries without apostrophe against titles with apostrophes", () => {
      const res1 = filterTracks(edgeTracks, "dont coi");
      expect(res1.some((t) => t.id === "e5")).toBe(true);

      const res2 = filterTracks(edgeTracks, "dont stop");
      expect(res2.some((t) => t.id === "e10")).toBe(true);
    });

    it("matches hyphens and special symbols like 'kicm', 'lofi', 'asap'", () => {
      expect(filterTracks(edgeTracks, "kicm").some((t) => t.id === "e6")).toBe(true);
      expect(filterTracks(edgeTracks, "lofi").some((t) => t.id === "e7")).toBe(true);
      expect(filterTracks(edgeTracks, "asap").some((t) => t.id === "e8")).toBe(true);
    });

    it("does NOT produce false positives across word boundaries (e.g. 'the' matching 'Hit Here')", () => {
      const results = filterTracks(edgeTracks, "the");
      const matchedIds = results.map((t) => t.id);
      expect(matchedIds).not.toContain("e9"); // "Hit Here" should not match "the"
    });

    it("ranks exact and prefix matches higher than loose substring collisions", () => {
      const results = filterTracks(edgeTracks, "b ray");
      // "B ray" artists (e1, e2, e3, e11) should rank before random matches
      expect(["e1", "e2", "e3", "e11"]).toContain(results[0].id);
    });
  });

  describe("searchItems generic multi-field search", () => {
    const mixedSliceItems = [
      { id: "s1", sliceName: "Intro Drop", trackTitle: "Waiting For You", artist: "MONO", createdAt: 100 },
      { id: "s2", sliceName: "Chorus Peak", trackTitle: "Em Của Ngày Hôm Qua", artist: "Sơn Tùng M-TP", createdAt: 200 },
      { id: "s3", sliceName: "Guitar Solo", trackTitle: "Xin Đừng Nhấc Máy", artist: "B Ray", createdAt: 300 },
    ];

    it("matches slices by sliceName", () => {
      const res = searchItems(mixedSliceItems, "intro drop", (item) => ({
        title: item.sliceName,
        artist: item.artist,
        segmentName: item.trackTitle,
        createdAt: item.createdAt,
      }));
      expect(res.length).toBe(1);
      expect(res[0].id).toBe("s1");
    });

    it("matches slices by parent trackTitle or artist", () => {
      const res = searchItems(mixedSliceItems, "bray", (item) => ({
        title: item.sliceName,
        artist: item.artist,
        segmentName: item.trackTitle,
        createdAt: item.createdAt,
      }));
      expect(res.length).toBe(1);
      expect(res[0].id).toBe("s3");
    });

    it("handles null or undefined fields gracefully", () => {
      const itemsWithNulls = [
        { id: "n1", title: null, artist: undefined, seg: "" },
        { id: "n2", title: "Valid Song", artist: null, seg: null },
      ];
      const res = searchItems(itemsWithNulls, "valid", (item) => ({
        title: item.title,
        artist: item.artist,
        segmentName: item.seg,
      }));
      expect(res.length).toBe(1);
      expect(res[0].id).toBe("n2");
    });
  });
});


