import * as React from "react";
import { useTranslation } from "react-i18next";
import { Disc, Play, Scissors, Shuffle, type LucideIcon } from "lucide-react";
import { DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator } from "./ui/dropdown-menu";
import { CollectionTile } from "./CollectionTile";
import { NowPlayingEqualizer } from "./NowPlayingEqualizer";
import { PlaylistCover } from "./PlaylistCover";
import { PlaylistDetails } from "./PlaylistGrid";
import { QueueMenuItems } from "./QueueMenuItems";
import type { PlayChoice } from "./LibraryPageActions";
import { selectPlayingPage, usePlayerStore, type PlaybackMode } from "../store/usePlayerStore";
import type { Playlist } from "@/server/types";

// Play and Shuffle, then Play Next and Play Later, as in the sidebar's menus
function PlayChoiceItems({ disabled, onChoose }: { disabled: boolean; onChoose: (choice: PlayChoice) => void }) {
  const { t } = useTranslation();
  return (
    <>
      <DropdownMenuGroup>
        <DropdownMenuItem disabled={disabled} onClick={() => onChoose("play")}>
          <Play />
          {t("playlist.play")}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={disabled} onClick={() => onChoose("shuffle")}>
          <Shuffle />
          {t("nav.shuffle")}
        </DropdownMenuItem>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <QueueMenuItems disabled={disabled} onQueue={onChoose} />
    </>
  );
}

// A playlist on a Home shelf; what it plays counts as started from Home
export function HomePlaylistTile({ playlist }: { playlist: Playlist & { item_count: number } }) {
  const { t } = useTranslation();
  const buildPlaylistQueue = usePlayerStore((s) => s.buildPlaylistQueue);
  const queuePlaylist = usePlayerStore((s) => s.queuePlaylist);
  const setActivePlaylist = usePlayerStore((s) => s.setActivePlaylist);
  const parent = usePlayerStore((s) => (playlist.parent_id ? s.playlists.find((p) => p.id === playlist.parent_id) : undefined));
  const isPlaying = usePlayerStore((s) => s.isPlaying && s.activePlaylistPlayingId === playlist.id);
  const isEmpty = (playlist.item_count || 0) === 0;
  const choose = (choice: PlayChoice) => {
    if (choice === "next" || choice === "later") {
      void queuePlaylist(playlist.id, choice, { fromHome: true });
    } else {
      void buildPlaylistQueue(playlist.id, choice === "shuffle", 0, false, { type: "playlist", playlistId: playlist.id, fromHome: true });
    }
  };

  return (
    <CollectionTile
      name={playlist.name}
      artwork={<PlaylistCover playlist={playlist} />}
      openLabel={t("playlist.openNamed", { name: playlist.name })}
      onOpen={() => void setActivePlaylist(playlist.id)}
      onPlay={isEmpty ? undefined : () => choose("play")}
      menu={<PlayChoiceItems disabled={isEmpty} onChoose={choose} />}
      details={<PlaylistDetails playlist={playlist} parent={parent} isPlaying={isPlaying} />}
      titleAs="h4"
    />
  );
}

// The sidebar's icon for each library page, as its artwork
const PAGES = {
  mixed: { labelKey: "categories.mixed", icon: Shuffle },
  slices_only: { labelKey: "categories.slices", icon: Scissors },
  original_only: { labelKey: "categories.tracks", icon: Disc },
} as const satisfies Record<PlaybackMode, { labelKey: string; icon: LucideIcon }>;

interface HomePageTileProps {
  mode: PlaybackMode;
  // False once the page has nothing left to play
  canPlay: boolean;
  onPlay: (mode: PlaybackMode, choice: PlayChoice) => void;
}

// A library page on a Home shelf
export function HomePageTile({ mode, canPlay, onPlay }: HomePageTileProps) {
  const { t } = useTranslation();
  const setActiveSystemCategory = usePlayerStore((s) => s.setActiveSystemCategory);
  const isPlaying = usePlayerStore((s) => s.isPlaying && selectPlayingPage(s) === mode);
  const { labelKey, icon: Icon } = PAGES[mode];
  const name = t(labelKey);

  return (
    <CollectionTile
      name={name}
      artwork={
        <div className="flex aspect-square w-full items-center justify-center bg-secondary text-primary">
          <Icon className="size-1/4" aria-hidden="true" />
        </div>
      }
      openLabel={t("home.openPage", { name })}
      onOpen={() => setActiveSystemCategory(mode)}
      onPlay={canPlay ? () => onPlay(mode, "play") : undefined}
      menu={<PlayChoiceItems disabled={!canPlay} onChoose={(choice) => onPlay(mode, choice)} />}
      details={
        <>
          {isPlaying && <NowPlayingEqualizer className="text-flexoki-green" />}
          {t("playlist.systemHeader")}
        </>
      }
      titleAs="h4"
    />
  );
}
