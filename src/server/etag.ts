/**
 * HTTP ETag (304 Not Modified) caching utility.
 * Generates fast weak ETags using Bun.hash (Wyhash) and validates client If-None-Match headers.
 */

export function computeEtag(payload: string): string {
  return `W/"${Bun.hash(payload).toString(16)}"`;
}

export function isEtagMatch(ifNoneMatchHeader: string | null | undefined, currentEtag: string): boolean {
  if (!ifNoneMatchHeader) return false;
  const raw = ifNoneMatchHeader.trim();
  if (!raw) return false;
  if (raw === "*") return true;

  const normalize = (tag: string) => tag.trim().replace(/^W\//i, "").replace(/^"|"$/g, "");
  const target = normalize(currentEtag);
  return raw.split(",").some((tag) => normalize(tag) === target);
}

export function createCachedJsonResponse(
  payloadObj: unknown,
  req: Request,
  corsHeaders: Record<string, string>
): Response {
  const jsonStr = JSON.stringify(payloadObj ?? null);
  const etag = computeEtag(jsonStr);
  const ifNoneMatch = req.headers.get("if-none-match");

  const headers = {
    ...corsHeaders,
    "ETag": etag,
    "Cache-Control": "private, must-revalidate",
  };

  if (isEtagMatch(ifNoneMatch, etag)) {
    return new Response(null, {
      status: 304,
      headers,
    });
  }

  return new Response(jsonStr, {
    status: 200,
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
  });
}
