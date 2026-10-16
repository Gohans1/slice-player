import * as React from "react";
import { useTranslation } from "react-i18next";
import { MoreHorizontal, Play, Shuffle } from "lucide-react";
import { Button } from "./ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { QueueMenuItems } from "./QueueMenuItems";
import type { QueuePlacement } from "../store/usePlayerStore";

export type PlayChoice = "play" | "shuffle" | QueuePlacement;

interface LibraryPageActionsProps {
  // The page's title, which names what the buttons play
  name: string;
  canPlay: boolean;
  onPlay: (choice: PlayChoice) => void;
}

// Play and Shuffle at the top of a library page, as at the top of Songs in Apple Music, and a "..." menu to queue it
export function LibraryPageActions({ name, canPlay, onPlay }: LibraryPageActionsProps) {
  const { t } = useTranslation();
  const playLabel = t("playlist.playNamed", { name });
  const shuffleLabel = t("playlist.shuffleTooltip", { name });
  const moreLabel = t("playlist.moreActions", { name });

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <Button size="lg" disabled={!canPlay} onClick={() => onPlay("play")} aria-label={playLabel} title={playLabel}>
        <Play data-icon="inline-start" className="fill-current" />
        {t("playlist.play")}
      </Button>
      <Button size="lg" disabled={!canPlay} onClick={() => onPlay("shuffle")} aria-label={shuffleLabel} title={shuffleLabel}>
        <Shuffle data-icon="inline-start" />
        {t("playlist.shuffle")}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={!canPlay}
          aria-label={moreLabel}
          title={moreLabel}
          render={<Button variant="ghost" size="icon-lg" />}
        >
          <MoreHorizontal />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          <QueueMenuItems onQueue={onPlay} />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
