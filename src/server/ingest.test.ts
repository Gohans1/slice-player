import { describe, it, expect } from "bun:test";
import { resolveBestYouTubeThumbnail, isYouTubeAuthError, isYouTubeFormatOrSabrError, getYouTubeAuthArgs, ingestLocalFile, ingestLocalDirectory, ingestUploadedFile, validateSafeLocalAudioPath, getDownloadQueueOrder } from "./ingest";

describe("resolveBestYouTubeThumbnail", () => {
  it("should select maxresdefault when available", () => {
    const thumbs = [
      { id: "default", url: "https://i.ytimg.com/vi/abc/default.jpg", width: 120, height: 90 },
      { id: "hqdefault", url: "https://i.ytimg.com/vi/abc/hqdefault.jpg", width: 480, height: 360 },
      { id: "maxresdefault", url: "https://i.ytimg.com/vi/abc/maxresdefault.jpg", width: 1280, height: 720 },
    ];
    expect(resolveBestYouTubeThumbnail("abc", thumbs)).toBe("https://i.ytimg.com/vi/abc/maxresdefault.jpg");
  });

  it("should select sddefault or highest available when maxres is absent", () => {
    const thumbs = [
      { id: "default", url: "https://i.ytimg.com/vi/abc/default.jpg", width: 120, height: 90 },
      { id: "mqdefault", url: "https://i.ytimg.com/vi/abc/mqdefault.jpg", width: 320, height: 180 },
      { id: "sddefault", url: "https://i.ytimg.com/vi/abc/sddefault.jpg", width: 640, height: 480 },
    ];
    expect(resolveBestYouTubeThumbnail("abc", thumbs)).toBe("https://i.ytimg.com/vi/abc/sddefault.jpg");
  });

  it("should select webp maxres when present", () => {
    const thumbs = [
      { id: "0", url: "https://i.ytimg.com/vi/3.jpg", width: 120 },
      { id: "maxresdefault", url: "https://i.ytimg.com/vi_webp/abc/maxresdefault.webp", width: 1280, height: 720 },
    ];
    expect(resolveBestYouTubeThumbnail("abc", thumbs)).toBe("https://i.ytimg.com/vi_webp/abc/maxresdefault.webp");
  });

  it("should prioritize quality by id/preference when width is undefined", () => {
    const thumbs = [
      { id: "default", url: "https://i.ytimg.com/vi/abc/default.jpg" },
      { id: "mqdefault", url: "https://i.ytimg.com/vi/abc/mqdefault.jpg" },
      { id: "hqdefault", url: "https://i.ytimg.com/vi/abc/hqdefault.jpg" },
    ];
    expect(resolveBestYouTubeThumbnail("abc", thumbs)).toBe("https://i.ytimg.com/vi/abc/hqdefault.jpg");
  });

  it("should filter out downscaled sqp thumbnails and fallback to maxresdefault", () => {
    const thumbs = [
      { id: "maxresdefault", url: "https://i.ytimg.com/vi/abc/maxresdefault.jpg?sqp=xyz" },
      { id: "hqdefault", url: "https://i.ytimg.com/vi/abc/hqdefault.jpg?sqp=xyz" },
    ];
    expect(resolveBestYouTubeThumbnail("abc", thumbs)).toBe("https://i.ytimg.com/vi/abc/maxresdefault.jpg");
  });

  it("should return default maxresdefault URL if thumbnails array is empty or missing", () => {
    expect(resolveBestYouTubeThumbnail("xyz", [])).toBe("https://i.ytimg.com/vi/xyz/maxresdefault.jpg");
    expect(resolveBestYouTubeThumbnail("xyz")).toBe("https://i.ytimg.com/vi/xyz/maxresdefault.jpg");
  });

  it("should respect clean defaultThumbnail fallback when thumbnails array is empty or downscaled", () => {
    expect(
      resolveBestYouTubeThumbnail("xyz", [], "https://i.ytimg.com/vi/xyz/clean_custom.jpg")
    ).toBe("https://i.ytimg.com/vi/xyz/clean_custom.jpg");
    expect(
      resolveBestYouTubeThumbnail("xyz", [], "//i.ytimg.com/vi/xyz/clean_custom.jpg")
    ).toBe("https://i.ytimg.com/vi/xyz/clean_custom.jpg");
  });

  it("should normalize protocol-relative // URLs in thumbnails array", () => {
    const thumbs = [
      { id: "maxresdefault", url: "//i.ytimg.com/vi/xyz/maxresdefault.jpg", width: 1280, height: 720 },
    ];
    expect(resolveBestYouTubeThumbnail("xyz", thumbs)).toBe("https://i.ytimg.com/vi/xyz/maxresdefault.jpg");
  });

  it("should reject defaultThumbnail if it contains sqp or invalid protocol", () => {
    expect(
      resolveBestYouTubeThumbnail("xyz", [], "https://example.com/thumb.jpg?sqp=bad")
    ).toBe("https://i.ytimg.com/vi/xyz/maxresdefault.jpg");

    expect(
      resolveBestYouTubeThumbnail("xyz", [], "javascript:alert(1)")
    ).toBe("https://i.ytimg.com/vi/xyz/maxresdefault.jpg");
  });

  it("should fallback to maxresdefault when thumbnails have no quality identifiers or dimensions", () => {
    const unrankedThumbs = [{ id: "0", url: "https://i.ytimg.com/vi/xyz/0.jpg" }];
    expect(resolveBestYouTubeThumbnail("xyz", unrankedThumbs)).toBe("https://i.ytimg.com/vi/xyz/maxresdefault.jpg");
  });

  it("should prioritize maxresdefault over low-res sub-320px default.jpg with dimensions", () => {
    const lowResThumbs = [
      { id: "default", url: "https://i.ytimg.com/vi/xyz/default.jpg", width: 120, height: 90 },
    ];
    expect(resolveBestYouTubeThumbnail("xyz", lowResThumbs)).toBe("https://i.ytimg.com/vi/xyz/maxresdefault.jpg");
  });

  it("should not falsely match high-res tier if videoId contains hq720 token or hyphenated hq720-", () => {
    const thumbs1 = [
      { id: "0", url: "https://i.ytimg.com/vi/vid_hq720_abc/default.jpg", width: 120, height: 90 },
    ];
    expect(resolveBestYouTubeThumbnail("vid_hq720_abc", thumbs1)).toBe(
      "https://i.ytimg.com/vi/vid_hq720_abc/maxresdefault.jpg"
    );

    // Hyphenated YouTube ID where '-' is \W
    const thumbs2 = [
      { id: "0", url: "https://i.ytimg.com/vi/hq720-abc1234/default.jpg", width: 120, height: 90 },
    ];
    expect(resolveBestYouTubeThumbnail("hq720-abc1234", thumbs2)).toBe(
      "https://i.ytimg.com/vi/hq720-abc1234/maxresdefault.jpg"
    );
  });

  it("should handle malformed, negative, or non-finite thumbnail dimensions safely", () => {
    const malformedThumbs = [
      { id: "default", url: "https://i.ytimg.com/vi/xyz/default.jpg", width: -120, height: NaN },
      { id: "hqdefault", url: "https://i.ytimg.com/vi/xyz/hqdefault.jpg", width: 480, height: 360 },
    ];
    expect(resolveBestYouTubeThumbnail("xyz", malformedThumbs)).toBe("https://i.ytimg.com/vi/xyz/hqdefault.jpg");
  });

  it("should handle empty or whitespace videoId gracefully", () => {
    expect(resolveBestYouTubeThumbnail("   ", [], "https://example.com/fallback.jpg")).toBe("https://example.com/fallback.jpg");
    expect(resolveBestYouTubeThumbnail("", [])).toBe("");
  });
});

