import * as React from "react";
import { FolderPlus, Trash2, X, Check, CheckSquare, Square, Plus } from "lucide-react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { ConfirmModal } from "./ConfirmModal";
const CreatePlaylistModal = React.lazy(() => import("./CreatePlaylistModal").then((m) => ({ default: m.CreatePlaylistModal })));
import { useTranslation } from "react-i18next";
import { usePlayerStore } from "../store/usePlayerStore";
import { getHierarchicalPlaylists } from "../lib/playlistHierarchy";
import { cn } from "../lib/utils";
import { isDialogOpen } from "../lib/dialog";
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

const mapItemsToBatchPayload = (items: SelectedItem[]) =>
  items.map((item) => ({
    track_id: item.trackId,
    segment_id: item.segmentId || (item.type === "slice" ? item.id : null),
  }));

// Long enough to read the check mark before the menu closes
const ADDED_CLOSE_DELAY_MS = 600;

// Adds every selected item to the picked playlist. Mixes take their songs from their sources, so they are left out.
function BulkAddToPlaylistMenu({
  selectedItems,
  onCreatePlaylist,
}: {
  selectedItems: SelectedItem[];
  onCreatePlaylist: () => void;
}) {
  const { t } = useTranslation();
  const allPlaylists = usePlayerStore((s) => s.playlists);
  const orderedPlaylists = React.useMemo(() => {
    return getHierarchicalPlaylists(allPlaylists, { excludeMixes: true });
  }, [allPlaylists]);
  const addTracksToPlaylistBatch = usePlayerStore((s) => s.addTracksToPlaylistBatch);
  const [open, setOpen] = React.useState(false);
  const [addedTo, setAddedTo] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const closeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  const addToPlaylist = async (playlistId: string) => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      if (!(await addTracksToPlaylistBatch(playlistId, mapItemsToBatchPayload(selectedItems)))) {
        setIsSubmitting(false);
        return;
      }
      setAddedTo(playlistId);
      closeTimerRef.current = setTimeout(() => {
        setIsSubmitting(false);
        setOpen(false);
      }, ADDED_CLOSE_DELAY_MS);
    } catch {
      setIsSubmitting(false);
    }
  };

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) setAddedTo(null);
      }}
    >
      <DropdownMenuTrigger render={<Button variant="outline" size="lg" />}>
        <FolderPlus data-icon="inline-start" />
        {t("bulkActions.addToPlaylist", "Playlist")}
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("addToPlaylist.title", "Add to Playlist")}</DropdownMenuLabel>
          <DropdownMenuItem onClick={onCreatePlaylist}>
            <Plus />
            {t("addToPlaylist.newPlaylist", "New Playlist")}
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {orderedPlaylists.length === 0 ? (
            <DropdownMenuItem disabled>{t("addToPlaylist.empty", "No playlists yet")}</DropdownMenuItem>
          ) : (
            orderedPlaylists.map(({ playlist, isChild }) => (
              <DropdownMenuItem
                key={playlist.id}
                inset={isChild || undefined}
                closeOnClick={false}
                onClick={() => void addToPlaylist(playlist.id)}
              >
                {isChild && (
                  <span aria-hidden="true" className="text-muted-foreground">
                    ↳
                  </span>
                )}
                <span className="truncate">{playlist.name}</span>
                {addedTo === playlist.id && <Check className="ml-auto text-flexoki-green" />}
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
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
  const addTracksToPlaylistBatch = usePlayerStore((s) => s.addTracksToPlaylistBatch);
  const activePlaylistId = usePlayerStore((s) => s.activePlaylistId);
  const isMixView = usePlayerStore((s) => Boolean(s.playlists.find((p) => p.id === s.activePlaylistId)?.is_mix));

  const [isCreateModalOpen, setIsCreateModalOpen] = React.useState(false);
  const [isDeleting, setIsDeleting] = React.useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = React.useState(false);

  // Global Escape clears the selection; open menus and dialogs keep their Escape to themselves
  React.useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && selectedCount > 0) {
        const target = e.target as HTMLElement | null;
        const isInput = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || (target as any).isContentEditable);
        if (isInput || isDialogOpen()) return;
        clearSelection();
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [selectedCount, clearSelection]);

  const [isRendered, setIsRendered] = React.useState(selectedCount > 0);
  const [isExiting, setIsExiting] = React.useState(false);

  React.useEffect(() => {
    if (selectedCount > 0) {
      setIsRendered(true);
      setIsExiting(false);
    } else if (isRendered) {
      setIsExiting(true);
      const timer = setTimeout(() => {
        setIsRendered(false);
        setIsExiting(false);
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [selectedCount, isRendered]);

  if (selectedCount === 0 && !isRendered) return null;

  const allVisibleSelected = isAllVisibleSelected(selectedTrackIds, visibleTrackIds);
  const hasVisible = visibleTrackIds.length > 0;

  const handleDelete = () => {
    if (isDeleting) return;
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
      <div className="fixed bottom-24 inset-x-0 z-40 flex justify-center pointer-events-none px-4">
        <aside
          aria-label={t("bulkActions.barLabel", "Bulk actions")}
          className={cn(
            "pointer-events-auto flex items-center gap-2 sm:gap-3 rounded-2xl border border-border/80 bg-card/95 backdrop-blur-md px-3 sm:px-4 py-2 shadow-2xl duration-150 max-w-[95vw]",
            isExiting ? "animate-out fade-out slide-out-to-bottom-4 pointer-events-none" : "animate-in fade-in slide-in-from-bottom-4"
          )}
        >
        {/* Selection count badge */}
        <Badge className="shrink-0">
          <span key={selectedCount} className="font-mono font-bold inline-block animate-in zoom-in-75 duration-100 motion-reduce:animate-none">{selectedCount}</span>
          <span className="hidden sm:inline">{t("bulkActions.selected", "selected")}</span>
        </Badge>

        {/* Select All Visible toggle */}
        {hasVisible && (
          <Button
            variant="ghost"
            size="lg"
            onClick={handleToggleSelectAllVisible}
            title={allVisibleSelected ? t("bulkActions.deselectAllVisible", "Deselect view") : t("bulkActions.selectAllVisible", "Select all in view")}
          >
            {allVisibleSelected ? (
              <>
                <CheckSquare data-icon="inline-start" className="text-primary" />
                <span className="hidden md:inline">{t("bulkActions.deselectAll", "Deselect view")}</span>
              </>
            ) : (
              <>
                <Square data-icon="inline-start" />
                <span className="hidden md:inline">{t("bulkActions.selectAll", "Select view")}</span>
              </>
            )}
          </Button>
        )}

        <BulkAddToPlaylistMenu
          selectedItems={Array.from(selectedItems.values())}
          onCreatePlaylist={() => setIsCreateModalOpen(true)}
        />

        {/* Delete selected */}
        {!isMixView && (
          <Button variant="destructive" size="lg" onClick={handleDelete} disabled={isDeleting}>
            <Trash2 data-icon="inline-start" />
            <span className="hidden sm:inline">{t("bulkActions.delete", "Delete")}</span>
          </Button>
        )}

        {/* Clear selection */}
        <Button
          variant="ghost"
          size="icon-lg"
          onClick={clearSelection}
          title={t("bulkActions.clear", "Clear selection")}
          aria-label={t("bulkActions.clear", "Clear selection")}
        >
          <X />
        </Button>
      </aside>
    </div>

    {/* Bulk Delete Confirm Modal */}
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

    {/* Create Playlist Modal */}
    {isCreateModalOpen && (
      <React.Suspense fallback={null}>
        <CreatePlaylistModal
          isOpen={isCreateModalOpen}
          onClose={() => setIsCreateModalOpen(false)}
          onCreated={async (newId) => {
            setIsCreateModalOpen(false);
            const payload = mapItemsToBatchPayload(Array.from(selectedItems.values()));
            await addTracksToPlaylistBatch(newId, payload);
          }}
        />
      </React.Suspense>
    )}
    </>

  );
}
