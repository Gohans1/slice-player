import * as React from "react";
import { useTranslation } from "react-i18next";
import { Combine, Play, Plus, Shuffle } from "lucide-react";
import { PlaylistCover } from "./PlaylistCover";
import { NowPlayingEqualizer } from "./NowPlayingEqualizer";
import { usePlayerStore } from "../store/usePlayerStore";
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
    <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 min-[2048px]:grid-cols-8 gap-4">
      {playlists.map((pl) => {
        const isEmpty = (pl.item_count || 0) === 0;
        const isPlayingThis = playingId === pl.id;
        return (
          <li key={pl.id} className="group relative">
            <button
              type="button"
              onClick={() => onOpen(pl.id)}
              aria-label={t("playlist.openNamed", { name: pl.name })}
              className="flex w-full flex-col rounded-xl border border-border bg-card p-2 text-left transition-[border-color,transform] duration-150 ease-out hover:-translate-y-0.5 hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary motion-reduce:transform-none cursor-pointer"
            >
              <PlaylistCover playlist={pl} className="rounded-lg" />
              <span className="mt-2.5 px-1 text-sm font-semibold leading-snug text-foreground truncate group-hover:text-primary transition-colors">
                {pl.name}
              </span>
              <span className="mt-0.5 mb-1 px-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                {isPlayingThis && <NowPlayingEqualizer className="text-flexoki-green" />}
                {pl.is_mix && (
                  <span className="flex items-center gap-1 font-semibold text-flexoki-magenta">
                    <Combine className="h-3 w-3" aria-hidden="true" />
                    {t("mixPlaylist.badge")}
                    <span aria-hidden="true">·</span>
                  </span>
                )}
                <span className="font-mono">{t("playlist.itemCount", { count: pl.item_count || 0 })}</span>
              </span>
            </button>

            {!isEmpty && (
              <div className="absolute right-4 top-[calc(100%-5.75rem)] flex items-center gap-1.5 opacity-100 sm:opacity-0 sm:translate-y-1 sm:group-hover:opacity-100 sm:group-hover:translate-y-0 sm:group-focus-within:opacity-100 sm:group-focus-within:translate-y-0 transition-[opacity,transform] duration-150 ease-out motion-reduce:transform-none">
                <button
                  type="button"
                  onClick={() => buildPlaylistQueue(pl.id, true)}
                  aria-label={t("playlist.shuffleTooltip", { name: pl.name })}
                  title={t("playlist.shuffleTooltip", { name: pl.name })}
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card text-flexoki-green shadow-lg shadow-black/40 hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary cursor-pointer"
                >
                  <Shuffle className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => buildPlaylistQueue(pl.id, false)}
                  aria-label={t("playlist.playNamed", { name: pl.name })}
                  title={t("playlist.playNamed", { name: pl.name })}
                  className="flex h-11 w-11 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-black/40 hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card transition-transform motion-reduce:transform-none cursor-pointer"
                >
                  <Play className="h-5 w-5 fill-current translate-x-px" />
                </button>
              </div>
            )}
          </li>
        );
      })}

      <li>
        <button
          type="button"
          onClick={onCreate}
          className="flex h-full min-h-40 w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-primary/40 text-primary transition-colors hover:border-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary cursor-pointer"
        >
          <Plus className="h-7 w-7" />
          <span className="text-sm font-semibold">{t("library.newPlaylist")}</span>
        </button>
      </li>

      {canMix && (
        <li>
          <button
            type="button"
            onClick={onMix}
            className="flex h-full min-h-40 w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-flexoki-magenta/40 text-flexoki-magenta transition-colors hover:border-flexoki-magenta hover:bg-flexoki-magenta/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flexoki-magenta cursor-pointer"
          >
            <Combine className="h-7 w-7" />
            <span className="text-sm font-semibold">{t("mixPlaylist.newTile")}</span>
          </button>
        </li>
      )}
    </ul>
  );
}
