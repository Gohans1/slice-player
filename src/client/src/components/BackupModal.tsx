import * as React from "react";
import { Modal } from "./ui/modal";
import { Button } from "./ui/button";
import { useTranslation } from "react-i18next";
import { usePlayerStore } from "../store/usePlayerStore";
import {
  Download,
  UploadCloud,
  FileArchive,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Database,
  Music,
  ListMusic
} from "lucide-react";

interface BackupModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function BackupModal({ isOpen, onClose }: BackupModalProps) {
  const { t } = useTranslation();
  const tracks = usePlayerStore((s) => s.tracks);
  const playlists = usePlayerStore((s) => s.playlists);
  const fetchTracks = usePlayerStore((s) => s.fetchTracks);
  const fetchPlaylists = usePlayerStore((s) => s.fetchPlaylists);

  const [activeTab, setActiveTab] = React.useState<"export" | "import">("export");
  const [isExporting, setIsExporting] = React.useState(false);
  const [exportMessage, setExportMessage] = React.useState<{ type: "success" | "error"; text: string } | null>(null);

  const [importFile, setImportFile] = React.useState<File | null>(null);
  const [isImporting, setIsImporting] = React.useState(false);
  const [importMessage, setImportMessage] = React.useState<{ type: "success" | "error"; text: string } | null>(null);
  const [isDragging, setIsDragging] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleExport = async () => {
    setIsExporting(true);
    setExportMessage(null);
    try {
      const res = await fetch("/api/library/export");
      if (!res.ok) {
        let errText = "Export failed";
        try {
          const errData = await res.json();
          errText = errData.error || errText;
        } catch {}
        throw new Error(errText);
      }

      const blob = await res.blob();
      const contentDisp = res.headers.get("Content-Disposition");
      let filename = "slice-player-backup.tar.gz";
      if (contentDisp) {
        const match = contentDisp.match(/filename="?([^"]+)"?/);
        if (match && match[1]) filename = match[1];
      }

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        window.URL.revokeObjectURL(url);
        if (a.parentNode) {
          a.parentNode.removeChild(a);
        }
      }, 2000);

      setExportMessage({ type: "success", text: t("backupModal.exportSuccess") });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setExportMessage({ type: "error", text: t("backupModal.exportError", { message: msg }) });
    } finally {
      setIsExporting(false);
    }
  };

  const handleSelectFile = (file: File) => {
    setImportFile(file);
    setImportMessage(null);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleSelectFile(e.dataTransfer.files[0]);
    }
  };

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

  const handleImport = async () => {
    if (!importFile) return;
    setIsImporting(true);
    setImportMessage(null);

    try {
      const formData = new FormData();
      formData.append("file", importFile);

      const res = await fetch("/api/library/import", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || data.message || "Import failed");
      }

      setImportMessage({ type: "success", text: data.message || t("backupModal.importSuccess") });
      setImportFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }

      // Refresh store with new data
      await fetchTracks(true);
      await fetchPlaylists();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setImportMessage({ type: "error", text: t("backupModal.importError", { message: msg }) });
    } finally {
      setIsImporting(false);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t("backupModal.title")}
      description={t("backupModal.description")}
      className="max-w-lg"
    >
      <div className="space-y-4">
        {/* Navigation Tabs */}
        <div className="flex rounded-lg bg-secondary/50 p-1 border border-border/60">
          <button
            type="button"
            onClick={() => {
              setActiveTab("export");
              setExportMessage(null);
            }}
            className={`flex-1 py-1.5 px-3 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition-[color,background-color,border-color,box-shadow] duration-150 cursor-pointer ${
              activeTab === "export"
                ? "bg-card text-foreground shadow-sm border border-border/80"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Download className="h-3.5 w-3.5" />
            <span>{t("backupModal.exportTab")}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab("import");
              setImportMessage(null);
            }}
            className={`flex-1 py-1.5 px-3 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition-[color,background-color,border-color,box-shadow] duration-150 cursor-pointer ${
              activeTab === "import"
                ? "bg-card text-foreground shadow-sm border border-border/80"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <UploadCloud className="h-3.5 w-3.5" />
            <span>{t("backupModal.importTab")}</span>
          </button>
        </div>

        {/* Tab 1: Export */}
        {activeTab === "export" && (
          <div className="space-y-4 pt-1 animate-in fade-in duration-150">
            <div className="rounded-lg border border-border/60 bg-secondary/20 p-3 text-xs space-y-2.5">
              <div className="font-semibold text-foreground flex items-center gap-1.5">
                <Database className="h-4 w-4 text-primary" />
                <span>{t("backupModal.exportStats")}</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-muted-foreground pt-1">
                <div className="flex items-center gap-1.5 bg-background/50 px-2.5 py-1.5 rounded border border-border/40">
                  <Music className="h-3.5 w-3.5 text-flexoki-cyan shrink-0" />
                  <span>{t("backupModal.trackCount", { count: tracks.length })}</span>
                </div>
                <div className="flex items-center gap-1.5 bg-background/50 px-2.5 py-1.5 rounded border border-border/40">
                  <ListMusic className="h-3.5 w-3.5 text-flexoki-green shrink-0" />
                  <span>{t("backupModal.playlistCount", { count: playlists.length })}</span>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed pt-1">
                {t("backupModal.exportDesc")}
              </p>
            </div>

            {exportMessage && (
              <div
                className={`p-3 rounded-md text-xs flex items-start gap-2 border ${
                  exportMessage.type === "success"
                    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                    : "bg-destructive/10 border-destructive/30 text-destructive"
                }`}
              >
                {exportMessage.type === "success" ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                )}
                <span>{exportMessage.text}</span>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={onClose} disabled={isExporting}>
                {t("backupModal.close")}
              </Button>
              <Button
                variant="default"
                onClick={handleExport}
                disabled={isExporting}
                className="gap-1.5"
              >
                {isExporting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>{t("backupModal.exporting")}</span>
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4" />
                    <span>{t("backupModal.downloadBtn")}</span>
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {/* Tab 2: Import */}
        {activeTab === "import" && (
          <div className="space-y-4 pt-1 animate-in fade-in duration-150">
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300 flex items-start gap-2 leading-relaxed">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-400" />
              <span>{t("backupModal.importWarning")}</span>
            </div>

            {/* Dropzone */}
            <div
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-lg p-5 text-center cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                isDragging
                  ? "border-primary bg-primary/10"
                  : "border-border hover:border-primary/50 bg-secondary/10"
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".tar.gz,.tar,application/gzip,application/x-tar"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) {
                    handleSelectFile(e.target.files[0]);
                  }
                }}
              />
              <FileArchive className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
              <p className="text-xs font-medium text-foreground">
                {t("backupModal.dropzoneHint")}
              </p>
              {importFile && (
                <div className="mt-3 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/15 text-primary text-xs font-semibold border border-primary/30">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span>
                    {t("backupModal.selectedFile", {
                      name: importFile.name,
                      size: formatFileSize(importFile.size),
                    })}
                  </span>
                </div>
              )}
            </div>

            {importMessage && (
              <div
                className={`p-3 rounded-md text-xs flex items-start gap-2 border ${
                  importMessage.type === "success"
                    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                    : "bg-destructive/10 border-destructive/30 text-destructive"
                }`}
              >
                {importMessage.type === "success" ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                )}
                <span>{importMessage.text}</span>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={onClose} disabled={isImporting}>
                {t("backupModal.close")}
              </Button>
              <Button
                variant="default"
                onClick={handleImport}
                disabled={!importFile || isImporting}
                className="gap-1.5"
              >
                {isImporting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>{t("backupModal.importing")}</span>
                  </>
                ) : (
                  <>
                    <UploadCloud className="h-4 w-4" />
                    <span>{t("backupModal.importBtn")}</span>
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
