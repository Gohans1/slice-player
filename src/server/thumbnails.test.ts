import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { removeThumbnailVariants, resizedThumbnail, sweepThumbnailVariants, withResizeSlot } from "./thumbnails";

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

  it("makes a new copy when a restore brings back other cover art with an older date", async () => {
    await coverArt(source, 3000);
    expect(await widthOf((await resizedThumbnail(source, 192, variants))!)).toBe(192);

    // A restore writes the backup's cover art and keeps the backup's older modification time
    await coverArt(source, 100);
    const backedUpAt = new Date(Date.now() - 86_400_000);
    utimesSync(source, backedUpAt, backedUpAt);

    expect(await widthOf((await resizedThumbnail(source, 192, variants))!)).toBe(100);
    // The copy of the art it replaced is gone
    expect(readdirSync(variants)).toHaveLength(1);
  });

  it("leaves no copy behind when its track is deleted while the copy is being made", async () => {
    await coverArt(source, 3000);
    const making = resizedThumbnail(source, 192, variants);

    // Hold the event loop until ffmpeg has read the cover art and begun writing, then delete the track
    const deadline = Date.now() + 10_000;
    while (!existsSync(variants) || readdirSync(variants).length === 0) {
      if (Date.now() > deadline) throw new Error("ffmpeg never started writing");
    }
    rmSync(source);
    removeThumbnailVariants("loc_abc", variants);

    expect(await making).toBeNull();
    expect(readdirSync(variants)).toEqual([]);
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
    const other = await resizedThumbnail(join(dir, "loc_other.jpg"), 192, variants);

    removeThumbnailVariants("loc_abc", variants);

    expect(readdirSync(variants)).toEqual([basename(other!)]);
  });

  it("clears copies of tracks that are gone, such as after a library restore", async () => {
    await coverArt(source, 3000);
    await coverArt(join(dir, "loc_gone.jpg"), 3000);
    const kept = await resizedThumbnail(source, 192, variants);
    await resizedThumbnail(join(dir, "loc_gone.jpg"), 192, variants);

    sweepThumbnailVariants(new Set(["loc_abc"]), variants);

    expect(readdirSync(variants)).toEqual([basename(kept!)]);
  });

  it("gives up on a file that isn't an image, so the caller can serve the original", async () => {
    await Bun.write(source, "not an image");

    expect(await resizedThumbnail(source, 192, variants)).toBeNull();
  });
});

describe("withResizeSlot", () => {
  it("never runs more than two resizes, even when one arrives just as another finishes", async () => {
    let running = 0;
    let peak = 0;
    let draining = false;
    const finishers: Array<() => void> = [];
    const resize = () =>
      withResizeSlot(async () => {
        running++;
        peak = Math.max(peak, running);
        if (!draining) await new Promise<void>((resolve) => finishers.push(resolve));
        running--;
      });
    const resizes = [resize(), resize(), resize()];

    // One resize finishes while new requests keep arriving, one on each of the next few ticks
    finishers.shift()!();
    let tick = Promise.resolve();
    for (let i = 0; i < 10; i++) {
      tick = tick.then(() => {
        resizes.push(resize());
      });
    }
    await tick;

    // Let every resize run to the end
    draining = true;
    for (const finish of finishers.splice(0)) finish();
    await Promise.all(resizes);

    expect(peak).toBe(2);
  });
});
