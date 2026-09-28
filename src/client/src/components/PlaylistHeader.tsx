import * as React from "react";
import { useTranslation } from "react-i18next";
import { Check, Combine, ImageIcon, Pencil, Play, Shuffle, Trash2, X } from "lucide-react";
import { PlaylistCover } from "./PlaylistCover";
import { usePlayerStore } from "../store/usePlayerStore";
import { formatDuration, cn } from "../lib/utils";
import { ConfirmModal } from "./ui/ConfirmModal";
import { Modal } from "./ui/modal";
import { Button } from "./ui/button";
import type { Playlist, PlaylistItemWithDetails } from "@/server/types";

interface PlaylistHeaderProps {
  playlist: Playlist & { item_count?: number };
  items: PlaylistItemWithDetails[];
  onEditSources?: () => void;
}

export function PlaylistHeader({ playlist, items, onEditSources }: PlaylistHeaderProps) {
  const { t } = useTranslation();
  const buildPlaylistQueue = usePlayerStore((s) => s.buildPlaylistQueue);
  const renamePlaylist = usePlayerStore((s) => s.renamePlaylist);
  const deletePlaylist = usePlayerStore((s) => s.deletePlaylist);
  const setPlaylistCover = usePlayerStore((s) => s.setPlaylistCover);

  const allPlaylists = usePlayerStore((s) => s.playlists);
  const sourceNames = React.useMemo(() => {
    if (!playlist.is_mix || !playlist.source_ids) return "";
    return playlist.source_ids
      .map((id) => allPlaylists.find((p) => p.id === id)?.name)
      .filter(Boolean)
      .join(" · ");
  }, [playlist.is_mix, playlist.source_ids, allPlaylists]);

  const [isEditingName, setIsEditingName] = React.useState(false);
  const [editingName, setEditingName] = React.useState(playlist.name);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = React.useState(false);
  const [isDeleting, setIsDeleting] = React.useState(false);
  const [isCoverModalOpen, setIsCoverModalOpen] = React.useState(false);

  // Sync editing name when playlist changes
  React.useEffect(() => {
    setEditingName(playlist.name);
    setIsEditingName(false);
  }, [playlist.id, playlist.name]);

  const count = playlist.item_count ?? items.length;
  const sliceCount = items.filter((it) => it.segment).length;
  const totalSeconds = items.reduce(
    (sum, it) => sum + (it.segment ? it.segment.end_time - it.segment.start_time : it.track?.duration ?? 0),
    0
  );
  const meta = [
    t("playlist.itemCount", { count }),
    sliceCount > 0 ? t("playlist.sliceCount", { count: sliceCount }) : null,
    totalSeconds > 0 ? formatDuration(totalSeconds) : null,
  ].filter(Boolean);

  const handleStartRename = () => {
    setEditingName(playlist.name);
    setIsEditingName(true);
  };

  const handleSaveRename = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = editingName.trim();
    if (trimmed && trimmed !== playlist.name) {
      await renamePlaylist(playlist.id, trimmed);
    }
    setIsEditingName(false);
  };

  const handleCancelRename = () => {
    setEditingName(playlist.name);
    setIsEditingName(false);
  };

  const handleKeyDownRename = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      handleCancelRename();
    }
  };

  const handleConfirmDelete = async () => {
    if (isDeleting) return;
    setIsDeleting(true);
    try {
      await deletePlaylist(playlist.id);
      setIsDeleteModalOpen(false);
    } finally {
      setIsDeleting(false);
    }
  };

  // Distinct tracks from playlist items available to pick as cover
  const distinctTracks = React.useMemo(() => {
    const map = new Map<string, PlaylistItemWithDetails["track"]>();
    for (const item of items) {
      if (item.track && !map.has(item.track.id)) {
        map.set(item.track.id, item.track);
      }
    }
    return Array.from(map.values());
  }, [items]);

  return (
    <>
      <section
        data-testid="playlist-header"
        className="mb-6 rounded-2xl bg-gradient-to-b from-secondary/70 to-transparent p-4 sm:p-5 flex flex-col gap-4 border border-border/40 shadow-xs"
      >
        {/* Top Block: Cover + Info */}
        <div className="flex flex-col sm:flex-row sm:items-end gap-4 sm:gap-5 min-w-0">
          <div className="relative group shrink-0 self-start sm:self-auto">
            <PlaylistCover
              playlist={playlist}
              className="w-28 sm:w-36 rounded-xl shadow-xl shadow-black/50 aspect-square"
            />
            {!playlist.is_mix && (
              <button
                type="button"
                onClick={() => setIsCoverModalOpen(true)}
                data-testid="playlist-cover-hover-btn"
                title={t("playlist.changeCover", "Đổi ảnh bìa")}
                aria-label={t("playlist.changeCover", "Đổi ảnh bìa")}
                className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-xs opacity-0 group-hover:opacity-100 transition-opacity rounded-xl text-white font-semibold text-xs gap-1 cursor-pointer focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <ImageIcon className="h-5 w-5" />
                <span>{t("playlist.changeCover", "Đổi bìa")}</span>
              </button>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <span className="text-2xs uppercase tracking-wider font-bold text-primary mb-1 block">
              {playlist.is_mix ? t("mixPlaylist.badge", "Mix Playlist") : t("playlist.customBadge", "Playlist")}
            </span>

            {isEditingName ? (
              <form onSubmit={handleSaveRename} className="flex items-center gap-2 max-w-md my-1">
                <input
                  type="text"
                  autoFocus
                  id="playlist-rename-input"
                  name="playlistName"
                  data-testid="playlist-inline-rename-input"
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  onKeyDown={handleKeyDownRename}
                  aria-label={t("playlist.renameAria", "Tên danh sách phát")}
                  className="w-full rounded-md border border-primary/50 bg-background px-3 py-1.5 text-base sm:text-xl font-bold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                />
                <Button
                  type="submit"
                  size="sm"
                  variant="default"
                  data-testid="playlist-rename-save-btn"
                  title={t("playlist.save", "Lưu")}
                  aria-label={t("playlist.save", "Lưu")}
                  className="shrink-0 h-9 px-3 gap-1 cursor-pointer"
                >
                  <Check className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={handleCancelRename}
                  data-testid="playlist-rename-cancel-btn"
                  title={t("playlist.cancel", "Hủy")}
                  aria-label={t("playlist.cancel", "Hủy")}
                  className="shrink-0 h-9 px-2 text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </Button>
              </form>
            ) : (
              <div className="flex items-center gap-2 group/title flex-wrap">
                <h2 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold tracking-tight text-foreground text-balance break-words">
                  {playlist.name}
                </h2>
                {!playlist.is_mix && (
                  <button
                    type="button"
                    onClick={handleStartRename}
                    data-testid="playlist-rename-btn"
                    title={t("playlist.rename", "Đổi tên")}
                    aria-label={t("playlist.rename", "Đổi tên")}
                    className="p-1.5 rounded-lg border border-transparent hover:border-border text-muted-foreground hover:text-foreground hover:bg-secondary/80 transition-colors cursor-pointer"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                )}
              </div>
            )}

            <p className="mt-2 font-mono text-xs text-muted-foreground">{meta.join(" · ")}</p>

            {playlist.is_mix && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <span className="flex min-w-0 items-center gap-1.5 font-semibold text-flexoki-magenta">
                  <Combine className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate">{t("mixPlaylist.sources", { names: sourceNames })}</span>
                </span>
                {onEditSources && (
                  <button
                    type="button"
                    onClick={onEditSources}
                    aria-label={t("mixPlaylist.editSourcesNamed", { name: playlist.name })}
                    className="flex items-center gap-1 rounded-md border border-border px-2 py-0.5 font-semibold text-foreground hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary cursor-pointer"
                  >
                    <Pencil className="h-3 w-3" aria-hidden="true" />
                    {t("mixPlaylist.editSources")}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Bottom Row: Controls & Actions Row (Spotify + Actions Toolbar) */}
        <div
          data-testid="playlist-controls-row"
          className="flex flex-wrap items-center gap-3 pt-2 border-t border-border/40"
        >
          {/* Primary Play & Shuffle Buttons */}
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              disabled={count === 0}
              onClick={() => buildPlaylistQueue(playlist.id, false)}
              data-testid="playlist-play-btn"
              aria-label={t("playlist.playNamed", { name: playlist.name })}
              title={t("playlist.playNamed", { name: playlist.name })}
              className="flex h-11 w-11 sm:h-12 sm:w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-black/40 hover:scale-105 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background transition-transform motion-reduce:transform-none cursor-pointer"
            >
              <Play className="h-5 w-5 fill-current translate-x-px" />
            </button>
            <button
              type="button"
              disabled={count === 0}
              onClick={() => buildPlaylistQueue(playlist.id, true)}
              data-testid="playlist-shuffle-btn"
              aria-label={t("playlist.shuffleTooltip", { name: playlist.name })}
              title={t("playlist.shuffleTooltip", { name: playlist.name })}
              className="flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-full border border-border bg-card text-flexoki-green hover:bg-secondary disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary cursor-pointer transition-transform hover:scale-105 motion-reduce:transform-none"
            >
              <Shuffle className="h-4 w-4" />
            </button>
          </div>

          <div className="h-5 w-px bg-border/60 mx-1 hidden sm:block" />

          {/* Action Toolbar Buttons */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {!playlist.is_mix && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleStartRename}
                  disabled={isEditingName}
                  data-testid="playlist-toolbar-rename-btn"
                  className="h-8 gap-1.5 text-xs border-border/80 text-foreground hover:bg-secondary cursor-pointer"
                >
                  <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>{t("playlist.rename", "Đổi tên")}</span>
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsCoverModalOpen(true)}
                  data-testid="playlist-cover-btn"
                  className="h-8 gap-1.5 text-xs border-border/80 text-foreground hover:bg-secondary cursor-pointer"
                >
                  <ImageIcon className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>{t("playlist.changeCover", "Đổi ảnh bìa")}</span>
                </Button>
              </>
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsDeleteModalOpen(true)}
              data-testid="playlist-delete-btn"
              className="h-8 gap-1.5 text-xs border-border/80 text-destructive/90 hover:text-destructive hover:bg-destructive/10 hover:border-destructive/30 cursor-pointer"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>{t("playlist.delete", "Xóa playlist")}</span>
            </Button>
          </div>
        </div>
      </section>

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        onConfirm={handleConfirmDelete}
        title={t("playlist.deletePlaylistTitle", "Xóa danh sách phát?")}
        description={t("playlist.confirmDelete", { name: playlist.name })}
        confirmText={t("common.delete", "Xóa")}
        cancelText={t("common.cancel", "Hủy")}
        variant="destructive"
        isLoading={isDeleting}
      />

      {/* Cover Picker Modal */}
      <Modal
        isOpen={isCoverModalOpen}
        onClose={() => setIsCoverModalOpen(false)}
        title={t("playlist.changeCoverTitle", "Chọn ảnh bìa đại diện")}
        className="max-w-md"
      >
        <div className="space-y-3 py-1">
          <p className="text-xs text-muted-foreground">
            {t("playlist.coverPickerHint", "Chọn bài hát trong danh sách để làm ảnh bìa hoặc đặt lại về ảnh ghép 4 ô.")}
          </p>

          <button
            type="button"
            data-testid="cover-option-reset"
            onClick={async () => {
              await setPlaylistCover(playlist.id, null);
              setIsCoverModalOpen(false);
            }}
            className={cn(
              "w-full flex items-center gap-3 p-2.5 rounded-lg border text-left text-xs transition-colors cursor-pointer",
              !playlist.cover_track_id
                ? "border-primary bg-primary/10 text-primary font-bold"
                : "border-border hover:bg-secondary text-foreground"
            )}
          >
            <div className="w-10 h-10 rounded-md bg-secondary/80 flex items-center justify-center border border-border shrink-0">
              <ImageIcon className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold">{t("playlist.coverAutoMosaic", "Tự động (Ảnh ghép 4 ô)")}</div>
              <div className="text-2xs text-muted-foreground">{t("playlist.coverAutoDesc", "Tự động ghép ảnh từ 4 bài đầu")}</div>
            </div>
          </button>

          <div className="max-h-60 overflow-y-auto space-y-1.5 pr-1">
            {distinctTracks.map((trk) => {
              const isSelected = playlist.cover_track_id === trk.id;
              return (
                <button
                  key={trk.id}
                  type="button"
                  data-testid={`cover-option-${trk.id}`}
                  onClick={async () => {
                    await setPlaylistCover(playlist.id, trk.id);
                    setIsCoverModalOpen(false);
                  }}
                  className={cn(
                    "w-full flex items-center gap-3 p-2 rounded-lg border text-left text-xs transition-colors cursor-pointer",
                    isSelected
                      ? "border-primary bg-primary/10 text-primary font-bold"
                      : "border-border hover:bg-secondary text-foreground"
                  )}
                >
                  {trk.thumbnail_url ? (
                    <img
                      src={trk.thumbnail_url}
                      alt=""
                      className="w-10 h-10 rounded-md object-cover border border-border shrink-0"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-md bg-secondary flex items-center justify-center shrink-0">
                      <ImageIcon className="h-4 w-4 text-muted-foreground" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="truncate font-semibold">{trk.title}</div>
                    {trk.artist && <div className="truncate text-2xs text-muted-foreground">{trk.artist}</div>}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </Modal>
    </>
  );
}
