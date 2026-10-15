import { file as bunFile } from "bun";
import { existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { getCrossPlatformBasename } from "./db";
import { validateSafeLocalAudioPath } from "./ingest";

export async function resolveAudioSource(
  filePath: string,
  cacheDir = "./data/cache/audio"
): Promise<{ path: string; file: ReturnType<typeof bunFile> } | { error: string; status: 403 | 404 }> {
  let path = filePath;
  if (!validateSafeLocalAudioPath(path).ok) return { error: "Invalid or forbidden audio file path", status: 403 };
  let file = bunFile(path);
  if (!(await file.exists())) {
    const candidate = resolve(join(cacheDir, getCrossPlatformBasename(path)));
    if (!validateSafeLocalAudioPath(candidate).ok || !existsSync(candidate)) {
      return { error: "Audio file missing on disk", status: 404 };
    }
    // A GET/HEAD fallback must not mutate the library after an async read.
    path = candidate;
    file = bunFile(path);
  }
  return { path, file };
}
