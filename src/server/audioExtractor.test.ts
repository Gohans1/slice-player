import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, unlinkSync, mkdirSync, rmSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { extractAudioFromVideo } from "./audioExtractor";
import { SUPPORTED_AUDIO_EXTENSIONS, ingestLocalFile, ingestUploadedFile } from "./ingest";
import { deleteTrack } from "./db";

const TEST_DIR = resolve("./data/test_mp4_tmp");

beforeAll(async () => {
  mkdirSync(TEST_DIR, { recursive: true });

  // Generate 1-second MP4 with video and AAC audio
  const genAudioProc = Bun.spawn([
    "ffmpeg", "-v", "error", "-y",
    "-f", "lavfi", "-i", "testsrc=duration=1:size=320x240:rate=1",
    "-f", "lavfi", "-i", "sine=frequency=1000:duration=1",
    "-c:v", "libx264", "-c:a", "aac",
    join(TEST_DIR, "sample_with_audio.mp4"),
  ]);
  await genAudioProc.exited;

  // Generate 1-second MP4 with video ONLY (no audio stream)
  const genNoAudioProc = Bun.spawn([
    "ffmpeg", "-v", "error", "-y",
    "-f", "lavfi", "-i", "testsrc=duration=1:size=320x240:rate=1",
    "-c:v", "libx264",
    join(TEST_DIR, "sample_no_audio.mp4"),
  ]);
  await genNoAudioProc.exited;
});

afterAll(() => {
  try {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
    const cacheDir = resolve("./data/cache/audio");
    if (existsSync(cacheDir)) {
      const files = readdirSync(cacheDir).filter((f: string) => f.startsWith("loc_1b95f672f3e0") || f.startsWith("loc_32d7892cec5d") || f.startsWith("loc_e7995914fa76"));
      for (const f of files) {
        try { unlinkSync(join(cacheDir, f)); } catch {}
      }
    }
    deleteTrack("loc_1b95f672f3e0");
    deleteTrack("loc_32d7892cec5d");
  } catch {}
});

describe("MP4 Audio Extraction & Support", () => {
  it("SUPPORTED_AUDIO_EXTENSIONS should include .mp4", () => {
    expect((SUPPORTED_AUDIO_EXTENSIONS as readonly string[]).includes(".mp4")).toBe(true);
  });

  it("extractAudioFromVideo should extract audio stream from MP4 without video", async () => {
    const inputMp4 = join(TEST_DIR, "sample_with_audio.mp4");
    const outputM4a = join(TEST_DIR, "extracted.m4a");
    if (existsSync(outputM4a)) unlinkSync(outputM4a);

    const result = await extractAudioFromVideo(inputMp4, outputM4a);
    expect(result.success).toBe(true);
    expect(existsSync(outputM4a)).toBe(true);

    // Verify output file contains NO video stream
    const probeProc = Bun.spawn(
      ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_type", "-of", "default=noprint_wrappers=1:nokey=1", outputM4a],
      { stdout: "pipe", stderr: "ignore" }
    );
    const videoStreamOutput = probeProc.stdout ? await new Response(probeProc.stdout as ReadableStream<Uint8Array>).text() : "";
    await probeProc.exited;
    expect(videoStreamOutput.trim()).toBe("");
  });

  it("extractAudioFromVideo should fail if MP4 contains no audio stream", async () => {
    const inputMp4 = join(TEST_DIR, "sample_no_audio.mp4");
    const outputM4a = join(TEST_DIR, "extracted_fail.m4a");

    const result = await extractAudioFromVideo(inputMp4, outputM4a);
    expect(result.success).toBe(false);
    expect(result.message).toContain("không chứa luồng âm thanh");
  });

  it("extractAudioFromVideo should fail gracefully if file does not exist", async () => {
    const result = await extractAudioFromVideo(join(TEST_DIR, "not_found.mp4"), join(TEST_DIR, "out.m4a"));
    expect(result.success).toBe(false);
  });

  it("ingestLocalFile should ingest MP4 and extract audio to cache", async () => {
    const inputMp4 = join(TEST_DIR, "sample_with_audio.mp4");
    const res = await ingestLocalFile(inputMp4, "Test MP4 Song");
    expect(res.success).toBe(true);
    expect(res.tracks).toBeDefined();
    expect(res.tracks!.length).toBe(1);
    const track = res.tracks![0];
    expect(track.title).toBe("Test MP4 Song");
    expect(track.file_path).toBeDefined();
    // file_path should point to extracted audio (.m4a), NOT .mp4
    expect(track.file_path!.endsWith(".m4a")).toBe(true);
    expect(existsSync(track.file_path!)).toBe(true);
  });

  it("ingestUploadedFile should extract audio to .m4a and create track from uploaded MP4", async () => {
    const inputMp4 = join(TEST_DIR, "sample_with_audio.mp4");
    const mp4Bytes = await Bun.file(inputMp4).arrayBuffer();
    const file = new File([mp4Bytes], "uploaded_clip.mp4", { type: "video/mp4" });

    const res = await ingestUploadedFile(file);
    expect(res.success).toBe(true);
    expect(res.tracks).toBeDefined();
    expect(res.tracks!.length).toBe(1);
    const track = res.tracks![0];
    expect(track.file_path).toBeDefined();
    expect(track.file_path!.endsWith(".m4a")).toBe(true);
    expect(existsSync(track.file_path!)).toBe(true);
    // Ensure NO video file (.mp4) is retained in cache
    const cacheDir = resolve("./data/cache/audio");
    const mp4Files = readdirSync(cacheDir).filter((f: string) => f.endsWith(".mp4"));
    expect(mp4Files.length).toBe(0);
  });
});
