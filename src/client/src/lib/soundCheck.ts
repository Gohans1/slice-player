import type { Track } from "@/server/types";

// Sound Check plays every song at one loudness, -14 LUFS as Spotify's Normal does. A song is turned down all the way;
// a quiet one is raised only as far as leaves its true peak 1 dB below full scale, the headroom Spotify keeps for
// lossy files like the library's (support.spotify.com/artists/article/loudness-normalization)
const TARGET_LOUDNESS = -14;
const PEAK_CEILING = -1;

export function soundCheckGain({ loudness, true_peak }: Pick<Track, "loudness" | "true_peak">): number {
  if (typeof loudness !== "number" || typeof true_peak !== "number") return 1;
  const gain = 10 ** ((TARGET_LOUDNESS - loudness) / 20);
  if (gain <= 1) return gain;
  return Math.max(1, Math.min(gain, 10 ** ((PEAK_CEILING - true_peak) / 20)));
}
