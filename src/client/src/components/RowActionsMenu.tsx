import * as React from "react";
import { Menu } from "@base-ui/react/menu";
import { Check, FolderPlus, Link2, MoreHorizontal, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { AddToPlaylistItems, CreatePlaylistAndAddModal } from "./AddToPlaylistPopover";
import { copyToClipboard } from "../lib/clipboard";
import type { Track } from "@/server/types";

// Long enough to read "Copied link!" before the menu closes
const COPIED_CLOSE_DELAY_MS = 900;

interface RowActionsMenuProps {
  // Names the row in the trigger's accessible label
  name: string;
  track?: Track | null;
  segmentId?: string | null;
  canAddToPlaylist: boolean;
  disabled?: boolean;
  deleteLabel?: string;
  onDelete?: () => void;
  // Actions that sit inline in the row on wider screens; phones list them first in the menu
  children?: React.ReactNode;
}

// What a row hands the shared menu when its "..." button opens it
type RowActionsPayload = Omit<RowActionsMenuProps, "disabled">;

const RowActionsMenuContext = React.createContext<Menu.Handle<RowActionsPayload> | null>(null);

// One "..." menu for every row and card. Each row renders only a detached trigger that passes its row as `payload`,
// so a table or grid mounts a single Base UI menu instead of one per row.
export function RowActionsMenuProvider({ children }: { children: React.ReactNode }) {
  const [handle] = React.useState(() => Menu.createHandle<RowActionsPayload>());
  const [copied, setCopied] = React.useState(false);
  const [createFor, setCreateFor] = React.useState<{ trackId: string; segmentId?: string | null } | null>(null);
  const closeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  const copyLink = async (link: string) => {
    if (!(await copyToClipboard(link))) return;
    setCopied(true);
    closeTimerRef.current = setTimeout(() => handle.close(), COPIED_CLOSE_DELAY_MS);
  };

  return (
    <RowActionsMenuContext.Provider value={handle}>
      {children}
      <DropdownMenu
        handle={handle}
        onOpenChange={(open) => {
          if (open) setCopied(false);
        }}
      >
        {({ payload }) =>
          payload ? (
            <RowActionsMenuContent
              {...payload}
              copied={copied}
              onCopyLink={(link) => void copyLink(link)}
              onCreatePlaylist={(trackId, segmentId) => {
                handle.close();
                setCreateFor({ trackId, segmentId });
              }}
            />
          ) : null
        }
      </DropdownMenu>
      {createFor && (
        <CreatePlaylistAndAddModal
          isOpen
          onClose={() => setCreateFor(null)}
          trackId={createFor.trackId}
          segmentId={createFor.segmentId}
        />
      )}
    </RowActionsMenuContext.Provider>
  );
}

interface RowActionsMenuContentProps extends RowActionsPayload {
  copied: boolean;
  onCopyLink: (link: string) => void;
  onCreatePlaylist: (trackId: string, segmentId?: string | null) => void;
}

function RowActionsMenuContent({
  track,
  segmentId,
  canAddToPlaylist,
  deleteLabel,
  onDelete,
  children,
  copied,
  onCopyLink,
  onCreatePlaylist,
}: RowActionsMenuContentProps) {
  const { t } = useTranslation();
  const youtubeLink = track?.source_type === "youtube" ? track.source_uri : undefined;
  const showAddToPlaylist = Boolean(track) && canAddToPlaylist;

  return (
    <DropdownMenuContent align="end" className="w-52">
      {children && (
        <>
          <DropdownMenuGroup>{children}</DropdownMenuGroup>
          {(showAddToPlaylist || youtubeLink) && <DropdownMenuSeparator />}
        </>
      )}
      {(showAddToPlaylist || youtubeLink) && (
        <DropdownMenuGroup>
          {track && showAddToPlaylist && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <FolderPlus />
                {t("addToPlaylist.title")}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-56">
                <AddToPlaylistItems
                  trackId={track.id}
                  segmentId={segmentId}
                  onCreatePlaylist={() => onCreatePlaylist(track.id, segmentId)}
                />
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          {youtubeLink && (
            <DropdownMenuItem closeOnClick={false} onClick={() => onCopyLink(youtubeLink)}>
              {copied ? <Check /> : <Link2 />}
              {copied ? t("trackCard.copiedLink", "Copied link!") : t("trackCard.copyLink", "Copy YouTube link")}
            </DropdownMenuItem>
          )}
        </DropdownMenuGroup>
      )}
      {onDelete && (
        <>
          {(children || showAddToPlaylist || youtubeLink) && <DropdownMenuSeparator />}
          <DropdownMenuGroup>
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              <Trash2 />
              {deleteLabel}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </>
      )}
    </DropdownMenuContent>
  );
}

// Apple Music style "..." button for a row's secondary actions; the menu itself lives in RowActionsMenuProvider
export function RowActionsMenu({ disabled, ...payload }: RowActionsMenuProps) {
  const { t } = useTranslation();
  const handle = React.useContext(RowActionsMenuContext);
  if (!handle) throw new Error("RowActionsMenu must be rendered inside a RowActionsMenuProvider");

  const { name, track, canAddToPlaylist, onDelete, children } = payload;
  const hasYoutubeLink = track?.source_type === "youtube";
  if (!children && !(track && canAddToPlaylist) && !hasYoutubeLink && !onDelete) return null;

  const label = t("table.moreActions", { name, defaultValue: `More options for ${name}` });
  return (
    <DropdownMenuTrigger
      handle={handle}
      payload={payload}
      disabled={disabled}
      aria-label={label}
      title={label}
      render={<Button variant="ghost" size="icon-sm" />}
    >
      <MoreHorizontal />
    </DropdownMenuTrigger>
  );
}
