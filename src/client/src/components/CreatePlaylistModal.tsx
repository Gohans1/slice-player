import * as React from "react";
import { createPortal } from "react-dom";
import { Modal } from "./ui/modal";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { useTranslation } from "react-i18next";
import { usePlayerStore } from "../store/usePlayerStore";
import { Loader2 } from "lucide-react";

interface CreatePlaylistModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated?: (id: string) => void;
  initialParentId?: string | null;
}

export function CreatePlaylistModal({ isOpen, onClose, onCreated, initialParentId }: CreatePlaylistModalProps) {
  const { t } = useTranslation();
  const [name, setName] = React.useState("");
  const allPlaylists = usePlayerStore((s) => s.playlists);
  const rootPlaylists = React.useMemo(() => allPlaylists.filter((p) => !p.is_mix && !p.parent_id), [allPlaylists]);
  const [selectedParentId, setSelectedParentId] = React.useState<string | "">(initialParentId || "");
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const createPlaylist = usePlayerStore((s) => s.createPlaylist);

  React.useEffect(() => {
    if (isOpen) {
      setSelectedParentId(initialParentId || "");
    }
  }, [isOpen, initialParentId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t("createPlaylist.requiredError"));
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      const pl = selectedParentId
        ? await createPlaylist(trimmed, selectedParentId)
        : await createPlaylist(trimmed);
      if (pl) {
        setName("");
        setSelectedParentId("");
        onClose();
        if (onCreated) {
          onCreated(pl.id);
        }
      } else {
        setError(t("createPlaylist.serverError"));
      }
    } catch {
      setError(t("createPlaylist.serverError"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!isSubmitting) {
      setName("");
      setSelectedParentId("");
      setError(null);
      onClose();
    }
  };

  const modalElement = (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={t("createPlaylist.title")}
      description={t("createPlaylist.description")}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (error) setError(null);
            }}
            placeholder={t("createPlaylist.placeholder")}
            autoFocus
            disabled={isSubmitting}
            maxLength={100}
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        {rootPlaylists.length > 0 && (
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">
              {t("playlist.selectParentPrompt", "Parent playlist (optional)")}
            </label>
            <select
              value={selectedParentId}
              onChange={(e) => setSelectedParentId(e.target.value)}
              disabled={isSubmitting}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary cursor-pointer"
            >
              <option value="">{t("playlist.noParent", "None (Root playlist)")}</option>
              {rootPlaylists.map((rp) => (
                <option key={rp.id} value={rp.id}>
                  {rp.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleClose}
            disabled={isSubmitting}
          >
            {t("createPlaylist.cancel")}
          </Button>
          <Button type="submit" disabled={isSubmitting || !name.trim()}>
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
            <span>{t("createPlaylist.submit")}</span>
          </Button>
        </div>
      </form>
    </Modal>
  );

  if (typeof document !== "undefined" && document.body) {
    return createPortal(modalElement, document.body);
  }

  return modalElement;
}
