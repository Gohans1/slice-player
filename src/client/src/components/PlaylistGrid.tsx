import * as React from "react";
import { useTranslation } from "react-i18next";
import { Combine, FolderTree, MoreHorizontal, Play, Plus, Shuffle, Trash2 } from "lucide-react";
import { Button } from "./ui/button";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "./ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { DeletePlaylistModal } from "./DeletePlaylistModal";
import { QueueMenuItems } from "./QueueMenuItems";
import { PlaylistCover } from "./PlaylistCover";
import { NowPlayingEqualizer } from "./NowPlayingEqualizer";
import { usePlayerStore } from "../store/usePlayerStore";
import { cn, REVEAL_ON_HOVER } from "../lib/utils";
import { canStartMix } from "../lib/mixPlaylist";
import type { Playlist } from "@/server/types";

type ListedPlaylist = Playlist & { item_count: number };

interface PlaylistGridProps {
  playlists: ListedPlaylist[];
  onOpen: (id: string) => void;
  // The dashed tile after the playlists: New Playlist, unless the caller names it otherwise
  onCreate: () => void;
  createLabel?: string;
  // The Mix Playlists tile after the playlists, which starts a new mix
  onMix?: () => void;
  // New Mix with This Playlist in each regular playlist's menu
  onMixWith?: (firstSourceId: string) => void;
  onEditSources?: (mix: ListedPlaylist) => void;
}

export function PlaylistGrid({ playlists, onOpen, onCreate, createLabel, onMix, onMixWith, onEditSources }: PlaylistGridProps) {
  const { t } = useTranslation();
  const deletePlaylist = usePlayerStore((s) => s.deletePlaylist);
  const playingId = usePlayerStore((s) => (s.isPlaying ? s.activePlaylistPlayingId : null));
  const [playlistToDelete, setPlaylistToDelete] = React.useState<ListedPlaylist | null>(null);
  // From the whole library, not the playlists a search left on the page
  const canMix = usePlayerStore((s) => canStartMix(s.playlists));

  return (
    <>
      {/* Columns of at least 11rem; a phone always gets two, as in the Playlists grid of Apple Music on iPhone */}
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(11rem,calc(50%-0.5rem)),1fr))] gap-x-4 gap-y-6">
        {playlists.map((pl) => (
          <PlaylistTile
            key={pl.id}
            playlist={pl}
            parent={pl.parent_id ? playlists.find((p) => p.id === pl.parent_id) : undefined}
            isPlaying={playingId === pl.id}
            onOpen={onOpen}
            onMixWith={onMixWith}
            canMix={canMix}
            onEditSources={onEditSources}
            onDelete={setPlaylistToDelete}
          />
        ))}

        <li>
          <NewTileButton icon={Plus} label={createLabel ?? t("library.newPlaylist")} onClick={onCreate} />
        </li>
        {onMix && canMix && (
          <li>
            <NewTileButton icon={Combine} label={t("mixPlaylist.newTile")} onClick={() => onMix?.()} />
          </li>
        )}
      </ul>

      {playlistToDelete && (
        <DeletePlaylistModal
          isOpen
          onClose={() => setPlaylistToDelete(null)}
          playlist={playlistToDelete}
          onConfirm={async (keepChildren) => {
            await deletePlaylist(playlistToDelete.id, keepChildren);
          }}
        />
      )}
    </>
  );
}

interface PlaylistTileProps {
  playlist: ListedPlaylist;
  parent?: ListedPlaylist;
  isPlaying: boolean;
  onOpen: (id: string) => void;
  onMixWith?: (firstSourceId: string) => void;
  canMix: boolean;
  onEditSources?: (mix: ListedPlaylist) => void;
  onDelete: (playlist: ListedPlaylist) => void;
}

// Apple Music's playlist tile: artwork with Play and "..." on hover, and the same menu on a right-click or long press
function PlaylistTile({ playlist: pl, parent, isPlaying: isPlayingThis, onOpen, onMixWith, canMix, onEditSources, onDelete }: PlaylistTileProps) {
  const { t } = useTranslation();
  const buildPlaylistQueue = usePlayerStore((s) => s.buildPlaylistQueue);
  const queuePlaylist = usePlayerStore((s) => s.queuePlaylist);
  const isEmpty = (pl.item_count || 0) === 0;
  const moreLabel = t("sidebar.playlistActions", { name: pl.name });
  // A mix's sources are edited here; any other playlist can start a mix
  const mixItem = pl.is_mix
    ? onEditSources && (
        <DropdownMenuItem onClick={() => onEditSources(pl)}>
          <Combine />
          {t("mixPlaylist.editSources")}
        </DropdownMenuItem>
      )
    : onMixWith && (
        <DropdownMenuItem disabled={!canMix} onClick={() => onMixWith(pl.id)}>
          <Combine />
          {t("mixPlaylist.newWith")}
        </DropdownMenuItem>
      );

  const actions = (
    <>
      <DropdownMenuGroup>
        <DropdownMenuItem disabled={isEmpty} onClick={() => buildPlaylistQueue(pl.id, false)}>
          <Play />
          {t("playlist.play")}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={isEmpty} onClick={() => buildPlaylistQueue(pl.id, true)}>
          <Shuffle />
          {t("nav.shuffle")}
        </DropdownMenuItem>
      </DropdownMenuGroup>
      <QueueMenuItems disabled={isEmpty} onQueue={(placement) => void queuePlaylist(pl.id, placement)} />
      {mixItem && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>{mixItem}</DropdownMenuGroup>
        </>
      )}
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuItem variant="destructive" onClick={() => onDelete(pl)}>
          <Trash2 />
          {t("playlist.delete")}
        </DropdownMenuItem>
      </DropdownMenuGroup>
    </>
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger render={<li className="group flex min-w-0 flex-col" />}>
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
            <div className={cn("absolute bottom-2 left-2", REVEAL_ON_HOVER)}>
              <Button
                size="icon-lg"
                onClick={() => buildPlaylistQueue(pl.id, false)}
                aria-label={t("playlist.playNamed", { name: pl.name })}
                title={t("playlist.playNamed", { name: pl.name })}
              >
                <Play className="fill-current" />
              </Button>
            </div>
          )}
          <div className={cn("absolute right-2 bottom-2", REVEAL_ON_HOVER)}>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="secondary" size="icon-lg" aria-label={moreLabel} title={moreLabel} />}>
                <MoreHorizontal />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-auto">
                {actions}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <div className="mt-2 min-w-0">
          <h3 title={pl.name} className="truncate text-xs text-foreground">
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
            <span className="shrink-0 tabular-nums">{t("playlist.itemCount", { count: pl.item_count || 0 })}</span>
          </p>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-auto">{actions}</ContextMenuContent>
    </ContextMenu>
  );
}

// A dashed placeholder the size of a playlist cover, for starting a new playlist or mix
function NewTileButton({ icon: Icon, label, onClick }: { icon: typeof Plus; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="group/new flex w-full cursor-pointer flex-col gap-2 text-left outline-none">
      <span className="flex aspect-square w-full items-center justify-center rounded-lg border border-dashed text-muted-foreground transition-colors group-hover/new:border-foreground/40 group-hover/new:text-foreground group-focus-visible/new:ring-2 group-focus-visible/new:ring-ring group-focus-visible/new:ring-offset-2 group-focus-visible/new:ring-offset-background">
        <Icon className="size-8" aria-hidden="true" />
      </span>
      <span className="truncate text-xs text-foreground">{label}</span>
    </button>
  );
}
