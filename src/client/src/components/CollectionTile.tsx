import * as React from "react";
import { useTranslation } from "react-i18next";
import { MoreHorizontal, Play } from "lucide-react";
import { Button } from "./ui/button";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "./ui/context-menu";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { cn, REVEAL_ON_HOVER } from "../lib/utils";

interface CollectionTileProps {
  name: string;
  // Square, filling the tile's width
  artwork: React.ReactNode;
  openLabel: string;
  onOpen: () => void;
  // Left out when there is nothing to play
  onPlay?: () => void;
  // The "..." menu's items, also shown on a right-click or long press
  menu: React.ReactNode;
  // The line under the name, such as how many songs
  details: React.ReactNode;
  // h3 on a page of tiles; h4 on a shelf, under the shelf's own heading
  titleAs?: "h3" | "h4";
}

// Apple Music's tile for a playlist or album: artwork with Play and "..." on hover, and the same menu on a right-click or long press
export function CollectionTile({ name, artwork, openLabel, onOpen, onPlay, menu, details, titleAs: Title = "h3" }: CollectionTileProps) {
  const { t } = useTranslation();
  const playLabel = t("playlist.playNamed", { name });
  const moreLabel = t("sidebar.playlistActions", { name });

  return (
    <ContextMenu>
      <ContextMenuTrigger render={<li className="group flex min-w-0 flex-col" />}>
        <div className="relative">
          <button
            type="button"
            onClick={onOpen}
            aria-label={openLabel}
            className="block w-full cursor-pointer overflow-hidden rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            {artwork}
          </button>
          {onPlay && (
            <div className={cn("absolute bottom-2 left-2", REVEAL_ON_HOVER)}>
              <Button size="icon-lg" onClick={onPlay} aria-label={playLabel} title={playLabel}>
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
                {menu}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <div className="mt-2 min-w-0">
          <Title title={name} className="truncate text-xs text-foreground">
            {name}
          </Title>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">{details}</p>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-auto">{menu}</ContextMenuContent>
    </ContextMenu>
  );
}
