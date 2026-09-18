import * as React from "react";
import {
  X,
  Trash2,
  Copy,
  Check,
  Search,
  Terminal,
  AlertCircle,
  CheckCircle2,
  Info,
  AlertTriangle,
  ArrowDownToLine,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { useTranslation } from "react-i18next";
import { useLogStore, type LogFilterCategory, type AppLogItem } from "../store/useLogStore";
import { normalizeVi, tokenizeQuery } from "../lib/search";

interface LogDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

function formatLogTimestamp(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${ms}`;
}

export function safeStringify(value: unknown, indent?: number): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") {
    return value.length > 5000 ? value.slice(0, 5000) + "... [truncated]" : value;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);

  try {
    const seen = new WeakSet();
    return (
      JSON.stringify(
        value,
        (_k, v) => {
          if (typeof v === "bigint" || (typeof v === "object" && v !== null && Object.prototype.toString.call(v) === "[object BigInt]")) {
            return v.toString();
          }
          if (typeof v === "object" && v !== null) {
            if (seen.has(v)) return "[Circular]";
            seen.add(v);
          }
          if (v instanceof Error) {
            const errorObj: Record<string, unknown> = {
              name: v.name,
              message: v.message,
              stack: v.stack,
              cause: v.cause,
              ...(v as unknown as Record<string, unknown>),
            };
            if ("errors" in v && Array.isArray((v as any).errors)) {
              errorObj.errors = (v as any).errors;
            }
            return errorObj;
          }
          if (typeof MediaError !== "undefined" && v instanceof MediaError) {
            return { code: v.code, message: v.message };
          }
          if (v instanceof Set) return Array.from(v);
          if (v instanceof Map) return Object.fromEntries(v);
          if (v instanceof RegExp) return v.toString();
          if (typeof v === "string" && v.length > 5000) {
            return v.slice(0, 5000) + "... [truncated]";
          }
          return v;
        },
        indent
      ) ?? ""
    );
  } catch {
    try {
      return String(value);
    } catch {
      return "[Unserializable Details]";
    }
  }
}

export function safePrettyStringify(value: unknown): string {
  return safeStringify(value, 2);
}

export function LogDrawer({ isOpen, onClose }: LogDrawerProps) {
  const { t } = useTranslation();
  const logs = useLogStore((s) => s.logs);
  const clearLogs = useLogStore((s) => s.clearLogs);
  const filterCategory = useLogStore((s) => s.filterCategory);
  const setFilterCategory = useLogStore((s) => s.setFilterCategory);
  const searchQuery = useLogStore((s) => s.searchQuery);
  const setSearchQuery = useLogStore((s) => s.setSearchQuery);
  const autoScroll = useLogStore((s) => s.autoScroll);
  const setAutoScroll = useLogStore((s) => s.setAutoScroll);

  const deferredSearch = React.useDeferredValue(searchQuery);
  const [copied, setCopied] = React.useState(false);
  const [expandedLogIds, setExpandedLogIds] = React.useState<Set<string>>(new Set());
  const [isUserScrolledUp, setIsUserScrolledUp] = React.useState(false);
  const copyTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const listContainerRef = React.useRef<HTMLDivElement>(null);
  const drawerRef = React.useRef<HTMLDivElement>(null);
  const isFirstRender = React.useRef(true);
  const previousActiveElementRef = React.useRef<HTMLElement | null>(null);

  // Focus search input and manage focus restoration on mount/unmount
  React.useEffect(() => {
    if (isOpen) {
      setIsUserScrolledUp(false);
      previousActiveElementRef.current = document.activeElement as HTMLElement | null;
      searchInputRef.current?.focus();
    }
    return () => {
      if (previousActiveElementRef.current && typeof previousActiveElementRef.current.focus === "function") {
        try {
          previousActiveElementRef.current.focus();
        } catch {}
        previousActiveElementRef.current = null;
      }
    };
  }, [isOpen]);

  // Clear expandedLogIds when logs are cleared
  React.useEffect(() => {
    if (logs.length === 0) setExpandedLogIds(new Set());
  }, [logs.length]);

  // Clean copy timeout on unmount
  React.useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    };
  }, []);

  // Keyboard navigation & close on Escape + focus trap
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key === "Tab" && drawerRef.current) {
        const focusable = drawerRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length > 0) {
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (!drawerRef.current.contains(document.activeElement)) {
            e.preventDefault();
            first.focus();
            return;
          }
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Counts by category
  const { errorCount, downloadCount, playbackCount, systemCount } = React.useMemo(() => {
    let error = 0;
    let download = 0;
    let playback = 0;
    let system = 0;
    for (const l of logs) {
      if (l.level === "error") error++;
      if (l.category === "download") download++;
      else if (l.category === "playback") playback++;
      else if (l.category === "system") system++;
    }
    return { errorCount: error, downloadCount: download, playbackCount: playback, systemCount: system };
  }, [logs]);

  // Filtered logs using deferredSearch for fast responsiveness
  const filteredLogs = React.useMemo(() => {
    if (!isOpen) return [];
    const trimmed = deferredSearch.trim();
    const tokens = trimmed ? tokenizeQuery(trimmed) : null;

    return logs.filter((item) => {
      // Category filter
      if (filterCategory === "error") {
        if (item.level !== "error") return false;
      } else if (filterCategory !== "all") {
        if (item.category !== filterCategory) return false;
      }

      // Search query filter: fast check using cached searchableText or hoisted tokenized matching
      if (tokens && tokens.length > 0) {
        if (item.searchableText) {
          return tokens.every((tok) => item.searchableText?.includes(tok));
        }
        const combined = `${normalizeVi(item.level)} ${normalizeVi(item.message)} ${normalizeVi(item.category)} ${item.details ? normalizeVi(safeStringify(item.details)) : ""}`;
        return tokens.every((tok) => combined.includes(tok));
      }

      return true;
    });
  }, [logs, filterCategory, deferredSearch, isOpen]);

  // Track user scrolling: pause auto-scroll if user has scrolled away from the bottom
  const handleContainerScroll = React.useCallback(() => {
    if (!listContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = listContainerRef.current;
    const isScrolledUp = scrollHeight - scrollTop - clientHeight > 40;
    setIsUserScrolledUp(isScrolledUp);
  }, []);

  // Consolidated scroll synchronization effect to prevent layout thrashing on tab switch
  const latestFilteredLogId = filteredLogs.length > 0 ? filteredLogs[filteredLogs.length - 1].id : null;
  const prevFilterRef = React.useRef({ category: filterCategory, query: deferredSearch });

  React.useEffect(() => {
    if (!isOpen || !listContainerRef.current) return;

    if (isFirstRender.current) {
      isFirstRender.current = false;
      if (autoScroll && !isUserScrolledUp) {
        listContainerRef.current.scrollTop = listContainerRef.current.scrollHeight;
      }
      return;
    }

    const queryChanged = prevFilterRef.current.query !== deferredSearch;
    const categoryChanged = prevFilterRef.current.category !== filterCategory;
    prevFilterRef.current = { category: filterCategory, query: deferredSearch };

    if (queryChanged) {
      listContainerRef.current.scrollTop = 0;
      const { scrollHeight, clientHeight } = listContainerRef.current;
      setIsUserScrolledUp(scrollHeight - clientHeight > 40);
      return;
    }

    if (categoryChanged) {
      if (autoScroll) {
        listContainerRef.current.scrollTop = listContainerRef.current.scrollHeight;
        setIsUserScrolledUp(false);
      } else {
        listContainerRef.current.scrollTop = 0;
        const { scrollHeight, clientHeight } = listContainerRef.current;
        setIsUserScrolledUp(scrollHeight - clientHeight > 40);
      }
      return;
    }

    if (autoScroll && !isUserScrolledUp) {
      listContainerRef.current.scrollTop = listContainerRef.current.scrollHeight;
    }
  }, [latestFilteredLogId, isOpen, autoScroll, isUserScrolledUp, filterCategory, deferredSearch]);

  const handleToggleAutoScroll = () => {
    const next = !autoScroll;
    setAutoScroll(next);
    if (next) {
      setIsUserScrolledUp(false);
      if (listContainerRef.current) {
        listContainerRef.current.scrollTop = listContainerRef.current.scrollHeight;
      }
    }
  };

  const handleCopyAll = async () => {
    if (filteredLogs.length === 0) return;
    const text = filteredLogs
      .map((l) => {
        const time = formatLogTimestamp(l.timestamp);
        const detailsStr = l.details !== undefined && l.details !== null ? ` | details: ${safeStringify(l.details)}` : "";
        const safeLevel = (l.level || "info").toUpperCase();
        const safeCat = (l.category || "system").toUpperCase();
        return `[${time}] [${safeLevel}] [${safeCat}] ${l.message}${detailsStr}`;
      })
      .join("\n");

    const fallbackCopy = () => {
      const prevActive = document.activeElement as HTMLElement | null;
      try {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.style.position = "fixed";
        textArea.style.left = "-999999px";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand("copy");
        textArea.remove();
        prevActive?.focus();
        setCopied(true);
        if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
        copyTimeoutRef.current = setTimeout(() => setCopied(false), 2000);
      } catch {
        prevActive?.focus();
        // Ignore clipboard errors
      }
    };

    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
        copyTimeoutRef.current = setTimeout(() => setCopied(false), 2000);
      } catch {
        fallbackCopy();
      }
    } else {
      fallbackCopy();
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedLogIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div
        aria-hidden="true"
        className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity animate-in fade-in duration-200"
        onClick={onClose}
      />

      {/* Drawer Panel */}
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        data-drawer="log-drawer"
        aria-label={t("logs.title")}
        className="relative z-10 w-full max-w-md sm:max-w-xl md:max-w-2xl border-l border-border bg-card/95 backdrop-blur-md shadow-2xl flex flex-col h-full animate-in slide-in-from-right duration-200 text-foreground"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border bg-card/80">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-md bg-primary/10 border border-primary/20 text-primary">
              <Terminal className="h-4 w-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-bold text-sm tracking-tight">{t("logs.title")}</h2>
                <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-accent text-accent-foreground border border-border">
                  {logs.length}
                </span>
                {errorCount > 0 && (
                  <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-destructive/20 text-destructive border border-destructive/30 font-semibold">
                    {t("logs.errorsCount", { count: errorCount })}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t("logs.description")}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {/* Auto-scroll toggle */}
            <Button
              variant={autoScroll ? "secondary" : "ghost"}
              size="sm"
              onClick={handleToggleAutoScroll}
              title={autoScroll ? t("logs.autoScrollOn") : t("logs.autoScrollOff")}
              aria-label={t("logs.autoScroll")}
              aria-pressed={autoScroll}
              className="h-8 px-2 text-xs gap-1 text-muted-foreground hover:text-foreground"
            >
              <ArrowDownToLine className={`h-3.5 w-3.5 ${autoScroll ? "text-primary" : "opacity-60"}`} />
              <span className="hidden md:inline">{t("logs.autoScroll")}</span>
            </Button>

            {/* Copy button */}
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopyAll}
              disabled={filteredLogs.length === 0}
              title={t("logs.copyTooltip")}
              aria-label={t("logs.copyTooltip")}
              className="h-8 px-2 text-xs gap-1 border-border/80 text-muted-foreground hover:text-foreground"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-flexoki-green" /> : <Copy className="h-3.5 w-3.5" />}
              <span className="hidden sm:inline">{copied ? t("logs.copied") : t("logs.copy")}</span>
            </Button>

            {/* Clear button */}
            <Button
              variant="ghost"
              size="sm"
              onClick={clearLogs}
              disabled={logs.length === 0}
              title={t("logs.clearTooltip")}
              aria-label={t("logs.clearTooltip")}
              className="h-8 px-2 text-xs gap-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t("logs.clear")}</span>
            </Button>

            {/* Close button */}
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              aria-label={t("logs.close")}
              className="h-8 w-8 text-muted-foreground hover:text-foreground ml-1"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Filter Category Tabs & Search Bar */}
        <div className="p-3 border-b border-border bg-background/50 space-y-2.5">
          {/* Tabs */}
          <div role="tablist" aria-label={t("logs.title")} className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs select-none">
            {[
              { id: "all" as LogFilterCategory, label: t("logs.filterAll"), count: logs.length },
              { id: "download" as LogFilterCategory, label: t("logs.filterDownload"), count: downloadCount },
              { id: "error" as LogFilterCategory, label: t("logs.filterError"), count: errorCount, isError: true },
              { id: "playback" as LogFilterCategory, label: t("logs.filterPlayback"), count: playbackCount },
              { id: "system" as LogFilterCategory, label: t("logs.filterSystem"), count: systemCount },
            ].map((tab) => {
              const isSelected = filterCategory === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  aria-controls="log-list-panel"
                  onClick={() => setFilterCategory(tab.id)}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors shrink-0 ${
                    isSelected
                      ? tab.isError && tab.count > 0
                        ? "bg-destructive text-destructive-foreground font-semibold"
                        : "bg-primary text-primary-foreground font-semibold"
                      : "bg-secondary/50 hover:bg-secondary text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <span>{tab.label}</span>
                  <span
                    className={`font-mono text-[10px] px-1 py-0.2 rounded ${
                      isSelected
                        ? "bg-black/20 text-inherit"
                        : tab.isError && tab.count > 0
                        ? "bg-destructive/20 text-destructive font-bold"
                        : "bg-background text-muted-foreground"
                    }`}
                  >
                    {tab.count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Search box */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              ref={searchInputRef}
              type="text"
              placeholder={t("logs.searchPlaceholder")}
              aria-label={t("logs.searchPlaceholder")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 pl-8 pr-7 text-xs bg-background/80"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5"
                title={t("nav.clearSearch")}
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>

        {/* Logs List Area */}
        <div
          ref={listContainerRef}
          role="tabpanel"
          id="log-list-panel"
          aria-label={t("logs.title")}
          tabIndex={0}
          onScroll={handleContainerScroll}
          className="flex-1 overflow-y-auto p-3 space-y-1.5 font-mono text-xs select-text focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {filteredLogs.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center text-muted-foreground p-8 space-y-2">
              <Terminal className="h-8 w-8 opacity-30" />
              <p className="text-xs font-sans">
                {logs.length === 0
                  ? t("logs.emptyDesc")
                  : t("logs.emptyFilter")}
              </p>
              {searchQuery && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSearchQuery("")}
                  className="text-xs font-sans mt-2"
                >
                  {t("library.clearSearch")}
                </Button>
              )}
            </div>
          ) : (
            filteredLogs.map((item) => {
              const isExpanded = expandedLogIds.has(item.id);
              const hasDetails = item.details !== undefined && item.details !== null;

              let levelBadge = (
                <span className="px-1 py-0.5 rounded text-[10px] font-bold bg-primary/10 text-primary border border-primary/20 shrink-0">
                  INFO
                </span>
              );
              let icon = <Info className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />;
              let borderColor = "border-border/60 hover:border-border";

              if (item.level === "error") {
                levelBadge = (
                  <span className="px-1 py-0.5 rounded text-[10px] font-bold bg-destructive/20 text-destructive border border-destructive/30 shrink-0">
                    ERROR
                  </span>
                );
                icon = <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />;
                borderColor = "border-destructive/30 bg-destructive/5 hover:border-destructive/50";
              } else if (item.level === "warn") {
                levelBadge = (
                  <span className="px-1 py-0.5 rounded text-[10px] font-bold bg-flexoki-yellow/20 text-flexoki-yellow border border-flexoki-yellow/30 shrink-0">
                    WARN
                  </span>
                );
                icon = <AlertTriangle className="h-3.5 w-3.5 text-flexoki-yellow shrink-0 mt-0.5" />;
                borderColor = "border-flexoki-yellow/30 bg-flexoki-yellow/5 hover:border-flexoki-yellow/50";
              } else if (item.level === "success") {
                levelBadge = (
                  <span className="px-1 py-0.5 rounded text-[10px] font-bold bg-flexoki-green/20 text-flexoki-green border border-flexoki-green/30 shrink-0">
                    OK
                  </span>
                );
                icon = <CheckCircle2 className="h-3.5 w-3.5 text-flexoki-green shrink-0 mt-0.5" />;
                borderColor = "border-flexoki-green/30 bg-flexoki-green/5 hover:border-flexoki-green/50";
              }

              let categoryTag = t("logs.filterSystem").toUpperCase();
              if (item.category === "download") categoryTag = t("logs.filterDownload").toUpperCase();
              if (item.category === "playback") categoryTag = t("logs.filterPlayback").toUpperCase();

              return (
                <div
                  key={item.id}
                  className={`rounded-md border p-2 transition-colors ${borderColor}`}
                >
                  <div className="flex items-start gap-2">
                    {icon}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap text-[10px] text-muted-foreground mb-0.5">
                        <span className="font-semibold text-foreground/80">
                          {formatLogTimestamp(item.timestamp)}
                        </span>
                        {levelBadge}
                        <span className="px-1 py-0.2 rounded bg-secondary text-secondary-foreground text-[10px] uppercase tracking-wider">
                          {categoryTag}
                        </span>
                      </div>
                      <p className="break-words text-xs leading-relaxed text-foreground select-text">
                        {item.message}
                      </p>
                    </div>

                    {hasDetails && (
                      <button
                        type="button"
                        onClick={() => toggleExpand(item.id)}
                        aria-expanded={isExpanded}
                        aria-label={isExpanded ? t("logs.collapseDetails") : t("logs.viewDetails")}
                        className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent shrink-0"
                        title={isExpanded ? t("logs.collapseDetails") : t("logs.viewDetails")}
                      >
                        {isExpanded ? (
                          <ChevronDown className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5" />
                        )}
                      </button>
                    )}
                  </div>

                  {/* Expandable JSON / Details */}
                  {hasDetails && isExpanded && (
                    <div className="mt-2 pt-2 border-t border-border/50 text-[11px] overflow-x-auto bg-black/30 p-2 rounded">
                      <pre className="text-muted-foreground whitespace-pre-wrap break-all">
                        {safePrettyStringify(item.details)}
                      </pre>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer info bar */}
        <div className="px-4 py-2 border-t border-border bg-card/60 flex items-center justify-between text-[10px] text-muted-foreground font-sans">
          <span>{t("logs.shortcutHint")}</span>
          <span className="font-mono">
            {t("logs.linesCount", { current: filteredLogs.length, total: logs.length })}
          </span>
        </div>
      </div>
    </div>
  );
}
