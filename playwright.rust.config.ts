import { existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";

// Real-backend E2E suite: starts the compiled Rust `slice-server` binary in a throwaway temp
// working directory with `dist/` symlinked in so `./data/music.db` and `./data/cache` are isolated
// from the developer's real library, and runs with zero API or WebSocket mocks.
const PORT = 5397;
const repoRoot = resolve(import.meta.dir);
const distDir = join(repoRoot, "dist");
const serverBin = join(
  repoRoot,
  process.platform === "win32" ? "target/release/slice-server.exe" : "target/release/slice-server",
);
if (!existsSync(join(distDir, "index.html")) || !existsSync(serverBin)) {
  throw new Error("Run 'bun run build:exe' before running 'bun run test:e2e:rust'");
}

let workDir = process.env.SLICE_E2E_RUST_WORKDIR;
if (!workDir) {
  workDir = mkdtempSync(join(tmpdir(), "slice-rust-e2e-"));
  process.env.SLICE_E2E_RUST_WORKDIR = workDir;
  symlinkSync(distDir, join(workDir, "dist"), "junction");
  const dirToClean = workDir;
  process.on("exit", () => {
    try {
      rmSync(dirToClean, { recursive: true, force: true });
    } catch {}
  });
}

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
