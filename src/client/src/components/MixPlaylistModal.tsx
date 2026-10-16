import * as React from "react";
import { flushSync } from "react-dom";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp, Minus, Plus } from "lucide-react";
import { Modal } from "./Modal";
import { Button } from "./ui/button";
import { ButtonGroup } from "./ui/button-group";
import { DialogFooter } from "./ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel, FieldLegend, FieldSet } from "./ui/field";
import { Input } from "./ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Spinner } from "./ui/spinner";
import { PlaylistCover } from "./PlaylistCover";
import { usePlayerStore } from "../store/usePlayerStore";
import { defaultMixName } from "../lib/mixPlaylist";
import type { Playlist } from "@/server/types";

interface MixPlaylistModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated?: (id: string) => void;
  /** When given, edits this mix's sources instead of creating a new mix. */
  mix?: Playlist;
  /** A new mix started from a playlist's menu has that playlist in its first row. */
  firstSourceId?: string;
}

// A row of the mix: a source playlist, or none yet. The key stays with the row as it moves.
interface SourceRow {
  key: number;
  id: string | null;
}

type RowControl = "picker" | "up" | "down";

// Like a Smart Playlist's rules: one row per source playlist, played top to bottom
export function MixPlaylistModal({ isOpen, onClose, onCreated, mix, firstSourceId }: MixPlaylistModalProps) {
  const { t } = useTranslation();
  const playlists = usePlayerStore((s) => s.playlists);
  const createMixPlaylist = usePlayerStore((s) => s.createMixPlaylist);
  const setMixSources = usePlayerStore((s) => s.setMixSources);

  const candidates = React.useMemo(() => playlists.filter((p) => !p.is_mix), [playlists]);
  const items = React.useMemo(() => candidates.map((p) => ({ value: p.id, label: p.name })), [candidates]);
  const nextKeyRef = React.useRef(0);
  const newRow = (id: string | null): SourceRow => ({ key: nextKeyRef.current++, id });
  const [rows, setRows] = React.useState<SourceRow[]>(() => {
    // Deleting a mix's playlists can leave it fewer than the two it needs; empty rows make up the rest
    const seed = mix ? (mix.source_ids ?? []) : firstSourceId ? [firstSourceId] : [];
    const ids: (string | null)[] = seed.filter((id) => candidates.some((p) => p.id === id));
    while (ids.length < 2) ids.push(null);
    return ids.map(newRow);
  });
  const [customName, setCustomName] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const listRef = React.useRef<HTMLOListElement>(null);

  const sourceIds = rows.flatMap((row) => (row.id ? [row.id] : []));
  const playlistOf = (id: string) => candidates.find((p) => p.id === id);
  const name = customName ?? (sourceIds.length >= 2 ? defaultMixName(sourceIds.map((id) => playlistOf(id)?.name ?? "")) : "");
  const canSubmit = sourceIds.length >= 2 && (Boolean(mix) || name.trim().length > 0) && !isSubmitting;
  const canAdd = rows.length < candidates.length && !isSubmitting;
  const canRemove = rows.length > 2 && !isSubmitting;

  // Adding, removing or moving a row takes away or moves the button that had focus, so focus follows the row. A move
  // can turn the pressed button off at either end; the row's other move button takes focus then.
  const updateRows = (next: SourceRow[], focus: { key: number; control: RowControl }) => {
    flushSync(() => {
      setError(null);
      setRows(next);
    });
    const row = listRef.current?.querySelector(`[data-row="${focus.key}"]`);
    const order: RowControl[] = focus.control === "up" ? ["up", "down"] : focus.control === "down" ? ["down", "up"] : ["picker"];
    const target = order.map((control) => row?.querySelector<HTMLElement>(`[data-control="${control}"]:not(:disabled)`)).find(Boolean);
    target?.focus();
  };

  const pick = (key: number, id: string | null) => {
    setError(null);
    setRows(rows.map((row) => (row.key === key ? { ...row, id } : row)));
  };

  const addAfter = (index: number) => {
    const row = newRow(null);
    updateRows([...rows.slice(0, index + 1), row, ...rows.slice(index + 1)], { key: row.key, control: "picker" });
  };

  const remove = (index: number) => {
    const next = rows.filter((_, i) => i !== index);
    updateRows(next, { key: next[Math.min(index, next.length - 1)].key, control: "picker" });
  };

  const move = (index: number, step: -1 | 1) => {
    const next = [...rows];
    [next[index], next[index + step]] = [next[index + step], next[index]];
    updateRows(next, { key: rows[index].key, control: step < 0 ? "up" : "down" });
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setIsSubmitting(true);
    setError(null);
    try {
      if (mix) {
        if (await setMixSources(mix.id, sourceIds)) onClose();
        else setError(t("mixPlaylist.serverError"));
      } else {
        const pl = await createMixPlaylist(name.trim(), sourceIds);
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
      {/* A fieldset is as wide as its content by default, which would push the rows past a phone's screen */}
      <div className="flex min-w-0 flex-col gap-4">
        <FieldSet className="min-w-0">
          <FieldLegend variant="label">{t("mixPlaylist.rulesLead")}</FieldLegend>
          <ol ref={listRef} className="flex max-h-80 flex-col divide-y overflow-y-auto rounded-lg border">
            {rows.map((row, index) => {
              const rowLabel = t("mixPlaylist.rowLabel", { position: index + 1 });
              const rowName = row.id ? (playlistOf(row.id)?.name ?? rowLabel) : rowLabel;
              return (
                <li key={row.key} data-row={row.key} className="flex items-center gap-2 px-2 py-1.5">
                  <span aria-hidden="true" className="w-4 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                    {index + 1}
                  </span>
                  <Select items={items} value={row.id} onValueChange={(id) => pick(row.key, id)} disabled={isSubmitting}>
                    <SelectTrigger data-control="picker" aria-label={rowLabel} className="min-w-0 flex-1">
                      <SelectValue placeholder={t("mixPlaylist.choose")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {candidates.map((pl) => (
                          <SelectItem key={pl.id} value={pl.id} disabled={pl.id !== row.id && sourceIds.includes(pl.id)}>
                            <PlaylistCover playlist={pl} thumbnailSize="small" className="size-5 shrink-0 rounded-sm" />
                            {pl.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <ButtonGroup>
                    <Button
                      variant="outline"
                      size="icon"
                      data-control="up"
                      disabled={index === 0 || isSubmitting}
                      onClick={() => move(index, -1)}
                      aria-label={t("mixPlaylist.moveUp", { name: rowName })}
                    >
                      <ChevronUp />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      data-control="down"
                      disabled={index === rows.length - 1 || isSubmitting}
                      onClick={() => move(index, 1)}
                      aria-label={t("mixPlaylist.moveDown", { name: rowName })}
                    >
                      <ChevronDown />
                    </Button>
                  </ButtonGroup>
                  <ButtonGroup>
                    <Button
                      variant="outline"
                      size="icon"
                      disabled={!canRemove}
                      onClick={() => remove(index)}
                      aria-label={t("mixPlaylist.remove", { name: rowName })}
                    >
                      <Minus />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      disabled={!canAdd}
                      onClick={() => addAfter(index)}
                      aria-label={t("mixPlaylist.addAfter", { name: rowName })}
                    >
                      <Plus />
                    </Button>
                  </ButtonGroup>
                </li>
              );
            })}
          </ol>
          {/* Where a Smart Playlist has Live updating. No item count: the mix leaves out an item a second playlist repeats */}
          <FieldDescription>{t("mixPlaylist.liveNote")}</FieldDescription>
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

        <DialogFooter>
          <Button type="button" variant="outline" onClick={handleClose} disabled={isSubmitting}>
            {t("mixPlaylist.cancel")}
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={!canSubmit}>
            {isSubmitting && <Spinner data-icon="inline-start" />}
            {mix ? t("mixPlaylist.save") : t("mixPlaylist.submit")}
          </Button>
        </DialogFooter>
      </div>
    </Modal>
  );
}
