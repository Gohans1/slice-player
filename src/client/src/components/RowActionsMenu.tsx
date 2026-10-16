import * as React from "react";
import { Menu } from "@base-ui/react/menu";
import { Check, FolderPlus, Link2, MoreHorizontal, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui/button";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "./ui/context-menu";
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

// What a row hands the shared menus: the "..." menu when its button opens it, the context menu when it's right-clicked
type RowActionsPayload = Omit<RowActionsMenuProps, "disabled">;

// The rows and tiles a right-click opens the menu of; each holds one RowActionsMenu
const ROW_SELECTOR = '[role="row"], [data-slot="media-tile"]';

// The actions of the rows on screen, by the id their "..." button carries, so one context menu can open any row's
// actions; and which row's context menu is open, so that row can show it
function createRowRegistry() {
  const rows = new Map<string, { payload: RowActionsPayload; disabled: boolean }>();
  const listeners = new Set<() => void>();
  let contextMenuRowId: string | null = null;
  return {
    rows,
    getContextMenuRowId: () => contextMenuRowId,
    setContextMenuRowId: (id: string | null) => {
      contextMenuRowId = id;
      for (const listener of listeners) listener();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

interface RowActionsMenuContextValue {
  handle: Menu.Handle<RowActionsPayload>;
  registry: ReturnType<typeof createRowRegistry>;
  onCreatePlaylist: (trackId: string, segmentId?: string | null) => void;
}

const RowActionsMenuContext = React.createContext<RowActionsMenuContextValue | null>(null);

function useRowActionsMenuContext() {
  const context = React.useContext(RowActionsMenuContext);
  if (!context) throw new Error("Row menus must be rendered inside a RowActionsMenuProvider");
  return context;
}

// "Copy YouTube link" turns into "Copied link!", then closes the menu. A menu shared by rows counts its opens, closes
// and moves to another row, so a copy started for one row checks it before touching whichever row the menu shows by
// the time the copy finishes.
function useCopyLinkThenClose(close: () => void) {
  const [copied, setCopied] = React.useState(false);
  const closeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const openingRef = React.useRef(0);

  const clearCloseTimer = () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  };

  React.useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  const copyLink = async (link: string) => {
    const opening = openingRef.current;
    if (!(await copyToClipboard(link)) || opening !== openingRef.current) return;
    setCopied(true);
    clearCloseTimer();
    closeTimerRef.current = setTimeout(close, COPIED_CLOSE_DELAY_MS);
  };

  // For the menu's onOpenChange; Base UI also reports a move to another row's trigger as an open
  const onOpenChange = (open: boolean) => {
    openingRef.current += 1;
    clearCloseTimer();
    if (open) setCopied(false);
  };

  return { copied, copyLink, onOpenChange };
}

// One "..." menu for every row and card. Each row renders only a detached trigger that passes its row as `payload`,
// so a table or grid mounts a single Base UI menu instead of one per row.
export function RowActionsMenuProvider({ children }: { children: React.ReactNode }) {
  const [handle] = React.useState(() => Menu.createHandle<RowActionsPayload>());
  const [registry] = React.useState(createRowRegistry);
  const [createFor, setCreateFor] = React.useState<{ trackId: string; segmentId?: string | null } | null>(null);
  const copy = useCopyLinkThenClose(() => handle.close());
  const context = React.useMemo<RowActionsMenuContextValue>(
    () => ({ handle, registry, onCreatePlaylist: (trackId, segmentId) => setCreateFor({ trackId, segmentId }) }),
    [handle, registry]
  );

  return (
    <RowActionsMenuContext.Provider value={context}>
      {children}
      <DropdownMenu handle={handle} onOpenChange={copy.onOpenChange}>
        {({ payload }) =>
          payload ? (
            <DropdownMenuContent align="end" className="w-52">
              <RowActionsMenuItems
                {...payload}
                copied={copy.copied}
                onCopyLink={(link) => void copy.copyLink(link)}
                onCreatePlaylist={(trackId, segmentId) => {
                  handle.close();
                  setCreateFor({ trackId, segmentId });
                }}
              />
            </DropdownMenuContent>
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

// Like Apple Music, right-clicking a row or tile (or long-pressing it) opens the actions of its "..." button at the
// pointer. A list wraps its rows in one of these: it finds the row under the pointer and opens the actions that row's
// RowActionsMenu registered, so the list mounts one context menu, not one per row. Base UI keeps the browser's own
// menu off the whole area, gaps between rows included.
export function RowContextMenu({ children }: { children: React.ReactNode }) {
  const { registry, onCreatePlaylist } = useRowActionsMenuContext();
  const actionsRef = React.useRef<Menu.Root.Actions | null>(null);
  const [row, setRow] = React.useState<{ id: string; payload: RowActionsPayload } | null>(null);
  // The row a right-click or touch landed on; a touch opens the menu only once it's held
  const pressedRowRef = React.useRef<{ id: string; payload: RowActionsPayload } | null>(null);
  const copy = useCopyLinkThenClose(() => actionsRef.current?.close());

  const pressRow = (event: { target: EventTarget; preventBaseUIHandler: () => void }) => {
    const id = event.target instanceof Element
      ? event.target.closest(ROW_SELECTOR)?.querySelector<HTMLElement>("[data-row-actions]")?.dataset.rowActions
      : undefined;
    const entry = id ? registry.rows.get(id) : undefined;
    pressedRowRef.current = id && entry && !entry.disabled ? { id, payload: entry.payload } : null;
    if (!pressedRowRef.current) event.preventBaseUIHandler();
  };

  return (
    <ContextMenu
      actionsRef={actionsRef}
      onOpenChange={(open) => {
        copy.onOpenChange(open);
        if (open) setRow(pressedRowRef.current);
        registry.setContextMenuRowId(open ? (pressedRowRef.current?.id ?? null) : null);
      }}
    >
      <ContextMenuTrigger onContextMenu={pressRow} onTouchStart={pressRow}>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        {row && (
          <RowActionsMenuItems
            {...row.payload}
            copied={copy.copied}
            onCopyLink={(link) => void copy.copyLink(link)}
            onCreatePlaylist={(trackId, segmentId) => {
              actionsRef.current?.close();
              onCreatePlaylist(trackId, segmentId);
            }}
          />
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

interface RowActionsMenuItemsProps extends RowActionsPayload {
  copied: boolean;
  onCopyLink: (link: string) => void;
  onCreatePlaylist: (trackId: string, segmentId?: string | null) => void;
}

// The items both menus show for a row; Base UI's context menu is built from the same menu parts
function RowActionsMenuItems({
  track,
  segmentId,
  canAddToPlaylist,
  deleteLabel,
  onDelete,
  children,
  copied,
  onCopyLink,
  onCreatePlaylist,
}: RowActionsMenuItemsProps) {
  const { t } = useTranslation();
  const youtubeLink = track?.source_type === "youtube" ? track.source_uri : undefined;
  const showAddToPlaylist = Boolean(track) && canAddToPlaylist;

  return (
    <>
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
    </>
  );
}

// Apple Music style "..." button for a row's secondary actions; the menu itself lives in RowActionsMenuProvider
export function RowActionsMenu({ disabled = false, ...payload }: RowActionsMenuProps) {
  const { t } = useTranslation();
  const { handle, registry } = useRowActionsMenuContext();
  const id = React.useId();
  const isContextMenuOpen = React.useSyncExternalStore(registry.subscribe, () => registry.getContextMenuRowId() === id);

  const { name, track, canAddToPlaylist, onDelete, children } = payload;
  const hasYoutubeLink = track?.source_type === "youtube";
  const hasActions = Boolean(children || (track && canAddToPlaylist) || hasYoutubeLink || onDelete);

  // The row's context menu opens with the actions of its latest render
  React.useLayoutEffect(() => {
    if (hasActions) registry.rows.set(id, { payload, disabled });
    else registry.rows.delete(id);
  });
  React.useLayoutEffect(() => () => {
    registry.rows.delete(id);
  }, [registry, id]);

  if (!hasActions) return null;

  const label = t("table.moreActions", { name, defaultValue: `More options for ${name}` });
  return (
    <DropdownMenuTrigger
      handle={handle}
      payload={payload}
      disabled={disabled}
      aria-label={label}
      title={label}
      data-row-actions={id}
      data-context-menu-open={isContextMenuOpen || undefined}
      render={<Button variant="ghost" size="icon-sm" />}
    >
      <MoreHorizontal />
    </DropdownMenuTrigger>
  );
}
