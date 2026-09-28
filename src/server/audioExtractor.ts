import { existsSync, statSync, unlinkSync } from "node:fs";
import { killProcessSafely } from "./processUtils";

/**
 * Checks if the video file contains an audio stream using ffprobe
 */
export async function hasAudioStream(filePath: string): Promise<boolean> {
  if (!existsSync(filePath)) return false;

  let proc: ReturnType<typeof Bun.spawn> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  try {
    proc = Bun.spawn(
      ["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_type", "-of", "default=noprint_wrappers=1:nokey=1", filePath],
      { stdout: "pipe", stderr: "ignore" }
    );

    timer = setTimeout(async () => {
      await killProcessSafely(proc);
    }, 5000);

    const outText = proc.stdout ? await new Response(proc.stdout as ReadableStream<Uint8Array>).text() : "";
    await proc.exited;
    return outText.trim().toLowerCase().includes("audio");
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
    if (proc && proc.exitCode === null) {
      await killProcessSafely(proc);
    }
  }
}

export interface ExtractResult {
  success: boolean;
  message?: string;
}

/**
 * Extracts audio track from video file, stripping video entirely.
 * Tries fast zero-copy stream copy first, then falls back to AAC transcoding.
 */
export async function extractAudioFromVideo(inputPath: string, outputPath: string): Promise<ExtractResult> {
  if (!existsSync(inputPath)) {
    return { success: false, message: `File không tồn tại: ${inputPath}` };
  }

  const hasAudio = await hasAudioStream(inputPath);
  if (!hasAudio) {
    return { success: false, message: "File MP4 không chứa luồng âm thanh nào." };
  }

  // Attempt 1: Fast zero-copy stream extraction (-vn -c:a copy)
  let copyProc: ReturnType<typeof Bun.spawn> | null = null;
  let copyTimer: ReturnType<typeof setTimeout> | null = null;

  try {
    copyProc = Bun.spawn(
      ["ffmpeg", "-v", "error", "-y", "-i", inputPath, "-vn", "-c:a", "copy", outputPath],
      { stdout: "ignore", stderr: "ignore" }
    );

    copyTimer = setTimeout(async () => {
      await killProcessSafely(copyProc);
    }, 30000);

    const exitCode = await copyProc.exited;
    if (exitCode === 0 && existsSync(outputPath) && statSync(outputPath).size > 0) {
      return { success: true };
    }
  } catch {
    // Fall through to fallback transcode
  } finally {
    if (copyTimer) clearTimeout(copyTimer);
    if (copyProc && copyProc.exitCode === null) {
      await killProcessSafely(copyProc);
    }
    // Clean up partial/corrupt file from failed copy before fallback
    if (existsSync(outputPath) && (copyProc?.exitCode !== 0 || statSync(outputPath).size === 0)) {
      try { unlinkSync(outputPath); } catch {}
    }
  }

  // Attempt 2: Fallback AAC transcode if stream copy is incompatible with .m4a container
  let transcodeProc: ReturnType<typeof Bun.spawn> | null = null;
  let transcodeTimer: ReturnType<typeof setTimeout> | null = null;

  try {
    transcodeProc = Bun.spawn(
      ["ffmpeg", "-v", "error", "-y", "-i", inputPath, "-vn", "-c:a", "aac", "-b:a", "256k", outputPath],
      { stdout: "ignore", stderr: "pipe" }
    );

    transcodeTimer = setTimeout(async () => {
      await killProcessSafely(transcodeProc);
    }, 60000);

    const errTextPromise = transcodeProc.stderr
      ? new Response(transcodeProc.stderr as ReadableStream<Uint8Array>).text()
      : Promise.resolve("");

    const exitCode = await transcodeProc.exited;
    const errText = await errTextPromise;

    if (exitCode === 0 && existsSync(outputPath) && statSync(outputPath).size > 0) {
      return { success: true };
    }

    if (existsSync(outputPath)) {
      try { unlinkSync(outputPath); } catch {}
    }

    if (errText.trim()) {
      return { success: false, message: `Lỗi trích xuất audio: ${errText.trim()}` };
    }
  } catch (err: unknown) {
    if (existsSync(outputPath)) {
      try { unlinkSync(outputPath); } catch {}
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, message: `Lỗi trích xuất audio: ${msg}` };
  } finally {
    if (transcodeTimer) clearTimeout(transcodeTimer);
    if (transcodeProc && transcodeProc.exitCode === null) {
      await killProcessSafely(transcodeProc);
    }
  }

  if (existsSync(outputPath)) {
    try { unlinkSync(outputPath); } catch {}
  }

  return { success: false, message: "Không thể trích xuất âm thanh từ file MP4." };
}
