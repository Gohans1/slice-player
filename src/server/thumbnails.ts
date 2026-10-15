import { existsSync, mkdirSync, renameSync, statSync, unlinkSync, readdirSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";

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

// A page of local tracks asks for many covers at once; scaling them a couple at a time keeps the server responsive.
// A finished resize hands its slot straight to the next one waiting, so a request arriving in between can't take it too.
export async function withResizeSlot<T>(task: () => Promise<T>): Promise<T> {
  if (runningResizes < MAX_CONCURRENT_RESIZES) runningResizes++;
  else await new Promise<void>((resolve) => waitingResizes.push(resolve));
  try {
    return await task();
  } finally {
    const next = waitingResizes.shift();
    if (next) next();
    else runningResizes--;
  }
}

// Each copy is named <track id>-<width>-<cover art version>.jpg
interface Variant {
  trackId: string;
  width: number;
  version: string;
}
const VARIANT_NAME = /^(.+)-(\d+)-([0-9a-z]+)\.jpg$/;
const variantPathFor = (variantsDir: string, { trackId, width, version }: Variant) => join(variantsDir, `${trackId}-${width}-${version}.jpg`);

// Changes whenever the cover art file is written, even when a library restore brings back an older modification time,
// so a copy of earlier art is never taken for a copy of the current one
function coverArtVersion(sourcePath: string): string | null {
  try {
    const { size, mtimeMs, ctimeMs } = statSync(sourcePath);
    return Bun.hash(`${size}:${mtimeMs}:${ctimeMs}`).toString(36);
  } catch {
    return null;
  }
}

function removeVariantsWhere(variantsDir: string, shouldRemove: (variant: Variant | null) => boolean) {
  if (!existsSync(variantsDir)) return;
  for (const name of readdirSync(variantsDir)) {
    const match = VARIANT_NAME.exec(name);
    if (shouldRemove(match && { trackId: match[1], width: Number(match[2]), version: match[3] })) {
      try { unlinkSync(join(variantsDir, name)); } catch {}
    }
  }
}

// Returns a copy of the cover art scaled down to fit the width (never up). It is made once and reused until the cover
// art changes. Returns null when it can't be made, so the caller serves the original instead.
export function resizedThumbnail(sourcePath: string, width: number, variantsDir: string): Promise<string | null> {
  const version = coverArtVersion(sourcePath);
  if (!version) return Promise.resolve(null);
  const variant = { trackId: basename(sourcePath, extname(sourcePath)), width, version };
  const variantPath = variantPathFor(variantsDir, variant);
  if (existsSync(variantPath)) return Promise.resolve(variantPath);

  let pending = inFlight.get(variantPath);
  if (!pending) {
    pending = withResizeSlot(() => scaleDown(sourcePath, variant, variantsDir)).finally(() => inFlight.delete(variantPath));
    inFlight.set(variantPath, pending);
  }
  return pending;
}

async function scaleDown(sourcePath: string, variant: Variant, variantsDir: string): Promise<string | null> {
  const variantPath = variantPathFor(variantsDir, variant);
  // Written under another name and renamed into place, so a request never reads a half-written file
  const partialPath = `${variantPath}.partial.jpg`;
  try {
    mkdirSync(dirname(variantPath), { recursive: true });
    const proc = Bun.spawn(
      [
        "ffmpeg", "-v", "error", "-y", "-i", sourcePath,
        "-vf", `scale='min(iw,${variant.width})':'min(ih,${variant.width})':force_original_aspect_ratio=decrease`,
        "-frames:v", "1", "-update", "1", "-q:v", "3", partialPath,
      ],
      // SIGKILL, so a stuck ffmpeg can't hold its request and its slot past the deadline
      { stdout: "ignore", stderr: "ignore", timeout: RESIZE_TIMEOUT_MS, killSignal: "SIGKILL" }
    );
    if ((await proc.exited) !== 0 || !existsSync(partialPath)) return null;
    renameSync(partialPath, variantPath);
    // The cover art was replaced, or its track deleted, while it was being scaled: this copy is of art that's gone
    if (coverArtVersion(sourcePath) !== variant.version) {
      unlinkSync(variantPath);
      return null;
    }
    // Copies of the art this one replaced stay until the startup sweep, since a request may still be sending one
    return variantPath;
  } catch {
    return null;
  } finally {
    if (existsSync(partialPath)) {
      try { unlinkSync(partialPath); } catch {}
    }
  }
}

// A deleted track takes its scaled copies with it
export function removeThumbnailVariants(trackId: string, variantsDir: string) {
  removeVariantsWhere(variantsDir, (variant) => variant?.trackId === trackId);
}

// Clears copies whose cover art is gone or has changed since: its track was deleted, its file re-imported or the library
// restored. It runs at startup, before any resize or request, so it also clears partial files and anything else that
// isn't a copy.
export function sweepThumbnailVariants(thumbsDir: string, variantsDir: string) {
  removeVariantsWhere(variantsDir, (variant) => {
    if (!variant) return true;
    const source = [".jpg", ".png", ".webp"].map((ext) => join(thumbsDir, `${variant.trackId}${ext}`)).find((path) => existsSync(path));
    return !source || coverArtVersion(source) !== variant.version;
  });
}
