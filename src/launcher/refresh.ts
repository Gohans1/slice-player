// Brings the app up to the code in this checkout before a launcher opens it, so it always runs what was last
// merged: installs what the lockfile asks for, rebuilds the client when its sources are newer than dist/, and
// stops the server when its code is newer than the running process, for the launcher to start it again.
// Runs where the server does, on Linux or WSL: it finds the server with ss and ps.
import { readdirSync, readlinkSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";

const root = realpathSync(join(import.meta.dir, "../.."));
const port = Number(process.env.PORT) || 3000;
const TEST_FILE = /(?:\.test\.[cm]?[jt]sx?|_test\.rs|(?:^|[\\/])tests[\\/].*\.rs)$/;
// Config both sides run with
const SHARED = ["package.json", "bun.lock", "tsconfig.json", "bunfig.toml"];
// The client takes the server's types too
const CLIENT = ["src", "index.html", "vite.config.ts", "components.json", ...SHARED];
export const RUST_SERVER = ["crates/engine/src", "Cargo.toml", "Cargo.lock", "crates/engine/Cargo.toml"];
const SERVER = [...RUST_SERVER, "src/server", ...SHARED];
const SERVER_BIN = join(
  root,
  process.platform === "win32" ? "target/release/slice-server.exe" : "target/release/slice-server",
);

// When the newest of these files, or of the files in these folders, changed; tests don't change what runs
export function newestChange(base: string, paths: string[]): number {
  let newest = 0;
  for (const path of paths) {
    const full = join(base, path);
    let files: string[];
    try {
      files = statSync(full).isDirectory() ? readdirSync(full, { recursive: true, encoding: "utf8" }).map((name) => join(full, name)) : [full];
    } catch {
      continue;
    }
    for (const file of files) {
      if (TEST_FILE.test(file)) continue;
      const stat = statSync(file);
      if (stat.isFile()) newest = Math.max(newest, stat.mtimeMs);
    }
  }
  return newest;
}

// downloading is null when the server didn't say. Restarting marks the songs it is downloading as failed, so a
// busy server runs on until a later launch
export function serverPlan(server: { startedAt: number; downloading: number | null }, codeChangedAt: number) {
  if (server.startedAt >= codeChangedAt) return "current";
  return server.downloading === 0 ? "restart" : "busy";
}

function spawnEnv(): Record<string, string | undefined> {
  const home = process.env.HOME || process.env.USERPROFILE;
  const cargoBin = home ? join(home, ".cargo", "bin") : "";
  const currentPath = process.env.PATH || "";
  const sep = process.platform === "win32" ? ";" : ":";
  const path =
    cargoBin && !currentPath.split(sep).includes(cargoBin)
      ? `${cargoBin}${currentPath ? `${sep}${currentPath}` : ""}`
      : currentPath;
  return { ...process.env, PATH: path };
}

function run(command: string[], output: "inherit" | "pipe" = "pipe") {
  const result = Bun.spawnSync(command, { cwd: root, env: spawnEnv(), stdout: output, stderr: output });
  return { ok: result.exitCode === 0, out: result.stdout?.toString() ?? "" };
}

function listenerPid(): number | null {
  const match = run(["ss", "-ltnpH", `sport = :${port}`]).out.match(/pid=(\d+)/);
  return match ? Number(match[1]) : null;
}

async function downloadingCount(): Promise<number | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/tracks`, { signal: AbortSignal.timeout(5000) });
    const tracks: { status: string }[] = await res.json();
    return tracks.filter((track) => track.status === "queued" || track.status === "downloading").length;
  } catch {
    return null;
  }
}

// The server shuts down cleanly on SIGTERM; wait for it to free the port for the next one
function stop(pid: number): boolean {
  process.kill(pid, "SIGTERM");
  for (let waited = 0; waited < 15_000; waited += 100) {
    Bun.sleepSync(100);
    if (listenerPid() !== pid) return true;
  }
  return false;
}

async function refreshServer(): Promise<boolean> {
  const pid = listenerPid();
  if (pid === null) {
    console.log("Server: not running");
    return true;
  }
  let cwd = "";
  try {
    cwd = readlinkSync(`/proc/${pid}/cwd`);
  } catch {}
  if (cwd !== root) {
    console.warn(`Server: port ${port} is held by another program (pid ${pid}), left alone`);
    return false;
  }
  const elapsed = Number(run(["ps", "-o", "etimes=", "-p", String(pid)]).out.trim());
  const downloading = await downloadingCount();
  const plan = serverPlan({ startedAt: Date.now() - elapsed * 1000, downloading }, newestChange(root, SERVER));
  if (plan === "current") {
    console.log("Server: up to date");
    return true;
  }
  if (plan === "busy") {
    console.log(downloading === null
      ? "Server: its code changed, but it didn't answer, so it was left running"
      : `Server: its code changed, but it is downloading ${downloading === 1 ? "a song" : `${downloading} songs`}; it updates on a later launch`);
    return true;
  }
  console.log("Server: its code changed, stopping it");
  if (stop(pid)) return true;
  console.warn(`Server: pid ${pid} didn't stop within 15s`);
  return false;
}

if (import.meta.main) {
  let ok = run([process.execPath, "install", "--frozen-lockfile"], "inherit").ok;
  if (!ok) console.warn("Dependencies: install failed");

  let builtAt = 0;
  try {
    builtAt = statSync(join(root, "dist/index.html")).mtimeMs;
  } catch {}
  if (newestChange(root, CLIENT) > builtAt) {
    console.log("Client: its sources changed, building");
    // A failed build leaves the last one in dist/
    if (!run([process.execPath, "run", "build"], "inherit").ok) {
      console.warn("Client: build failed, the last build stays");
      ok = false;
    }
  } else {
    console.log("Client: up to date");
  }

  let serverBuiltAt = 0;
  try {
    serverBuiltAt = statSync(SERVER_BIN).mtimeMs;
  } catch {}
  let serverBuildOk = true;
  if (newestChange(root, RUST_SERVER) > serverBuiltAt) {
    console.log("Server: its Rust sources changed, building");
    if (!run(["cargo", "build", "--release", "-p", "slice-engine", "--bin", "slice-server"], "inherit").ok) {
      console.warn("Server: build failed, the last binary stays");
      serverBuildOk = false;
      ok = false;
    }
  } else {
    console.log("Server: binary up to date");
  }

  if (serverBuildOk && !(await refreshServer())) ok = false;
  process.exit(ok ? 0 : 1);
}
