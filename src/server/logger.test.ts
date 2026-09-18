import { describe, it, expect, beforeEach } from "bun:test";
import { safeSerializeDetails, logEvent, getRecentLogs, clearServerLogs } from "./logger";

describe("src/server/logger.ts", () => {
  beforeEach(() => {
    clearServerLogs();
  });

  describe("safeSerializeDetails", () => {
    it("returns primitives untouched", () => {
      expect(safeSerializeDetails("hello")).toBe("hello");
      expect(safeSerializeDetails(123)).toBe(123);
      expect(safeSerializeDetails(true)).toBe(true);
      expect(safeSerializeDetails(null)).toBeUndefined();
      expect(safeSerializeDetails(undefined)).toBeUndefined();
    });

    it("serializes BigInt and boxed BigInt cleanly as string", () => {
      expect(safeSerializeDetails(1234567890123456789n)).toBe("1234567890123456789");
      expect(safeSerializeDetails({ val: 42n })).toEqual({ val: "42" });
      expect(safeSerializeDetails({ boxed: Object(99n) })).toEqual({ boxed: "99" });
    });

    it("serializes standard Error instances and preserves cause", () => {
      const inner = new Error("inner cause");
      const outer = new Error("outer message", { cause: inner });
      const serialized = safeSerializeDetails(outer) as any;

      expect(serialized.name).toBe("Error");
      expect(serialized.message).toBe("outer message");
      expect(serialized.cause).toBeDefined();
      expect(serialized.cause.message).toBe("inner cause");
    });

    it("serializes AggregateError preserving the errors array", () => {
      const err1 = new Error("sub-error 1");
      const err2 = new Error("sub-error 2");
      const agg = new AggregateError([err1, err2], "Batch failure");
      const serialized = safeSerializeDetails(agg) as any;

      expect(serialized.name).toBe("AggregateError");
      expect(serialized.message).toBe("Batch failure");
      expect(Array.isArray(serialized.errors)).toBe(true);
      expect(serialized.errors.length).toBe(2);
      expect(serialized.errors[0].message).toBe("sub-error 1");
    });

    it("handles circular objects and circular Error instances without stack overflow", () => {
      const circObj: any = { name: "circ" };
      circObj.self = circObj;

      const serializedObj = safeSerializeDetails(circObj) as any;
      expect(serializedObj.name).toBe("circ");
      expect(serializedObj.self).toBe("[Circular]");

      const circErr: any = new Error("circular error");
      circErr.self = circErr;
      circErr.cause = circErr;

      const serializedErr = safeSerializeDetails(circErr) as any;
      expect(serializedErr.name).toBe("Error");
      expect(serializedErr.message).toBe("circular error");
      expect(serializedErr.self).toBe("[Circular]");
      expect(serializedErr.cause).toBe("[Circular]");
    });

    it("handles Object.create(null) and throwing toString without throwing unhandled exceptions", () => {
      const nullProto = Object.create(null);
      nullProto.key = "value";
      expect(safeSerializeDetails(nullProto)).toEqual({ key: "value" });

      const throwingObj = {
        get bad() {
          throw new Error("Getter boom");
        },
        toString() {
          throw new Error("toString boom");
        },
      };
      const fallback = safeSerializeDetails(throwingObj);
      expect(typeof fallback).toBe("string");
    });

    it("truncates very long strings at 5000 characters", () => {
      const longStr = "A".repeat(6000);
      const res = safeSerializeDetails({ text: longStr }) as any;
      expect(res.text.length).toBeLessThan(6000);
      expect(res.text).toContain("[truncated]");

      const rootRes = safeSerializeDetails(longStr) as string;
      expect(rootRes.length).toBeLessThan(6000);
      expect(rootRes).toContain("[truncated]");
    });

    it("preserves custom properties on objects containing code and message", () => {
      const payload = {
        code: 4,
        message: "MEDIA_ERR_SRC_NOT_SUPPORTED",
        src: "blob:http://localhost:3000/123",
        segmentId: "seg_abc_123",
      };
      const serialized = safeSerializeDetails(payload) as any;
      expect(serialized.code).toBe(4);
      expect(serialized.message).toBe("MEDIA_ERR_SRC_NOT_SUPPORTED");
      expect(serialized.src).toBe("blob:http://localhost:3000/123");
      expect(serialized.segmentId).toBe("seg_abc_123");
    });

    it("serializes Set, Map, and RegExp collections cleanly", () => {
      const setInput = new Set(["apple", "banana"]);
      const mapInput = new Map([["key1", "val1"], ["key2", "val2"]]);
      const regexInput = /^[a-z]+$/i;

      const serialized = safeSerializeDetails({
        tags: setInput,
        meta: mapInput,
        pattern: regexInput,
      }) as any;

      expect(Array.isArray(serialized.tags)).toBe(true);
      expect(serialized.tags).toEqual(["apple", "banana"]);
      expect(serialized.meta).toEqual({ key1: "val1", key2: "val2" });
      expect(serialized.pattern).toBe("/^[a-z]+$/i");
    });
  });

  describe("logEvent and ring buffer", () => {
    it("pushes log entry into ring buffer and caps at 200 items", () => {
      for (let i = 0; i < 220; i++) {
        logEvent("info", "system", `Message ${i}`, { index: i });
      }

      const recent = getRecentLogs(300);
      expect(recent.length).toBe(200);
      expect(recent[0].message).toBe("Message 20");
      expect(recent[199].message).toBe("Message 219");
    });

    it("clamps getRecentLogs limit safely", () => {
      logEvent("warn", "playback", "Test warn");
      expect(getRecentLogs(0).length).toBe(1);
      expect(getRecentLogs(NaN as any).length).toBe(1);
      expect(getRecentLogs(-10).length).toBe(1);
    });

    it("clears server logs cleanly", () => {
      logEvent("error", "download", "Failed");
      expect(getRecentLogs().length).toBe(1);
      clearServerLogs();
      expect(getRecentLogs().length).toBe(0);
    });
  });
});
