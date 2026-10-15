import * as React from "react";
import { FolderPlus, Loader2, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { usePlayerStore } from "../store/usePlayerStore";
import { getHierarchicalPlaylists } from "../lib/playlistHierarchy";
const CreatePlaylistModal = React.lazy(() => import("./CreatePlaylistModal").then((m) => ({ default: m.CreatePlaylistModal })));

// Which playlists already hold this track or slice, as playlist id -> playlist item id. It fetches on
// mount, and menu content only mounts while open, so closed menus never hit the network.
function usePlaylistMemberships(trackId: string, segmentId?: string | null) {
  const addToPlaylist = usePlayerStore((s) => s.addToPlaylist);
  const removeFromPlaylist = usePlayerStore((s) => s.removeFromPlaylist);
  const [memberships, setMemberships] = React.useState<Record<string, string>>({});
  const [loading, setLoading] = React.useState(true);
  const [busyPlaylistId, setBusyPlaylistId] = React.useState<string | null>(null);
  const isMountedRef = React.useRef(true);

  const fetchMemberships = React.useCallback(async (signal?: AbortSignal) => {
    try {
      setLoading(true);
      const url = `/api/playlist-memberships?track_id=${encodeURIComponent(trackId)}${
        segmentId ? `&segment_id=${encodeURIComponent(segmentId)}` : ""
      }`;
      const res = await fetch(url, { signal });
      if (res.ok && isMountedRef.current) {
        const data: unknown = await res.json();
        const map: Record<string, string> = {};
        if (Array.isArray(data)) {
          for (const item of data) {
            if (item?.playlist_id && item?.item_id) {
              map[item.playlist_id] = item.item_id;
            }
          }
        }
        setMemberships(map);
      }
    } catch (e) {
      if (!(e instanceof Error && e.name === "AbortError")) {
        console.error("Failed to fetch playlist memberships:", e);
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [trackId, segmentId]);

  React.useEffect(() => {
    isMountedRef.current = true;
    const abortController = new AbortController();
    void fetchMemberships(abortController.signal);
    return () => {
      isMountedRef.current = false;
      abortController.abort();
    };
  }, [fetchMemberships]);

  const toggle = async (playlistId: string) => {
    if (busyPlaylistId) return;
    setBusyPlaylistId(playlistId);
    try {
      const existingItemId = memberships[playlistId];
      const ok = existingItemId
        ? await removeFromPlaylist(playlistId, existingItemId)
        : await addToPlaylist(playlistId, trackId, segmentId || null);
      if (ok && isMountedRef.current) {
        await fetchMemberships();
      }
    } catch (e) {
      console.error("Failed to toggle playlist item:", e);
    } finally {
      if (isMountedRef.current) {
        setBusyPlaylistId(null);
      }
    }
  };

  return { memberships, loading, busyPlaylistId, toggle };
}

interface AddToPlaylistItemsProps {
  trackId: string;
  segmentId?: string | null;
  onCreatePlaylist: () => void;
}

// Menu items for adding a track or slice to playlists, for this menu and for row action submenus
export function AddToPlaylistItems({ trackId, segmentId, onCreatePlaylist }: AddToPlaylistItemsProps) {
  const { t } = useTranslation();
  const allPlaylists = usePlayerStore((s) => s.playlists);
  const orderedPlaylists = React.useMemo(
    () => getHierarchicalPlaylists(allPlaylists, { excludeMixes: true }),
    [allPlaylists]
  );
  const { memberships, loading, busyPlaylistId, toggle } = usePlaylistMemberships(trackId, segmentId);

  return (
    <>
      <DropdownMenuGroup>
        <DropdownMenuLabel>
          {t("addToPlaylist.title")}
          {loading && <Loader2 className="ml-1.5 inline animate-spin" />}
        </DropdownMenuLabel>
        <DropdownMenuItem onClick={onCreatePlaylist}>
          <Plus />
          {t("addToPlaylist.newPlaylist", "New Playlist")}
        </DropdownMenuItem>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      {orderedPlaylists.length === 0 ? (
        <DropdownMenuLabel>{t("addToPlaylist.empty")}</DropdownMenuLabel>
      ) : (
        <DropdownMenuGroup className="max-h-60 overflow-y-auto">
          {orderedPlaylists.map(({ playlist, isChild }) => (
            <DropdownMenuCheckboxItem
              key={playlist.id}
              // data-inset styles on presence, so leave it off rather than false
              inset={isChild || undefined}
              checked={Boolean(memberships[playlist.id])}
              onCheckedChange={() => void toggle(playlist.id)}
              disabled={Boolean(busyPlaylistId)}
            >
              {isChild && (
                <span aria-hidden="true" className="text-muted-foreground">
                  ↳
                </span>
              )}
              <span className="truncate">{playlist.name}</span>
              {busyPlaylistId === playlist.id && <Loader2 className="animate-spin" />}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
      )}
    </>
  );
}

interface CreatePlaylistAndAddModalProps {
  isOpen: boolean;
  onClose: () => void;
  trackId: string;
  segmentId?: string | null;
}

// "New Playlist" from an add-to-playlist menu: create the playlist, then add the track or slice to it
export function CreatePlaylistAndAddModal({ isOpen, onClose, trackId, segmentId }: CreatePlaylistAndAddModalProps) {
  const addToPlaylist = usePlayerStore((s) => s.addToPlaylist);
  if (!isOpen) return null;
  return (
    <React.Suspense fallback={null}>
      <CreatePlaylistModal
        isOpen
        onClose={onClose}
        onCreated={async (newId) => {
          onClose();
          await addToPlaylist(newId, trackId, segmentId || null);
        }}
      />
    </React.Suspense>
  );
}

// Menu events bubble through the React tree out of the portal; keep them from reaching the card or row
const stopPropagation = (e: React.SyntheticEvent) => e.stopPropagation();

export interface AddToPlaylistPopoverProps {
  trackId: string;
  segmentId?: string | null;
  disabled?: boolean;
}

// Icon button that opens a menu of playlists to add the track or slice to
export const AddToPlaylistPopover = React.memo(function AddToPlaylistPopover({
  trackId,
  segmentId,
  disabled = false,
}: AddToPlaylistPopoverProps) {
  const { t } = useTranslation();
  const [isCreateModalOpen, setIsCreateModalOpen] = React.useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={disabled}
          onClick={stopPropagation}
          title={t("addToPlaylist.title")}
          aria-label={t("addToPlaylist.title")}
          render={<Button variant="ghost" size="icon" />}
        >
          <FolderPlus />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56" onClick={stopPropagation} onKeyDown={stopPropagation}>
          <AddToPlaylistItems
            trackId={trackId}
            segmentId={segmentId}
            onCreatePlaylist={() => setIsCreateModalOpen(true)}
          />
        </DropdownMenuContent>
      </DropdownMenu>

      <CreatePlaylistAndAddModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        trackId={trackId}
        segmentId={segmentId}
      />
    </>
  );
});
