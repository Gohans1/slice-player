import type { Track } from "@/server/types";

export interface SearchableFields {
  title?: string | null;
  artist?: string | null;
  segmentName?: string | null;
  createdAt?: number | null;
}

/**
 * Normalizes Vietnamese and multilingual text:
 * - Uses NFKD to decompose full-width chars (e.g. Ｂ Ｒａｙ -> B R a y) and compatibility symbols
 * - Strips zero-width and invisible characters (\u200B-\u200D, \uFEFF)
 * - Normalizes typographic quotes [’‘ʼ′`] to ' and dashes [–—−] to -
 * - Strips combining diacritical marks (Vietnamese accents)
 * - Converts đ/Đ/Ð to d
 * - Lowercases and trims
 */
export function normalizeVi(str: string | null | undefined): string {
  if (!str) return "";
  return str
    .normalize("NFKD")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[’‘ʼ′`]/g, "'")
    .replace(/[–—−]/g, "-")
    .replace(/\$/g, "s")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐÐ]/g, "d")
    .toLowerCase()
    .trim();
}

/**
 * Splits text into individual canonical word tokens by replacing punctuation with spaces.
 */
export function toCanonicalWords(str: string | null | undefined): string[] {
  if (!str) return [];
  const normalized = normalizeVi(str);
  return normalized
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Computes a compact alphanumeric representation and tracks valid word-start indices.
 * This prevents cross-boundary false positives (e.g., "the" matching "Hit Here").
 */
export function toCompactWithWordStarts(words: string[]): { compact: string; startIndices: Set<number> } {
  let compact = "";
  const startIndices = new Set<number>();
  for (const w of words) {
    if (!w) continue;
    startIndices.add(compact.length);
    compact += w;
  }
  return { compact, startIndices };
}

/**
 * Tokenizes and sanitizes search query.
 */
export function tokenizeQuery(query: string): string[] {
  if (!query || !query.trim()) return [];
  const words = toCanonicalWords(query);
  if (words.length > 0) return words;

  // Fallback for query consisting exclusively of special characters
  const rawNormalized = normalizeVi(query).split(/\s+/).filter(Boolean);
  return rawNormalized;
}

interface PreparedField {
  canonicalText: string;
  words: string[];
  compact: string;
  wordStarts: Set<number>;
}

function prepareField(text: string | null | undefined): PreparedField {
  if (!text) {
    return { canonicalText: "", words: [], compact: "", wordStarts: new Set() };
  }
  const words = toCanonicalWords(text);
  const canonicalText = words.join(" ");
  const { compact, startIndices } = toCompactWithWordStarts(words);
  return { canonicalText, words, compact, wordStarts: startIndices };
}

function tokenMatchesField(
  token: string,
  tokenCompact: string,
  field: PreparedField
): { matched: boolean; isPrefix: boolean; isExact: boolean; isWordStart: boolean } {
  if (!field.compact) {
    return { matched: false, isPrefix: false, isExact: false, isWordStart: false };
  }

  // Exact match
  if (field.compact === tokenCompact || field.canonicalText === token) {
    return { matched: true, isPrefix: true, isExact: true, isWordStart: true };
  }

  // Canonical substring match
  if (token && field.canonicalText.includes(token)) {
    const isPrefix = field.canonicalText.startsWith(token);
    const isWordStart = field.words.some((w) => w.startsWith(token));
    return { matched: true, isPrefix, isExact: false, isWordStart };
  }

  // Compact word-anchored match (e.g. "bray" matching "B ray", "mtp" matching "M-TP")
  if (tokenCompact && field.compact.includes(tokenCompact)) {
    let idx = field.compact.indexOf(tokenCompact);
    let anchored = false;
    while (idx !== -1) {
      if (field.wordStarts.has(idx)) {
        anchored = true;
        break;
      }
      idx = field.compact.indexOf(tokenCompact, idx + 1);
    }
    if (anchored) {
      const isPrefix = idx === 0;
      return { matched: true, isPrefix, isExact: false, isWordStart: true };
    }
  }

  return { matched: false, isPrefix: false, isExact: false, isWordStart: false };
}

/**
 * Generic search and ranking engine for items.
 * Evaluates tokens across fields and applies lightweight relevance scoring.
 */
export function searchItems<T>(
  items: T[],
  query: string,
  extractFields: (item: T) => SearchableFields
): T[] {
  if (!items || items.length === 0) return [];
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return items;

  const queryWords = toCanonicalWords(query);
  const queryCompact = queryWords.join("");
  const queryCanonical = queryWords.join(" ");

  const preparedTokens = tokens.map((token) => ({
    token,
    tokCompact: toCanonicalWords(token).join(""),
  }));

  interface ScoredItem {
    item: T;
    score: number;
    createdAt: number;
  }

  const scored: ScoredItem[] = [];

  for (const item of items) {
    const fields = extractFields(item);
    const titleField = prepareField(fields.title);
    const artistField = prepareField(fields.artist);
    const segmentField = prepareField(fields.segmentName);

    let allTokensMatch = true;
    let itemScore = 0;

    // Check full-query exact matches
    if (queryCompact && titleField.compact === queryCompact) {
      itemScore += 1000;
    } else if (queryCanonical && titleField.canonicalText.startsWith(queryCanonical)) {
      itemScore += 500;
    } else if (queryCompact && titleField.compact.startsWith(queryCompact)) {
      itemScore += 400;
    }

    if (queryCompact && artistField.compact === queryCompact) {
      itemScore += 800;
    } else if (queryCanonical && artistField.canonicalText.startsWith(queryCanonical)) {
      itemScore += 450;
    } else if (queryCompact && artistField.compact.startsWith(queryCompact)) {
      itemScore += 350;
    }

    for (const { token, tokCompact } of preparedTokens) {
      const titleRes = tokenMatchesField(token, tokCompact, titleField);
      const artistRes = tokenMatchesField(token, tokCompact, artistField);
      const segmentRes = tokenMatchesField(token, tokCompact, segmentField);

      if (!titleRes.matched && !artistRes.matched && !segmentRes.matched) {
        allTokensMatch = false;
        break;
      }

      if (titleRes.matched) {
        itemScore += titleRes.isExact ? 200 : titleRes.isPrefix ? 120 : titleRes.isWordStart ? 80 : 40;
      }
      if (artistRes.matched) {
        itemScore += artistRes.isExact ? 180 : artistRes.isPrefix ? 100 : artistRes.isWordStart ? 70 : 30;
      }
      if (segmentRes.matched) {
        itemScore += segmentRes.isExact ? 150 : segmentRes.isPrefix ? 90 : segmentRes.isWordStart ? 60 : 20;
      }
    }

    if (allTokensMatch) {
      scored.push({
        item,
        score: itemScore,
        createdAt: fields.createdAt || 0,
      });
    }
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.createdAt - a.createdAt;
  });

  return scored.map((s) => s.item);
}

/**
 * Multi-token search for tracks by title and artist with relevance ranking.
 */
export function filterTracks<
  T extends Pick<Track, "title"> & Partial<Pick<Track, "artist" | "created_at">>
>(
  tracks: T[],
  query: string
): T[] {
  return searchItems(tracks, query, (track) => ({
    title: track.title,
    artist: track.artist,
    createdAt: track.created_at,
  }));
}
