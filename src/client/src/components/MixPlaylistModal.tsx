import * as React from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { Modal } from "./ui/modal";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
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

  const modalElement = (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={mix ? t("mixPlaylist.editTitle", { name: mix.name }) : t("mixPlaylist.title")}
      description={t("mixPlaylist.description")}
    >
      <div className="space-y-4">
        <div>
          <p className="mb-2 text-xs font-semibold text-muted-foreground">{t("mixPlaylist.pickHint")}</p>
          <ul className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
            {candidates.map((pl) => {
              const order = picked.indexOf(pl.id);
              const isPicked = order > -1;
              return (
                <li
                  key={pl.id}
                  className={cn(
                    "flex items-center gap-2 rounded-lg border p-1.5 transition-colors",
                    isPicked ? "border-primary/60 bg-primary/5" : "border-border hover:border-muted-foreground/40"
                  )}
                >
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={isPicked}
                    onClick={() => toggle(pl.id)}
                    disabled={isSubmitting}
                    className="flex min-w-0 flex-1 items-center gap-2.5 text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-md"
                  >
                    <span
                      className={cn(
                        "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold font-mono",
                        isPicked ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/50"
                      )}
                    >
                      {isPicked ? order + 1 : ""}
                    </span>
                    <PlaylistCover playlist={pl} className="w-9 shrink-0 rounded-md" />
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{pl.name}</span>
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">
                      {t("playlist.itemCount", { count: pl.item_count || 0 })}
                    </span>
                  </button>
                  {isPicked && (
                    <span className="flex shrink-0 gap-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="h-7 w-7"
                        disabled={order === 0 || isSubmitting}
                        onClick={() => move(pl.id, -1)}
                        aria-label={t("mixPlaylist.moveUp", { name: pl.name })}
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="h-7 w-7"
                        disabled={order === picked.length - 1 || isSubmitting}
                        onClick={() => move(pl.id, 1)}
                        aria-label={t("mixPlaylist.moveDown", { name: pl.name })}
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </Button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        {!mix && (
          <Input
            value={name}
            onChange={(e) => setCustomName(e.target.value)}
            placeholder={t("mixPlaylist.namePlaceholder")}
            aria-label={t("mixPlaylist.nameLabel")}
            disabled={isSubmitting}
            maxLength={100}
          />
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" onClick={handleClose} disabled={isSubmitting}>
            {t("mixPlaylist.cancel")}
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={!canSubmit}>
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
            <span>{mix ? t("mixPlaylist.save") : t("mixPlaylist.submit")}</span>
          </Button>
        </div>
      </div>
    </Modal>
  );

  if (typeof document !== "undefined" && document.body) {
    return createPortal(modalElement, document.body);
  }
  return modalElement;
}
