import type { Track } from "@/server/types";

/**
 * Normalizes Vietnamese text by stripping tone marks, converting to lowercase,
 * and normalizing special characters like 'đ'/'Đ' to 'd'.
 */
export function normalizeVi(str: string | null | undefined): string {
  if (!str) return "";
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .trim();
}

/**
 * Tokenizes and sanitizes search query by stripping punctuation.
 */
export function tokenizeQuery(query: string): string[] {
  if (!query || !query.trim()) return [];
  const normalizedQuery = normalizeVi(query);
  const rawTokens = normalizedQuery.split(/\s+/).filter(Boolean);
  if (rawTokens.length === 0) return [];

  // Clean surrounding punctuation from each token (e.g., "tung," -> "tung", "(remix)" -> "remix")
  const strippedTokens = rawTokens
    .map((t) => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter(Boolean);

  // If query is composed exclusively of punctuation symbols (e.g. "???"), fall back to raw tokens
  return strippedTokens.length > 0 ? strippedTokens : rawTokens;
}

/**
 * Multi-token search for tracks by title and artist.
 * Matches if every search token appears in either the track title or artist.
 */
export function filterTracks<T extends Pick<Track, "title"> & Partial<Pick<Track, "artist">>>(
  tracks: T[],
  query: string
): T[] {
  if (!tracks || tracks.length === 0) return [];
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return tracks;

  return tracks.filter((track) => {
    const titleNorm = normalizeVi(track.title);
    const artistNorm = track.artist ? normalizeVi(track.artist) : "";
    const combined = artistNorm ? `${titleNorm} ${artistNorm}` : titleNorm;

    return tokens.every((token) => combined.includes(token));
  });
}