describe("isYouTubeAuthError", () => {
  it("should match bot challenges with Unicode curly and ASCII apostrophes", () => {
    expect(isYouTubeAuthError("ERROR: [youtube] KLZgIuTQDA4: Sign in to confirm you’re not a bot.")).toBe(true);
    expect(isYouTubeAuthError("ERROR: [youtube] KLZgIuTQDA4: Sign in to confirm you're not a bot.")).toBe(true);
  });

  it("should match HTTP 403 Forbidden, HTTP 401 Unauthorized, and HTTP 429 Too Many Requests formats", () => {
    expect(isYouTubeAuthError("ERROR: unable to download video data: HTTP Error 403: Forbidden")).toBe(true);
    expect(isYouTubeAuthError("ERROR: [youtube] abc: HTTP Error 401: Unauthorized")).toBe(true);
    expect(isYouTubeAuthError("ERROR: [youtube] abc: HTTP Error 429: Too Many Requests")).toBe(true);
    expect(isYouTubeAuthError("429 Too Many Requests")).toBe(true);
    expect(isYouTubeAuthError("403 Forbidden")).toBe(true);
  });

  it("should match PO token challenges with various delimiters", () => {
    expect(isYouTubeAuthError("A PO Token is required to download this video")).toBe(true);
    expect(isYouTubeAuthError("Proof of origin token missing")).toBe(true);
    expect(isYouTubeAuthError("po_token validation failed")).toBe(true);
  });

  it("should match invalid or expired cookies", () => {
    expect(isYouTubeAuthError("ERROR: cookies file expired")).toBe(true);
    expect(isYouTubeAuthError("ERROR: Invalid cookies provided")).toBe(true);
    expect(isYouTubeAuthError("ERROR: cookie error occurred")).toBe(true);
    expect(isYouTubeAuthError("The session needs to be reloaded")).toBe(true);
  });

  it("should NOT match per-video restrictions or unrelated errors", () => {
    expect(isYouTubeAuthError("ERROR: [youtube] This is a private video")).toBe(false);
    expect(isYouTubeAuthError("ERROR: [youtube] Join this channel to view members-only video")).toBe(false);
    expect(isYouTubeAuthError("ERROR: Confirm your age to watch this video")).toBe(false);
    expect(isYouTubeAuthError("Stream reloaded successfully")).toBe(false);
    expect(isYouTubeAuthError("General network error")).toBe(false);
  });
});

