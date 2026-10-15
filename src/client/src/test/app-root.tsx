import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { RowActionsMenuProvider } from "../components/RowActionsMenu";

// A React root for component tests that renders inside the providers AppShell gives the real app
export function createAppRoot(container: Element): Root {
  const root = createRoot(container);
  return {
    render: (children) => root.render(<RowActionsMenuProvider>{children}</RowActionsMenuProvider>),
    unmount: () => root.unmount(),
  };
}
