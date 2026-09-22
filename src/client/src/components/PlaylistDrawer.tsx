import * as React from "react";
import {
  X,
  Plus,
  Trash2,
  Edit2,
  Check,
  Folder,
  FolderPlus,
  Shuffle,
  Music,
  Scissors,
  Disc,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { useTranslation } from "react-i18next";
import { usePlayerStore } from "../store/usePlayerStore";
import { ConfirmModal } from "./ui/ConfirmModal";
import { cn } from "../lib/utils";

interface PlaylistDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenCreateModal: () => void;
}

interface PlaylistDrawerContentProps extends PlaylistDrawerProps {
  isExiting?: boolean;
}

function PlaylistDrawerContent({
  isOpen,
  onClose,
  onOpenCreateModal,
  isExiting = false,
}: PlaylistDrawerContentProps) {
  const { t } = useTranslation();
  const playlists = usePlayerStore((s) => s.playlists);
  const activePlaylistId = usePlayerStore((s) => s.activePlaylistId);
  const activePlaylistPlayingId = usePlayerStore((s) => s.activePlaylistPlayingId);
  const activeSystemCategory = usePlayerStore((s) => s.activeSystemCategory);
  const setActiveSystemCategory = usePlayerStore((s) => s.setActiveSystemCategory);
  const setActivePlaylist = usePlayerStore((s) => s.setActivePlaylist);
  const deletePlaylist = usePlayerStore((s) => s.deletePlaylist);
  const renamePlaylist = usePlayerStore((s) => s.renamePlaylist);
  const buildPlaylistQueue = usePlayerStore((s) => s.buildPlaylistQueue);
  const playModeQueue = usePlayerStore((s) => s.playModeQueue);
  const playbackMode = usePlayerStore((s) => s.playbackMode);
  const tracks = usePlayerStore((s) => s.tracks);
  const activeTrack = usePlayerStore((s) => s.activeTrack);

  const { totalSlices, totalOriginals, totalDownloading, totalErrors, totalMixed } = React.useMemo(() => {
    let slices = 0;
    let originals = 0;
    let downloading = 0;
    let errors = 0;
    for (const t of tracks) {
      if (t.status === "ready") {
        slices += (t.segment_count || 0);
        originals++;
      }
      if (t.status === "downloading" || t.status === "queued") {
        downloading++;
        originals++;
      }
      if (t.status === "error") errors++;
    }
    return {
      totalSlices: slices,
      totalOriginals: originals,
      totalDownloading: downloading,
      totalErrors: errors,
      totalMixed: slices + originals,
    };
  }, [tracks]);

  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editingName, setEditingName] = React.useState("");
  const [playlistToDelete, setPlaylistToDelete] = React.useState<{ id: string; name: string } | null>(null);
  const [isDeleting, setIsDeleting] = React.useState(false);

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        if (editingId) {
          setEditingId(null);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, editingId]);

  const handleStartRename = (id: string, currentName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(id);
    setEditingName(currentName);
  };

  const handleSaveRename = async (id: string, e?: React.MouseEvent | React.FormEvent) => {
    e?.stopPropagation();
    e?.preventDefault();
    const trimmed = editingName.trim();
    if (trimmed) {
      await renamePlaylist(id, trimmed);
    }
    setEditingId(null);
  };

  const handleDelete = (id: string, name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setPlaylistToDelete({ id, name });
  };

  const handleConfirmDelete = async () => {
    if (!playlistToDelete || isDeleting) return;
    setIsDeleting(true);
    try {
      await deletePlaylist(playlistToDelete.id);
      setPlaylistToDelete(null);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleQuickShuffle = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await setActivePlaylist(id);
    await buildPlaylistQueue(id, true);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div
        className={cn(
          "fixed inset-0 bg-black/60 backdrop-blur-xs duration-200",
          isExiting ? "animate-out fade-out pointer-events-none" : "animate-in fade-in"
        )}
        onClick={onClose}
      />

      {/* Drawer Panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("playlist.drawerTitle")}
        className={cn(
          "relative z-10 w-full max-w-sm border-r border-border bg-card/95 backdrop-blur-md p-5 shadow-2xl flex flex-col duration-200",
          isExiting ? "animate-out slide-out-to-left pointer-events-none" : "animate-in slide-in-from-left"
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Folder className="h-5 w-5 text-primary" />
            <h2 className="font-bold text-base text-foreground">{t("playlist.drawerTitle")}</h2>
            <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-accent text-accent-foreground">
              {playlists.length}
            </span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label={t("queue.close")}
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Create button */}
        <div className="pt-4 pb-2">
          <Button
            onClick={() => {
              onClose();
              onOpenCreateModal();
            }}
            className="w-full gap-2 shadow-sm font-semibold"
          >
            <Plus className="h-4 w-4" />
            <span>{t("playlist.newButton")}</span>
          </Button>
        </div>

        {/* Scrollable list */}
        <div className="flex-1 overflow-y-auto py-2 space-y-4 pr-1">
          {/* System Default Tab */}
          <div>
            <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-2 mb-1.5">
              {t("playlist.systemHeader")}
            </div>
            <div className="space-y-1.5">
              {[
                {
                  id: "mixed" as const,
                  name: t("categories.mixed"),
                  icon: <Shuffle className="h-4 w-4 shrink-0 text-flexoki-blue" />,
                  countText: t("categories.itemsCount", { count: totalMixed }),
                },
                {
                  id: "slices_only" as const,
                  name: t("categories.slices"),
                  icon: <Scissors className="h-4 w-4 shrink-0 text-flexoki-yellow" />,
                  countText: t("categories.slicesCount", { count: totalSlices }),
                },
                {
                  id: "original_only" as const,
                  name: t("categories.tracks"),
                  icon: <Disc className="h-4 w-4 shrink-0 text-flexoki-green" />,
                  countText: t("categories.tracksCount", { count: totalOriginals }),
                },
                {
                  id: "downloading_only" as const,
                  name: t("categories.downloading"),
                  icon: <Loader2 className={`h-4 w-4 shrink-0 ${totalDownloading > 0 ? "animate-spin text-primary" : "text-muted-foreground"}`} />,
                  countText: t("categories.tracksCount", { count: totalDownloading }),
                },
                {
                  id: "error_only" as const,
                  name: t("categories.errors"),
                  icon: <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />,
                  countText: t("categories.tracksCount", { count: totalErrors }),
                },
              ].map((cat) => {
                const isSelected = activePlaylistId === null && activeSystemCategory === cat.id;
                const isPlayingThis = Boolean(activeTrack) && activePlaylistPlayingId === null && playbackMode === cat.id;

                return (
                  <div
                    key={cat.id}
                    role="button"
                    tabIndex={0}
                    aria-label={cat.name}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setActiveSystemCategory(cat.id);
                        onClose();
                      }
                    }}
                    onClick={() => {
                      setActiveSystemCategory(cat.id);
                      onClose();
                    }}
                    className={`group relative flex items-center justify-between p-2.5 rounded-lg border text-left transition-[border-color,background-color,color,box-shadow] duration-150 cursor-pointer ${
                      isSelected
                        ? "bg-primary/10 border-primary text-foreground font-medium shadow-xs"
                        : "border-transparent bg-secondary/30 hover:bg-secondary text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <div className="flex items-center gap-2.5 truncate flex-1 min-w-0 pr-2">
                      {cat.icon}
                      <span className="truncate text-sm font-medium">{cat.name}</span>
                      <span className="font-mono text-[11px] text-muted-foreground shrink-0">
                        {cat.countText}
                      </span>
                      {isPlayingThis && (
                        <span className="inline-flex items-center gap-1 font-mono text-[10px] text-flexoki-green shrink-0 ml-1">
                          <span className="h-1.5 w-1.5 rounded-full bg-flexoki-green animate-pulse" />
                          <span>{t("playlist.nowPlayingBadge")}</span>
                        </span>
                      )}
                    </div>

                    {cat.id !== "error_only" && cat.id !== "downloading_only" && (
                      <div
                        className="flex items-center gap-1 shrink-0 opacity-80 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                      >
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => {
                            setActiveSystemCategory(cat.id);
                            playModeQueue(cat.id, 0, true);
                            onClose();
                          }}
                          className="h-7 w-7 text-flexoki-green hover:bg-flexoki-green/10 cursor-pointer"
                          title={t("playlist.shuffleTooltip", { name: cat.name })}
                          aria-label={t("playlist.shuffleTooltip", { name: cat.name })}
                        >
                          <Shuffle className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Custom Playlists Section */}
          <div>
            <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-2 mb-1.5 flex items-center justify-between">
              <span>{t("playlist.customHeader")}</span>
              <span className="text-muted-foreground/70 font-mono text-[10px]">
                {t("playlist.customCount", { count: playlists.length })}
              </span>
            </div>

            {playlists.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-6 text-center rounded-lg border border-dashed border-border bg-card/40 my-2 animate-in fade-in zoom-in-95 duration-150 ease-out motion-reduce:animate-none">
                <FolderPlus className="h-8 w-8 text-muted-foreground/40 mb-2" />
                <p className="text-xs font-medium text-muted-foreground">
                  {t("playlist.empty")}
                </p>
                <p className="text-[11px] text-muted-foreground/60 mt-1 max-w-[200px]">
                  {t("playlist.emptyHint")}
                </p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {playlists.map((pl) => {
                  const isActive = activePlaylistId === pl.id;
                  const isEditing = editingId === pl.id;

                  return (
                    <div
                      key={pl.id}
                      role="button"
                      tabIndex={0}
                      aria-label={pl.name}
                      onKeyDown={(e) => {
                        if ((e.key === "Enter" || e.key === " ") && !isEditing) {
                          e.preventDefault();
                          setActivePlaylist(pl.id);
                          onClose();
                        }
                      }}
                      onClick={() => {
                        if (!isEditing) {
                          setActivePlaylist(pl.id);
                          onClose();
                        }
                      }}
                      className={`group relative flex items-center justify-between p-2.5 rounded-lg border text-left transition-[border-color,background-color,color,box-shadow] duration-150 cursor-pointer ${
                        isActive
                          ? "bg-primary/10 border-primary text-foreground font-medium shadow-xs"
                          : "border-transparent bg-secondary/30 hover:bg-secondary text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {isEditing ? (
                        <form
                          onSubmit={(e) => handleSaveRename(pl.id, e)}
                          className="flex items-center gap-1.5 flex-1"
                          onKeyDown={(e) => {
                            if (e.key === "Escape") {
                              setEditingId(null);
                            }
                            e.stopPropagation();
                          }}
                        >
                          <Input
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            autoFocus
                            className="h-7 text-xs flex-1"
                            maxLength={100}
                          />
                          <Button
                            type="submit"
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-flexoki-green hover:bg-flexoki-green/10 cursor-pointer"
                            aria-label={t("playlist.save")}
                          >
                            <Check className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingId(null);
                            }}
                            className="h-7 w-7 text-muted-foreground hover:text-foreground cursor-pointer"
                            aria-label={t("playlist.cancel")}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </form>
                      ) : (
                        <>
                          <div className="flex items-center gap-2.5 truncate flex-1 min-w-0 pr-2">
                            <Music className="h-4 w-4 shrink-0 text-flexoki-yellow" />
                            <span className="truncate text-sm font-medium">
                              {pl.name}
                            </span>
                            <span className="font-mono text-[11px] text-muted-foreground shrink-0">
                              ({pl.item_count || 0})
                            </span>
                            {activePlaylistPlayingId === pl.id && Boolean(activeTrack) && (
                              <span className="inline-flex items-center gap-1 font-mono text-[10px] text-flexoki-green shrink-0 ml-1">
                                <span className="h-1.5 w-1.5 rounded-full bg-flexoki-green animate-pulse" />
                                <span>{t("playlist.nowPlayingBadge")}</span>
                              </span>
                            )}
                          </div>

                          <div
                            className="flex items-center gap-1 shrink-0 opacity-80 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => e.stopPropagation()}
                          >
                            <Button
                              size="icon"
                              variant="ghost"
                              disabled={(pl.item_count || 0) === 0}
                              onClick={(e) => handleQuickShuffle(pl.id, e)}
                              className="h-7 w-7 text-flexoki-green hover:bg-flexoki-green/10 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                              title={(pl.item_count || 0) === 0 ? t("playlist.emptyPlaylistHint") : t("playlist.shuffleTooltip", { name: pl.name })}
                              aria-label={t("playlist.shuffleTooltip", { name: pl.name })}
                            >
                              <Shuffle className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={(e) => handleStartRename(pl.id, pl.name, e)}
                              className="h-7 w-7 text-muted-foreground hover:text-foreground cursor-pointer"
                              title={t("playlist.rename")}
                              aria-label={t("playlist.rename")}
                            >
                              <Edit2 className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={(e) => handleDelete(pl.id, pl.name, e)}
                              className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10 cursor-pointer"
                              title={t("playlist.delete")}
                              aria-label={t("playlist.delete")}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
      {playlistToDelete && (
        <ConfirmModal
          isOpen={!!playlistToDelete}
          onClose={() => !isDeleting && setPlaylistToDelete(null)}
          onConfirm={handleConfirmDelete}
          isLoading={isDeleting}
          title={t("playlist.deletePlaylistTitle", "Delete playlist?")}
          description={t("playlist.confirmDelete", {
            name: playlistToDelete.name,
            defaultValue: `Delete playlist "${playlistToDelete.name}"?`,
          })}
          confirmText={t("common.delete", "Delete")}
          cancelText={t("common.cancel", "Cancel")}
          variant="destructive"
        />
      )}
    </div>
  );
}

export function PlaylistDrawer({
  isOpen,
  onClose,
  onOpenCreateModal,
}: PlaylistDrawerProps) {
  const [isRendered, setIsRendered] = React.useState(isOpen);
  const [isExiting, setIsExiting] = React.useState(false);

  React.useEffect(() => {
    if (isOpen) {
      setIsRendered(true);
      setIsExiting(false);
    } else if (isRendered) {
      setIsExiting(true);
      const timer = setTimeout(() => {
        setIsRendered(false);
        setIsExiting(false);
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [isOpen, isRendered]);

  if (!isOpen && !isRendered) return null;

  return (
    <PlaylistDrawerContent
      isOpen={isOpen}
      onClose={onClose}
      onOpenCreateModal={onOpenCreateModal}
      isExiting={isExiting}
    />
  );
}
