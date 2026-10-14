import * as React from "react";
import { AppSidebar } from "./AppSidebar";
import { SidebarProvider } from "../ui/sidebar";
import { TooltipProvider } from "../ui/tooltip";

interface AppShellProps extends Omit<React.ComponentProps<typeof AppSidebar>, "className"> {
  // Render a SidebarInset for the main column; fixed overlays can sit beside it.
  children: React.ReactNode;
}

export function AppShell({ children, ...sidebarProps }: AppShellProps) {
  return (
    <TooltipProvider>
      <SidebarProvider>
        {/* The docked player bar spans the full width, so the sidebar stops above it */}
        <AppSidebar {...sidebarProps} className="bottom-[var(--player-bar-height,0px)] h-auto" />
        {children}
      </SidebarProvider>
    </TooltipProvider>
  );
}
