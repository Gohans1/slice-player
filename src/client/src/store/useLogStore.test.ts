import { describe, it, expect, beforeEach } from "bun:test";
import { useLogStore, logClientInfo, logClientError } from "./useLogStore";

describe("useLogStore", () => {
  beforeEach(() => {
    useLogStore.setState({
      logs: [],
      unreadErrorCount: 0,
      filterCategory: "all",
      searchQuery: "",
      isDrawerOpen: false,
      autoScroll: true,
    });
  });

  it("adds log entries and preserves order", () => {
    useLogStore.getState().addLog({
      level: "info",
      category: "playback",
      message: "Bắt đầu phát bài hát A",
    });
    useLogStore.getState().addLog({
      level: "success",
      category: "download",
      message: "Tải nhạc hoàn tất",
    });

    const { logs } = useLogStore.getState();
    expect(logs.length).toBe(2);
    expect(logs[0].message).toBe("Bắt đầu phát bài hát A");
    expect(logs[0].level).toBe("info");
    expect(logs[1].message).toBe("Tải nhạc hoàn tất");
    expect(logs[1].level).toBe("success");
  });

  it("increments unreadErrorCount when an error is logged while drawer is closed", () => {
    expect(useLogStore.getState().unreadErrorCount).toBe(0);

    useLogStore.getState().addLog({
      level: "info",
      category: "system",
      message: "Thông tin bình thường",
    });
    expect(useLogStore.getState().unreadErrorCount).toBe(0);

    useLogStore.getState().addLog({
      level: "error",
      category: "playback",
      message: "Lỗi tải audio",
    });
    expect(useLogStore.getState().unreadErrorCount).toBe(1);

    useLogStore.getState().addLog({
      level: "error",
      category: "download",
      message: "yt-dlp lỗi",
    });
    expect(useLogStore.getState().unreadErrorCount).toBe(2);

    // Opening drawer resets unread count
    useLogStore.getState().openDrawer();
    expect(useLogStore.getState().unreadErrorCount).toBe(0);
    expect(useLogStore.getState().isDrawerOpen).toBe(true);

    // Adding error while drawer is open does NOT increment unreadErrorCount
    useLogStore.getState().addLog({
      level: "error",
      category: "system",
      message: "Lỗi khác khi đang mở",
    });
    expect(useLogStore.getState().unreadErrorCount).toBe(0);
  });

  it("toggles and closes drawer properly", () => {
    const store = useLogStore.getState();
    expect(store.isDrawerOpen).toBe(false);

    store.toggleDrawer();
    expect(useLogStore.getState().isDrawerOpen).toBe(true);

    store.closeDrawer();
    expect(useLogStore.getState().isDrawerOpen).toBe(false);
  });

  it("limits maximum log items to 500 (ring buffer behavior)", () => {
    for (let i = 0; i < 550; i++) {
      useLogStore.getState().addLog({
        level: "info",
        category: "playback",
        message: `Log line ${i}`,
        id: `id_${i}`,
      });
    }

    const { logs } = useLogStore.getState();
    expect(logs.length).toBe(500);
    expect(logs[0].message).toBe("Log line 50");
    expect(logs[499].message).toBe("Log line 549");
  });

  it("supports logClientInfo and logClientError standalone helpers", () => {
    logClientInfo("playback", "Standalone info log");
    logClientError("system", "Standalone error log");

    const { logs, unreadErrorCount } = useLogStore.getState();
    expect(logs.length).toBe(2);
    expect(unreadErrorCount).toBe(1);
    expect(logs[0].category).toBe("playback");
    expect(logs[1].category).toBe("system");
  });

  it("clears logs cleanly", () => {
    logClientInfo("download", "Log 1");
    logClientError("download", "Log 2");
    expect(useLogStore.getState().logs.length).toBe(2);

    useLogStore.getState().clearLogs();
    expect(useLogStore.getState().logs.length).toBe(0);
    expect(useLogStore.getState().unreadErrorCount).toBe(0);
  });

  it("increments unreadErrorCount when fresh errors are merged via setLogs on reconnect", () => {
    useLogStore.getState().addLog({
      id: "log_1",
      level: "info",
      category: "system",
      message: "Old log",
      timestamp: 1000,
    });
    expect(useLogStore.getState().unreadErrorCount).toBe(0);

    useLogStore.getState().setLogs([
      { id: "log_1", level: "info", category: "system", message: "Old log", timestamp: 1000 },
      { id: "log_2", level: "error", category: "download", message: "Server error", timestamp: 2000 },
      { id: "log_3", level: "info", category: "download", message: "Server info", timestamp: 3000 },
    ]);

    expect(useLogStore.getState().logs.length).toBe(3);
    expect(useLogStore.getState().unreadErrorCount).toBe(1);
  });

  it("handles BigInt and circular details in setLogs without throwing", () => {
    const circ: any = { name: "circ" };
    circ.self = circ;

    expect(() => {
      useLogStore.getState().setLogs([
        {
          id: "log_bigint",
          level: "info",
          category: "system",
          message: "BigInt test",
          timestamp: 4000,
          details: { val: 1234567890123456789n },
        },
        {
          id: "log_circ",
          level: "error",
          category: "playback",
          message: "Circular test",
          timestamp: 5000,
          details: circ,
        },
      ]);
    }).not.toThrow();

    const { logs } = useLogStore.getState();
    expect(logs.length).toBe(2);
    expect(logs[0].details).toEqual({ val: "1234567890123456789" });
    expect(logs[0].searchableText).toContain("info");
    expect(logs[0].searchableText).toContain("hệ thống");
    expect(logs[1].searchableText).toContain("error");
    expect(logs[1].searchableText).toContain("phát nhạc");
  });

  it("truncates long primitive root strings in safeSerializeDetails", () => {
    const longStr = "X".repeat(6000);
    useLogStore.getState().addLog({
      level: "warn",
      category: "download",
      message: "Long string test",
      details: longStr,
    });

    const { logs } = useLogStore.getState();
    expect(typeof logs[0].details).toBe("string");
    expect((logs[0].details as string).length).toBeLessThan(6000);
    expect(logs[0].details as string).toContain("[truncated]");
  });

  it("preserves custom properties on error-like objects and serializes collections", () => {
    useLogStore.getState().addLog({
      level: "error",
      category: "playback",
      message: "Audio error",
      details: {
        code: 4,
        message: "MEDIA_ERR_SRC_NOT_SUPPORTED",
        src: "blob:http://localhost:3000/test",
        segmentId: "seg_123",
        tags: new Set(["lossless", "flac"]),
        meta: new Map([["bitrate", 1411]]),
      },
    });

    const { logs } = useLogStore.getState();
    const details = logs[0].details as any;
    expect(details.code).toBe(4);
    expect(details.message).toBe("MEDIA_ERR_SRC_NOT_SUPPORTED");
    expect(details.src).toBe("blob:http://localhost:3000/test");
    expect(details.segmentId).toBe("seg_123");
    expect(details.tags).toEqual(["lossless", "flac"]);
    expect(details.meta).toEqual({ bitrate: 1411 });
  });

  it("bounds long message strings to 2000 characters defensively", () => {
    const longMsg = "M".repeat(3000);
    useLogStore.getState().addLog({
      level: "info",
      category: "system",
      message: longMsg,
    });

    const { logs } = useLogStore.getState();
    expect(logs[0].message.length).toBeLessThan(3000);
    expect(logs[0].message).toContain("[truncated]");
  });

  it("indexes serialized object details into searchableText in addLog without boolean coercion", () => {
    useLogStore.getState().addLog({
      level: "error",
      category: "download",
      message: "yt-dlp failed to download track",
      details: {
        errorReason: "Sign in to confirm you are not a bot",
        videoId: "dQw4w9WgXcQ",
      },
    });

    const { logs } = useLogStore.getState();
    const item = logs[0];
    expect(item.searchableText).toBeDefined();
    expect(item.searchableText?.includes("sign in to confirm you are not a bot")).toBe(true);
    expect(item.searchableText?.includes("dqw4w9wgxcq")).toBe(true);
    // Ensure it does not contain literal boolean string coercion "false" or "true"
    expect(item.searchableText?.split(" ")).not.toContain("false");
  });
});
