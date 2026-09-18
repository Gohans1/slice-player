import { create } from "zustand";
import type { LogLevel, LogCategory, LogEntry } from "@/server/types";
import { normalizeVi } from "../lib/search";

export type { LogLevel, LogCategory };
export type LogFilterCategory = "all" | "download" | "playback" | "error" | "system";

export interface AppLogItem extends LogEntry {
  searchableText?: string;
}

const MAX_LOGS = 500;
let nextLogIdCounter = 0;

export function safeSerializeDetails(details: unknown): unknown {
  if (details === undefined || details === null) return undefined;
  if (typeof details === "string") {
    return details.length > 5000 ? details.slice(0, 5000) + "... [truncated]" : details;
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
        const errorObj: Record<string, unknown> = {
          name: value.name,
          message: value.message,
          stack: value.stack,
          cause: value.cause,
          ...(value as unknown as Record<string, unknown>),
        };
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
      if (typeof MediaError !== "undefined" && value instanceof MediaError) {
        return {
          code: value.code,
          message: value.message,
        };
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

interface LogState {
  logs: AppLogItem[];
  unreadErrorCount: number;
  filterCategory: LogFilterCategory;
  searchQuery: string;
  isDrawerOpen: boolean;
  autoScroll: boolean;

  addLog: (entry: {
    id?: string;
    timestamp?: number;
    level: LogLevel;
    category: LogCategory;
    message: string;
    details?: unknown;
  }) => void;
  setLogs: (logs: LogEntry[]) => void;
  clearLogs: () => void;
  clearLogsLocal: () => void;
  setFilterCategory: (category: LogFilterCategory) => void;
  setSearchQuery: (query: string) => void;
  setAutoScroll: (auto: boolean) => void;
  setIsDrawerOpen: (isOpen: boolean) => void;
  openDrawer: () => void;
  closeDrawer: () => void;
  toggleDrawer: () => void;
  resetUnreadErrorCount: () => void;
}

const CATEGORY_NAMES_VI: Record<string, string> = {
  download: "tải nhạc",
  playback: "phát nhạc",
  system: "hệ thống",
};

export const useLogStore = create<LogState>((set, get) => ({
  logs: [],
  unreadErrorCount: 0,
  filterCategory: "all",
  searchQuery: "",
  isDrawerOpen: false,
  autoScroll: true,

  addLog: (entry) => {
    let safeMessage: string;
    try {
      safeMessage = typeof entry.message === "string" && entry.message.length > 2000
        ? entry.message.slice(0, 2000) + "... [truncated]"
        : String(entry.message ?? "");
    } catch {
      safeMessage = "[Unstringifiable Message]";
    }

    const serializedDetails = safeSerializeDetails(entry.details);
    const detailsSearch = serializedDetails !== undefined && serializedDetails !== null
      ? typeof serializedDetails === "string"
        ? serializedDetails
        : JSON.stringify(serializedDetails)
      : "";
    const catVi = CATEGORY_NAMES_VI[entry.category] || "";
    const rawSearch = `${entry.level} ${entry.category} ${catVi} ${safeMessage} ${detailsSearch}`;
    const searchableText = `${rawSearch} ${normalizeVi(rawSearch)}`.toLowerCase();

    const newItem: AppLogItem = {
      id: entry.id || `log_${Date.now()}_${++nextLogIdCounter}`,
      timestamp: entry.timestamp ?? Date.now(),
      level: entry.level,
      category: entry.category,
      message: safeMessage,
      details: serializedDetails,
      searchableText,
    };

    set((state) => {
      // Avoid duplicate logs if same id already exists
      if (state.logs.some((l) => l.id === newItem.id)) {
        return state;
      }
      const isError = newItem.level === "error";
      const isClosed = !state.isDrawerOpen;
      const updatedLogs = state.logs.length >= MAX_LOGS
        ? [...state.logs.slice(state.logs.length - MAX_LOGS + 1), newItem]
        : [...state.logs, newItem];

      return {
        logs: updatedLogs,
        unreadErrorCount: isError && isClosed ? state.unreadErrorCount + 1 : state.unreadErrorCount,
      };
    });
  },

  setLogs: (newLogs) => {
    set((state) => {
      // Merge unique by id, avoiding both state collisions and intra-batch duplicates
      const existingIds = new Set(state.logs.map((l) => l.id));
      const freshToAdd: AppLogItem[] = [];

      for (const l of newLogs) {
        if (!l || !l.id || existingIds.has(l.id)) continue;
        existingIds.add(l.id);

        const serializedDetails = safeSerializeDetails(l.details);
        const detailsSearch = serializedDetails !== undefined && serializedDetails !== null
          ? typeof serializedDetails === "string"
            ? serializedDetails
            : JSON.stringify(serializedDetails)
          : "";
        let safeMessage: string;
        try {
          safeMessage = typeof l.message === "string" && l.message.length > 2000
            ? l.message.slice(0, 2000) + "... [truncated]"
            : String(l.message ?? "");
        } catch {
          safeMessage = "[Unstringifiable Message]";
        }
        const catVi = CATEGORY_NAMES_VI[l.category] || "";
        const rawSearch = `${l.level} ${l.category} ${catVi} ${safeMessage} ${detailsSearch}`;
        freshToAdd.push({
          ...l,
          message: safeMessage,
          details: serializedDetails,
          searchableText: (l as AppLogItem).searchableText || `${rawSearch} ${normalizeVi(rawSearch)}`.toLowerCase(),
        });
      }

      if (freshToAdd.length === 0) return state;

      const merged = [...state.logs, ...freshToAdd].sort((a, b) => (a.timestamp - b.timestamp) || a.id.localeCompare(b.id));
      const capped = merged.slice(-MAX_LOGS);
      const newErrors = !state.isDrawerOpen
        ? freshToAdd.filter((l) => l.level === "error").length
        : 0;
      const unread = state.logs.length === 0 && !state.isDrawerOpen
        ? capped.filter((l) => l.level === "error").length
        : state.unreadErrorCount + newErrors;

      return { logs: capped, unreadErrorCount: unread };
    });
  },

  clearLogs: () => {
    set({ logs: [], unreadErrorCount: 0 });
    try {
      fetch("/api/logs", { method: "DELETE" }).catch(() => {});
    } catch {}
  },

  clearLogsLocal: () => {
    set({ logs: [], unreadErrorCount: 0 });
  },

  setFilterCategory: (cat) => set({ filterCategory: cat }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setAutoScroll: (auto) => set({ autoScroll: auto }),

  setIsDrawerOpen: (open) => {
    set({
      isDrawerOpen: open,
      unreadErrorCount: open ? 0 : get().unreadErrorCount,
    });
  },

  openDrawer: () => {
    set({ isDrawerOpen: true, unreadErrorCount: 0 });
  },

  closeDrawer: () => {
    set({ isDrawerOpen: false });
  },

  toggleDrawer: () => {
    const next = !get().isDrawerOpen;
    set({
      isDrawerOpen: next,
      unreadErrorCount: next ? 0 : get().unreadErrorCount,
    });
  },

  resetUnreadErrorCount: () => set({ unreadErrorCount: 0 }),
}));

// Global convenience helpers for client-side logging outside React components
export function logClientInfo(category: LogCategory, message: string, details?: unknown) {
  useLogStore.getState().addLog({ level: "info", category, message, details });
}

export function logClientWarn(category: LogCategory, message: string, details?: unknown) {
  useLogStore.getState().addLog({ level: "warn", category, message, details });
}

export function logClientError(category: LogCategory, message: string, details?: unknown) {
  useLogStore.getState().addLog({ level: "error", category, message, details });
}

export function logClientSuccess(category: LogCategory, message: string, details?: unknown) {
  useLogStore.getState().addLog({ level: "success", category, message, details });
}
