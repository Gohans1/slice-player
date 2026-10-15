import * as React from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Modal } from "./Modal";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { ButtonGroup } from "./ui/button-group";
import { Checkbox } from "./ui/checkbox";
import { Field, FieldContent, FieldDescription, FieldError, FieldLabel, FieldLegend, FieldSet, FieldTitle } from "./ui/field";
import { Input } from "./ui/input";
import { Spinner } from "./ui/spinner";
import { PlaylistCover } from "./PlaylistCover";
import { usePlayerStore } from "../store/usePlayerStore";
import { defaultMixName } from "../lib/mixPlaylist";
import { cn } from "../lib/utils";
import type { Playlist } from "@/server/types";

interface MixPlaylistModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated?: (id: string) => void;
  /** When given, edits this mix's sources instead of creating a new mix. */
  mix?: Playlist;
}

export function MixPlaylistModal({ isOpen, onClose, onCreated, mix }: MixPlaylistModalProps) {
  const { t } = useTranslation();
  const playlists = usePlayerStore((s) => s.playlists);
  const createMixPlaylist = usePlayerStore((s) => s.createMixPlaylist);
  const setMixSources = usePlayerStore((s) => s.setMixSources);

  const candidates = React.useMemo(() => playlists.filter((p) => !p.is_mix), [playlists]);
  const [picked, setPicked] = React.useState<string[]>(() => mix?.source_ids ?? []);
  const [customName, setCustomName] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const nameOf = (id: string) => candidates.find((p) => p.id === id)?.name ?? "";
  const name = customName ?? (picked.length >= 2 ? defaultMixName(picked.map(nameOf)) : "");
  const canSubmit = picked.length >= 2 && (Boolean(mix) || name.trim().length > 0) && !isSubmitting;

  const toggle = (id: string) => {
    setError(null);
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const move = (id: string, dir: -1 | 1) => {
    setPicked((prev) => {
      const i = prev.indexOf(id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setIsSubmitting(true);
    setError(null);
    try {
      if (mix) {
        if (await setMixSources(mix.id, picked)) onClose();
        else setError(t("mixPlaylist.serverError"));
      } else {
        const pl = await createMixPlaylist(name.trim(), picked);
        if (pl) {
          onClose();
          onCreated?.(pl.id);
        } else {
          setError(t("mixPlaylist.serverError"));
        }
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!isSubmitting) onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={mix ? t("mixPlaylist.editTitle", { name: mix.name }) : t("mixPlaylist.title")}
      description={t("mixPlaylist.description")}
    >
      <div className="flex flex-col gap-4">
        <FieldSet>
          <FieldLegend variant="label">{t("mixPlaylist.pickHint")}</FieldLegend>
          <ul className="flex max-h-72 flex-col gap-1.5 overflow-y-auto pr-1">
            {candidates.map((pl) => {
              const order = picked.indexOf(pl.id);
              const isPicked = order > -1;
              const checkboxId = `mix-source-${pl.id}`;
              return (
                <li key={pl.id} className="flex items-center gap-2">
                  <FieldLabel htmlFor={checkboxId} className="min-w-0 flex-1">
                    <Field orientation="horizontal">
                      <Checkbox
                        id={checkboxId}
                        checked={isPicked}
                        onCheckedChange={() => toggle(pl.id)}
                        disabled={isSubmitting}
                      />
                      <PlaylistCover playlist={pl} thumbnailSize="small" className="w-9 shrink-0 rounded-md" />
                      <FieldContent className="min-w-0">
                        <FieldTitle>{pl.name}</FieldTitle>
                        <FieldDescription>{t("playlist.itemCount", { count: pl.item_count || 0 })}</FieldDescription>
                      </FieldContent>
                      {/* The position joins the checkbox's name, so the play order is heard as well as seen */}
                      {isPicked && (
                        <Badge variant="secondary">
                          <span className="sr-only">{t("mixPlaylist.positionLabel")} </span>
                          {order + 1}
                        </Badge>
                      )}
                    </Field>
                  </FieldLabel>
                  {/* Always laid out, so ticking a row doesn't change its width; hidden rows keep the buttons out of reach */}
                  <div className={cn(!isPicked && "invisible")}>
                    <ButtonGroup>
                      <Button
                        variant="outline"
                        size="icon"
                        disabled={order === 0 || isSubmitting}
                        onClick={() => move(pl.id, -1)}
                        aria-label={t("mixPlaylist.moveUp", { name: pl.name })}
                      >
                        <ChevronUp />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        disabled={order === picked.length - 1 || isSubmitting}
                        onClick={() => move(pl.id, 1)}
                        aria-label={t("mixPlaylist.moveDown", { name: pl.name })}
                      >
                        <ChevronDown />
                      </Button>
                    </ButtonGroup>
                  </div>
                </li>
              );
            })}
          </ul>
        </FieldSet>

        {!mix && (
          <Field>
            <FieldLabel htmlFor="mix-playlist-name">{t("mixPlaylist.nameLabel")}</FieldLabel>
            <Input
              id="mix-playlist-name"
              value={name}
              onChange={(e) => setCustomName(e.target.value)}
              placeholder={t("mixPlaylist.namePlaceholder")}
              disabled={isSubmitting}
              maxLength={100}
            />
          </Field>
        )}

        {error && <FieldError>{error}</FieldError>}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={handleClose} disabled={isSubmitting}>
            {t("mixPlaylist.cancel")}
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={!canSubmit}>
            {isSubmitting && <Spinner data-icon="inline-start" />}
            {mix ? t("mixPlaylist.save") : t("mixPlaylist.submit")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
