import * as React from "react";
import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  Combine,
  Disc,
  LibraryBig,
  ListMusic,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Scissors,
  Shuffle,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarRail,
} from "../ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { LibrarySearch } from "./LibrarySearch";
import { SidebarUtilities } from "./SidebarUtilities";
import { DeletePlaylistModal } from "../DeletePlaylistModal";
import { NowPlayingEqualizer } from "../NowPlayingEqualizer";
import { usePlayerStore, type SystemCategory } from "../../store/usePlayerStore";
import { cn } from "../../lib/utils";
import type { Playlist } from "@/server/types";

type SidebarPlaylist = Playlist & { item_count?: number };

interface PlaylistNode {
  playlist: SidebarPlaylist;
  children: SidebarPlaylist[];
}

// Sub-playlists sit under their parent; ones whose parent is gone become top-level.
function buildPlaylistTree(playlists: SidebarPlaylist[]): PlaylistNode[] {
  const ids = new Set(playlists.map((pl) => pl.id));
  const childrenByParent = new Map<string, SidebarPlaylist[]>();
  for (const pl of playlists) {
    if (pl.parent_id && ids.has(pl.parent_id)) {
      childrenByParent.set(pl.parent_id, [...(childrenByParent.get(pl.parent_id) ?? []), pl]);
    }
  }
  return playlists
    .filter((pl) => !pl.parent_id || !ids.has(pl.parent_id))
    .map((pl) => ({ playlist: pl, children: childrenByParent.get(pl.id) ?? [] }));
}

interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onCreatePlaylist: () => void;
  onOpenShortcuts: () => void;
}

