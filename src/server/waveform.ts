import { existsSync } from "node:fs";

/**
 * Generate 1000 normalized peak points for WaveSurfer from an audio file using ffmpeg.
 * Bypasses browser decodeAudioData, saving gigabytes of RAM.
 */
export async function generatePeaks(filePath: string, targetPoints: number = 1000): Promise<number[]> {
  if (!existsSync(filePath)) {
    throw new Error(`Audio file not found: ${filePath}`);
  }

  // Use ffmpeg to downsample audio to mono 8-bit PCM (pcm_s8) at 100Hz
  // 100 samples/sec is fast and lightweight
  const ffmpegCmd = [
    "ffmpeg",
    "-v", "error",
    "-i", filePath,
    "-ac", "1",
    "-filter:a", "aresample=200",
    "-f", "s8",
    "-c:a", "pcm_s8",
    "-"
  ];

  const proc = Bun.spawn(ffmpegCmd, {
    stdout: "pipe",
    stderr: "pipe",
  });

  const chunks: Uint8Array[] = [];
  for await (const chunk of proc.stdout) {
    chunks.push(chunk);
  }

  await proc.exited;

  if (chunks.length === 0) {
    // Return empty fallback array
    return Array.from({ length: targetPoints }, () => 0.1);
  }

  // Combine chunks into a single Int8Array (since pcm_s8 is signed 8-bit, -128 to 127)
  const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
  const rawData = new Int8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    rawData.set(new Int8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength), offset);
    offset += chunk.byteLength;
  }

  // Downsample/bucket rawData into targetPoints (e.g. 1000)
  const peaks: number[] = [];
  const step = rawData.length / targetPoints;

  for (let i = 0; i < targetPoints; i++) {
    const start = Math.floor(i * step);
    const end = Math.min(Math.floor((i + 1) * step), rawData.length);
    let max = 0;
    for (let j = start; j < end; j++) {
      const absVal = Math.abs(rawData[j]);
      if (absVal > max) max = absVal;
    }
    // Normalize 0..127 to 0.0..1.0, with minimum 0.02 so quiet parts are still visible
    const normalized = Math.max(0.02, Math.min(1.0, max / 127));
    peaks.push(Number(normalized.toFixed(3)));
  }

  return peaks;
}
