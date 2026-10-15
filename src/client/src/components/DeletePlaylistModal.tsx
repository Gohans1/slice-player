import * as React from "react";
import { Modal } from "./Modal";
import { Alert, AlertDescription } from "./ui/alert";
import { Button } from "./ui/button";
import { Field, FieldContent, FieldLabel, FieldTitle } from "./ui/field";
import { RadioGroup, RadioGroupItem } from "./ui/radio-group";
import { Spinner } from "./ui/spinner";
import { AlertTriangle } from "lucide-react";
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
  const strategyPromptId = React.useId();
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
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {hasChildren ? (
          <>
            <Alert variant="destructive">
              <AlertTriangle />
              <AlertDescription id={strategyPromptId}>
                {t("playlist.deleteParentPrompt", {
                  count: childPlaylists.length,
                  defaultValue: `This playlist contains ${childPlaylists.length} sub-playlist(s). How would you like to proceed?`,
                })}
              </AlertDescription>
            </Alert>

            <RadioGroup
              aria-labelledby={strategyPromptId}
              value={keepChildren ? "keep" : "cascade"}
              onValueChange={(value) => setKeepChildren(value === "keep")}
              disabled={isSubmitting}
            >
              <FieldLabel htmlFor="delete-strategy-cascade">
                <Field orientation="horizontal">
                  <RadioGroupItem value="cascade" id="delete-strategy-cascade" />
                  <FieldContent>
                    <FieldTitle>{t("playlist.deleteCascadeOption", "Delete parent and all sub-playlists")}</FieldTitle>
                  </FieldContent>
                </Field>
              </FieldLabel>
              <FieldLabel htmlFor="delete-strategy-keep">
                <Field orientation="horizontal">
                  <RadioGroupItem value="keep" id="delete-strategy-keep" />
                  <FieldContent>
                    <FieldTitle>{t("playlist.deleteKeepOption", "Keep sub-playlists as standalone playlists")}</FieldTitle>
                  </FieldContent>
                </Field>
              </FieldLabel>
            </RadioGroup>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("playlist.confirmDelete", {
              name: playlist.name,
              defaultValue: `Delete playlist "${playlist.name}"?`,
            })}
          </p>
        )}

        <div className="flex justify-end gap-2">
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
          >
            {isSubmitting && <Spinner data-icon="inline-start" />}
            {t("playlist.delete", "Delete playlist")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
