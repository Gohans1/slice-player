import * as React from "react";
import { Modal } from "./ui/modal";
import { Button } from "./ui/button";
import { Loader2, AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { usePlayerStore } from "../store/usePlayerStore";
import type { Playlist } from "@/server/types";

interface DeletePlaylistModalProps {
  isOpen: boolean;
  onClose: () => void;
  playlist: (Playlist & { item_count?: number }) | null;
  onConfirm: (keepChildren: boolean) => Promise<void>;
}

export function DeletePlaylistModal({
  isOpen,
  onClose,
  playlist,
  onConfirm,
}: DeletePlaylistModalProps) {
  const { t } = useTranslation();
  const allPlaylists = usePlayerStore((s) => s.playlists);
  const [keepChildren, setKeepChildren] = React.useState(false);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const childPlaylists = React.useMemo(() => {
    if (!playlist) return [];
    return allPlaylists.filter((p) => p.parent_id === playlist.id);
  }, [playlist, allPlaylists]);

  const hasChildren = childPlaylists.length > 0;

  React.useEffect(() => {
    if (isOpen) {
      setKeepChildren(false);
      setIsSubmitting(false);
    }
  }, [isOpen]);

  if (!playlist) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      await onConfirm(keepChildren);
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        if (!isSubmitting) onClose();
      }}
      title={t("playlist.deletePlaylistTitle", "Delete playlist?")}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {hasChildren ? (
          <div className="space-y-3">
            <div className="flex items-start gap-2.5 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>
                {t("playlist.deleteParentPrompt", {
                  count: childPlaylists.length,
                  defaultValue: `This playlist contains ${childPlaylists.length} sub-playlist(s). How would you like to proceed?`,
                })}
              </span>
            </div>

            <fieldset className="space-y-2 pt-1">
              <legend className="sr-only">{t("playlist.deletePlaylistTitle")}</legend>
              <label
                className={`flex items-start gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                  !keepChildren
                    ? "border-destructive/40 bg-destructive/5 text-foreground"
                    : "border-border hover:bg-secondary/40 text-muted-foreground"
                }`}
              >
                <input
                  type="radio"
                  name="subPlaylistDeleteStrategy"
                  checked={!keepChildren}
                  onChange={() => setKeepChildren(false)}
                  disabled={isSubmitting}
                  className="mt-0.5 text-destructive focus:ring-destructive cursor-pointer"
                />
                <span className="text-xs font-medium">
                  {t(
                    "playlist.deleteCascadeOption",
                    "Delete parent and all sub-playlists"
                  )}
                </span>
              </label>

              <label
                className={`flex items-start gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                  keepChildren
                    ? "border-primary/40 bg-primary/5 text-foreground"
                    : "border-border hover:bg-secondary/40 text-muted-foreground"
                }`}
              >
                <input
                  type="radio"
                  name="subPlaylistDeleteStrategy"
                  checked={keepChildren}
                  onChange={() => setKeepChildren(true)}
                  disabled={isSubmitting}
                  className="mt-0.5 text-primary focus:ring-primary cursor-pointer"
                />
                <span className="text-xs font-medium">
                  {t(
                    "playlist.deleteKeepOption",
                    "Keep sub-playlists as standalone playlists"
                  )}
                </span>
              </label>
            </fieldset>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("playlist.confirmDelete", {
              name: playlist.name,
              defaultValue: `Delete playlist "${playlist.name}"?`,
            })}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={isSubmitting}
          >
            {t("playlist.cancel", "Cancel")}
          </Button>
          <Button
            type="submit"
            variant="destructive"
            disabled={isSubmitting}
            data-testid="delete-playlist-submit-btn"
            className="cursor-pointer"
          >
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
            <span>{t("playlist.delete", "Delete playlist")}</span>
          </Button>
        </div>
      </form>
    </Modal>
  );
}