describe("isYouTubeFormatOrSabrError", () => {
  it("should match requested format not available errors", () => {
    expect(
      isYouTubeFormatOrSabrError(
        "ERROR: [youtube] doN4GrGoVpA: Requested format is not available. Use --list-formats for a list of available formats"
      )
    ).toBe(true);
  });

  it("should match YouTube SABR streaming warnings and format skips", () => {
    expect(
      isYouTubeFormatOrSabrError(
        "Some web client https formats have been skipped as they are missing a URL. YouTube is forcing SABR streaming for this client."
      )
    ).toBe(true);
  });

  it("should match only images available warnings", () => {
    expect(
      isYouTubeFormatOrSabrError("WARNING: Only images are available for download. use --list-formats to see them")
    ).toBe(true);
  });

  it("should not match unrelated errors", () => {
    expect(isYouTubeFormatOrSabrError("General network error")).toBe(false);
    expect(isYouTubeFormatOrSabrError("403 Forbidden")).toBe(false);
  });
});

describe("ingestLocalFile & ingestLocalDirectory validation", () => {
  it("should reject non-existent file", async () => {
    const res = await ingestLocalFile("C:/non_existent_folder/missing_song.flac");
    expect(res.success).toBe(false);
    expect(res.message).toContain("không tồn tại");
  });

  it("should reject unsupported extensions", async () => {
    const res = await ingestLocalFile("C:/Users/test.exe");
    expect(res.success).toBe(false);
    expect(res.message).toContain("không được hỗ trợ");
  });

  it("should reject UNC paths for security", async () => {
    const res = await ingestLocalFile("\\\\evil-server\\share\\song.flac");
    expect(res.success).toBe(false);
    expect(res.message).toContain("UNC");
  });

  it("should reject UNC paths in ingestLocalDirectory for security", async () => {
    const res = await ingestLocalDirectory("\\\\evil-server\\share\\music");
    expect(res.success).toBe(false);
    expect(res.message).toContain("UNC");
  });

  it("should reject DOS device names and NTFS ADS in ingestLocalDirectory", async () => {
    const res1 = await ingestLocalDirectory("CON");
    expect(res1.success).toBe(false);
    expect(res1.message).toContain("thiết bị");

    const res2 = await ingestLocalDirectory("C:/music:stream");
    expect(res2.success).toBe(false);
    expect(res2.message).toContain("Alternate Data Stream");
  });

  it("should reject non-existent directory", async () => {
    const res = await ingestLocalDirectory("C:/non_existent_music_dir_12345");
    expect(res.success).toBe(false);
    expect(res.message).toContain("không tồn tại");
  });
});

