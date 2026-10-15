import * as React from "react";
import { AppSidebar } from "./AppSidebar";
import { SidebarProvider } from "../ui/sidebar";
import { TooltipProvider } from "../ui/tooltip";
import { Toaster } from "../ui/toast";
import { RowActionsMenuProvider } from "../RowActionsMenu";
import { useMediaQuery, WIDE_LAYOUT_QUERY } from "../../hooks/use-media-query";

interface AppShellProps extends Omit<React.ComponentProps<typeof AppSidebar>, "className"> {
  // Render a SidebarInset for the main column; fixed overlays can sit beside it.
  children: React.ReactNode;
}

export function AppShell({ children, ...sidebarProps }: AppShellProps) {
  // Below the wide layout the sidebar shrinks to icons; a manual toggle holds until the breakpoint is crossed
  const isWide = useMediaQuery(WIDE_LAYOUT_QUERY);
  const [isSidebarOpen, setIsSidebarOpen] = React.useState(isWide);
  const [wasWide, setWasWide] = React.useState(isWide);
  if (wasWide !== isWide) {
    setWasWide(isWide);
    setIsSidebarOpen(isWide);
  }

  return (
    <TooltipProvider>
      <RowActionsMenuProvider>
        <SidebarProvider open={isSidebarOpen} onOpenChange={setIsSidebarOpen}>
          {/* The docked player bar spans the full width, so the sidebar stops above it */}
          <AppSidebar {...sidebarProps} className="bottom-[var(--player-bar-height,0px)] h-auto" />
          {children}
        </SidebarProvider>
      </RowActionsMenuProvider>
      {/* Toasts stack above the docked player bar rather than over its controls */}
      <Toaster className="bottom-[calc(var(--player-bar-height,0px)+1rem)]" />
    </TooltipProvider>
  );
}
