import * as React from "react";
import { useTranslation } from "react-i18next";
import { Search, X } from "lucide-react";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "../ui/input-group";
import { Kbd } from "../ui/kbd";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "../ui/sidebar";
import { usePlayerStore } from "../../store/usePlayerStore";
import { isDialogOpen } from "../../lib/dialog";

interface LibrarySearchProps {
  value: string;
  onChange: (query: string) => void;
}

function isTypingTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
}

export function LibrarySearch({ value, onChange }: LibrarySearchProps) {
  const { t } = useTranslation();
  const { isMobile, open, setOpen } = useSidebar();
  const inputRef = React.useRef<HTMLInputElement>(null);

  const focusSearch = React.useCallback(() => {
    if (!isMobile && !open) setOpen(true);
    // Wait a frame so a just-expanded sidebar has shown the field
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [isMobile, open, setOpen]);

  // "/" (outside text fields) and Cmd/Ctrl+K focus search, unless a dialog or Slice Studio is open
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || usePlayerStore.getState().sliceStudioTrack || isDialogOpen()) return;
      const isSlash = e.key === "/" && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && !isTypingTarget(e.target);
      const isCmdK = (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k";
      if (!isSlash && !isCmdK) return;
      e.preventDefault();
      focusSearch();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [focusSearch]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Escape") return;
    if (value) {
      onChange("");
    } else {
      e.currentTarget.blur();
    }
  };

  return (
    <>
      <div role="search" className="group-data-[collapsible=icon]:hidden">
        <InputGroup>
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            ref={inputRef}
            id="library-search"
            name="search"
            type="search"
            maxLength={200}
            aria-label={t("nav.searchAria")}
            placeholder={t("nav.searchPlaceholder")}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <InputGroupAddon align="inline-end">
            {value ? (
              <InputGroupButton
                size="icon-xs"
                aria-label={t("nav.clearSearch")}
                title={t("nav.clearSearch")}
                onClick={() => {
                  onChange("");
                  inputRef.current?.focus();
                }}
              >
                <X />
              </InputGroupButton>
            ) : (
              <Kbd>/</Kbd>
            )}
          </InputGroupAddon>
        </InputGroup>
      </div>

      {/* Collapsed to icons: a search button that expands the sidebar into the field */}
      <SidebarMenu className="hidden group-data-[collapsible=icon]:flex">
        <SidebarMenuItem>
          <SidebarMenuButton tooltip={t("nav.searchAria")} onClick={focusSearch}>
            <Search />
            <span>{t("nav.searchAria")}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </>
  );
}
