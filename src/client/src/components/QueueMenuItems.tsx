import * as React from "react";
import { useTranslation } from "react-i18next";
import { ListEnd, ListStart } from "lucide-react";
import { DropdownMenuGroup, DropdownMenuItem } from "./ui/dropdown-menu";
import type { QueuePlacement } from "../store/usePlayerStore";

interface QueueMenuItemsProps {
  disabled?: boolean;
  onQueue: (placement: QueuePlacement) => void;
}

// Play Next and Play Later, as in Apple Music's menus, for anything whose songs can join the queue
export function QueueMenuItems({ disabled, onQueue }: QueueMenuItemsProps) {
  const { t } = useTranslation();
  return (
    <DropdownMenuGroup>
      <DropdownMenuItem disabled={disabled} onClick={() => onQueue("next")}>
        <ListStart />
        {t("queue.playNext")}
      </DropdownMenuItem>
      <DropdownMenuItem disabled={disabled} onClick={() => onQueue("later")}>
        <ListEnd />
        {t("queue.playLater")}
      </DropdownMenuItem>
    </DropdownMenuGroup>
  );
}
