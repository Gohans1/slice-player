// Global keyboard shortcuts stay quiet while a dialog or alert dialog is up
export function isDialogOpen(except?: string): boolean {
  return Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"]')).some(
    (dialog) => !except || !dialog.matches(except)
  );
}
