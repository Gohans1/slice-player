import { describe, it, expect } from "bun:test";
import { compareDownloadingTracks } from "../lib/utils";
import type { Track } from "@/server/types";

describe("Download Queue Sorting and Tab Logic", () => {
  it("places track with status 'downloading' before tracks with status 'queued'", () => {
    const trackDownloading: Track = {
      id: "trk_dl",
      title: "Downloading Song",
      source_type: "youtube",
      source_uri: "https://youtube.com/watch?v=dl",
      duration: 200,
      status: "downloading",
      download_index: 0,
      created_at: 100,
    };

    const trackQueued: Track = {
      id: "trk_q",
      title: "Queued Song",
      source_type: "youtube",
      source_uri: "https://youtube.com/watch?v=q",
      duration: 180,
      status: "queued",
      download_index: 1,
      created_at: 50,
    };

    expect(compareDownloadingTracks(trackDownloading, trackQueued)).toBe(-1);
    expect(compareDownloadingTracks(trackQueued, trackDownloading)).toBe(1);

    const sorted = [trackQueued, trackDownloading].sort(compareDownloadingTracks);
    expect(sorted[0].id).toBe("trk_dl");
    expect(sorted[1].id).toBe("trk_q");
  });

  it("sorts multiple queued tracks strictly by download_index ASC", () => {
    const queued1: Track = {
      id: "trk_1",
      title: "Song 1",
      source_type: "youtube",
      source_uri: "https://youtube.com/watch?v=1",
      duration: 150,
      status: "queued",
      download_index: 1,
      created_at: 200,
    };

    const queued2: Track = {
      id: "trk_2",
      title: "Song 2",
      source_type: "youtube",
      source_uri: "https://youtube.com/watch?v=2",
      duration: 150,
      status: "queued",
      download_index: 2,
      created_at: 100,
    };

    const queued3: Track = {
      id: "trk_3",
      title: "Song 3",
      source_type: "youtube",
      source_uri: "https://youtube.com/watch?v=3",
      duration: 150,
      status: "queued",
      download_index: 3,
      created_at: 300,
    };

    const sorted = [queued3, queued1, queued2].sort(compareDownloadingTracks);
    expect(sorted.map((t) => t.id)).toEqual(["trk_1", "trk_2", "trk_3"]);
  });

  it("prioritizes track with defined download_index over track with undefined download_index", () => {
    const trackWithIndex: Track = {
      id: "trk_indexed",
      title: "Indexed",
      source_type: "youtube",
      source_uri: "uri1",
      duration: 100,
      status: "queued",
      download_index: 2,
      created_at: 5000,
    };

    const trackWithoutIndex: Track = {
      id: "trk_unindexed",
      title: "Unindexed",
      source_type: "youtube",
      source_uri: "uri2",
      duration: 100,
      status: "queued",
      created_at: 1000, // earlier created, but has no index
    };

    const sorted = [trackWithoutIndex, trackWithIndex].sort(compareDownloadingTracks);
    expect(sorted[0].id).toBe("trk_indexed");
    expect(sorted[1].id).toBe("trk_unindexed");
  });

  it("falls back to created_at ASC if download_index is identical or not provided for both", () => {
    const tA: Track = {
      id: "trk_a",
      title: "Song A",
      source_type: "youtube",
      source_uri: "https://youtube.com/watch?v=a",
      duration: 100,
      status: "queued",
      created_at: 1000,
    };

    const tB: Track = {
      id: "trk_b",
      title: "Song B",
      source_type: "youtube",
      source_uri: "https://youtube.com/watch?v=b",
      duration: 100,
      status: "queued",
      created_at: 2000,
    };

    const sorted = [tB, tA].sort(compareDownloadingTracks);
    expect(sorted[0].id).toBe("trk_a");
    expect(sorted[1].id).toBe("trk_b");
  });

  it("verifies composite grouping: downloading/queued tracks stay on top of ready tracks", () => {
    const rawTracks: Track[] = [
      {
        id: "trk_ready_old",
        title: "Ready Old",
        source_type: "youtube",
        source_uri: "uri_r1",
        duration: 200,
        status: "ready",
        created_at: 100,
      },
      {
        id: "trk_ready_new",
        title: "Ready New",
        source_type: "youtube",
        source_uri: "uri_r2",
        duration: 200,
        status: "ready",
        created_at: 500,
      },
      {
        id: "trk_queued",
        title: "Queued",
        source_type: "youtube",
        source_uri: "uri_q",
        duration: 200,
        status: "queued",
        download_index: 1,
        created_at: 200,
      },
      {
        id: "trk_downloading",
        title: "Downloading",
        source_type: "youtube",
        source_uri: "uri_dl",
        duration: 200,
        status: "downloading",
        download_index: 0,
        created_at: 300,
      },
    ];

    const downloading = rawTracks
      .filter((t) => t.status === "downloading" || t.status === "queued")
      .sort(compareDownloadingTracks);

    const ready = rawTracks
      .filter((t) => t.status === "ready")
      .sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

    const compositeOriginals = [...downloading, ...ready];

    // Priority: downloading first, queued second, then ready descending by created_at
    expect(compositeOriginals.map((t) => t.id)).toEqual([
      "trk_downloading",
      "trk_queued",
      "trk_ready_new",
      "trk_ready_old",
    ]);

    // When trk_downloading finishes, it becomes ready
    rawTracks[3].status = "ready";
    rawTracks[2].status = "downloading";
    rawTracks[2].download_index = 0;

    const updatedDownloading = rawTracks
      .filter((t) => t.status === "downloading" || t.status === "queued")
      .sort(compareDownloadingTracks);

    const updatedReady = rawTracks
      .filter((t) => t.status === "ready")
      .sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

    const updatedComposite = [...updatedDownloading, ...updatedReady];
    expect(updatedComposite.map((t) => t.id)).toEqual([
      "trk_queued", // now downloading
      "trk_ready_new",
      "trk_downloading", // newly ready, created_at 300
      "trk_ready_old",
    ]);
  });
});
