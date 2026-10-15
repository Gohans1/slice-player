import * as React from "react";
import { ListMusic } from "lucide-react";
import { TrackThumbnail } from "./TrackThumbnail";
import { resolvePlaylistCover } from "../lib/playlistCover";
import { cn } from "../lib/utils";
import type { Playlist } from "@/server/types";

interface PlaylistCoverProps {
  playlist: Pick<Playlist, "cover_url" | "mosaic_urls">;
  className?: string;
  // "small" for covers a few dozen pixels wide, as in lists
  thumbnailSize?: React.ComponentProps<typeof TrackThumbnail>["size"];
}

const tileFallback = <div className="h-full w-full bg-secondary" />;

export function PlaylistCover({ playlist, className, thumbnailSize }: PlaylistCoverProps) {
  const cover = resolvePlaylistCover(playlist);

  return (
    <div className={cn("relative aspect-square w-full overflow-hidden bg-secondary", className)}>
      {/* Decorative: every cover sits beside its playlist's name */}
      {cover.kind === "single" && (
        <TrackThumbnail src={cover.url} size={thumbnailSize} alt="" className="h-full w-full object-cover" />
      )}
      {cover.kind === "mosaic" && (
        <div className="grid h-full w-full grid-cols-2 grid-rows-2">
          {cover.urls.map((url, i) => (
            <TrackThumbnail key={`${i}_${url}`} src={url} size={thumbnailSize} alt="" className="h-full w-full object-cover" fallback={tileFallback} />
          ))}
        </div>
      )}
      {cover.kind === "empty" && (
        <div className="flex h-full w-full items-center justify-center text-muted-foreground">
          <ListMusic className="h-1/4 w-1/4 opacity-60" aria-hidden="true" />
        </div>
      )}
    </div>
  );
}
