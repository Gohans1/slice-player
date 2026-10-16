import * as React from "react";
import { useTranslation } from "react-i18next";
import { Music } from "lucide-react";
import { Alert, AlertAction, AlertTitle } from "./ui/alert";
import { Button } from "./ui/button";
import { EmptyState } from "./EmptyState";
import { SongShelf } from "./HomeSongShelf";
import { HomePageTile, HomePlaylistTile } from "./HomeTiles";
import { Shelf } from "./Shelf";
import type { PlayChoice } from "./LibraryPageActions";
import { homeShelvesOf } from "../lib/home";
import { useHomeStore } from "../store/useHomeStore";
import { usePlayerStore, type PlaybackMode } from "../store/usePlayerStore";

// Square tiles, about Apple Music's size: from two and a part of the next a page on a phone to six in a wide window
const TILE_COLUMNS = "auto-cols-[42%] gap-x-2.5 @md:shelf-columns-3 @2xl:shelf-columns-4 @4xl:shelf-columns-5 @6xl:shelf-columns-6";

interface HomePageProps {
  // Plays a library page's songs as that page lists them
  onPlayPage: (mode: PlaybackMode, choice: PlayChoice) => void;
}

// Like Apple Music's Home: what was played lately and most, then what was added
export function HomePage({ onPlayPage }: HomePageProps) {
  const { t } = useTranslation();
  const summary = useHomeStore((s) => s.summary);
  const failed = useHomeStore((s) => s.failed);
  const refresh = useHomeStore((s) => s.refresh);
  const tracks = usePlayerStore((s) => s.tracks);
  const playlists = usePlayerStore((s) => s.playlists);

  // Picks up what was played since the last visit
  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const shelves = React.useMemo(() => homeShelvesOf(summary, tracks, playlists), [summary, tracks, playlists]);
  const playable = React.useMemo(
    () => ({
      songs: tracks.some((track) => track.status === "ready"),
      slices: tracks.some((track) => track.status === "ready" && (track.segment_count ?? 0) > 0),
    }),
    [tracks]
  );

  if (tracks.length === 0) {
    return <EmptyState icon={Music} title={t("library.emptyLibraryTitle")} description={t("library.emptyLibraryDesc")} />;
  }
  // A moment, on the first visit only: later ones show the shelves while they refresh
  if (!summary && !failed) return null;

  const hasPlays = shelves.recentlyPlayed.length > 0 || shelves.heavyRotation.length > 0 || shelves.topPlaylists.length > 0;
  const canPlay = (mode: PlaybackMode) => (mode === "slices_only" ? playable.slices : playable.songs);

  return (
    <div className="flex flex-col gap-9">
      {!summary && (
        <Alert>
          <AlertTitle>{t("home.loadFailed")}</AlertTitle>
          <AlertAction>
            <Button variant="outline" size="sm" onClick={() => void refresh()}>
              {t("home.retry")}
            </Button>
          </AlertAction>
        </Alert>
      )}
      {summary && !hasPlays && <p className="text-xs text-muted-foreground">{t("home.noPlays")}</p>}

      {shelves.recentlyPlayed.length > 0 && (
        <Shelf title={t("home.recentlyPlayed")} listClassName={TILE_COLUMNS}>
          {shelves.recentlyPlayed.map((item) =>
            item.type === "playlist" ? (
              <HomePlaylistTile key={item.playlist.id} playlist={item.playlist} />
            ) : (
              <HomePageTile key={item.mode} mode={item.mode} canPlay={canPlay(item.mode)} onPlay={onPlayPage} />
            )
          )}
        </Shelf>
      )}
      {shelves.heavyRotation.length > 0 && (
        <SongShelf shelf="heavy_rotation" title={t("home.heavyRotation")} description={t("home.heavyRotationDesc")} songs={shelves.heavyRotation} />
      )}
      {shelves.topPlaylists.length > 0 && (
        <Shelf title={t("home.topPlaylists")} description={t("home.topPlaylistsDesc")} listClassName={TILE_COLUMNS}>
          {shelves.topPlaylists.map((playlist) => (
            <HomePlaylistTile key={playlist.id} playlist={playlist} />
          ))}
        </Shelf>
      )}
      {shelves.recentlyAdded.length > 0 && (
        <SongShelf shelf="recently_added" title={t("home.recentlyAdded")} songs={shelves.recentlyAdded.map((track) => ({ track }))} />
      )}
    </div>
  );
}
