import * as React from "react";
import {
  Music2, FolderPlus, Shuffle, Search, AlertCircle, Loader2, X, Folder,
  UploadCloud, CheckCircle2, FileAudio, ChevronDown, ChevronRight, Terminal, Languages, Keyboard, Archive
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Modal } from "./ui/modal";
import { usePlayerStore, isPlaybackMode } from "../store/usePlayerStore";
import { useLogStore } from "../store/useLogStore";
import { BackupModal } from "./BackupModal";

interface UploadQueueItem {
  id: string;
  file?: File;
  name: string;
  size: number;
  status: "pending" | "uploading" | "success" | "error";
  error?: string;
}

import { YoutubeIngestModal, YoutubeIcon } from "./YoutubeIngestModal";

interface NavbarProps {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onTogglePlaylistDrawer?: () => void;
  onOpenShortcuts?: () => void;
}

export function Navbar({ searchQuery, onSearchChange, onTogglePlaylistDrawer, onOpenShortcuts }: NavbarProps) {
  const { t, i18n } = useTranslation();
  const currentLang = (i18n.resolvedLanguage || i18n.language || "en").startsWith("vi") ? "vi" : "en";
  const toggleLanguage = () => {
    const nextLang = currentLang === "vi" ? "en" : "vi";
    void i18n.changeLanguage(nextLang);
  };

  const tracks = usePlayerStore((s) => s.tracks);
  const fetchTracks = usePlayerStore((s) => s.fetchTracks);
  const activePlaylistId = usePlayerStore((s) => s.activePlaylistId);
  const activePlaylistItems = usePlayerStore((s) => s.activePlaylistItems);
  const playlists = usePlayerStore((s) => s.playlists);
  const activeSystemCategory = usePlayerStore((s) => s.activeSystemCategory);
  const playModeQueue = usePlayerStore((s) => s.playModeQueue);
  const buildPlaylistQueue = usePlayerStore((s) => s.buildPlaylistQueue);

  const isLogsOpen = useLogStore((s) => s.isDrawerOpen);
  const toggleLogs = useLogStore((s) => s.toggleDrawer);
  const unreadErrorCount = useLogStore((s) => s.unreadErrorCount);

  const activePl = React.useMemo(() => {
    return playlists.find((p) => p.id === activePlaylistId);
  }, [playlists, activePlaylistId]);

  const [isShuffling, setIsShuffling] = React.useState(false);

  const desktopSearchRef = React.useRef<HTMLInputElement>(null);
  const mobileSearchRef = React.useRef<HTMLInputElement>(null);
  const [isMobileSearchOpen, setIsMobileSearchOpen] = React.useState(false);

  const [isYtModalOpen, setIsYtModalOpen] = React.useState(false);
  const [isProcessingYtQueue, setIsProcessingYtQueue] = React.useState(false);
  const handleCloseYtModal = React.useCallback(() => setIsYtModalOpen(false), []);
  const [isBackupModalOpen, setIsBackupModalOpen] = React.useState(false);

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

  React.useEffect(() => {
    if (isMobileSearchOpen) {
      mobileSearchRef.current?.focus();
    }
  }, [isMobileSearchOpen]);

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const hasActiveModal =
        isYtModalOpen ||
        isLocalModalOpen ||
        Boolean(usePlayerStore.getState().sliceStudioTrack) ||
        Boolean(document.querySelector('[role="dialog"]'));

      if (hasActiveModal || e.defaultPrevented) {
        return;
      }

      const target = e.target as HTMLElement | null;
      const isInput = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);

      const isSlash = e.key === "/" && !e.shiftKey && !isInput && !e.ctrlKey && !e.metaKey && !e.altKey;
      const isCmdK = (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k";

      if (isSlash || isCmdK) {
        e.preventDefault();
        if (window.innerWidth < 768) {
          setIsMobileSearchOpen(true);
          mobileSearchRef.current?.focus();
          mobileSearchRef.current?.select();
        } else {
          desktopSearchRef.current?.focus();
          desktopSearchRef.current?.select();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isYtModalOpen, isLocalModalOpen]);

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      if (searchQuery) {
        onSearchChange("");
      } else {
        e.currentTarget.blur();
        setIsMobileSearchOpen(false);
      }
    }
  };

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

    const ALLOWED_EXTS = [".flac", ".mp3", ".m4a", ".wav", ".ogg", ".opus", ".webm", ".aac"];
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

  const hasPlayableTracks = React.useMemo(() => {
    return activePlaylistId
      ? activePlaylistItems.some((it) => it.track && it.track.status === "ready" && it.track.duration > 0)
      : activeSystemCategory === "slices_only"
      ? tracks.some((tr) => tr.status === "ready" && (tr.segment_count || 0) > 0)
      : activeSystemCategory === "error_only" || activeSystemCategory === "downloading_only"
      ? false
      : tracks.some((tr) => tr.status === "ready" && tr.duration > 0);
  }, [activePlaylistId, activePlaylistItems, activeSystemCategory, tracks]);
  const isShufflingRef = React.useRef(false);

  const shuffleLabel = activePl
    ? t("nav.shufflePlaylist", { name: activePl.name })
    : activeSystemCategory === "slices_only"
    ? t("nav.shuffleSlices")
    : activeSystemCategory === "original_only"
    ? t("nav.shuffleOriginals")
    : activeSystemCategory === "downloading_only"
    ? t("nav.cannotPlayDownloading")
    : activeSystemCategory === "error_only"
    ? t("nav.cannotPlayError")
    : t("nav.shuffleMix");

  const handleQuickShuffle = async () => {
    if (isShufflingRef.current || isShuffling || !hasPlayableTracks) return;
    isShufflingRef.current = true;
    setIsShuffling(true);
    try {
      if (activePlaylistId) {
        await buildPlaylistQueue(activePlaylistId, true);
      } else if (isPlaybackMode(activeSystemCategory)) {
        await playModeQueue(activeSystemCategory, 0, true);
      }
    } catch (e) {
      console.error("[Navbar] Shuffle error:", e);
    } finally {
      isShufflingRef.current = false;
      setIsShuffling(false);
    }
  };

  return (
    <>
      <header className="sticky top-0 z-40 w-full border-b border-border bg-card/80 backdrop-blur-md px-6 py-3">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
        {/* Logo & Brand */}
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 border border-primary/30 text-primary">
            <Music2 className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-base tracking-tight text-foreground">{t("app.title")}</span>
              <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-accent text-accent-foreground border border-border">
                {t("app.flexoki")}
              </span>
            </div>
            <p className="text-xs text-muted-foreground hidden sm:block">
              {t("app.tagline")}
            </p>
          </div>

          {onTogglePlaylistDrawer && (
            <Button
              variant="outline"
              size="sm"
              onClick={onTogglePlaylistDrawer}
              className="hidden sm:inline-flex items-center gap-1.5 ml-1 border-border/80 bg-secondary/30 hover:bg-secondary text-xs h-8"
              title={t("nav.playlistsTooltip")}
            >
              <Folder className="h-3.5 w-3.5 text-primary" />
              <span>{t("nav.playlists")}</span>
              <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-accent text-accent-foreground ml-0.5">
                {playlists.length}
              </span>
            </Button>
          )}
        </div>

        {/* Desktop Search bar */}
        <div role="search" className="relative flex-1 max-w-sm hidden md:block">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            ref={desktopSearchRef}
            id="library-search-desktop"
            name="search"
            type="search"
            maxLength={200}
            aria-label={t("nav.searchAria")}
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder={t("nav.searchPlaceholder")}
            className="pl-9 pr-8 bg-background/60 text-sm h-9 [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden"
          />
          {searchQuery ? (
            <button
              type="button"
              onClick={() => {
                onSearchChange("");
                desktopSearchRef.current?.focus();
              }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5 rounded cursor-pointer transition-colors"
              title={t("nav.clearSearch")}
              aria-label={t("nav.clearSearch")}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : (
            <kbd className="hidden lg:inline-flex absolute right-2.5 top-1/2 -translate-y-1/2 items-center pointer-events-none text-[10px] text-muted-foreground font-mono bg-muted/60 border border-border px-1.5 py-0.5 rounded">
              /
            </kbd>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          {onTogglePlaylistDrawer && (
            <Button
              variant="outline"
              size="icon"
              onClick={onTogglePlaylistDrawer}
              title={t("nav.playlistsTooltip")}
              aria-label={t("nav.playlists")}
              className="sm:hidden h-8 w-8 text-primary border-primary/30"
            >
              <Folder className="h-4 w-4" />
            </Button>
          )}

          <Button
            variant={isMobileSearchOpen ? "secondary" : "ghost"}
            size="icon"
            onClick={() => {
              const next = !isMobileSearchOpen;
              setIsMobileSearchOpen(next);
              if (!next && searchQuery) {
                onSearchChange("");
              }
            }}
            title={t("nav.searchAria")}
            aria-label={t("nav.searchAria")}
            aria-expanded={isMobileSearchOpen}
            aria-controls="mobile-search-bar"
            className="md:hidden h-8 w-8 text-muted-foreground hover:text-foreground relative"
          >
            <Search className="h-4 w-4" />
            {searchQuery && (
              <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-primary" />
            )}
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={handleQuickShuffle}
            disabled={!hasPlayableTracks || isShuffling}
            title={shuffleLabel}
            aria-label={shuffleLabel}
            className="text-flexoki-green hover:text-flexoki-green hover:border-flexoki-green/40 disabled:opacity-40"
          >
            <Shuffle className={`h-4 w-4 ${isShuffling ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline truncate max-w-[140px]">
              {shuffleLabel}
            </span>
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={handleOpenFlacPicker}
            title={t("nav.addFlacTooltip")}
            aria-label={t("nav.addFlac")}
            className="text-flexoki-cyan hover:text-flexoki-cyan hover:border-flexoki-cyan/40"
          >
            <FolderPlus className="h-4 w-4" />
            <span className="hidden sm:inline">{t("nav.addFlac")}</span>
          </Button>

          <input
            ref={fileInputRef}
            id="local-audio-file-input"
            name="audioFiles"
            type="file"
            multiple
            accept=".flac,audio/flac,.mp3,.m4a,.wav,.ogg,.opus,.webm,.aac"
            className="hidden"
            onChange={handleFileInputChange}
          />

          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsYtModalOpen(true)}
            aria-label={t("nav.addYoutube")}
            className="text-flexoki-red hover:text-flexoki-red hover:border-flexoki-red/40 hover:bg-flexoki-red/10 border-border/80"
          >
            <YoutubeIcon className="h-4 w-4 text-flexoki-red" />
            <span className="hidden sm:inline">{t("nav.addYoutube")}</span>
            {isProcessingYtQueue && (
              <Loader2 className="h-3.5 w-3.5 animate-spin ml-1 text-flexoki-red" />
            )}
          </Button>

          {onOpenShortcuts && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onOpenShortcuts}
              aria-label={t("nav.shortcutsAria", "Keyboard Shortcuts (?)")}
              title={t("nav.shortcuts", "Shortcuts (?)")}
              className="h-8 w-8 text-muted-foreground hover:text-foreground shrink-0"
            >
              <Keyboard className="h-4 w-4" />
            </Button>
          )}

          <Button
            variant={isLogsOpen ? "secondary" : "ghost"}
            size="icon"
            onClick={toggleLogs}
            aria-expanded={isLogsOpen}
            aria-label={
              isLogsOpen
                ? t("nav.closeLogs")
                : unreadErrorCount > 0
                ? t("nav.systemLogsUnread", { count: unreadErrorCount })
                : t("nav.systemLogsAria")
            }
            className="relative h-8 w-8 text-muted-foreground hover:text-foreground shrink-0"
            title={t("nav.systemLogs")}
          >
            <Terminal className="h-4 w-4" />
            {unreadErrorCount > 0 && (
              <span className="absolute top-1 right-1 flex h-2 w-2" aria-hidden="true">
                <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-destructive" />
              </span>
            )}
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={toggleLanguage}
            title={t("nav.switchLanguage")}
            aria-label={t("nav.switchLanguage")}
            className="h-8 px-2 text-xs font-mono font-semibold gap-1 text-muted-foreground hover:text-foreground shrink-0 border border-border/60 hover:bg-secondary/60 transition-colors"
          >
            <Languages className="h-3.5 w-3.5 text-primary" />
            <span className="uppercase">{currentLang}</span>
          </Button>

          <Button
            variant={isBackupModalOpen ? "secondary" : "ghost"}
            size="icon"
            onClick={() => setIsBackupModalOpen(true)}
            aria-label={t("nav.backup")}
            title={t("nav.backupTooltip")}
            className="h-8 w-8 text-muted-foreground hover:text-foreground shrink-0"
          >
            <Archive className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Mobile search bar */}
      {isMobileSearchOpen && (
        <div id="mobile-search-bar" role="search" className="pt-2.5 pb-0.5 max-w-7xl mx-auto md:hidden">
          <div className="relative w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              ref={mobileSearchRef}
              id="library-search-mobile"
              name="mobileSearch"
              type="search"
              maxLength={200}
              aria-label={t("nav.searchAria")}
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder={t("nav.searchPlaceholder")}
              className="pl-9 pr-9 bg-background/90 text-sm h-9 w-full [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  onSearchChange("");
                  mobileSearchRef.current?.focus();
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1 rounded cursor-pointer transition-colors"
                title={t("nav.clearSearch")}
                aria-label={t("nav.clearSearch")}
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      )}
      </header>

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
        <div className="space-y-4">
          {/* Drag & Drop / File Explorer Trigger Area */}
          <div
            onClick={handleOpenFlacPicker}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-lg p-5 text-center cursor-pointer transition-colors flex flex-col items-center justify-center gap-2 ${
              isDragging
                ? "border-primary bg-primary/10"
                : "border-border hover:border-primary/50 hover:bg-secondary/30"
            }`}
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
              <UploadCloud className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">
                {t("localModal.dropzoneTitle")}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t("localModal.dropzoneHint")}
              </p>
            </div>
          </div>

          {/* Upload Queue Progress */}
          {uploadQueue.length > 0 && (
            <div className="space-y-2 border border-border rounded-md p-3 bg-secondary/10">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-foreground">
                  {isProcessingQueue
                    ? t("localModal.processingProgress", {
                        current: Math.min(uploadQueue.length, uploadFinishedCount + 1),
                        total: uploadQueue.length,
                      })
                    : t("localModal.completedProgress", {
                        success: uploadSuccessCount,
                        total: uploadQueue.length,
                      })}
                </span>
                <span className="text-muted-foreground">{uploadProgressPercent}%</span>
              </div>

              {/* Progress Bar */}
              <div
                role="progressbar"
                aria-valuenow={uploadProgressPercent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={t("localModal.uploadProgressAria", "Import progress")}
                className="w-full bg-secondary rounded-full h-1.5 overflow-hidden"
              >
                <div
                  className="bg-primary h-1.5 transition-all duration-300"
                  style={{ width: `${uploadProgressPercent}%` }}
                />
              </div>

              {/* Items List */}
              <div className="max-h-48 overflow-y-auto space-y-1.5 pt-1 pr-1 divide-y divide-border/40">
                {uploadQueue.map((item) => (
                  <div key={item.id} className="flex items-center justify-between pt-1.5 text-xs">
                    <div className="flex items-center gap-2 min-w-0 pr-2">
                      <FileAudio className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate font-mono" title={item.name}>
                        {item.name}
                      </span>
                    </div>
                    <div className="shrink-0">
                      {item.status === "pending" && (
                        <span className="text-[11px] text-muted-foreground">{t("localModal.statusPending")}</span>
                      )}
                      {item.status === "uploading" && (
                        <div className="flex items-center gap-1 text-[11px] text-primary">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          <span>{t("localModal.statusUploading")}</span>
                        </div>
                      )}
                      {item.status === "success" && (
                        <div className="flex items-center gap-1 text-[11px] text-flexoki-green">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          <span>{t("localModal.statusSuccess")}</span>
                        </div>
                      )}
                      {item.status === "error" && (
                        <div className="flex items-center gap-1 text-[11px] text-destructive" title={item.error}>
                          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate max-w-[120px]">{item.error || t("localModal.statusError")}</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {localError && (
            <div className="p-3 rounded-md bg-destructive/10 border border-destructive/30 text-xs text-destructive">
              {localError}
            </div>
          )}

          {/* Path/Directory fallback */}
          <div className="pt-1">
            <button
              type="button"
              onClick={() => setShowPathFallback((v) => !v)}
              aria-expanded={showPathFallback}
              aria-controls="local-path-fallback-form"
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            >
              {showPathFallback ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              <span>{t("localModal.pathFallback")}</span>
            </button>

            {showPathFallback && (
              <form id="local-path-fallback-form" onSubmit={handleIngestLocal} className="space-y-3 pt-2">
                <div className="space-y-1.5">
                  <textarea
                    id="local-path-fallback-input"
                    value={localPath}
                    onChange={(e) => setLocalPath(e.target.value)}
                    placeholder={t("localModal.pathPlaceholder")}
                    aria-label={t("localModal.pathPlaceholder")}
                    rows={2}
                    disabled={isLocalLoading}
                    className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-xs ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 font-mono resize-y"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    {t("localModal.pathHint")}
                  </p>
                </div>
                <div className="flex justify-end">
                  <Button type="submit" size="sm" disabled={isLocalLoading || !localPath.trim()}>
                    {isLocalLoading && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
                    {isLocalLoading ? t("localModal.scanning") : t("localModal.ingestPath")}
                  </Button>
                </div>
              </form>
            )}
          </div>

          <div className="flex justify-between items-center pt-2 border-t border-border">
            <div>
              {uploadQueue.length > 0 && !isProcessingQueue && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setUploadQueue([])}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  {t("localModal.clearList")}
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              {isProcessingQueue && (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={handleCancelUpload}
                >
                  {t("localModal.cancelUpload")}
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleOpenFlacPicker}
              >
                <FolderPlus className="h-3.5 w-3.5 mr-1" />
                {t("localModal.selectMoreFiles")}
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => setIsLocalModalOpen(false)}
              >
                {t("localModal.close")}
              </Button>
            </div>
          </div>
        </div>
      </Modal>

      <BackupModal
        isOpen={isBackupModalOpen}
        onClose={() => setIsBackupModalOpen(false)}
      />
    </>
  );
}
