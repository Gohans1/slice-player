/**
 * Shared process management utilities
 */

export async function killProcessSafely(proc: ReturnType<typeof Bun.spawn> | null): Promise<void> {
  if (!proc || proc.exitCode !== null || proc.killed || typeof proc.pid !== "number" || proc.pid <= 0) return;
  try {
    if (process.platform === "win32") {
      const killProc = Bun.spawn(["taskkill", "/F", "/T", "/PID", String(proc.pid)], {
        stdout: "ignore",
        stderr: "ignore",
      });
      await killProc.exited;
    } else {
      try {
        process.kill(-proc.pid, "SIGKILL");
      } catch {
        proc.kill();
      }
    }
    try { await proc.exited; } catch {}
  } catch {}
}
