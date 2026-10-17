import * as React from "react";
import { FolderPlus, AlertCircle, UploadCloud, CheckCircle2, FileAudio, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription } from "./ui/alert";
import { Button } from "./ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./ui/empty";
import { Progress, ProgressLabel, ProgressValue } from "./ui/progress";
import { Spinner } from "./ui/spinner";
import { Textarea } from "./ui/textarea";
import { Modal } from "./Modal";
import { YoutubeIngestModal, YoutubeIcon } from "./YoutubeIngestModal";
import { usePlayerStore } from "../store/usePlayerStore";
import { cn } from "../lib/utils";

interface UploadQueueItem {
  id: string;
  file?: File;
  name: string;
  size: number;
  status: "pending" | "uploading" | "success" | "error";
  error?: string;
}

export function ImportActions() {
  const { t } = useTranslation();

  const fetchTracks = usePlayerStore((s) => s.fetchTracks);
  const [isYtModalOpen, setIsYtModalOpen] = React.useState(false);
  const [isProcessingYtQueue, setIsProcessingYtQueue] = React.useState(false);
  const handleCloseYtModal = React.useCallback(() => setIsYtModalOpen(false), []);

  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [isLocalModalOpen, setIsLocalModalOpen] = React.useState(false);
  const [localPath, setLocalPath] = React.useState("");
  const [isLocalLoading, setIsLocalLoading] = React.useState(false);
  const [localError, setLocalError] = React.useState<string | null>(null);
  const [uploadQueue, setUploadQueue] = React.useState<UploadQueueItem[]>([]);
  const [isProcessingQueue, setIsProcessingQueue] = React.useState(false);
  const [isDragging, setIsDragging] = React.useState(false);
  const [showPathFallback, setShowPathFallback] = React.useState(false);
  const uploadFinishedCount = React.useMemo(
    () => uploadQueue.filter((i) => i.status === "success" || i.status === "error").length,
    [uploadQueue]
  );
  const uploadSuccessCount = React.useMemo(
    () => uploadQueue.filter((i) => i.status === "success").length,
    [uploadQueue]
  );
  const uploadProgressPercent = uploadQueue.length > 0 ? Math.round((uploadFinishedCount / uploadQueue.length) * 100) : 0;

  const isMountedRef = React.useRef(true);

  React.useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const handleOpenFlacPicker = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
      fileInputRef.current.click();
    }
  };

  const processFiles = React.useCallback((files: File[]) => {
    if (!files || files.length === 0) return;

    setIsLocalModalOpen(true);
    setLocalError(null);

    const ALLOWED_EXTS = [".flac", ".mp3", ".m4a", ".wav", ".ogg", ".opus", ".webm", ".aac", ".mp4"];
    const validFiles: File[] = [];
    const invalidNames: string[] = [];

    for (const f of files) {
      const dotIdx = f.name.lastIndexOf(".");
      const ext = dotIdx >= 0 ? f.name.slice(dotIdx).toLowerCase() : "";
      if (ALLOWED_EXTS.includes(ext)) {
        validFiles.push(f);
      } else {
        invalidNames.push(f.name);
      }
    }

    if (validFiles.length === 0) {
      setLocalError(
        t("localModal.unsupportedFormat", {
          names: invalidNames.slice(0, 3).join(", "),
          allowed: ALLOWED_EXTS.join(", "),
        })
      );
      return;
    }

    if (invalidNames.length > 0) {
      setLocalError(
        t("localModal.skippedInvalid", {
          count: invalidNames.length,
          names: invalidNames.slice(0, 3).join(", "),
        })
      );
    }

    const newItems: UploadQueueItem[] = validFiles.map((f, idx) => ({
      id: `${Date.now()}_${idx}_${f.name}`,
      file: f,
      name: f.name,
      size: f.size,
      status: "pending",
    }));

    setUploadQueue((prev) => [...prev, ...newItems]);
  }, [t]);

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFiles(Array.from(e.target.files));
    }
  };

  const uploadQueueRef = React.useRef<UploadQueueItem[]>([]);
  uploadQueueRef.current = uploadQueue;
  const isProcessingQueueRef = React.useRef(false);
  const abortControllerRef = React.useRef<AbortController | null>(null);

  const handleCancelUpload = React.useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setUploadQueue((prev) =>
      prev.map((it) =>
        it.status === "pending" || it.status === "uploading"
          ? { ...it, status: "error", error: t("localModal.cancelled"), file: undefined }
          : it
      )
    );
  }, [t]);

  const runUploadQueue = React.useCallback(async () => {
    if (isProcessingQueueRef.current) return;
    isProcessingQueueRef.current = true;
    setIsProcessingQueue(true);
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;
    const inFlightIds = new Set<string>();

    try {
      while (true) {
        if (signal.aborted) {
          setUploadQueue((prev) =>
            prev.map((it) =>
              it.status === "pending" || it.status === "uploading"
                ? { ...it, status: "error", error: t("localModal.cancelled"), file: undefined }
                : it
            )
          );
          break;
        }

        const nextItem = uploadQueueRef.current.find(
          (it) => it.status === "pending" && !inFlightIds.has(it.id)
        );
        if (!nextItem) break;
        if (!nextItem.file) {
          inFlightIds.add(nextItem.id);
          setUploadQueue((prev) =>
            prev.map((it) => (it.id === nextItem.id ? { ...it, status: "error", error: t("localModal.missingData") } : it))
          );
          continue;
        }

        inFlightIds.add(nextItem.id);
        setUploadQueue((prev) =>
          prev.map((it) => (it.id === nextItem.id ? { ...it, status: "uploading" } : it))
        );

        try {
          const formData = new FormData();
          formData.append("file", nextItem.file);

          const res = await fetch("/api/tracks/upload", {
            method: "POST",
            body: formData,
            signal,
          });

          const data = await res.json();
          if (res.ok && data.success) {
            setUploadQueue((prev) =>
              prev.map((it) => (it.id === nextItem.id ? { ...it, status: "success", file: undefined } : it))
            );
          } else {
            const errMsg = data.message || data.error || t("localModal.uploadError");
            setUploadQueue((prev) =>
              prev.map((it) =>
                it.id === nextItem.id
                  ? { ...it, status: "error", error: errMsg, file: undefined }
                  : it
              )
            );
          }
        } catch (err: unknown) {
          if (signal.aborted) {
            setUploadQueue((prev) =>
              prev.map((it) =>
                it.status === "pending" || it.status === "uploading"
                  ? { ...it, status: "error", error: t("localModal.cancelled"), file: undefined }
                  : it
              )
            );
            break;
          }
          const msg = err instanceof Error ? err.message : String(err);
          setUploadQueue((prev) =>
            prev.map((it) =>
              it.id === nextItem.id ? { ...it, status: "error", error: t("localModal.connectionError", { message: msg }), file: undefined } : it
            )
          );
        }
      }
    } finally {
      isProcessingQueueRef.current = false;
      setIsProcessingQueue(false);
      fetchTracks();
    }
  }, [fetchTracks, t]);

  React.useEffect(() => {
    const hasPending = uploadQueue.some((it) => it.status === "pending");
    if (hasPending && !isProcessingQueueRef.current) {
      runUploadQueue();
    }
  }, [uploadQueue, runUploadQueue]);

  React.useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFiles(Array.from(e.dataTransfer.files));
    }
  };

  const handleIngestLocal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!localPath.trim()) return;

    setIsLocalLoading(true);
    setLocalError(null);

    try {
      const rawLines = localPath.split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean);
      const payload = rawLines.length > 1 ? { paths: rawLines } : { path: rawLines[0] };

      const res = await fetch("/api/tracks/ingest-local", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        setLocalError(data.message || data.error || t("localModal.ingestError"));
      } else {
        setLocalPath("");
        await fetchTracks();
        if (data.tracks && Array.isArray(data.tracks)) {
          const loadedItems: UploadQueueItem[] = data.tracks.map((tItem: { id: string; title?: string; file_path?: string }) => ({
            id: `${Date.now()}_${tItem.id}_${Math.random().toString(36).slice(2, 6)}`,
            name: tItem.title || tItem.file_path || t("localModal.defaultTrackName"),
            size: 0,
            status: "success",
          }));
          setUploadQueue((prev) => [...prev, ...loadedItems]);
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setLocalError(t("localModal.connectionError", { message: msg }));
    } finally {
      setIsLocalLoading(false);
    }
  };


  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={handleOpenFlacPicker}
        title={t("nav.addFlacTooltip")}
        aria-label={t("nav.addFlac")}
      >
        <FolderPlus data-icon="inline-start" className="text-flexoki-cyan" />
        <span className="hidden @4xl:inline">{t("nav.addFlac")}</span>
      </Button>

      <input
        ref={fileInputRef}
        id="local-audio-file-input"
        name="audioFiles"
        type="file"
        multiple
        accept=".flac,audio/flac,.mp3,.m4a,.wav,.ogg,.opus,.webm,.aac,.mp4,video/mp4"
        className="hidden"
        onChange={handleFileInputChange}
      />

      <Button variant="outline" size="sm" onClick={() => setIsYtModalOpen(true)} aria-label={t("nav.addYoutube")}>
        <YoutubeIcon data-icon="inline-start" className="text-flexoki-red" />
        <span className="hidden @4xl:inline">{t("nav.addYoutube")}</span>
        {isProcessingYtQueue && <Spinner data-icon="inline-end" />}
      </Button>

      {/* YouTube Modal */}
      <YoutubeIngestModal
        isOpen={isYtModalOpen}
        onClose={handleCloseYtModal}
        onProcessingChange={setIsProcessingYtQueue}
      />

      {/* Local FLAC Modal */}
      <Modal
        isOpen={isLocalModalOpen}
        onClose={() => {
          setIsLocalModalOpen(false);
          setLocalError(null);
        }}
        title={t("localModal.title")}
        description={t("localModal.description")}
      >
        <div className="flex flex-col gap-4">
          {/* Drop target around the empty state, highlighted while files hover over it */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            data-dragging={isDragging || undefined}
            className="rounded-xl border border-dashed transition-colors data-dragging:border-primary data-dragging:bg-primary/10"
          >
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <UploadCloud />
                </EmptyMedia>
                <EmptyTitle>{t("localModal.dropzoneTitle")}</EmptyTitle>
                <EmptyDescription>{t("localModal.dropzoneHint")}</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button type="button" variant="outline" size="sm" onClick={handleOpenFlacPicker}>
                  <FolderPlus data-icon="inline-start" />
                  {t("localModal.selectMoreFiles")}
                </Button>
              </EmptyContent>
            </Empty>
          </div>

          {uploadQueue.length > 0 && (
            <div className="flex flex-col gap-3 rounded-md border p-3">
              <Progress value={uploadProgressPercent}>
                <ProgressLabel>
                  {isProcessingQueue
                    ? t("localModal.processingProgress", {
                        current: Math.min(uploadQueue.length, uploadFinishedCount + 1),
                        total: uploadQueue.length,
                      })
                    : t("localModal.completedProgress", {
                        success: uploadSuccessCount,
                        total: uploadQueue.length,
                      })}
                </ProgressLabel>
                <ProgressValue />
              </Progress>

              <ul className="flex max-h-48 flex-col divide-y overflow-y-auto pr-1">
                {uploadQueue.map((item) => (
                  <li key={item.id} className="flex items-center justify-between gap-2 py-1.5 text-xs">
                    <span className="flex min-w-0 items-center gap-2">
                      <FileAudio className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate font-mono" title={item.name}>
                        {item.name}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1 text-2xs">
                      {item.status === "pending" && (
                        <span className="text-muted-foreground">{t("localModal.statusPending")}</span>
                      )}
                      {item.status === "uploading" && (
                        <>
                          <Spinner className="size-3" />
                          {t("localModal.statusUploading")}
                        </>
                      )}
                      {item.status === "success" && (
                        <span className="flex items-center gap-1 text-flexoki-green">
                          <CheckCircle2 className="size-3.5" />
                          {t("localModal.statusSuccess")}
                        </span>
                      )}
                      {item.status === "error" && (
                        <span className="flex min-w-0 items-center gap-1 text-destructive" title={item.error}>
                          <AlertCircle className="size-3.5 shrink-0" />
                          <span className="max-w-30 truncate">{item.error || t("localModal.statusError")}</span>
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {localError && (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertDescription>{localError}</AlertDescription>
            </Alert>
          )}

          <Collapsible open={showPathFallback} onOpenChange={setShowPathFallback}>
            <CollapsibleTrigger render={<Button type="button" variant="ghost" size="sm" />}>
              <ChevronRight data-icon="inline-start" className={cn("transition-transform duration-150", showPathFallback && "rotate-90")} />
              {t("localModal.pathFallback")}
            </CollapsibleTrigger>
            <CollapsibleContent>
              <form onSubmit={handleIngestLocal} className="flex flex-col gap-2 pt-2">
                <Textarea
                  id="local-path-fallback-input"
                  value={localPath}
                  onChange={(e) => setLocalPath(e.target.value)}
                  placeholder={t("localModal.pathPlaceholder")}
                  aria-label={t("localModal.pathPlaceholder")}
                  aria-describedby="local-path-fallback-hint"
                  rows={2}
                  disabled={isLocalLoading}
                />
                <p id="local-path-fallback-hint" className="text-2xs text-muted-foreground">
                  {t("localModal.pathHint")}
                </p>
                <Button type="submit" size="sm" disabled={isLocalLoading || !localPath.trim()} className="self-end">
                  {isLocalLoading && <Spinner data-icon="inline-start" />}
                  {isLocalLoading ? t("localModal.scanning") : t("localModal.ingestPath")}
                </Button>
              </form>
            </CollapsibleContent>
          </Collapsible>

          <div className="flex items-center justify-between gap-2 border-t pt-3">
            {uploadQueue.length > 0 && !isProcessingQueue ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => setUploadQueue([])}>
                {t("localModal.clearList")}
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              {isProcessingQueue && (
                <Button type="button" variant="destructive" size="sm" onClick={handleCancelUpload}>
                  {t("localModal.cancelUpload")}
                </Button>
              )}
              <Button type="button" size="sm" onClick={() => setIsLocalModalOpen(false)}>
                {t("localModal.close")}
              </Button>
            </div>
          </div>
        </div>
      </Modal>
    </>
  );
}
