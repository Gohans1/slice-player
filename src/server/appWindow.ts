import { existsSync } from "node:fs";
import { resolve, win32 } from "node:path";

const APP_BROWSERS = [win32.join("Microsoft", "Edge", "Application", "msedge.exe"), win32.join("Google", "Chrome", "Application", "chrome.exe")];

// Chromium browsers can show a page as its own window without tabs or address bar; Edge comes with Windows
export function findAppBrowser(env: Record<string, string | undefined> = process.env, exists: (path: string) => boolean = existsSync): string | null {
  const roots = [env["ProgramFiles(x86)"], env.ProgramFiles, env.LOCALAPPDATA].filter((root) => root !== undefined);
  for (const browser of APP_BROWSERS) {
    for (const root of roots) {
      const path = win32.join(root, browser);
      if (exists(path)) return path;
    }
  }
  return null;
}

// shortcut: Windows only, like the start.bat it replaces; add launchers for other systems if the app ships there
export function openAppWindow(url: string) {
  if (process.platform !== "win32") return;
  const browser = findAppBrowser();
  const command = browser
    ? [browser, `--app=${url}`, `--user-data-dir=${resolve("data/edge_profile")}`, "--autoplay-policy=no-user-gesture-required", "--start-maximized"]
    : ["cmd", "/c", "start", "", url];
  // Detached so the window outlives this process: a second launch exits right after opening it
  Bun.spawn(command, { detached: true, stdio: ["ignore", "ignore", "ignore"], windowsHide: !browser }).unref();
}

export async function isServerRunning(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/api/tracks`, { signal: AbortSignal.timeout(1000) });
    return res.ok;
  } catch {
    return false;
  }
}
