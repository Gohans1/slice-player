import { existsSync, mkdirSync, renameSync, statSync, unlinkSync, readdirSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { killProcessSafely } from "./processUtils";

// Cover art embedded in local files is often 3000px square, but the client shows it a few dozen to a few hundred
// pixels wide. It asks for a slot size, and the server answers with a copy scaled to that size's width.
export const THUMBNAIL_WIDTHS = { small: 192, large: 640 } as const;
export type ThumbnailSize = keyof typeof THUMBNAIL_WIDTHS;

// Scaled copies are derived from the cover art, so they live apart from it and stay out of backups
export const THUMBNAIL_VARIANTS_DIR = "./data/cache/thumbs-sized";

export const isThumbnailSize = (value: string | null): value is ThumbnailSize => value === "small" || value === "large";

const RESIZE_TIMEOUT_MS = 10_000;
const MAX_CONCURRENT_RESIZES = 2;

const inFlight = new Map<string, Promise<string | null>>();
let runningResizes = 0;
const waitingResizes: Array<() => void> = [];

// A page of local tracks asks for many covers at once; scaling them a couple at a time keeps the server responsive
async function withResizeSlot<T>(task: () => Promise<T>): Promise<T> {
  if (runningResizes >= MAX_CONCURRENT_RESIZES) await new Promise<void>((resolve) => waitingResizes.push(resolve));
  runningResizes++;
  try {
    return await task();
  } finally {
    runningResizes--;
    waitingResizes.shift()?.();
  }
}

const variantPathFor = (trackId: string, width: number, variantsDir: string) => join(variantsDir, `${trackId}-${width}.jpg`);

// Returns a copy of the cover art scaled down to fit the width (never up). It is made once and reused until the cover
// art changes. Returns null when it can't be made, so the caller serves the original instead.
export function resizedThumbnail(sourcePath: string, width: number, variantsDir: string): Promise<string | null> {
  const variantPath = variantPathFor(basename(sourcePath, extname(sourcePath)), width, variantsDir);
  try {
    if (existsSync(variantPath) && statSync(variantPath).mtimeMs >= statSync(sourcePath).mtimeMs) {
      return Promise.resolve(variantPath);
    }
  } catch {
    return Promise.resolve(null);
  }

  let pending = inFlight.get(variantPath);
  if (!pending) {
    pending = withResizeSlot(() => scaleDown(sourcePath, width, variantPath)).finally(() => inFlight.delete(variantPath));
    inFlight.set(variantPath, pending);
  }
  return pending;
}

async function scaleDown(sourcePath: string, width: number, variantPath: string): Promise<string | null> {
  // Written under another name and renamed into place, so a request never reads a half-written file
  const partialPath = `${variantPath}.partial.jpg`;
  let proc: ReturnType<typeof Bun.spawn> | null = null;
  const timer = setTimeout(() => void killProcessSafely(proc), RESIZE_TIMEOUT_MS);
  try {
    mkdirSync(dirname(variantPath), { recursive: true });
    proc = Bun.spawn(
      [
        "ffmpeg", "-v", "error", "-y", "-i", sourcePath,
        "-vf", `scale='min(iw,${width})':'min(ih,${width})':force_original_aspect_ratio=decrease`,
        "-frames:v", "1", "-update", "1", "-q:v", "3", partialPath,
      ],
      { stdout: "ignore", stderr: "ignore" }
    );
    if ((await proc.exited) !== 0 || !existsSync(partialPath)) return null;
    renameSync(partialPath, variantPath);
    return variantPath;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    if (existsSync(partialPath)) {
      try { unlinkSync(partialPath); } catch {}
    }
  }
}

// A deleted track takes its scaled copies with it
export function removeThumbnailVariants(trackId: string, variantsDir: string) {
  if (/[\\/]/.test(trackId)) return;
  for (const width of Object.values(THUMBNAIL_WIDTHS)) {
    const variantPath = variantPathFor(trackId, width, variantsDir);
    if (existsSync(variantPath)) {
      try { unlinkSync(variantPath); } catch {}
    }
  }
}

// Clears copies left behind by tracks that are gone, such as after a library restore
export function sweepThumbnailVariants(validTrackIds: Set<string>, variantsDir: string) {
  if (!existsSync(variantsDir)) return;
  for (const name of readdirSync(variantsDir)) {
    const trackId = /^(.+)-\d+\.jpg$/.exec(name)?.[1];
    if (!trackId || !validTrackIds.has(trackId)) {
      try { unlinkSync(join(variantsDir, name)); } catch {}
    }
  }
}
