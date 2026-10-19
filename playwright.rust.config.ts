import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";

// Real-backend E2E suite: starts the compiled Rust `slice-server` binary in a throwaway temp
// working directory with `dist/` symlinked in so `./data/music.db` and `./data/cache` are isolated
// from the developer's real library, and runs with zero API or WebSocket mocks.
const PORT = 5397;
const repoRoot = resolve(import.meta.dir);
const workDir = mkdtempSync(join(tmpdir(), "slice-rust-e2e-"));
try {
  symlinkSync(join(repoRoot, "dist"), join(workDir, "dist"), "dir");
} catch {}
process.on("exit", () => {
  try {
    rmSync(workDir, { recursive: true, force: true });
  } catch {}
});

const serverBin = join(
  repoRoot,
  process.platform === "win32" ? "target/release/slice-server.exe" : "target/release/slice-server",
);

export default defineConfig({
  testDir: "./e2e/rust-backend",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "on-first-retry",
    launchOptions: { args: ["--mute-audio"] },
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    command: serverBin,
    cwd: workDir,
    env: {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: "development",
    },
    url: `http://127.0.0.1:${PORT}/api/tracks`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
