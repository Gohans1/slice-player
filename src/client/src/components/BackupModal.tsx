import * as React from "react";
import { AlertTriangle, CheckCircle2, Database, Download, FileArchive, FolderOpen, ListMusic, Music, UploadCloud } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Modal } from "./Modal";
import { Alert, AlertDescription } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia } from "./ui/empty";
import { Spinner } from "./ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { usePlayerStore } from "../store/usePlayerStore";

type StatusMessage = { type: "success" | "error"; text: string };

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
  const [exportMessage, setExportMessage] = React.useState<StatusMessage | null>(null);

  const [importFile, setImportFile] = React.useState<File | null>(null);
  const [isImporting, setIsImporting] = React.useState(false);
  const [importMessage, setImportMessage] = React.useState<StatusMessage | null>(null);
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
    >
      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          if (value === "import") {
            setActiveTab("import");
            setImportMessage(null);
          } else {
            setActiveTab("export");
            setExportMessage(null);
          }
        }}
      >
        <TabsList className="w-full">
          <TabsTrigger value="export">
            <Download data-icon="inline-start" />
            {t("backupModal.exportTab")}
          </TabsTrigger>
          <TabsTrigger value="import">
            <UploadCloud data-icon="inline-start" />
            {t("backupModal.importTab")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="export">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2.5 rounded-lg border p-3 text-xs">
              <div className="flex items-center gap-1.5 font-semibold text-foreground">
                <Database className="size-4 text-muted-foreground" />
                {t("backupModal.exportStats")}
              </div>
              <div className="grid grid-cols-2 gap-2 text-muted-foreground">
                <div className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5">
                  <Music className="size-3.5 shrink-0 text-flexoki-cyan" />
                  {t("backupModal.trackCount", { count: tracks.length })}
                </div>
                <div className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5">
                  <ListMusic className="size-3.5 shrink-0 text-flexoki-green" />
                  {t("backupModal.playlistCount", { count: playlists.length })}
                </div>
              </div>
              <p className="leading-relaxed text-muted-foreground">{t("backupModal.exportDesc")}</p>
            </div>

            {exportMessage && <StatusAlert message={exportMessage} />}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onClose} disabled={isExporting}>
                {t("backupModal.close")}
              </Button>
              <Button onClick={handleExport} disabled={isExporting}>
                {isExporting ? <Spinner data-icon="inline-start" /> : <Download data-icon="inline-start" />}
                {isExporting ? t("backupModal.exporting") : t("backupModal.downloadBtn")}
              </Button>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="import">
          <div className="flex flex-col gap-4">
            <Alert>
              <AlertTriangle />
              <AlertDescription>{t("backupModal.importWarning")}</AlertDescription>
            </Alert>

            {/* Drop target around the empty state, highlighted while a file hovers over it */}
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              data-dragging={isDragging || undefined}
              className="rounded-xl border border-dashed transition-colors data-dragging:border-primary data-dragging:bg-primary/10"
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
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <FileArchive />
                  </EmptyMedia>
                  <EmptyDescription>{t("backupModal.dropzoneHint")}</EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                    <FolderOpen data-icon="inline-start" />
                    {t("backupModal.selectFile")}
                  </Button>
                  {importFile && (
                    <Badge variant="secondary">
                      <CheckCircle2 data-icon="inline-start" />
                      {t("backupModal.selectedFile", { name: importFile.name, size: formatFileSize(importFile.size) })}
                    </Badge>
                  )}
                </EmptyContent>
              </Empty>
            </div>

            {importMessage && <StatusAlert message={importMessage} />}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onClose} disabled={isImporting}>
                {t("backupModal.close")}
              </Button>
              <Button onClick={handleImport} disabled={!importFile || isImporting}>
                {isImporting ? <Spinner data-icon="inline-start" /> : <UploadCloud data-icon="inline-start" />}
                {isImporting ? t("backupModal.importing") : t("backupModal.importBtn")}
              </Button>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </Modal>
  );
}

function StatusAlert({ message }: { message: StatusMessage }) {
  return message.type === "success" ? (
    <Alert>
      <CheckCircle2 />
      <AlertDescription>{message.text}</AlertDescription>
    </Alert>
  ) : (
    <Alert variant="destructive">
      <AlertTriangle />
      <AlertDescription>{message.text}</AlertDescription>
    </Alert>
  );
}
