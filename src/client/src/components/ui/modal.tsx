import * as React from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "../../lib/utils";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}

export function Modal({
  isOpen,
  onClose,
  title,
  description,
  children,
  className,
}: ModalProps) {
  const { t } = useTranslation();
  const closeLabel = t("common.close", "Close");
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const previousActiveElementRef = React.useRef<HTMLElement | null>(null);
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;
  const titleId = React.useId();
  const descId = React.useId();

  React.useEffect(() => {
    if (!isOpen) return;

    previousActiveElementRef.current = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Prioritize autofocus element if present, otherwise focus first focusable child
    const dialogEl = dialogRef.current;
    if (dialogEl) {
      const autoFocusEl = dialogEl.querySelector<HTMLElement>("[autofocus], [data-autofocus]");
      if (autoFocusEl && typeof autoFocusEl.focus === "function") {
        autoFocusEl.focus();
      } else {
        const focusableElements = dialogEl.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusableElements.length > 0) {
          focusableElements[0].focus();
        } else {
          dialogEl.focus();
        }
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
        return;
      }

      if (e.key === "Tab") {
        const dialog = dialogRef.current;
        if (!dialog) return;

        const focusables = Array.from(
          dialog.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
          )
        ).filter((el) => el.offsetParent !== null || el === document.activeElement);

        if (focusables.length === 0) {
          e.preventDefault();
          return;
        }

        const firstFocusable = focusables[0];
        const lastFocusable = focusables[focusables.length - 1];

        if (e.shiftKey) {
          if (
            document.activeElement === firstFocusable ||
            document.activeElement === dialog ||
            !dialog.contains(document.activeElement)
          ) {
            e.preventDefault();
            lastFocusable.focus();
          }
        } else {
          if (
            document.activeElement === lastFocusable ||
            !dialog.contains(document.activeElement)
          ) {
            e.preventDefault();
            firstFocusable.focus();
          }
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = prevOverflow;
      if (previousActiveElementRef.current && typeof previousActiveElementRef.current.focus === "function") {
        previousActiveElementRef.current.focus();
      }
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-150"
    >
      <div
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        className={cn(
          "relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl border border-border bg-card p-6 shadow-2xl animate-in zoom-in-95 duration-150 outline-none",
          className
        )}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label={closeLabel}
          title={closeLabel}
          className="absolute right-4 top-4 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none z-10 cursor-pointer"
        >
          <X className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
        </button>
        <div className="mb-4">
          <h2 id={titleId} className="text-lg font-semibold tracking-tight text-foreground">
            {title}
          </h2>
          {description && (
            <p id={descId} className="text-sm text-muted-foreground mt-1">
              {description}
            </p>
          )}
        </div>
        <div>{children}</div>
      </div>
    </div>
  );
}
