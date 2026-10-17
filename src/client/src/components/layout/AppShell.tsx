import * as React from "react";
import { useTranslation } from "react-i18next";
import { AppSidebar } from "./AppSidebar";
import { SidebarProvider } from "../ui/sidebar";
import { TooltipProvider } from "../ui/tooltip";
import { Toaster } from "../ui/toast";
import { buttonVariants } from "../ui/button";
import { RowActionsMenuProvider } from "../RowActionsMenu";
import { useMediaQuery, WIDE_LAYOUT_QUERY } from "../../hooks/use-media-query";

// The main column, where the skip link lands
export const MAIN_CONTENT_ID = "main-content";

interface AppShellProps extends Omit<React.ComponentProps<typeof AppSidebar>, "className"> {
  // Render a SidebarInset for the main column; fixed overlays can sit beside it.
  children: React.ReactNode;
}

export function AppShell({ children, ...sidebarProps }: AppShellProps) {
  const { t } = useTranslation();
  // Below the wide layout the sidebar shrinks to icons; a manual toggle holds until the breakpoint is crossed
  const isWide = useMediaQuery(WIDE_LAYOUT_QUERY);
  const [isSidebarOpen, setIsSidebarOpen] = React.useState(isWide);
  const [wasWide, setWasWide] = React.useState(isWide);
  if (wasWide !== isWide) {
    setWasWide(isWide);
    setIsSidebarOpen(isWide);
  }

  return (
    // A pause before the first tooltip, Base UI's default; the next ones in the group open at once, without animation
    <TooltipProvider delay={600}>
      <RowActionsMenuProvider>
        <SidebarProvider open={isSidebarOpen} onOpenChange={setIsSidebarOpen}>
          {/* The first Tab stop lets keyboard users skip past the sidebar; it shows only while focused */}
          <div className="sr-only focus-within:not-sr-only focus-within:fixed focus-within:top-2 focus-within:left-2 focus-within:z-50">
            <a href={`#${MAIN_CONTENT_ID}`} className={buttonVariants()}>
              {t("nav.skipToContent")}
            </a>
          </div>
          <AppSidebar {...sidebarProps} />
          {children}
        </SidebarProvider>
      </RowActionsMenuProvider>
      {/* Toasts stack above the player capsule rather than over its controls */}
      <Toaster className="bottom-[calc(var(--player-bar-height,0px)+1rem)]" />
    </TooltipProvider>
  );
}
