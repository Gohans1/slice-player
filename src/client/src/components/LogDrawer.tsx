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
  ChevronRight,
} from "lucide-react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia } from "./ui/empty";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "./ui/input-group";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from "./ui/sheet";
import { Toggle } from "./ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import { useTranslation } from "react-i18next";
import { useFormatNumber } from "../hooks/use-format-number";
import { useLogStore, type LogFilterCategory } from "../store/useLogStore";
import { normalizeVi, tokenizeQuery } from "../lib/search";
import { cn } from "../lib/utils";
import { copyToClipboard } from "../lib/clipboard";
import { useVirtualizer } from "@tanstack/react-virtual";

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

interface LogDrawerContentProps {
  searchInputRef: React.RefObject<HTMLInputElement | null>;
}

// Mounted only while the sheet is open, so its state starts fresh each time
function LogDrawerContent({ searchInputRef }: LogDrawerContentProps) {
  const { t } = useTranslation();
  const formatNumber = useFormatNumber();
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
  const listContainerRef = React.useRef<HTMLDivElement>(null);
  const isFirstRender = React.useRef(true);

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
  }, [logs, filterCategory, deferredSearch]);

  const observeElementRect = React.useCallback(
    (
      instance: { scrollElement: HTMLDivElement | null },
      cb: (rect: { width: number; height: number }) => void
    ) => {
      const el = instance.scrollElement;
      if (!el) return () => {};
      const update = () => {
        const r = el.getBoundingClientRect();
        cb({
          width: r.width > 0 ? r.width : 400,
          height: r.height > 0 ? r.height : 600,
        });
      };
      update();
      if (typeof ResizeObserver !== "undefined") {
        const observer = new ResizeObserver((entries) => {
          const entry = entries[0];
          if (entry) {
            const borderBox = entry.borderBoxSize?.[0];
            const width = borderBox ? borderBox.inlineSize : entry.contentRect?.width;
            const height = borderBox ? borderBox.blockSize : entry.contentRect?.height;
            cb({
              width: width && width > 0 ? Math.round(width) : 400,
              height: height && height > 0 ? Math.round(height) : 600,
            });
          } else {
            update();
          }
        });
        observer.observe(el, { box: "border-box" });
        return () => {
          observer.disconnect();
        };
      }
      return () => {};
    },
    []
  );

  const rowVirtualizer = useVirtualizer({
    count: filteredLogs.length,
    getScrollElement: () => listContainerRef.current,
    estimateSize: () => 56,
    overscan: 10,
    initialRect: { width: 400, height: 600 },
    observeElementRect,
  });

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
    if (!listContainerRef.current) return;

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
  }, [latestFilteredLogId, autoScroll, isUserScrolledUp, filterCategory, deferredSearch]);

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

    if (await copyToClipboard(text)) {
      setCopied(true);
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = setTimeout(() => setCopied(false), 2000);
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

  const filters: { id: LogFilterCategory; label: string; count: number; isError?: boolean }[] = [
    { id: "all", label: t("logs.filterAll"), count: logs.length },
    { id: "download", label: t("logs.filterDownload"), count: downloadCount },
    { id: "error", label: t("logs.filterError"), count: errorCount, isError: true },
    { id: "playback", label: t("logs.filterPlayback"), count: playbackCount },
    { id: "system", label: t("logs.filterSystem"), count: systemCount },
  ];

  return (
    <>
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-border p-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="rounded-md border border-primary/20 bg-primary/10 p-1.5 text-primary">
              <Terminal className="size-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <SheetTitle>{t("logs.title")}</SheetTitle>
                <Badge variant="secondary">{formatNumber(logs.length)}</Badge>
                {errorCount > 0 && <Badge variant="destructive">{t("logs.errorsCount", { count: errorCount })}</Badge>}
              </div>
              <SheetDescription>{t("logs.description")}</SheetDescription>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <Toggle
              variant="outline"
              size="lg"
              pressed={autoScroll}
              onPressedChange={handleToggleAutoScroll}
              title={autoScroll ? t("logs.autoScrollOn") : t("logs.autoScrollOff")}
              aria-label={t("logs.autoScroll")}
            >
              <ArrowDownToLine data-icon="inline-start" />
              <span className="hidden md:inline">{t("logs.autoScroll")}</span>
            </Toggle>
            <Button
              variant="outline"
              size="lg"
              onClick={handleCopyAll}
              disabled={filteredLogs.length === 0}
              title={t("logs.copyTooltip")}
              aria-label={t("logs.copyTooltip")}
            >
              {copied ? <Check data-icon="inline-start" className="text-flexoki-green" /> : <Copy data-icon="inline-start" />}
              <span className="hidden sm:inline">{copied ? t("logs.copied") : t("logs.copy")}</span>
            </Button>
            <Button
              variant="ghost"
              size="lg"
              onClick={clearLogs}
              disabled={logs.length === 0}
              title={t("logs.clearTooltip")}
              aria-label={t("logs.clearTooltip")}
            >
              <Trash2 data-icon="inline-start" />
              <span className="hidden sm:inline">{t("logs.clear")}</span>
            </Button>
            <SheetClose aria-label={t("logs.close")} render={<Button variant="ghost" size="icon-lg" />}>
              <X />
            </SheetClose>
          </div>
        </div>

        {/* Category filters & search */}
        <div className="flex flex-col gap-2.5 border-b border-border p-3">
          <div className="overflow-x-auto pb-1">
            <ToggleGroup
              aria-label={t("logs.filterLabel", "Filter logs")}
              value={[filterCategory]}
              onValueChange={(value) => {
                // Pressing the active filter again empties the value; keep the filter instead
                const next = filters.find((filter) => value.includes(filter.id));
                if (next) setFilterCategory(next.id);
              }}
              variant="outline"
              size="sm"
            >
              {filters.map((filter) => (
                <ToggleGroupItem key={filter.id} value={filter.id}>
                  {filter.label}
                  <Badge variant={filter.isError && filter.count > 0 ? "destructive" : "secondary"}>{formatNumber(filter.count)}</Badge>
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>

          <InputGroup>
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            <InputGroupInput
              ref={searchInputRef}
              type="text"
              placeholder={t("logs.searchPlaceholder")}
              aria-label={t("logs.searchPlaceholder")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  size="icon-xs"
                  onClick={() => setSearchQuery("")}
                  aria-label={t("nav.clearSearch")}
                  title={t("nav.clearSearch")}
                >
                  <X />
                </InputGroupButton>
              </InputGroupAddon>
            )}
          </InputGroup>
        </div>

        {/* Logs List Area */}
        <div
          ref={listContainerRef}
          role="region"
          aria-label={t("logs.title")}
          tabIndex={0}
          onScroll={handleContainerScroll}
          className="flex-1 overflow-y-auto p-3 text-xs select-text outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        >
          {filteredLogs.length === 0 ? (
            <Empty className="h-full">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Terminal />
                </EmptyMedia>
                <EmptyDescription>{logs.length === 0 ? t("logs.emptyDesc") : t("logs.emptyFilter")}</EmptyDescription>
              </EmptyHeader>
              {searchQuery && (
                <EmptyContent>
                  <Button variant="ghost" onClick={() => setSearchQuery("")}>
                    {t("library.clearSearch")}
                  </Button>
                </EmptyContent>
              )}
            </Empty>
          ) : (
            <div
              className="relative h-(--virtual-size) w-full font-mono"
              style={{ "--virtual-size": `${rowVirtualizer.getTotalSize()}px` }}
            >
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const item = filteredLogs[virtualRow.index];
                if (!item) return null;
                const isExpanded = expandedLogIds.has(item.id);
                const hasDetails = item.details !== undefined && item.details !== null;

                let levelBadge = <Badge variant="blue">INFO</Badge>;
                let icon = <Info className="h-3.5 w-3.5 text-flexoki-blue shrink-0 mt-0.5" />;
                let borderColor = "border-border/60 hover:border-border";

                if (item.level === "error") {
                  levelBadge = <Badge variant="destructive">ERROR</Badge>;
                  icon = <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />;
                  borderColor = "border-destructive/30 bg-destructive/5 hover:border-destructive/50";
                } else if (item.level === "warn") {
                  levelBadge = <Badge variant="yellow">WARN</Badge>;
                  icon = <AlertTriangle className="h-3.5 w-3.5 text-flexoki-yellow shrink-0 mt-0.5" />;
                  borderColor = "border-flexoki-yellow/30 bg-flexoki-yellow/5 hover:border-flexoki-yellow/50";
                } else if (item.level === "success") {
                  levelBadge = <Badge variant="green">OK</Badge>;
                  icon = <CheckCircle2 className="h-3.5 w-3.5 text-flexoki-green shrink-0 mt-0.5" />;
                  borderColor = "border-flexoki-green/30 bg-flexoki-green/5 hover:border-flexoki-green/50";
                }

                let categoryTag = t("logs.filterSystem").toUpperCase();
                if (item.category === "download") categoryTag = t("logs.filterDownload").toUpperCase();
                if (item.category === "playback") categoryTag = t("logs.filterPlayback").toUpperCase();

                return (
                  <div
                    key={item.id}
                    ref={rowVirtualizer.measureElement}
                    data-index={virtualRow.index}
                    className="absolute inset-x-0 top-0 translate-y-(--virtual-start) pb-1.5"
                    style={{ "--virtual-start": `${virtualRow.start}px` }}
                  >
                    <div
                      className={`rounded-md border p-2 transition-colors ${borderColor}`}
                    >
                      <div className="flex items-start gap-2">
                        {icon}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap text-2xs text-muted-foreground mb-0.5">
                            <span className="font-semibold text-foreground/80">
                              {formatLogTimestamp(item.timestamp)}
                            </span>
                            {levelBadge}
                            <Badge variant="secondary">{categoryTag}</Badge>
                          </div>
                          <p className="break-words text-xs leading-relaxed text-foreground select-text">
                            {item.message}
                          </p>
                        </div>

                        {hasDetails && (
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => toggleExpand(item.id)}
                            aria-expanded={isExpanded}
                            aria-label={isExpanded ? t("logs.collapseDetails") : t("logs.viewDetails")}
                            title={isExpanded ? t("logs.collapseDetails") : t("logs.viewDetails")}
                          >
                            <ChevronRight className={cn("transition-transform duration-150", isExpanded && "rotate-90")} />
                          </Button>
                        )}
                      </div>

                      {/* Expandable JSON / Details */}
                      {hasDetails && isExpanded && (
                        <div className="mt-2 pt-2 border-t border-border/50 text-2xs overflow-x-auto bg-black/30 p-2 rounded animate-in fade-in slide-in-from-top-1 duration-150 ease-out motion-reduce:animate-none">
                          <pre className="text-muted-foreground whitespace-pre-wrap break-all">
                            {safePrettyStringify(item.details)}
                          </pre>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer info bar */}
        <div className="flex items-center justify-between border-t border-border px-4 py-2 font-sans text-2xs text-muted-foreground">
          <span>{t("logs.shortcutHint")}</span>
          <span className="font-mono">
            {t("logs.linesCount", { current: filteredLogs.length, total: logs.length })}
          </span>
        </div>
    </>
  );
}

// Slide-over log viewer. The shadcn Sheet traps focus, closes on Escape or the backdrop,
// returns focus to the opener and animates out.
export function LogDrawer({ isOpen, onClose }: LogDrawerProps) {
  const searchInputRef = React.useRef<HTMLInputElement>(null);

  return (
    <Sheet
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        data-drawer="log-drawer"
        showCloseButton={false}
        initialFocus={searchInputRef}
        className="data-[side=right]:w-full data-[side=right]:sm:max-w-xl data-[side=right]:md:max-w-2xl"
      >
        <LogDrawerContent searchInputRef={searchInputRef} />
      </SheetContent>
    </Sheet>
  );
}
