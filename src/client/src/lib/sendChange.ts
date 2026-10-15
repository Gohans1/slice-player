import i18n from "../i18n";
import { toast } from "../components/ui/toast";
import { logClientError } from "../store/useLogStore";

// Changes that fail with nothing else on screen to say so: the menu that started them has closed, or the
// optimistic update has quietly rolled back. Dialogs that show their own error, like New Playlist, don't use these.
export type ChangeName =
  | "renamePlaylist"
  | "deletePlaylist"
  | "setPlaylistCover"
  | "addToPlaylist"
  | "removeFromPlaylist"
  | "reorderPlaylist"
  | "deleteTracks"
  | "deleteSlices"
  | "retryDownload"
  | "trackVolume";

// What a proxy in front of the server answers when it can't reach it
const GATEWAY_STATUSES = new Set([502, 503, 504]);

// Tells the user a change didn't save, in a toast that stays until dismissed and is announced at once. A change that
// keeps failing updates its one toast rather than stacking more. The details go to System Logs, in English like the rest.
export function notifyChangeFailed(change: ChangeName, failure: unknown, count = 1) {
  toast.add({
    id: `change-failed:${change}`,
    type: "error",
    priority: "high",
    timeout: 0,
    title: i18n.t(`changeFailed.${change}`, { count }),
    description:
      failure instanceof Response && !GATEWAY_STATUSES.has(failure.status)
        ? i18n.t("changeFailed.rejected", { status: failure.status })
        : i18n.t("changeFailed.unreachable"),
  });

  const title = i18n.t(`changeFailed.${change}`, { count, lng: "en" });
  logClientError(
    "system",
    failure instanceof Response ? `${title} (HTTP ${failure.status})` : `${title}: ${String(failure)}`
  );
}

// Sends a change to the server. Returns the response when it succeeds; otherwise tells the user and returns null.
// Only the request itself is reported: work after a successful response failing doesn't mean the change didn't save.
export async function sendChange(change: ChangeName, input: string, init: RequestInit, count = 1): Promise<Response | null> {
  let res: Response;
  try {
    res = await fetch(input, init);
  } catch (e) {
    notifyChangeFailed(change, e, count);
    return null;
  }
  if (!res.ok) {
    notifyChangeFailed(change, res, count);
    return null;
  }
  return res;
}
