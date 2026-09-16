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

  try {
    const proc = Bun.spawn(ffmpegCmd, {
      stdout: "pipe",
      stderr: "ignore",
    });

    // 60s timeout to kill hanging ffmpeg
    const killTimer = setTimeout(() => {
      try {
        proc.kill();
      } catch {}
    }, 60000);

    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    const MAX_BYTES = 50 * 1024 * 1024; // 50MB cap to prevent OOM

    try {
      for await (const chunk of proc.stdout) {
        totalBytes += chunk.length;
        if (totalBytes > MAX_BYTES) {
          proc.kill();
          break;
        }
        chunks.push(chunk);
      }
    } finally {
      clearTimeout(killTimer);
    }

    await proc.exited;

    if (chunks.length === 0) {
      return Array.from({ length: targetPoints }, () => 0.1);
    }

    const merged = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }

    const samples = new Int8Array(merged.buffer, merged.byteOffset, merged.byteLength);
    const blockSize = Math.floor(samples.length / targetPoints);
    const peaks: number[] = [];

    if (blockSize <= 1) {
      for (let i = 0; i < targetPoints; i++) {
        const val = i < samples.length ? Math.abs(samples[i]) / 128 : 0.05;
        peaks.push(Number(val.toFixed(3)));
      }
    } else {
      for (let i = 0; i < targetPoints; i++) {
        let max = 0;
        const start = i * blockSize;
        const end = Math.min(start + blockSize, samples.length);
        for (let j = start; j < end; j++) {
          const val = Math.abs(samples[j]);
          if (val > max) max = val;
        }
        peaks.push(Number((max / 128).toFixed(3)));
      }
    }

    return peaks;
  } catch (err) {
    console.warn("[Waveform] ffmpeg execution failed, falling back to synthetic peaks:", err);
    return Array.from({ length: targetPoints }, () => 0.1);
  }
}
