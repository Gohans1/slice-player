import * as React from "react";
import { FolderPlus, Trash2, X, Check, CheckSquare, Square } from "lucide-react";
import { Button } from "./ui/button";
import { ConfirmModal } from "./ui/ConfirmModal";
import { useTranslation } from "react-i18next";
import { usePlayerStore } from "../store/usePlayerStore";
import {
  useSelectionStore,
  useSelectedTrackCount,
  isAllVisibleSelected,
  type SelectedItem,
} from "../store/useSelectionStore";

interface BulkActionBarProps {
  visibleTrackIds?: string[];
  visibleItems?: SelectedItem[];
}

function BulkAddToPlaylistMenu({
  selectedItems,
  onClose,
}: {
  selectedItems: SelectedItem[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const playlists = usePlayerStore((s) => s.playlists);
  const addTracksToPlaylistBatch = usePlayerStore((s) => s.addTracksToPlaylistBatch);
  const [addedFeedback, setAddedFeedback] = React.useState<string | null>(null);
  const feedbackTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  React.useEffect(() => {
    return () => {
      if (feedbackTimeoutRef.current) {
        clearTimeout(feedbackTimeoutRef.current);
      }
    };
  }, []);

  const handleSelect = async (plId: string) => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      const payload = selectedItems.map((item) => ({
        track_id: item.trackId,
        segment_id: item.segmentId || (item.type === "slice" ? item.id : null),
      }));
      const ok = await addTracksToPlaylistBatch(plId, payload);
      if (ok) {
        setAddedFeedback(plId);
        feedbackTimeoutRef.current = setTimeout(() => {
          setAddedFeedback(null);
          onClose();
        }, 600);
      } else {
        setIsSubmitting(false);
      }
    } catch {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 rounded-lg border border-border bg-card/95 backdrop-blur-md p-1.5 shadow-xl z-50 animate-in fade-in zoom-in-95 duration-100"
    >
      <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border-b border-border mb-1">
        {t("addToPlaylist.title", "Add to Playlist")}
      </div>
      {playlists.length === 0 ? (
        <div className="px-2 py-2 text-xs text-muted-foreground text-center">
          {t("addToPlaylist.empty", "No playlists yet")}
        </div>
      ) : (
        <div className="max-h-48 overflow-y-auto space-y-0.5">
          {playlists.map((pl) => (
            <button
              key={pl.id}
              onClick={() => handleSelect(pl.id)}
              disabled={isSubmitting}
              className="w-full flex items-center justify-between px-2 py-1.5 rounded text-xs text-left hover:bg-accent hover:text-accent-foreground transition-colors cursor-pointer disabled:opacity-50"
            >
              <span className="truncate">{pl.name}</span>
              {addedFeedback === pl.id && (
                <Check className="h-3.5 w-3.5 text-flexoki-green shrink-0 ml-1" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function BulkActionBar({ visibleTrackIds = [], visibleItems }: BulkActionBarProps) {
  const { t } = useTranslation();
  const selectedTrackIds = useSelectionStore((s) => s.selectedTrackIds);
  const selectedItems = useSelectionStore((s) => s.selectedItems);
  const selectedCount = useSelectedTrackCount();
  const clearSelection = useSelectionStore((s) => s.clearSelection);
  const selectAllVisible = useSelectionStore((s) => s.selectAllVisible);
  const deselectAllVisible = useSelectionStore((s) => s.deselectAllVisible);

  const deleteTracksBatch = usePlayerStore((s) => s.deleteTracksBatch);
  const deleteSegmentsBatch = usePlayerStore((s) => s.deleteSegmentsBatch);
  const removePlaylistItemsBatch = usePlayerStore((s) => s.removePlaylistItemsBatch);
  const activePlaylistId = usePlayerStore((s) => s.activePlaylistId);

  const [isPlaylistOpen, setIsPlaylistOpen] = React.useState(false);
  const [isDeleting, setIsDeleting] = React.useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  // Close playlist popover on click outside or Escape
  React.useEffect(() => {
    if (!isPlaylistOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsPlaylistOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsPlaylistOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isPlaylistOpen]);

  // Global Escape clears selection when popover isn't open
  React.useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && selectedCount > 0 && !isPlaylistOpen) {
        const target = e.target as HTMLElement | null;
        const isInput = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || (target as any).isContentEditable);
        if (isInput || document.querySelector('[role="dialog"]')) return;
        clearSelection();
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [selectedCount, isPlaylistOpen, clearSelection]);

  if (selectedCount === 0) return null;

  const allVisibleSelected = isAllVisibleSelected(selectedTrackIds, visibleTrackIds);
  const hasVisible = visibleTrackIds.length > 0;

  const handleDelete = () => {
    if (isDeleting) return;
    setIsPlaylistOpen(false);
    setIsConfirmOpen(true);
  };

  const handleConfirmBulkDelete = async () => {
    if (isDeleting) return;
    setIsDeleting(true);
    let allSucceeded = true;
    try {
      const items = Array.from(selectedItems.values());
      const trackIdsToDelete: string[] = [];
      const segmentIdsToDelete: string[] = [];
      const playlistItemsToDelete = new Map<string, string[]>();

      for (const item of items) {
        if (item.type === "playlist_item") {
          const plId = item.playlistId || activePlaylistId;
          if (plId) {
            const list = playlistItemsToDelete.get(plId) || [];
            list.push(item.id);
            playlistItemsToDelete.set(plId, list);
          }
        } else if (item.type === "slice") {
          segmentIdsToDelete.push(item.segmentId || item.id);
        } else {
          trackIdsToDelete.push(item.trackId || item.id);
        }
      }

      // Delete playlist items
      for (const [plId, itemIds] of playlistItemsToDelete.entries()) {
        const ok = await removePlaylistItemsBatch(plId, itemIds);
        if (!ok) allSucceeded = false;
      }

      // Delete tracks
      if (trackIdsToDelete.length > 0) {
        const ok = await deleteTracksBatch(trackIdsToDelete);
        if (!ok) allSucceeded = false;
      }

      // Delete segments (filter out any whose parent track is already being deleted)
      const trackIdSet = new Set(trackIdsToDelete);
      const segmentParentMap = new Map(items.map((it) => [it.segmentId || it.id, it.trackId]));
      const filteredSegmentIds = segmentIdsToDelete.filter((segId) => !trackIdSet.has(segmentParentMap.get(segId) || ""));

      if (filteredSegmentIds.length > 0) {
        const ok = await deleteSegmentsBatch(filteredSegmentIds);
        if (!ok) allSucceeded = false;
      }

      if (allSucceeded) {
        clearSelection();
      }
    } catch (err) {
      console.error("[BulkActionBar] Failed to complete bulk delete:", err);
    } finally {
      setIsDeleting(false);
      setIsConfirmOpen(false);
    }
  };

  const handleToggleSelectAllVisible = () => {
    if (allVisibleSelected) {
      deselectAllVisible(visibleTrackIds);
    } else {
      if (visibleItems && visibleItems.length > 0) {
        selectAllVisible(visibleItems);
      } else {
        selectAllVisible(visibleTrackIds);
      }
    }
  };

  return (
    <>
      <aside
        ref={containerRef}
        aria-label={t("bulkActions.barLabel", "Bulk actions")}
        className="fixed bottom-24 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 sm:gap-3 rounded-2xl border border-border/80 bg-card/95 backdrop-blur-md px-3 sm:px-4 py-2 shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-200 max-w-[95vw]"
      >
      {/* Selection count badge */}
      <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-primary/10 border border-primary/20 text-xs text-primary font-medium shrink-0">
        <span className="font-mono font-bold">{selectedCount}</span>
        <span className="hidden sm:inline">{t("bulkActions.selected", "selected")}</span>
      </div>

      {/* Select All Visible toggle */}
      {hasVisible && (
        <Button
          variant="ghost"
          size="sm"
          onClick={handleToggleSelectAllVisible}
          className="h-8 text-xs gap-1.5 px-2.5 text-muted-foreground hover:text-foreground cursor-pointer"
          title={allVisibleSelected ? t("bulkActions.deselectAllVisible", "Deselect view") : t("bulkActions.selectAllVisible", "Select all in view")}
        >
          {allVisibleSelected ? (
            <>
              <CheckSquare className="h-3.5 w-3.5 text-primary" />
              <span className="hidden md:inline">{t("bulkActions.deselectAll", "Deselect view")}</span>
            </>
          ) : (
            <>
              <Square className="h-3.5 w-3.5" />
              <span className="hidden md:inline">{t("bulkActions.selectAll", "Select view")}</span>
            </>
          )}
        </Button>
      )}

      {/* Add to Playlist */}
      <div className="relative inline-flex">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setIsPlaylistOpen((prev) => !prev)}
          className="h-8 text-xs gap-1.5 px-2.5 border-primary/20 text-primary hover:bg-primary/10 cursor-pointer"
        >
          <FolderPlus className="h-3.5 w-3.5" />
          <span>{t("bulkActions.addToPlaylist", "Playlist")}</span>
        </Button>

        {isPlaylistOpen && (
          <BulkAddToPlaylistMenu
            selectedItems={Array.from(selectedItems.values())}
            onClose={() => setIsPlaylistOpen(false)}
          />
        )}
      </div>

      {/* Delete selected */}
      <Button
        variant="destructive"
        size="sm"
        onClick={handleDelete}
        disabled={isDeleting}
        className="h-8 text-xs gap-1.5 px-2.5 cursor-pointer shadow-xs"
      >
        <Trash2 className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">{t("bulkActions.delete", "Delete")}</span>
      </Button>

      {/* Clear selection */}
      <Button
        variant="ghost"
        size="icon"
        onClick={clearSelection}
        className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-secondary cursor-pointer shrink-0 ml-1"
        title={t("bulkActions.clear", "Clear selection")}
        aria-label={t("bulkActions.clear", "Clear selection")}
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </aside>

    {/* Bulk Delete Confirm Modal */}
    {isConfirmOpen && (
      <ConfirmModal
        isOpen={isConfirmOpen}
        onClose={() => !isDeleting && setIsConfirmOpen(false)}
        onConfirm={handleConfirmBulkDelete}
        isLoading={isDeleting}
        title={t("bulkActions.deleteTitle", "Delete selected items?")}
        description={t("bulkActions.confirmDelete", {
          count: selectedCount,
          defaultValue: `Are you sure you want to delete ${selectedCount} selected item(s)?`,
        })}
        confirmText={t("common.delete", "Delete")}
        cancelText={t("common.cancel", "Cancel")}
        variant="destructive"
      />
    )}
    </>
  );
}