export function AppSidebar({ searchQuery, onSearchChange, onCreatePlaylist, onOpenShortcuts, ...props }: AppSidebarProps) {
  const { t } = useTranslation();
  const tracks = usePlayerStore((s) => s.tracks);
  const playlists = usePlayerStore((s) => s.playlists);
  const activePlaylistId = usePlayerStore((s) => s.activePlaylistId);
  const activeSystemCategory = usePlayerStore((s) => s.activeSystemCategory);
  const setActiveSystemCategory = usePlayerStore((s) => s.setActiveSystemCategory);
  const setActivePlaylist = usePlayerStore((s) => s.setActivePlaylist);
  const deletePlaylist = usePlayerStore((s) => s.deletePlaylist);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const hasActiveTrack = usePlayerStore((s) => Boolean(s.activeTrack));
  const playingPlaylistId = usePlayerStore((s) => s.activePlaylistPlayingId);
  const playbackMode = usePlayerStore((s) => s.playbackMode);

  const [playlistToDelete, setPlaylistToDelete] = React.useState<Playlist | null>(null);
  const [isDeleting, setIsDeleting] = React.useState(false);

  const counts = React.useMemo(() => {
    let slices = 0;
    let originals = 0;
    let downloading = 0;
    let errors = 0;
    for (const track of tracks) {
      if (track.status === "ready") {
        slices += track.segment_count || 0;
        originals++;
      }
      if (track.status === "downloading" || track.status === "queued") {
        downloading++;
        originals++;
      }
      if (track.status === "error") errors++;
    }
    return { mixed: slices + originals, slices, originals, downloading, errors };
  }, [tracks]);

  const categories: { id: SystemCategory; label: string; icon: LucideIcon; count: number }[] = [
    { id: "mixed", label: t("categories.mixed"), icon: Shuffle, count: counts.mixed },
    { id: "slices_only", label: t("categories.slices"), icon: Scissors, count: counts.slices },
    { id: "original_only", label: t("categories.tracks"), icon: Disc, count: counts.originals },
    { id: "downloading_only", label: t("categories.downloading"), icon: Loader2, count: counts.downloading },
    { id: "error_only", label: t("categories.errors"), icon: AlertCircle, count: counts.errors },
  ];

  const tree = React.useMemo(() => buildPlaylistTree(playlists), [playlists]);
  const isPlaylistsOverview = activePlaylistId === null && activeSystemCategory === "playlists";

  const handleConfirmDelete = async (keepChildren: boolean) => {
    if (!playlistToDelete || isDeleting) return;
    setIsDeleting(true);
    try {
      await deletePlaylist(playlistToDelete.id, keepChildren);
      setPlaylistToDelete(null);
    } finally {
      setIsDeleting(false);
    }
  };

  const renderPlaylist = (playlist: SidebarPlaylist, size: "default" | "sm") => (
    <PlaylistMenuItem
      key={playlist.id}
      playlist={playlist}
      size={size}
      isActive={activePlaylistId === playlist.id}
      nowPlaying={hasActiveTrack && playingPlaylistId === playlist.id ? (isPlaying ? "playing" : "paused") : null}
      onOpen={setActivePlaylist}
      onDelete={setPlaylistToDelete}
    />
  );

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <LibrarySearch value={searchQuery} onChange={onSearchChange} />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>{t("playlist.systemHeader")}</SidebarGroupLabel>
          <SidebarMenu>
            {categories.map((category) => {
              const isNowPlaying = hasActiveTrack && playingPlaylistId === null && playbackMode === category.id;
              const Icon = category.icon;
              return (
                <SidebarMenuItem key={category.id}>
                  <SidebarMenuButton
                    isActive={activePlaylistId === null && activeSystemCategory === category.id}
                    tooltip={category.label}
                    onClick={() => setActiveSystemCategory(category.id)}
                  >
                    {isNowPlaying ? (
                      <NowPlayingEqualizer isAnimated={isPlaying} className="w-4 justify-center text-primary" />
                    ) : (
                      <Icon className={cn("text-primary", category.id === "downloading_only" && counts.downloading > 0 && "animate-spin")} />
                    )}
                    <span>{category.label}</span>
                  </SidebarMenuButton>
                  <SidebarMenuBadge>{category.count}</SidebarMenuBadge>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>{t("playlist.customHeader")}</SidebarGroupLabel>
          <SidebarGroupAction aria-label={t("library.newPlaylist")} title={t("library.newPlaylist")} onClick={onCreatePlaylist}>
            <Plus />
          </SidebarGroupAction>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={isPlaylistsOverview}
                tooltip={t("sidebar.allPlaylists")}
                onClick={() => setActiveSystemCategory("playlists")}
              >
                <LibraryBig className="text-primary" />
                <span>{t("sidebar.allPlaylists")}</span>
              </SidebarMenuButton>
              <SidebarMenuBadge>{playlists.length}</SidebarMenuBadge>
            </SidebarMenuItem>
            {tree.map(({ playlist, children }) => (
              <React.Fragment key={playlist.id}>
                {renderPlaylist(playlist, "default")}
                {children.length > 0 && (
                  <SidebarMenuItem>
                    <SidebarMenuSub>{children.map((child) => renderPlaylist(child, "sm"))}</SidebarMenuSub>
                  </SidebarMenuItem>
                )}
              </React.Fragment>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarUtilities onOpenShortcuts={onOpenShortcuts} />
      </SidebarFooter>
      <SidebarRail />

      {playlistToDelete && (
        <DeletePlaylistModal
          isOpen
          onClose={() => !isDeleting && setPlaylistToDelete(null)}
          playlist={playlistToDelete}
          onConfirm={handleConfirmDelete}
        />
      )}
    </Sidebar>
  );
}

interface PlaylistMenuItemProps {
  playlist: SidebarPlaylist;
  size: "default" | "sm";
  isActive: boolean;
  nowPlaying: "playing" | "paused" | null;
  onOpen: (playlistId: string) => void;
  onDelete: (playlist: SidebarPlaylist) => void;
}

// Memoized with stable props: the sidebar re-renders on every keystroke in its search field, and each item
// carries its own tooltip and actions menu
const PlaylistMenuItem = React.memo(function PlaylistMenuItem({
  playlist,
  size,
  isActive,
  nowPlaying,
  onOpen,
  onDelete,
}: PlaylistMenuItemProps) {
  const { t } = useTranslation();
  const renamePlaylist = usePlayerStore((s) => s.renamePlaylist);
  const buildPlaylistQueue = usePlayerStore((s) => s.buildPlaylistQueue);
  const [draftName, setDraftName] = React.useState<string | null>(null);
  const renameInputRef = React.useRef<HTMLInputElement>(null);
  const isEmpty = (playlist.item_count || 0) === 0;
  const Icon = playlist.is_mix ? Combine : ListMusic;

  const commitRename = () => {
    if (draftName === null) return;
    const name = draftName.trim();
    setDraftName(null);
    if (name && name !== playlist.name) void renamePlaylist(playlist.id, name);
  };

  if (draftName !== null) {
    return (
      <SidebarMenuItem>
        <SidebarInput
          ref={renameInputRef}
          autoFocus
          value={draftName}
          maxLength={100}
          aria-label={t("playlist.renameAria")}
          onChange={(e) => setDraftName(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitRename();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setDraftName(null);
            }
          }}
        />
      </SidebarMenuItem>
    );
  }

  return (
    <SidebarMenuItem>
      <SidebarMenuButton size={size} isActive={isActive} tooltip={playlist.name} onClick={() => onOpen(playlist.id)}>
        {nowPlaying ? (
          <NowPlayingEqualizer isAnimated={nowPlaying === "playing"} className="w-4 justify-center text-primary" />
        ) : (
          <Icon className="text-primary" />
        )}
        <span>{playlist.name}</span>
      </SidebarMenuButton>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<SidebarMenuAction showOnHover aria-label={t("sidebar.playlistActions", { name: playlist.name })} />}
        >
          <MoreHorizontal />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start" className="w-auto" finalFocus={() => renameInputRef.current ?? true}>
          <DropdownMenuGroup>
            <DropdownMenuItem disabled={isEmpty} onClick={() => buildPlaylistQueue(playlist.id, true)}>
              <Shuffle />
              {t("nav.shuffle")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setDraftName(playlist.name)}>
              <Pencil />
              {t("playlist.rename")}
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem variant="destructive" onClick={() => onDelete(playlist)}>
              <Trash2 />
              {t("playlist.delete")}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
});
