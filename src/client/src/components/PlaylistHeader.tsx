import * as React from "react";
import { flushSync } from "react-dom";
import { useTranslation } from "react-i18next";
import { useFormatNumber } from "../hooks/use-format-number";
import { Check, Combine, FolderTree, ImageIcon, MoreHorizontal, Pencil, Play, Plus, Shuffle, Trash2, X } from "lucide-react";
import { PlaylistCover } from "./PlaylistCover";
import { usePlayerStore } from "../store/usePlayerStore";
import { formatDuration, REVEAL_ON_HOVER } from "../lib/utils";
import { DeletePlaylistModal } from "./DeletePlaylistModal";
const CreatePlaylistModal = React.lazy(() => import("./CreatePlaylistModal").then((m) => ({ default: m.CreatePlaylistModal })));
import { Modal } from "./Modal";
import { Badge } from "./ui/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "./ui/breadcrumb";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Input } from "./ui/input";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "./ui/item";
import type { Playlist, PlaylistItemWithDetails } from "@/server/types";

interface PlaylistHeaderProps {
  playlist: Playlist & { item_count?: number };
  items: PlaylistItemWithDetails[];
  onEditSources?: () => void;
}

export function PlaylistHeader({ playlist, items, onEditSources }: PlaylistHeaderProps) {
  const { t } = useTranslation();
  const formatNumber = useFormatNumber();
  const buildPlaylistQueue = usePlayerStore((s) => s.buildPlaylistQueue);
  const renamePlaylist = usePlayerStore((s) => s.renamePlaylist);
  const deletePlaylist = usePlayerStore((s) => s.deletePlaylist);
  const setPlaylistCover = usePlayerStore((s) => s.setPlaylistCover);
  const setActivePlaylist = usePlayerStore((s) => s.setActivePlaylist);

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
  const [isCreateSubModalOpen, setIsCreateSubModalOpen] = React.useState(false);
  // Renaming from the "..." menu: the menu hands focus to the field instead of back to its trigger
  const renameInputRef = React.useRef<HTMLInputElement>(null);
  const renameButtonRef = React.useRef<HTMLButtonElement>(null);

  const parentPlaylist = React.useMemo(() => {
    if (!playlist.parent_id) return null;
    return allPlaylists.find((p) => p.id === playlist.parent_id) || null;
  }, [playlist.parent_id, allPlaylists]);

  const childPlaylists = React.useMemo(() => {
    if (playlist.is_mix || playlist.parent_id) return [];
    return allPlaylists.filter((p) => p.parent_id === playlist.id);
  }, [playlist.id, playlist.is_mix, playlist.parent_id, allPlaylists]);

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

  // The field unmounts on close, so focus moves to the rename button that replaces it rather than the page
  const finishRename = () => {
    flushSync(() => setIsEditingName(false));
    renameButtonRef.current?.focus();
  };

  const handleSaveRename = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = editingName.trim();
    if (trimmed && trimmed !== playlist.name) {
      await renamePlaylist(playlist.id, trimmed);
    }
    finishRename();
  };

  const handleCancelRename = () => {
    setEditingName(playlist.name);
    finishRename();
  };

  const handleKeyDownRename = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      handleCancelRename();
    }
  };

  const handleConfirmDelete = async (keepChildren: boolean) => {
    if (isDeleting) return;
    setIsDeleting(true);
    try {
      if (keepChildren) {
        await deletePlaylist(playlist.id, true);
      } else {
        await deletePlaylist(playlist.id);
      }
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
      {/* Apple Music style: large artwork, the title with a small detail line under it, Play and Shuffle, and a "..." menu.
          Narrow screens stack it centered, like Apple Music at phone widths. */}
      <section data-testid="playlist-header" className="mb-6 flex flex-col gap-5">
        <div className="flex min-w-0 flex-col items-center gap-5 text-center sm:flex-row sm:items-end sm:text-left">
          <div className="group relative shrink-0">
            <PlaylistCover playlist={playlist} className="aspect-square w-48 rounded-lg shadow-xl shadow-black/50 sm:w-52 lg:w-67.5" />
            {!playlist.is_mix && (
              <button
                type="button"
                onClick={() => setIsCoverModalOpen(true)}
                data-testid="playlist-cover-hover-btn"
                title={t("playlist.changeCover", "Đổi ảnh bìa")}
                aria-label={t("playlist.changeCover", "Đổi ảnh bìa")}
                className="absolute inset-0 flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg bg-black/60 text-xs font-semibold text-white opacity-0 backdrop-blur-xs transition-opacity group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <ImageIcon className="size-5" />
                <span>{t("playlist.changeCover", "Đổi bìa")}</span>
              </button>
            )}
          </div>

          <div className="flex min-w-0 flex-1 flex-col max-sm:items-center">
            {parentPlaylist && (
              <Breadcrumb className="mb-1.5">
                <BreadcrumbList>
                  <BreadcrumbItem>
                    <FolderTree className="size-3.5 text-flexoki-purple" aria-hidden="true" />
                    <BreadcrumbLink
                      render={<button type="button" onClick={() => setActivePlaylist(parentPlaylist.id)} />}
                    >
                      {parentPlaylist.name}
                    </BreadcrumbLink>
                  </BreadcrumbItem>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    <BreadcrumbPage>{playlist.name}</BreadcrumbPage>
                  </BreadcrumbItem>
                </BreadcrumbList>
              </Breadcrumb>
            )}

            {isEditingName ? (
              <form onSubmit={handleSaveRename} className="playlist-title-timeline my-1 flex max-w-md items-center gap-2">
                <Input
                  ref={renameInputRef}
                  type="text"
                  autoFocus
                  id="playlist-rename-input"
                  name="playlistName"
                  data-testid="playlist-inline-rename-input"
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  onKeyDown={handleKeyDownRename}
                  aria-label={t("playlist.renameAria", "Tên danh sách phát")}
                />
                <Button
                  type="submit"
                  size="icon-lg"
                  data-testid="playlist-rename-save-btn"
                  title={t("playlist.save", "Lưu")}
                  aria-label={t("playlist.save", "Lưu")}
                >
                  <Check />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-lg"
                  onClick={handleCancelRename}
                  data-testid="playlist-rename-cancel-btn"
                  title={t("playlist.cancel", "Hủy")}
                  aria-label={t("playlist.cancel", "Hủy")}
                >
                  <X />
                </Button>
              </form>
            ) : (
              <div className="playlist-title-timeline group flex flex-wrap items-center gap-2 max-sm:justify-center">
                <h2 className="text-2xl font-bold text-balance break-words text-foreground">{playlist.name}</h2>
                {/* Renaming also lives in the "..." menu, so the shortcut beside the title waits for hover or focus */}
                {!playlist.is_mix && (
                  <div className={REVEAL_ON_HOVER}>
                    <Button
                      ref={renameButtonRef}
                      variant="ghost"
                      size="icon"
                      onClick={handleStartRename}
                      data-testid="playlist-rename-btn"
                      title={t("playlist.rename", "Đổi tên")}
                      aria-label={t("playlist.rename", "Đổi tên")}
                    >
                      <Pencil />
                    </Button>
                  </div>
                )}
              </div>
            )}

            <p className="mt-1 text-2xs font-semibold text-muted-foreground">{meta.join(" · ")}</p>

            {playlist.is_mix && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <span className="flex min-w-0 items-center gap-1.5 font-semibold text-flexoki-magenta">
                  <Combine className="size-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate">{t("mixPlaylist.sources", { names: sourceNames })}</span>
                </span>
                {onEditSources && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onEditSources}
                    aria-label={t("mixPlaylist.editSourcesNamed", { name: playlist.name })}
                  >
                    <Pencil data-icon="inline-start" />
                    {t("mixPlaylist.editSources")}
                  </Button>
                )}
              </div>
            )}

            <div data-testid="playlist-controls-row" className="mt-4 flex flex-wrap items-center gap-2 max-sm:justify-center">
              <Button
                size="lg"
                disabled={count === 0}
                onClick={() => buildPlaylistQueue(playlist.id, false)}
                data-testid="playlist-play-btn"
                aria-label={t("playlist.playNamed", { name: playlist.name })}
                title={t("playlist.playNamed", { name: playlist.name })}
              >
                <Play data-icon="inline-start" className="fill-current" />
                {t("playlist.play", "Play")}
              </Button>
              <Button
                size="lg"
                disabled={count === 0}
                onClick={() => buildPlaylistQueue(playlist.id, true)}
                data-testid="playlist-shuffle-btn"
                aria-label={t("playlist.shuffleTooltip", { name: playlist.name })}
                title={t("playlist.shuffleTooltip", { name: playlist.name })}
              >
                <Shuffle data-icon="inline-start" />
                {t("playlist.shuffle", "Shuffle")}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger
                  aria-label={t("playlist.moreActions", { name: playlist.name })}
                  title={t("playlist.moreActions", { name: playlist.name })}
                  render={<Button variant="ghost" size="icon-lg" />}
                >
                  <MoreHorizontal />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-48" finalFocus={renameInputRef}>
                  {!playlist.is_mix && (
                    <>
                      <DropdownMenuItem data-testid="playlist-menu-rename" onClick={handleStartRename}>
                        <Pencil />
                        {t("playlist.rename", "Đổi tên")}
                      </DropdownMenuItem>
                      <DropdownMenuItem data-testid="playlist-menu-cover" onClick={() => setIsCoverModalOpen(true)}>
                        <ImageIcon />
                        {t("playlist.changeCover", "Đổi ảnh bìa")}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                    </>
                  )}
                  <DropdownMenuItem
                    variant="destructive"
                    data-testid="playlist-menu-delete"
                    onClick={() => setIsDeleteModalOpen(true)}
                  >
                    <Trash2 />
                    {t("playlist.delete", "Xóa playlist")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>

        {/* Sub-Playlists Navigation Bar (Parent View) */}
        {!playlist.is_mix && !playlist.parent_id && (
          <div data-testid="sub-playlists-bar" className="flex flex-col gap-2 border-t border-border/40 pt-3">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                <FolderTree className="size-3.5 text-flexoki-purple" aria-hidden="true" />
                {t("playlist.subPlaylists", "Sub-playlists")}
                {childPlaylists.length > 0 && <Badge variant="secondary">{formatNumber(childPlaylists.length)}</Badge>}
              </span>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setIsCreateSubModalOpen(true)}
                data-testid="create-sub-playlist-btn"
              >
                <Plus data-icon="inline-start" />
                {t("playlist.newSubPlaylist", "New Sub-playlist")}
              </Button>
            </div>

            {childPlaylists.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                {childPlaylists.map((child) => (
                  <Button
                    key={child.id}
                    variant="outline"
                    size="sm"
                    onClick={() => setActivePlaylist(child.id)}
                    data-testid={`sub-playlist-pill-${child.id}`}
                  >
                    <FolderTree data-icon="inline-start" className="text-flexoki-purple" aria-hidden="true" />
                    <span className="max-w-40 truncate">{child.name}</span>
                    {child.item_count !== undefined && (
                      <span className="text-muted-foreground tabular-nums">{formatNumber(child.item_count)}</span>
                    )}
                  </Button>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Delete Confirmation Modal */}
      <DeletePlaylistModal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        playlist={playlist}
        onConfirm={handleConfirmDelete}
      />

      {/* Create Sub-Playlist Modal */}
      {isCreateSubModalOpen && (
        <React.Suspense fallback={null}>
          <CreatePlaylistModal
            isOpen={isCreateSubModalOpen}
            onClose={() => setIsCreateSubModalOpen(false)}
            initialParentId={playlist.id}
            onCreated={(newId) => setActivePlaylist(newId)}
          />
        </React.Suspense>
      )}

      {/* Cover Picker Modal */}
      <Modal
        isOpen={isCoverModalOpen}
        onClose={() => setIsCoverModalOpen(false)}
        title={t("playlist.changeCoverTitle", "Chọn ảnh bìa đại diện")}
        className="sm:max-w-md"
      >
        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            {t("playlist.coverPickerHint", "Chọn bài hát trong danh sách để làm ảnh bìa hoặc đặt lại về ảnh ghép 4 ô.")}
          </p>

          {/* Each option applies at once, so these are buttons; the current cover is marked with aria-current */}
          <Item
            variant="outline"
            size="sm"
            render={<button type="button" />}
            data-testid="cover-option-reset"
            aria-current={!playlist.cover_track_id || undefined}
            onClick={async () => {
              await setPlaylistCover(playlist.id, null);
              setIsCoverModalOpen(false);
            }}
          >
            <ItemMedia variant="icon">
              <ImageIcon />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{t("playlist.coverAutoMosaic", "Tự động (Ảnh ghép 4 ô)")}</ItemTitle>
              <ItemDescription>{t("playlist.coverAutoDesc", "Tự động ghép ảnh từ 4 bài đầu")}</ItemDescription>
            </ItemContent>
            {!playlist.cover_track_id && (
              <ItemActions>
                <Check />
              </ItemActions>
            )}
          </Item>

          <ul className="flex max-h-60 flex-col gap-1.5 overflow-y-auto pr-1">
            {distinctTracks.map((trk) => {
              const isSelected = playlist.cover_track_id === trk.id;
              return (
                <li key={trk.id}>
                  <Item
                    variant="outline"
                    size="sm"
                    render={<button type="button" />}
                    data-testid={`cover-option-${trk.id}`}
                    aria-current={isSelected || undefined}
                    onClick={async () => {
                      await setPlaylistCover(playlist.id, trk.id);
                      setIsCoverModalOpen(false);
                    }}
                  >
                    <ItemMedia variant={trk.thumbnail_url ? "image" : "icon"}>
                      {trk.thumbnail_url ? <img src={trk.thumbnail_url} alt="" /> : <ImageIcon />}
                    </ItemMedia>
                    <ItemContent className="min-w-0">
                      <ItemTitle>{trk.title}</ItemTitle>
                      {trk.artist && <ItemDescription>{trk.artist}</ItemDescription>}
                    </ItemContent>
                    {isSelected && (
                      <ItemActions>
                        <Check />
                      </ItemActions>
                    )}
                  </Item>
                </li>
              );
            })}
          </ul>
        </div>
      </Modal>
    </>
  );
}
