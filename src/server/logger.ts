import { serverEvents } from "./events";
import type { LogEntry, LogLevel, LogCategory } from "./types";

const MAX_SERVER_LOGS = 200;
const logBuffer: LogEntry[] = [];
let logCounter = 0;

export function sanitizeInternalPaths(text: string): string {
  if (!text) return text;
  let sanitized = text;
  try {
    const cwd = process.cwd();
    sanitized = sanitized.split(cwd).join(".");
    const forwardCwd = cwd.replace(/\\/g, "/");
    sanitized = sanitized.split(forwardCwd).join(".");
    const backwardCwd = cwd.replace(/\//g, "\\");
    sanitized = sanitized.split(backwardCwd).join(".");
  } catch {}
  return sanitized.replace(/(?:[a-zA-Z]:)?[\\/](?:Users|home)[\\/][^\\/]+[\\/]/gi, "~/");
}

export function safeSerializeDetails(details: unknown): unknown {
  if (details === undefined || details === null) return undefined;
  if (typeof details === "string") {
    const sanitized = sanitizeInternalPaths(details);
    return sanitized.length > 5000 ? sanitized.slice(0, 5000) + "... [truncated]" : sanitized;
  }
  if (typeof details === "number" || typeof details === "boolean") return details;

  try {
    const seen = new WeakSet();
    const clean = JSON.stringify(details, (_key, value) => {
      if (typeof value === "bigint" || (typeof value === "object" && value !== null && Object.prototype.toString.call(value) === "[object BigInt]")) {
        return value.toString();
      }
      if (typeof value === "object" && value !== null) {
        if (seen.has(value)) return "[Circular]";
        seen.add(value);
      }
      if (value instanceof Error) {
        const isProd = process.env.NODE_ENV === "production";
        const errorObj: Record<string, unknown> = {
          name: value.name,
          message: sanitizeInternalPaths(value.message),
          cause: value.cause,
          ...(value as unknown as Record<string, unknown>),
        };
        if (!isProd && value.stack) {
          errorObj.stack = sanitizeInternalPaths(value.stack);
        } else {
          delete errorObj.stack;
        }
        if ("errors" in value && Array.isArray((value as any).errors)) {
          errorObj.errors = (value as any).errors;
        }
        return errorObj;
      }
      if (value instanceof Set) {
        return Array.from(value);
      }
      if (value instanceof Map) {
        return Object.fromEntries(value);
      }
      if (value instanceof RegExp) {
        return value.toString();
      }
      if (typeof value === "string" && value.length > 5000) {
        return value.slice(0, 5000) + "... [truncated]";
      }
      return value;
    });
    return JSON.parse(clean);
  } catch {
    try {
      return String(details);
    } catch {
      return "[Unserializable Details]";
    }
  }
}

export function logEvent(
  level: LogLevel,
  category: LogCategory,
  message: string,
  details?: unknown
): LogEntry {
  let safeMessage: string;
  try {
    safeMessage = typeof message === "string" && message.length > 2000
      ? message.slice(0, 2000) + "... [truncated]"
      : String(message ?? "");
  } catch {
    safeMessage = "[Unstringifiable Message]";
  }

  const entry: LogEntry = {
    id: `srv_${Date.now()}_${++logCounter}`,
    timestamp: Date.now(),
    level,
    category,
    message: safeMessage,
    details: safeSerializeDetails(details),
  };

  logBuffer.push(entry);
  if (logBuffer.length > MAX_SERVER_LOGS) {
    logBuffer.shift();
  }

  // Console output
  const safeCategory = typeof category === "string" && category ? category.toUpperCase() : "SYSTEM";
  const prefix = `[Server:${safeCategory}] ${safeMessage}`;
  const logArgs = entry.details !== undefined ? [prefix, entry.details] : [prefix];
  if (level === "error") {
    console.error(...logArgs);
  } else if (level === "warn") {
    console.warn(...logArgs);
  } else {
    console.log(...logArgs);
  }

  // Broadcast to connected WebSocket clients
  serverEvents.emit("app_log", entry);

  return entry;
}

export function getRecentLogs(limit = 100): LogEntry[] {
  const parsedLimit = typeof limit === "number" && Number.isFinite(limit) ? limit : 100;
  const safeLimit = Math.max(1, Math.min(parsedLimit, MAX_SERVER_LOGS));
  return logBuffer.slice(-safeLimit);
}

export function clearServerLogs(): void {
  logBuffer.length = 0;
}
