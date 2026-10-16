import * as React from "react";
import { useTranslation } from "react-i18next";
import { Play, Shuffle } from "lucide-react";
import { Button } from "./ui/button";
import { NowPlayingEqualizer } from "./NowPlayingEqualizer";
import { Shelf } from "./Shelf";
import { TrackThumbnail } from "./TrackThumbnail";
import { cn, createDefaultFullSegment } from "../lib/utils";
import { createQueueItem, usePlayerStore, type HomeShelf, type QueueOrigin } from "../store/usePlayerStore";
import type { Track } from "@/server/types";

interface SongShelfProps {
  shelf: HomeShelf;
  title: string;
  description?: string;
  songs: { track: Track; plays?: number }[];
}

// Songs on Home, in Apple Music's columns of four rows. They play as a list of their own, from the song chosen
export function SongShelf({ shelf, title, description, songs }: SongShelfProps) {
  const { t } = useTranslation();
  const playSegmentInMode = usePlayerStore((s) => s.playSegmentInMode);
  const playModeQueue = usePlayerStore((s) => s.playModeQueue);
  const activeTrackId = usePlayerStore((s) => s.activeTrack?.id);
  const isPlaying = usePlayerStore((s) => s.isPlaying);

  const origin: QueueOrigin = { type: "home", shelf, mode: "original_only", fromHome: true };
  const queueOf = () => songs.map(({ track }) => createQueueItem(createDefaultFullSegment(track), track));
  const playFrom = (index: number) => {
    const queue = queueOf();
    void playSegmentInMode("original_only", queue[index].segment, queue[index].track, queue, index, origin);
  };
  const playAll = (shuffle: boolean) => void playModeQueue("original_only", queueOf(), { shuffle, origin });
  const playLabel = t("playlist.playNamed", { name: title });
  const shuffleLabel = t("playlist.shuffleTooltip", { name: title });

  return (
    <Shelf
      title={title}
      description={description}
      actions={
        <>
          <Button variant="secondary" size="sm" onClick={() => playAll(false)} aria-label={playLabel} title={playLabel}>
            <Play data-icon="inline-start" className="fill-current" />
            <span className="hidden @md:inline">{t("playlist.play")}</span>
          </Button>
          <Button variant="secondary" size="sm" onClick={() => playAll(true)} aria-label={shuffleLabel} title={shuffleLabel}>
            <Shuffle data-icon="inline-start" />
            <span className="hidden @md:inline">{t("playlist.shuffle")}</span>
          </Button>
        </>
      }
      listClassName="grid-rows-4 auto-cols-[85%] gap-x-2.5 @xl:shelf-columns-2 @4xl:shelf-columns-3 @7xl:shelf-columns-4"
    >
      {songs.map(({ track, plays }, index) => (
        <li key={track.id} className="min-w-0">
          <SongRow track={track} plays={plays} isCurrent={track.id === activeTrackId} isPlaying={isPlaying} onPlay={() => playFrom(index)} />
        </li>
      ))}
    </Shelf>
  );
}

interface SongRowProps {
  track: Track;
  plays?: number;
  isCurrent: boolean;
  isPlaying: boolean;
  onPlay: () => void;
}

function SongRow({ track, plays, isCurrent, isPlaying, onPlay }: SongRowProps) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onPlay}
      className="group/song flex h-14 w-full min-w-0 cursor-pointer items-center gap-3 rounded-md px-2 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="relative size-10 shrink-0 overflow-hidden rounded-sm bg-muted">
        <TrackThumbnail src={track.thumbnail_url} size="small" alt="" className="size-full object-cover" />
        {/* Play on hover, as on Apple Music's artwork; the playing song shows the equalizer instead */}
        <span
          className={cn(
            "absolute inset-0 flex items-center justify-center bg-background/60 text-foreground transition-opacity",
            !isCurrent && "opacity-0 group-hover/song:opacity-100 group-focus-visible/song:opacity-100"
          )}
        >
          {isCurrent ? <NowPlayingEqualizer isAnimated={isPlaying} className="text-primary" /> : <Play className="size-4 fill-current" />}
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="sr-only">{t("playlist.play")} </span>
        <span className={cn("block truncate text-xs", isCurrent ? "text-primary" : "text-foreground")}>{track.title}</span>
        <span className="block truncate text-2xs text-muted-foreground">{track.artist || t("table.unknownArtist")}</span>
      </span>
      {plays !== undefined && <span className="shrink-0 text-2xs text-muted-foreground tabular-nums">{t("home.plays", { count: plays })}</span>}
    </button>
  );
}