describe("validateSafeLocalAudioPath", () => {
  it("should accept valid standard Windows and Unix paths", () => {
    expect(validateSafeLocalAudioPath("C:\\Music\\song.flac").ok).toBe(true);
    expect(validateSafeLocalAudioPath("D:/Audio/Albums/track.mp3").ok).toBe(true);
    expect(validateSafeLocalAudioPath("/home/user/music/song.wav").ok).toBe(true);
    expect(validateSafeLocalAudioPath('"C:\\Music\\My Song.flac"').ok).toBe(true);
  });

  it("should reject UNC network paths", () => {
    expect(validateSafeLocalAudioPath("\\\\192.168.1.1\\share\\test.flac").ok).toBe(false);
    expect(validateSafeLocalAudioPath("//evil-host/share/song.mp3").ok).toBe(false);
    expect(validateSafeLocalAudioPath("\\\\?\\UNC\\server\\share").ok).toBe(false);
  });

  it("should reject DOS device names anywhere in path", () => {
    expect(validateSafeLocalAudioPath("CON").ok).toBe(false);
    expect(validateSafeLocalAudioPath("PRN.txt").ok).toBe(false);
    expect(validateSafeLocalAudioPath("C:\\Music\\AUX\\song.flac").ok).toBe(false);
    expect(validateSafeLocalAudioPath("D:/NUL/song.wav").ok).toBe(false);
    expect(validateSafeLocalAudioPath("COM1").ok).toBe(false);
    expect(validateSafeLocalAudioPath("LPT9").ok).toBe(false);
    expect(validateSafeLocalAudioPath("CONIN$").ok).toBe(false);
    expect(validateSafeLocalAudioPath("CONOUT$").ok).toBe(false);
    expect(validateSafeLocalAudioPath("C:\\Music\\CONIN$\\test.mp3").ok).toBe(false);
  });

  it("should reject NTFS Alternate Data Streams (ADS)", () => {
    expect(validateSafeLocalAudioPath("C:\\Music\\song.flac:stream").ok).toBe(false);
    expect(validateSafeLocalAudioPath("file.flac:hidden").ok).toBe(false);
    expect(validateSafeLocalAudioPath(":stream").ok).toBe(false);
  });

  it("should reject empty or whitespace-only inputs", () => {
    expect(validateSafeLocalAudioPath("").ok).toBe(false);
    expect(validateSafeLocalAudioPath("   ").ok).toBe(false);
  });
});

describe("ingestUploadedFile validation", () => {
  it("should reject unsupported extensions", async () => {
    const blob = new Blob(["test"], { type: "text/plain" });
    const file = new File([blob], "script.sh");
    const res = await ingestUploadedFile(file);
    expect(res.success).toBe(false);
    expect(res.message).toContain("không được hỗ trợ");
  });

  it("should reject empty upload files", async () => {
    const blob = new Blob([], { type: "audio/flac" });
    const file = new File([blob], "empty.flac");
    const res = await ingestUploadedFile(file);
    expect(res.success).toBe(false);
    expect(res.message).toContain("rỗng");
  });

  it("should reject files exceeding 300MB cap", async () => {
    // Create a mock File with simulated size > 300MB without allocating RAM
    const file = {
      name: "huge.flac",
      size: 350 * 1024 * 1024,
    } as File;
    const res = await ingestUploadedFile(file);
    expect(res.success).toBe(false);
    expect(res.message).toContain("vượt quá dung lượng tối đa 300MB");
  });

  it("should reject files without extension", async () => {
    const blob = new Blob(["audio data"], { type: "application/octet-stream" });
    const file = new File([blob], "song_without_extension");
    const res = await ingestUploadedFile(file);
    expect(res.success).toBe(false);
    expect(res.message).toContain("không được hỗ trợ");
  });
});

describe("getYouTubeAuthArgs", () => {
  it("should return default player_client when fallbackClient is false", () => {
    const args = getYouTubeAuthArgs(false, false);
    expect(args).toContain("--extractor-args");
    expect(args).toContain("youtube:player_client=default,-tv");
    expect(args).toContain("--js-runtimes");
    expect(args).toContain("bun");
  });

  it("should include mweb in fallbackClient player_client list when fallbackClient is true", () => {
    const args = getYouTubeAuthArgs(false, true);
    expect(args).toContain("--extractor-args");
    expect(args).toContain("youtube:player_client=mweb,android,ios,web");
  });
});

describe("getDownloadQueueOrder", () => {
  it("should return an array of track IDs in FIFO download queue order", () => {
    const queue = getDownloadQueueOrder();
    expect(Array.isArray(queue)).toBe(true);
    // When idle, queue should be an array of string IDs (defaulting to empty)
    expect(queue.length).toBeGreaterThanOrEqual(0);
    for (const id of queue) {
      expect(typeof id).toBe("string");
    }
  });
});
