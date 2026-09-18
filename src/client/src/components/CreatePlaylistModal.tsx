import * as React from "react";
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
}

export function CreatePlaylistModal({ isOpen, onClose, onCreated }: CreatePlaylistModalProps) {
  const { t } = useTranslation();
  const [name, setName] = React.useState("");
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const createPlaylist = usePlayerStore((s) => s.createPlaylist);

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
      const pl = await createPlaylist(trimmed);
      if (pl) {
        setName("");
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
      setError(null);
      onClose();
    }
  };

  return (
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
}
