import { describe, it, expect } from "bun:test";
import { resolvePlaylistCover } from "./playlistCover";

describe("resolvePlaylistCover", () => {
  it("uses the chosen cover over the mosaic", () => {
    const cover = resolvePlaylistCover({
      cover_url: "https://img/chosen.jpg",
      mosaic_urls: ["https://img/a.jpg", "https://img/b.jpg", "https://img/c.jpg", "https://img/d.jpg"],
    });

    expect(cover).toEqual({ kind: "single", url: "https://img/chosen.jpg" });
  });

  it("builds a 2x2 mosaic when at least 4 thumbnails exist", () => {
    const cover = resolvePlaylistCover({
      cover_url: null,
      mosaic_urls: ["https://img/a.jpg", "https://img/b.jpg", "https://img/c.jpg", "https://img/d.jpg"],
    });

    expect(cover).toEqual({
      kind: "mosaic",
      urls: ["https://img/a.jpg", "https://img/b.jpg", "https://img/c.jpg", "https://img/d.jpg"],
    });
  });

  it("falls back to the first thumbnail when fewer than 4 exist", () => {
    const cover = resolvePlaylistCover({ cover_url: null, mosaic_urls: ["https://img/a.jpg", "https://img/b.jpg"] });

    expect(cover).toEqual({ kind: "single", url: "https://img/a.jpg" });
  });

  it("is empty when the playlist has no thumbnails", () => {
    expect(resolvePlaylistCover({ cover_url: null, mosaic_urls: [] })).toEqual({ kind: "empty" });
  });

  it("treats a playlist from an older server without cover fields as empty", () => {
    expect(resolvePlaylistCover({})).toEqual({ kind: "empty" });
  });
});
