import * as React from "react";
import { useTranslation } from "react-i18next";
import { useFormatNumber } from "../../hooks/use-format-number";
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
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "../ui/context-menu";
import { LibrarySearch } from "./LibrarySearch";
import { SidebarUtilities } from "./SidebarUtilities";
import { DeletePlaylistModal } from "../DeletePlaylistModal";
import { NowPlayingEqualizer } from "../NowPlayingEqualizer";
import { PlaylistCover } from "../PlaylistCover";
import { usePlayerStore, type SystemCategory } from "../../store/usePlayerStore";
import { resolvePlaylistCover } from "../../lib/playlistCover";
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
  const formatNumber = useFormatNumber();
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
      {/* Scrolling past the end of the playlists doesn't carry on into the library */}
      <SidebarContent className="overscroll-contain">
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
                  <SidebarMenuBadge>{formatNumber(category.count)}</SidebarMenuBadge>
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
              <SidebarMenuBadge>{formatNumber(playlists.length)}</SidebarMenuBadge>
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
// carries its own tooltip, actions menu and context menu
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
  const isRenamingRef = React.useRef(false);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const focusAfterRenameRef = React.useRef(false);
  const isEmpty = (playlist.item_count || 0) === 0;
  const Icon = playlist.is_mix ? Combine : ListMusic;
  const hasArtwork = resolvePlaylistCover(playlist).kind !== "empty";

  const startRename = () => {
    isRenamingRef.current = true;
    setDraftName(playlist.name);
  };

  // Finished from the keyboard, a rename hands focus back to the playlist, as in Finder
  const endRename = (focusPlaylist: boolean) => {
    isRenamingRef.current = false;
    focusAfterRenameRef.current = focusPlaylist;
    setDraftName(null);
  };

  const commitRename = (focusPlaylist: boolean) => {
    if (draftName === null) return;
    const name = draftName.trim();
    endRename(focusPlaylist);
    if (name && name !== playlist.name) void renamePlaylist(playlist.id, name);
  };

  React.useEffect(() => {
    if (draftName !== null || !focusAfterRenameRef.current) return;
    focusAfterRenameRef.current = false;
    buttonRef.current?.focus();
  }, [draftName]);

  if (draftName !== null) {
    return (
      <SidebarMenuItem>
        <SidebarInput
          autoFocus
          value={draftName}
          maxLength={100}
          aria-label={t("playlist.renameAria")}
          onChange={(e) => setDraftName(e.target.value)}
          onBlur={() => commitRename(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitRename(true);
            } else if (e.key === "Escape") {
              // Escape cancels the rename only; on a phone it would also close the sidebar sheet
              e.preventDefault();
              e.stopPropagation();
              endRename(true);
            }
          }}
        />
      </SidebarMenuItem>
    );
  }

  // What both its "..." button and a right-click open, as in Apple Music's sidebar
  const actions = (
    <>
      <DropdownMenuGroup>
        <DropdownMenuItem disabled={isEmpty} onClick={() => buildPlaylistQueue(playlist.id, true)}>
          <Shuffle />
          {t("nav.shuffle")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={startRename}>
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
    </>
  );
  // Choosing Rename swaps the button that opened the menu for the name field, which focuses itself. The menu mustn't
  // move focus as it goes: with its button gone it would fall back to whatever it last saw focused, blurring the field
  // and ending the rename.
  const keepFocusWhileRenaming = () => !isRenamingRef.current;

  return (
    <SidebarMenuItem>
      {/* The button itself is the context menu's trigger, so it stays the sibling the action and badge style against */}
      <ContextMenu>
        <SidebarMenuButton
          ref={buttonRef}
          render={<ContextMenuTrigger render={<button type="button" />} />}
          size={size}
          isActive={isActive}
          tooltip={playlist.name}
          onClick={() => onOpen(playlist.id)}
        >
          {nowPlaying ? (
            <NowPlayingEqualizer isAnimated={nowPlaying === "playing"} className="w-4 justify-center text-primary" />
          ) : hasArtwork ? (
            // Each playlist's artwork, as in Apple Music's sidebar. Drawn at 20px in an icon's 16px box, so names
            // line up with the icon rows and the artwork stays centred when the sidebar collapses to icons.
            <PlaylistCover playlist={playlist} thumbnailSize="small" className="-m-0.5 size-5 shrink-0 rounded-sm" />
          ) : (
            <Icon className="text-primary" />
          )}
          <span>{playlist.name}</span>
        </SidebarMenuButton>
        <ContextMenuContent className="w-auto" finalFocus={keepFocusWhileRenaming}>
          {actions}
        </ContextMenuContent>
      </ContextMenu>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<SidebarMenuAction showOnHover aria-label={t("sidebar.playlistActions", { name: playlist.name })} />}
        >
          <MoreHorizontal />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start" className="w-auto" finalFocus={keepFocusWhileRenaming}>
          {actions}
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
});
