// Global keyboard shortcuts stay quiet while a dialog or alert dialog is up. Toasts are dialogs too, but they say
// aria-modal="false" and stay on screen until dismissed, so they must not hold the shortcuts hostage.
export function isDialogOpen(except?: string): boolean {
  return Array.from(
    document.querySelectorAll('[role="dialog"]:not([aria-modal="false"]), [role="alertdialog"]:not([aria-modal="false"])')
  ).some((dialog) => !except || !dialog.matches(except));
}
