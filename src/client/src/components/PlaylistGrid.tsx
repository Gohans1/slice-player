import * as React from "react";
import { useTranslation } from "react-i18next";
import { Combine, FolderTree, Play, Plus, Shuffle } from "lucide-react";
import { Button } from "./ui/button";
import { PlaylistCover } from "./PlaylistCover";
import { NowPlayingEqualizer } from "./NowPlayingEqualizer";
import { usePlayerStore } from "../store/usePlayerStore";
import { cn, REVEAL_ON_HOVER } from "../lib/utils";
import type { Playlist } from "@/server/types";

interface PlaylistGridProps {
  playlists: (Playlist & { item_count: number })[];
  onOpen: (id: string) => void;
  onCreate: () => void;
  onMix: () => void;
}

export function PlaylistGrid({ playlists, onOpen, onCreate, onMix }: PlaylistGridProps) {
  const { t } = useTranslation();
  const buildPlaylistQueue = usePlayerStore((s) => s.buildPlaylistQueue);
  const playingId = usePlayerStore((s) => (s.isPlaying ? s.activePlaylistPlayingId : null));
  const canMix = playlists.filter((pl) => !pl.is_mix).length >= 2;

  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-x-4 gap-y-6">
      {playlists.map((pl) => {
        const isEmpty = (pl.item_count || 0) === 0;
        const isPlayingThis = playingId === pl.id;
        const parent = pl.parent_id ? playlists.find((p) => p.id === pl.parent_id) : undefined;
        return (
          <li key={pl.id} className="group flex min-w-0 flex-col gap-2">
            <div className="relative">
              <button
                type="button"
                onClick={() => onOpen(pl.id)}
                aria-label={t("playlist.openNamed", { name: pl.name })}
                className="block w-full cursor-pointer overflow-hidden rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <PlaylistCover playlist={pl} />
              </button>
              {!isEmpty && (
                <div className={cn("absolute bottom-2 left-2 flex gap-1.5", REVEAL_ON_HOVER)}>
                  <Button
                    size="icon-lg"
                    onClick={() => buildPlaylistQueue(pl.id, false)}
                    aria-label={t("playlist.playNamed", { name: pl.name })}
                    title={t("playlist.playNamed", { name: pl.name })}
                  >
                    <Play className="fill-current" />
                  </Button>
                  <Button
                    variant="secondary"
                    size="icon-lg"
                    onClick={() => buildPlaylistQueue(pl.id, true)}
                    aria-label={t("playlist.shuffleTooltip", { name: pl.name })}
                    title={t("playlist.shuffleTooltip", { name: pl.name })}
                  >
                    <Shuffle />
                  </Button>
                </div>
              )}
            </div>
            <div className="min-w-0">
              <h3 title={pl.name} className="truncate text-sm font-medium text-foreground">
                {pl.name}
              </h3>
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                {isPlayingThis && <NowPlayingEqualizer className="text-flexoki-green" />}
                {pl.is_mix && (
                  <span className="flex shrink-0 items-center gap-1 font-medium text-flexoki-magenta">
                    <Combine className="size-3" aria-hidden="true" />
                    {t("mixPlaylist.badge")}
                    <span aria-hidden="true">·</span>
                  </span>
                )}
                {parent && (
                  <span
                    className="flex max-w-30 items-center gap-1 font-medium text-flexoki-blue"
                    title={t("playlist.subPlaylistOf", { name: parent.name })}
                  >
                    <FolderTree className="size-3 shrink-0" aria-hidden="true" />
                    <span className="truncate">{parent.name}</span>
                    <span aria-hidden="true">·</span>
                    <span className="sr-only">{t("playlist.subPlaylistOf", { name: parent.name })}</span>
                  </span>
                )}
                <span className="shrink-0 font-mono">{t("playlist.itemCount", { count: pl.item_count || 0 })}</span>
              </p>
            </div>
          </li>
        );
      })}

      <li>
        <NewTileButton icon={Plus} label={t("library.newPlaylist")} onClick={onCreate} />
      </li>
      {canMix && (
        <li>
          <NewTileButton icon={Combine} label={t("mixPlaylist.newTile")} onClick={onMix} />
        </li>
      )}
    </ul>
  );
}

// A dashed placeholder the size of a playlist cover, for starting a new playlist or mix
function NewTileButton({ icon: Icon, label, onClick }: { icon: typeof Plus; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="group/new flex w-full cursor-pointer flex-col gap-2 text-left outline-none">
      <span className="flex aspect-square w-full items-center justify-center rounded-lg border border-dashed text-muted-foreground transition-colors group-hover/new:border-foreground/40 group-hover/new:text-foreground group-focus-visible/new:ring-2 group-focus-visible/new:ring-ring group-focus-visible/new:ring-offset-2 group-focus-visible/new:ring-offset-background">
        <Icon className="size-8" aria-hidden="true" />
      </span>
      <span className="truncate text-sm font-medium text-foreground">{label}</span>
    </button>
  );
}
