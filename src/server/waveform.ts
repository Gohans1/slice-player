import { existsSync } from "node:fs";

const activeWaveformProcs = new Set<ReturnType<typeof Bun.spawn>>();

export async function abortWaveformProcesses(): Promise<void> {
  for (const proc of activeWaveformProcs) {
    try {
      if (process.platform === "win32") {
        const killProc = Bun.spawn(["taskkill", "/F", "/T", "/PID", String(proc.pid)], {
          stdout: "ignore",
          stderr: "ignore",
        });
        await killProc.exited;
      } else {
        proc.kill();
      }
    } catch {}
  }
  activeWaveformProcs.clear();
}

/**
 * Generate 1000 normalized peak points for WaveSurfer from an audio file using ffmpeg.
 * Bypasses browser decodeAudioData, saving gigabytes of RAM.
 */
export async function generatePeaks(filePath: string, targetPoints: number = 1000): Promise<number[]> {
  if (!existsSync(filePath)) {
    throw new Error(`Audio file not found: ${filePath}`);
  }

  // Extract mono 8-bit PCM at 200Hz directly to stdout via ffmpeg
  // 200 samples/sec is fast and lightweight (a 30-minute track is only ~360,000 bytes)
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

  function killFfmpeg(p: ReturnType<typeof Bun.spawn> | null) {
    if (!p) return;
    try {
      activeWaveformProcs.delete(p);
      if (process.platform === "win32") {
        Bun.spawn(["taskkill", "/F", "/T", "/PID", String(p.pid)], {
          stdout: "ignore",
          stderr: "ignore",
        });
      } else {
        p.kill();
      }
    } catch {}
  }

  let proc: ReturnType<typeof Bun.spawn> | null = null;
  try {
    proc = Bun.spawn(ffmpegCmd, {
      stdout: "pipe",
      stderr: "ignore",
    });
    activeWaveformProcs.add(proc);

    // 60s timeout to kill hanging ffmpeg
    const killTimer = setTimeout(() => {
      killFfmpeg(proc);
    }, 60000);

    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    const MAX_BYTES = 50 * 1024 * 1024; // 50MB cap to prevent OOM

    try {
      const stdoutStream = proc.stdout as ReadableStream<Uint8Array>;
      const reader = stdoutStream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          if (totalBytes + value.length > MAX_BYTES) {
            killFfmpeg(proc);
            break;
          }
          totalBytes += value.length;
          chunks.push(value);
        }
      }
    } finally {
      clearTimeout(killTimer);
    }

    await proc.exited;
    activeWaveformProcs.delete(proc);

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
        const sampleIdx = Math.floor((i / targetPoints) * samples.length);
        const val = samples.length > 0 ? Math.abs(samples[sampleIdx] || 0) / 128 : 0.05;
        peaks.push(Number(val.toFixed(3)));
      }
    } else {
      for (let i = 0; i < targetPoints; i++) {
        let max = 0;
        const start = i * blockSize;
        const end = i === targetPoints - 1 ? samples.length : Math.min(start + blockSize, samples.length);
        for (let j = start; j < end; j++) {
          const val = Math.abs(samples[j]);
          if (val > max) max = val;
        }
        peaks.push(Number((max / 128).toFixed(3)));
      }
    }

    return peaks;
  } catch (err) {
    if (proc) activeWaveformProcs.delete(proc);
    console.warn("[Waveform] ffmpeg execution failed, falling back to synthetic peaks:", err);
    return Array.from({ length: targetPoints }, () => 0.1);
  }
}
