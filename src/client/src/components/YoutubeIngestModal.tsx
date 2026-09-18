import * as React from "react";
import { AlertCircle, Loader2, CheckCircle2 } from "lucide-react";
import { Button } from "./ui/button";
import { Modal } from "./ui/modal";
import { useTranslation } from "react-i18next";
import { usePlayerStore } from "../store/usePlayerStore";

export interface YoutubeQueueItem {
  id: string;
  url: string;
  status: "pending" | "scanning" | "success" | "error";
  message?: string;
  count?: number;
  error?: string;
}

export function YoutubeIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
  );
}

export interface YoutubeIngestModalProps {
  isOpen: boolean;
  onClose: () => void;
  onProcessingChange?: (isProcessing: boolean) => void;
}

const MAX_YT_BATCH_SIZE = 50;
const MAX_YT_QUEUE_TOTAL = 100;
const YT_URL_REGEX = /(?:\bhttps?:\/\/|\b)(?:(?:www\.|music\.|m\.)?youtube\.com|youtu\.be)\/[^\s,"';)]+/gi;

export const YoutubeIngestModal = React.memo(function YoutubeIngestModal({
  isOpen,
  onClose,
  onProcessingChange,
}: YoutubeIngestModalProps) {
  const { t } = useTranslation();
  const fetchTracks = usePlayerStore((s) => s.fetchTracks);

  const [ytUrl, setYtUrl] = React.useState("");
  const [ytError, setYtError] = React.useState<string | null>(null);
  const [ytQueue, setYtQueue] = React.useState<YoutubeQueueItem[]>([]);
  const [isProcessingYtQueue, setIsProcessingYtQueue] = React.useState(false);

  const ytQueueRef = React.useRef<YoutubeQueueItem[]>([]);
  const isProcessingYtQueueRef = React.useRef(false);
  const ytAbortControllerRef = React.useRef<AbortController | null>(null);
  const isMountedRef = React.useRef(true);
  const onProcessingChangeRef = React.useRef(onProcessingChange);

  React.useEffect(() => {
    onProcessingChangeRef.current = onProcessingChange;
  }, [onProcessingChange]);

  React.useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (ytAbortControllerRef.current) {
        ytAbortControllerRef.current.abort();
      }
    };
  }, []);

  const updateYtItem = React.useCallback((id: string, patch: Partial<YoutubeQueueItem>) => {
    ytQueueRef.current = ytQueueRef.current.map((it) => (it.id === id ? { ...it, ...patch } : it));
    if (isMountedRef.current) {
      setYtQueue([...ytQueueRef.current]);
    }
  }, []);

  const handleCancelYtQueue = React.useCallback(() => {
    if (ytAbortControllerRef.current) {
      ytAbortControllerRef.current.abort();
    }
    ytQueueRef.current = ytQueueRef.current.map((it) =>
      it.status === "pending" || it.status === "scanning"
        ? { ...it, status: "error" as const, error: t("ytModal.cancelled") }
        : it
    );
    if (isMountedRef.current) {
      setYtQueue([...ytQueueRef.current]);
    }
  }, [t]);

  const runYtQueue = React.useCallback(async () => {
    if (isProcessingYtQueueRef.current) return;
    isProcessingYtQueueRef.current = true;
    setIsProcessingYtQueue(true);
    onProcessingChangeRef.current?.(true);
    ytAbortControllerRef.current = new AbortController();
    const signal = ytAbortControllerRef.current.signal;

    try {
      while (true) {
        if (signal.aborted) break;

        const nextItem = ytQueueRef.current.find((it) => it.status === "pending");
        if (!nextItem) break;

        updateYtItem(nextItem.id, { status: "scanning" });

        try {
          const res = await fetch("/api/tracks/ingest-youtube", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: nextItem.url }),
            signal,
          });

          let data: any = null;
          try {
            data = await res.json();
          } catch {
            if (signal.aborted) {
              break;
            }
            updateYtItem(nextItem.id, {
              status: "error",
              error: res.ok
                ? t("ytModal.invalidJson")
                : t("ytModal.serverHttpError", { status: res.status, text: res.statusText || t("ytModal.noResponse") }),
            });
            continue;
          }

          if (signal.aborted) {
            break;
          }

          if (res.ok && data?.success) {
            const count = Array.isArray(data.tracks) ? data.tracks.length : 0;
            updateYtItem(nextItem.id, {
              status: "success",
              count,
              message: data.message || t("ytModal.addedTracks", { count }),
            });
            try {
              await fetchTracks();
            } catch (err) {
              console.warn("[YoutubeIngestModal] Failed to refresh tracks after YouTube ingest:", err);
            }
          } else {
            const rawErr = data?.message || data?.error;
            const errMsg =
              typeof rawErr === "string"
                ? rawErr
                : typeof rawErr?.message === "string"
                ? rawErr.message
                : res.statusText
                ? t("ytModal.serverHttpError", { status: res.status, text: res.statusText })
                : t("ytModal.ingestError");
            updateYtItem(nextItem.id, { status: "error", error: errMsg });
          }
        } catch (err: unknown) {
          if (signal.aborted) {
            break;
          }
          const msg = err instanceof Error ? err.message : String(err);
          updateYtItem(nextItem.id, { status: "error", error: t("ytModal.connectionError", { message: msg }) });
        }
      }
    } finally {
      const hasPending = isMountedRef.current && ytQueueRef.current.some((it) => it.status === "pending");
      if (hasPending) {
        runYtQueue();
      } else {
        isProcessingYtQueueRef.current = false;
        if (isMountedRef.current) {
          setIsProcessingYtQueue(false);
          onProcessingChangeRef.current?.(false);
        }
        ytAbortControllerRef.current = null;
      }
    }
  }, [fetchTracks, updateYtItem, t]);

  const handleIngestYoutube = (e?: React.SyntheticEvent) => {
    e?.preventDefault();
    const raw = ytUrl.trim();
    if (!raw) return;

    const sanitizeUrl = (u: string) => {
      let clean = u.trim().replace(/[.,!?:;>\]"']+$/, "");
      if (!/^https?:\/\//i.test(clean)) {
        clean = `https://${clean}`;
      }
      return clean;
    };

    const extractedUrls = raw.match(YT_URL_REGEX);
    if (!extractedUrls || extractedUrls.length === 0) {
      setYtError(t("ytModal.invalidUrlError"));
      return;
    }

    const lines = Array.from(
      new Set(
        extractedUrls
          .map(sanitizeUrl)
          .filter((u) => u.length > 0)
      )
    );

    if (lines.length === 0) return;

    if (lines.length > MAX_YT_BATCH_SIZE) {
      setYtError(t("ytModal.maxBatchError", { max: MAX_YT_BATCH_SIZE }));
      return;
    }

    setYtError(null);

    const activeUrls = new Set(
      ytQueueRef.current
        .filter((it) => it.status === "pending" || it.status === "scanning")
        .map((it) => it.url)
    );
    const uniqueLines = lines.filter((url) => !activeUrls.has(url));

    if (uniqueLines.length === 0) {
      setYtError(t("ytModal.alreadyInQueueError"));
      return;
    }

    const activeCount = ytQueueRef.current.filter((it) => it.status === "pending" || it.status === "scanning").length;
    if (activeCount + uniqueLines.length > MAX_YT_QUEUE_TOTAL) {
      setYtError(t("ytModal.queueFullError", { count: activeCount, max: MAX_YT_QUEUE_TOTAL }));
      return;
    }

    const newItems: YoutubeQueueItem[] = uniqueLines.map((url, idx) => ({
      id: `${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 6)}`,
      url,
      status: "pending",
    }));

    ytQueueRef.current = [...ytQueueRef.current, ...newItems];
    setYtQueue([...ytQueueRef.current]);
    setYtUrl("");

    if (!isProcessingYtQueueRef.current) {
      runYtQueue();
    }
  };

  const { completedYtCount, successYtCount, errorYtCount } = React.useMemo(() => {
    let success = 0;
    let error = 0;
    for (const it of ytQueue) {
      if (it.status === "success") success++;
      else if (it.status === "error") error++;
    }
    return {
      successYtCount: success,
      errorYtCount: error,
      completedYtCount: success + error,
    };
  }, [ytQueue]);

  const ytProgressPercent =
    ytQueue.length > 0 ? Math.round((completedYtCount / ytQueue.length) * 100) : 0;

  const handleClose = () => {
    setYtError(null);
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={t("ytModal.title")}
      description={t("ytModal.description")}
    >
      <div className="space-y-4">
        <form onSubmit={handleIngestYoutube} className="space-y-3">
          <div className="space-y-2">
            <textarea
              value={ytUrl}
              onChange={(e) => {
                setYtUrl(e.target.value);
                if (ytError) setYtError(null);
              }}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing &&
                  e.keyCode !== 229
                ) {
                  e.preventDefault();
                  if (ytUrl.trim()) {
                    handleIngestYoutube(e);
                  }
                }
              }}
              maxLength={20000}
              aria-label={t("ytModal.title")}
              placeholder={t("ytModal.placeholder")}
              rows={2}
              autoFocus
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-xs ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 font-mono resize-y"
            />
            <div className="flex items-center justify-between gap-1.5 text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5 text-flexoki-orange">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                <span>{t("ytModal.limitHint")}</span>
              </div>
              <span className="text-[11px] hidden sm:inline text-muted-foreground/80">
                {t("ytModal.keyHint")}
              </span>
            </div>
          </div>

          {ytError && (
            <div role="alert" className="p-2.5 rounded-md bg-destructive/10 border border-destructive/30 text-xs text-destructive">
              {ytError}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="submit" disabled={!ytUrl.trim()}>
              {t("ytModal.submit")}
            </Button>
          </div>
        </form>

        {/* YouTube Ingestion Queue Progress */}
        {ytQueue.length > 0 && (
          <div className="space-y-2 border border-border rounded-md p-3 bg-secondary/10">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-foreground">
                {isProcessingYtQueue
                  ? t("ytModal.scanning", {
                      current: Math.min(ytQueue.length, completedYtCount + 1),
                      total: ytQueue.length,
                    })
                  : errorYtCount > 0
                  ? t("ytModal.completedWithErrors", {
                      success: successYtCount,
                      total: ytQueue.length,
                      errors: errorYtCount,
                    })
                  : t("ytModal.completed", {
                      success: successYtCount,
                      total: ytQueue.length,
                    })}
              </span>
              <span className="text-muted-foreground">
                {ytProgressPercent}%
              </span>
            </div>

            {/* Progress Bar */}
            <div
              role="progressbar"
              aria-label={t("ytModal.title")}
              aria-valuenow={ytProgressPercent}
              aria-valuemin={0}
              aria-valuemax={100}
              className="w-full bg-secondary rounded-full h-1.5 overflow-hidden"
            >
              <div
                className="bg-primary h-1.5 transition-all duration-300"
                style={{
                  width: `${ytProgressPercent}%`,
                }}
              />
            </div>

            {/* Items List */}
            <div className="max-h-48 overflow-y-auto space-y-1.5 pt-1 pr-1 divide-y divide-border/40">
              {ytQueue.map((item) => (
                <div key={item.id} className="flex items-center justify-between pt-1.5 text-xs">
                  <div className="flex items-center gap-2 min-w-0 pr-2">
                    <YoutubeIcon className="h-3.5 w-3.5 shrink-0 text-destructive" />
                    <span className="truncate font-mono" title={item.url}>
                      {item.url}
                    </span>
                  </div>
                  <div className="shrink-0">
                    {item.status === "pending" && (
                      <span className="text-[11px] text-muted-foreground">{t("ytModal.statusPending")}</span>
                    )}
                    {item.status === "scanning" && (
                      <div className="flex items-center gap-1 text-[11px] text-primary">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        <span>{t("ytModal.statusScanning")}</span>
                      </div>
                    )}
                    {item.status === "success" && (
                      <div className="flex items-center gap-1 text-[11px] text-flexoki-green" title={item.message}>
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        <span>{item.count ? t("ytModal.addedTracks", { count: item.count }) : t("ytModal.statusSuccess")}</span>
                      </div>
                    )}
                    {item.status === "error" && (
                      <div className="flex items-center gap-1 text-[11px] text-destructive" title={item.error}>
                        <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate max-w-[180px] sm:max-w-[240px]">{item.error || t("ytModal.statusError")}</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-between items-center pt-2 border-t border-border">
          <div>
            {ytQueue.length > 0 && !isProcessingYtQueue && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  ytQueueRef.current = [];
                  setYtQueue([]);
                }}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                {t("ytModal.clearList")}
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            {isProcessingYtQueue && (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={handleCancelYtQueue}
              >
                {t("ytModal.cancel")}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleClose}
            >
              {t("ytModal.close")}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
});
