import { defineConfig, devices } from "@playwright/test";

// Browser tests for what happy-dom can't check, such as layout, scrolling and focus. The client runs on a port of its
// own and every test serves it a library from memory (e2e/mock-library.ts), so no test reaches a real library.
const PORT = 5297;

export default defineConfig({
  testDir: "./e2e",
  testIgnore: ["**/rust-backend/**"],
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
    launchOptions: { args: ["--mute-audio"] },
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `bunx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
  },
});
