import { describe, it, expect } from "bun:test";
import { computeEtag, isEtagMatch, createCachedJsonResponse } from "./etag";

describe("HTTP ETag Caching Utility", () => {
  const sampleData = [{ id: "trk_1", title: "Test Track", duration: 180 }];
  const corsHeaders = {
    "Access-Control-Allow-Origin": "http://127.0.0.1:3000",
    "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges, ETag",
  };

  it("should compute consistent weak ETag from JSON payload", () => {
    const payload = JSON.stringify(sampleData);
    const etag1 = computeEtag(payload);
    const etag2 = computeEtag(payload);

    expect(etag1).toBe(etag2);
    expect(etag1.startsWith('W/"')).toBe(true);
    expect(etag1.endsWith('"')).toBe(true);
  });

  it("should return different ETags for different payloads", () => {
    const etag1 = computeEtag(JSON.stringify([{ id: "trk_1" }]));
    const etag2 = computeEtag(JSON.stringify([{ id: "trk_2" }]));

    expect(etag1).not.toBe(etag2);
  });

  it("should match ETags with weak comparison according to RFC 9110", () => {
    expect(isEtagMatch('W/"abc123"', 'W/"abc123"')).toBe(true);
    expect(isEtagMatch('"abc123"', 'W/"abc123"')).toBe(true);
    expect(isEtagMatch('W/"abc123"', '"abc123"')).toBe(true);
    expect(isEtagMatch('*', 'W/"abc123"')).toBe(true);
    expect(isEtagMatch('"other", W/"abc123", "xyz"', 'W/"abc123"')).toBe(true);
    expect(isEtagMatch('"other", "xyz"', 'W/"abc123"')).toBe(false);
    expect(isEtagMatch('w/"abc123"', 'W/"abc123"')).toBe(true);
    expect(isEtagMatch('   ', 'W/"abc123"')).toBe(false);
    expect(isEtagMatch(null, 'W/"abc123"')).toBe(false);
    expect(isEtagMatch(undefined, 'W/"abc123"')).toBe(false);
  });

  it("should handle undefined payload safely in createCachedJsonResponse", () => {
    const req = new Request("http://127.0.0.1:3000/api/tracks");
    expect(() => createCachedJsonResponse(undefined, req, corsHeaders)).not.toThrow();
  });

  it("should return 200 OK with ETag and Cache-Control headers when no If-None-Match header is sent", async () => {
    const req = new Request("http://127.0.0.1:3000/api/tracks");
    const res = createCachedJsonResponse(sampleData, req, corsHeaders);

    expect(res.status).toBe(200);
    expect(res.headers.get("ETag")).toBeTruthy();
    expect(res.headers.get("Cache-Control")).toBe("private, must-revalidate");
    expect(res.headers.get("Content-Type")).toBe("application/json");

    const body = await res.json();
    expect(body).toEqual(sampleData);
  });

  it("should return 304 Not Modified with empty body when matching If-None-Match is sent", async () => {
    const payload = JSON.stringify(sampleData);
    const etag = computeEtag(payload);

    const req = new Request("http://127.0.0.1:3000/api/tracks", {
      headers: { "If-None-Match": etag },
    });
    const res = createCachedJsonResponse(sampleData, req, corsHeaders);

    expect(res.status).toBe(304);
    expect(res.headers.get("ETag")).toBe(etag);
    expect(res.headers.get("Cache-Control")).toBe("private, must-revalidate");
    const text = await res.text();
    expect(text).toBe("");
  });

  it("should return 200 OK when If-None-Match does not match updated payload", async () => {
    const oldEtag = 'W/"stale_etag_value"';
    const req = new Request("http://127.0.0.1:3000/api/tracks", {
      headers: { "If-None-Match": oldEtag },
    });
    const res = createCachedJsonResponse(sampleData, req, corsHeaders);

    expect(res.status).toBe(200);
    expect(res.headers.get("ETag")).not.toBe(oldEtag);
    const body = await res.json();
    expect(body).toEqual(sampleData);
  });
});
