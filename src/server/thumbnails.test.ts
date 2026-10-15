import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeThumbnailVariants, resizedThumbnail, sweepThumbnailVariants } from "./thumbnails";

// Cover art as local files embed it: a single frame, often 3000px square
async function coverArt(path: string, size: number) {
  const proc = Bun.spawn(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", `color=c=red:s=${size}x${size}`, "-frames:v", "1", path]);
  expect(await proc.exited).toBe(0);
}

async function widthOf(path: string) {
  const proc = Bun.spawn(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width", "-of", "csv=p=0", path], { stdout: "pipe" });
  return Number((await new Response(proc.stdout).text()).trim());
}

describe("resizedThumbnail", () => {
  let dir: string;
  let source: string;
  let variants: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "slice-thumbnails-"));
    source = join(dir, "loc_abc.jpg");
    variants = join(dir, "sized");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("scales large cover art down to the requested width", async () => {
    await coverArt(source, 3000);

    const resized = await resizedThumbnail(source, 192, variants);

    expect(resized).not.toBeNull();
    expect(await widthOf(resized!)).toBe(192);
    expect(statSync(resized!).size).toBeLessThan(statSync(source).size);
  });

  it("never scales small cover art up", async () => {
    await coverArt(source, 100);

    const resized = await resizedThumbnail(source, 192, variants);

    expect(await widthOf(resized!)).toBe(100);
  });

  it("reuses a resized copy until the cover art changes", async () => {
    await coverArt(source, 3000);
    const first = await resizedThumbnail(source, 192, variants);
    const madeAt = statSync(first!).mtimeMs;

    expect(statSync((await resizedThumbnail(source, 192, variants))!).mtimeMs).toBe(madeAt);

    // A re-imported file brings new cover art
    await coverArt(source, 2000);
    const later = new Date(madeAt + 5000);
    utimesSync(source, later, later);
    expect(statSync((await resizedThumbnail(source, 192, variants))!).mtimeMs).not.toBe(madeAt);
  });

  it("makes a copy once when the same size is asked for at the same time", async () => {
    await coverArt(source, 3000);

    const [a, b] = await Promise.all([resizedThumbnail(source, 640, variants), resizedThumbnail(source, 640, variants)]);

    expect(a).toBe(b);
    expect(await widthOf(a!)).toBe(640);
  });

  it("removes a deleted track's copies and leaves other tracks' alone", async () => {
    await coverArt(source, 3000);
    await coverArt(join(dir, "loc_other.jpg"), 3000);
    await resizedThumbnail(source, 192, variants);
    await resizedThumbnail(source, 640, variants);
    await resizedThumbnail(join(dir, "loc_other.jpg"), 192, variants);

    removeThumbnailVariants("loc_abc", variants);

    expect(readdirSync(variants)).toEqual(["loc_other-192.jpg"]);
  });

  it("clears copies of tracks that are gone, such as after a library restore", async () => {
    await coverArt(source, 3000);
    await coverArt(join(dir, "loc_gone.jpg"), 3000);
    await resizedThumbnail(source, 192, variants);
    await resizedThumbnail(join(dir, "loc_gone.jpg"), 192, variants);

    sweepThumbnailVariants(new Set(["loc_abc"]), variants);

    expect(readdirSync(variants)).toEqual(["loc_abc-192.jpg"]);
    expect(existsSync(join(variants, "loc_gone-192.jpg"))).toBe(false);
  });

  it("gives up on a file that isn't an image, so the caller can serve the original", async () => {
    await Bun.write(source, "not an image");

    expect(await resizedThumbnail(source, 192, variants)).toBeNull();
  });
});
