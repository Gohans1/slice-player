import { createReadStream, statSync } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { pack as createPack } from "tar-stream";

export type ArchiveEntry = { name: string; source: string } | { name: string; data: string | Uint8Array };

/** Stream actual file bytes with backpressure; Bun.Archive currently writes empty BunFile entries. */
export function writeArchive(entries: ArchiveEntry[], onClose: (completed: boolean) => void): ReadableStream<Uint8Array> {
  const archive = createPack();
  const gzip = createGzip();
  const output: import("node:stream/web").ReadableStream<Uint8Array> = Readable.toWeb(gzip, { strategy: { highWaterMark: 1 } });
  const reader = output.getReader();
  let closed = false;
  const close = (completed: boolean) => {
    if (closed) return;
    closed = true;
    archive.destroy();
    gzip.destroy();
    onClose(completed);
  };

  void pipeline(archive, gzip).catch((error: unknown) => {
    gzip.destroy(error instanceof Error ? error : new Error(String(error)));
  });
  const writeEntries = async () => {
    for (const entry of entries) {
      if ("source" in entry) {
        const sink = archive.entry({ name: entry.name, size: statSync(entry.source).size });
        await pipeline(createReadStream(entry.source), sink);
      } else {
        await new Promise<void>((fulfill, reject) => {
          archive.entry({ name: entry.name }, entry.data, (error) => error ? reject(error) : fulfill());
        });
      }
    }
    archive.finalize();
  };
  void writeEntries().catch((error: unknown) => {
    gzip.destroy(error instanceof Error ? error : new Error(String(error)));
  });

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (chunk.done) {
          controller.close();
          close(true);
        } else {
          controller.enqueue(chunk.value);
        }
      } catch (error) {
        controller.error(error);
        close(false);
      }
    },
    async cancel(reason) {
      close(false);
      await reader.cancel(reason);
    },
  });
}
