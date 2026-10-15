import * as React from "react";
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

// Apple Music style "..." menu with a row's secondary actions
export function RowActionsMenu({
  name,
  track,
  segmentId,
  canAddToPlaylist,
  disabled,
  deleteLabel,
  onDelete,
  children,
}: RowActionsMenuProps) {
  const { t } = useTranslation();
  const [open, setOpen] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = React.useState(false);
  const closeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  const youtubeLink = track?.source_type === "youtube" ? track.source_uri : undefined;
  const showAddToPlaylist = Boolean(track) && canAddToPlaylist;
  if (!children && !showAddToPlaylist && !youtubeLink && !onDelete) return null;

  const copyLink = async () => {
    if (!youtubeLink || !(await copyToClipboard(youtubeLink))) return;
    setCopied(true);
    closeTimerRef.current = setTimeout(() => setOpen(false), COPIED_CLOSE_DELAY_MS);
  };

  const label = t("table.moreActions", { name, defaultValue: `More options for ${name}` });

  return (
    <>
      <DropdownMenu
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (nextOpen) setCopied(false);
        }}
      >
        <DropdownMenuTrigger
          disabled={disabled}
          aria-label={label}
          title={label}
          render={<Button variant="ghost" size="icon-sm" />}
        >
          <MoreHorizontal />
        </DropdownMenuTrigger>
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
                      onCreatePlaylist={() => {
                        setOpen(false);
                        setIsCreateModalOpen(true);
                      }}
                    />
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}
              {youtubeLink && (
                <DropdownMenuItem closeOnClick={false} onClick={() => void copyLink()}>
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
      </DropdownMenu>

      {track && (
        <CreatePlaylistAndAddModal
          isOpen={isCreateModalOpen}
          onClose={() => setIsCreateModalOpen(false)}
          trackId={track.id}
          segmentId={segmentId}
        />
      )}
    </>
  );
}
