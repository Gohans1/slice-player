import * as React from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "./Modal";
import { Button } from "./ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Spinner } from "./ui/spinner";
import { usePlayerStore } from "../store/usePlayerStore";

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
  const [selectedParentId, setSelectedParentId] = React.useState<string | null>(initialParentId || null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const createPlaylist = usePlayerStore((s) => s.createPlaylist);

  React.useEffect(() => {
    if (isOpen) {
      setSelectedParentId(initialParentId || null);
    }
  }, [isOpen, initialParentId]);

  // Base UI's Select shows the chosen item's label from this list; null means a top-level playlist
  const parentItems = React.useMemo(
    () => [
      { label: t("playlist.noParent", "None (Root playlist)"), value: null },
      ...rootPlaylists.map((playlist) => ({ label: playlist.name, value: playlist.id })),
    ],
    [rootPlaylists, t]
  );

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
        setSelectedParentId(null);
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
      setSelectedParentId(null);
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
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <FieldGroup>
          <Field data-invalid={error ? true : undefined}>
            <FieldLabel htmlFor="create-playlist-name">{t("createPlaylist.nameLabel")}</FieldLabel>
            <Input
              id="create-playlist-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError(null);
              }}
              placeholder={t("createPlaylist.placeholder")}
              aria-invalid={error ? true : undefined}
              autoFocus
              disabled={isSubmitting}
              maxLength={100}
            />
            {error && <FieldError>{error}</FieldError>}
          </Field>

          {rootPlaylists.length > 0 && (
            <Field>
              <FieldLabel htmlFor="create-playlist-parent">
                {t("playlist.selectParentPrompt", "Parent playlist (optional)")}
              </FieldLabel>
              <Select
                items={parentItems}
                value={selectedParentId}
                onValueChange={(value) => setSelectedParentId(value)}
                disabled={isSubmitting}
              >
                <SelectTrigger id="create-playlist-parent" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {parentItems.map((item) => (
                      <SelectItem key={item.value ?? "none"} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          )}
        </FieldGroup>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={handleClose} disabled={isSubmitting}>
            {t("createPlaylist.cancel")}
          </Button>
          <Button type="submit" disabled={isSubmitting || !name.trim()}>
            {isSubmitting && <Spinner data-icon="inline-start" />}
            {t("createPlaylist.submit")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
