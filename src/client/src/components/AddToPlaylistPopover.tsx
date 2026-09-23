import * as React from "react";
import { FolderPlus, Check, Loader2, Plus } from "lucide-react";
import { Button } from "./ui/button";
import { useTranslation } from "react-i18next";
import { usePlayerStore } from "../store/usePlayerStore";
import { CreatePlaylistModal } from "./CreatePlaylistModal";
import { cn } from "../lib/utils";

interface AddToPlaylistMenuProps {
  trackId: string;
  segmentId?: string | null;
  isOpen: boolean;
  onClose: () => void;
  onOpenCreateModal?: () => void;
}

function AddToPlaylistMenu({ trackId, segmentId, isOpen, onClose, onOpenCreateModal }: AddToPlaylistMenuProps) {
  const { t } = useTranslation();
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
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isOpen, isRendered]);

  const playlists = usePlayerStore((s) => s.playlists);
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
    } catch (e: any) {
      if (e?.name !== "AbortError") {
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
    if (!isOpen) return;

    const abortController = new AbortController();
    fetchMemberships(abortController.signal);

    return () => {
      isMountedRef.current = false;
      abortController.abort();
    };
  }, [isOpen, fetchMemberships]);

  const handleToggle = async (plId: string) => {
    if (busyPlaylistId) return;
    setBusyPlaylistId(plId);
    try {
      const existingItemId = memberships[plId];
      if (existingItemId) {
        const ok = await removeFromPlaylist(plId, existingItemId);
        if (ok && isMountedRef.current) {
          setMemberships((prev) => {
            const next = { ...prev };
            delete next[plId];
            return next;
          });
        }
      } else {
        const ok = await addToPlaylist(plId, trackId, segmentId || null);
        if (ok && isMountedRef.current) {
          await fetchMemberships();
        }
      }
    } catch (e) {
      console.error("Failed to toggle playlist item:", e);
    } finally {
      if (isMountedRef.current) {
        setBusyPlaylistId(null);
      }
    }
  };

  if (!isOpen && !isRendered) return null;

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          onClose();
        }
        e.stopPropagation();
      }}
      className={cn(
        "absolute bottom-full right-0 mb-1.5 w-52 origin-bottom-right rounded-lg border border-border bg-card/95 backdrop-blur-md p-1.5 shadow-xl z-50 duration-100",
        isExiting ? "animate-out fade-out zoom-out-95 pointer-events-none" : "animate-in fade-in zoom-in-95"
      )}
    >
      <div className="px-2 py-1 text-2xs font-semibold uppercase tracking-wider text-muted-foreground border-b border-border mb-1 flex items-center justify-between">
        <span>{t("addToPlaylist.title")}</span>
        {loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
      </div>
      <button
        type="button"
        onClick={() => {
          onClose();
          onOpenCreateModal?.();
        }}
        className="w-full flex items-center gap-1.5 px-2 py-1.5 mb-1 rounded text-xs text-left font-medium text-primary hover:bg-primary/10 transition-colors cursor-pointer border-b border-border/50"
      >
        <Plus className="h-3.5 w-3.5 shrink-0 stroke-[2.5]" />
        <span className="truncate">{t("addToPlaylist.newPlaylist", "New Playlist")}</span>
      </button>
      {loading && playlists.length === 0 ? (
        <div className="space-y-1.5 p-1">
          <div className="h-6 rounded bg-secondary/50 animate-pulse" />
          <div className="h-6 rounded bg-secondary/40 animate-pulse" />
        </div>
      ) : playlists.length === 0 ? (
        <div className="px-2 py-2 text-xs text-muted-foreground text-center">
          {t("addToPlaylist.empty")}
        </div>
      ) : (
        <div className="max-h-40 overflow-y-auto space-y-0.5">
          {playlists.map((pl) => {
            const isMember = Boolean(memberships[pl.id]);
            const isBusy = busyPlaylistId === pl.id;
            return (
              <button
                key={pl.id}
                type="button"
                role="checkbox"
                aria-checked={isMember}
                onClick={() => handleToggle(pl.id)}
                disabled={Boolean(busyPlaylistId)}
                className={`w-full flex items-center justify-between px-2 py-1.5 rounded text-xs text-left transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed ${
                  isMember
                    ? "bg-primary/10 text-primary font-medium hover:bg-primary/15"
                    : "hover:bg-accent hover:text-accent-foreground text-foreground"
                }`}
              >
                <span className="truncate">{pl.name}</span>
                {isBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0 ml-1 text-muted-foreground" />
                ) : isMember ? (
                  <Check className="h-3.5 w-3.5 text-primary shrink-0 ml-1 stroke-[2.5] animate-in zoom-in-75 duration-100 ease-out" />
                ) : null}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export interface AddToPlaylistPopoverProps {
  trackId: string;
  segmentId?: string | null;
  disabled?: boolean;
  variant?: "outline" | "ghost";
  size?: "sm" | "icon";
  buttonClassName?: string;
  showText?: boolean;
}

export const AddToPlaylistPopover = React.memo(function AddToPlaylistPopover({
  trackId,
  segmentId,
  disabled = false,
  variant = "outline",
  size = "sm",
  buttonClassName,
  showText = true,
}: AddToPlaylistPopoverProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = React.useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = React.useState(false);
  const addToPlaylist = usePlayerStore((s) => s.addToPlaylist);
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const defaultClasses =
    variant === "ghost"
      ? "h-8 w-8 text-muted-foreground hover:text-primary hover:bg-primary/10 cursor-pointer"
      : "h-8 text-xs gap-1 border-primary/20 text-primary hover:bg-primary/10 cursor-pointer";

  return (
    <div className="relative inline-flex" ref={containerRef}>
      <Button
        variant={variant}
        size={size}
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen((prev) => !prev);
        }}
        disabled={disabled}
        className={buttonClassName || defaultClasses}
        title={t("addToPlaylist.title")}
        aria-label={t("addToPlaylist.title")}
        aria-haspopup="menu"
        aria-expanded={isOpen}
      >
        <FolderPlus className="h-3.5 w-3.5" />
        {showText && <span className="hidden xl:inline">{t("addToPlaylist.buttonText", "Playlist")}</span>}
      </Button>

      <AddToPlaylistMenu
        trackId={trackId}
        segmentId={segmentId}
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        onOpenCreateModal={() => {
          setIsOpen(false);
          setIsCreateModalOpen(true);
        }}
      />

      <CreatePlaylistModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onCreated={async (newId) => {
          setIsCreateModalOpen(false);
          await addToPlaylist(newId, trackId, segmentId || null);
        }}
      />
    </div>
  );
});
