import * as React from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "../../lib/utils";

const activeModalStack: string[] = [];

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
  zIndex?: number;
}

export function Modal({
  isOpen,
  onClose,
  title,
  description,
  children,
  className,
  zIndex,
}: ModalProps) {
  const { t } = useTranslation();
  const closeLabel = t("common.close", "Close");
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const previousActiveElementRef = React.useRef<HTMLElement | null>(null);
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;
  const titleId = React.useId();
  const descId = React.useId();
  const modalId = React.useId();

  const [isRendered, setIsRendered] = React.useState(isOpen);
  const [isExiting, setIsExiting] = React.useState(false);

  React.useEffect(() => {
    if (isOpen) {
      setIsRendered(true);
      setIsExiting(false);
    } else if (isRendered) {
      setIsExiting(true);
      const timer = setTimeout(() => {
        setIsRendered(false);
        setIsExiting(false);
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [isOpen, isRendered]);

  React.useEffect(() => {
    if (!isOpen) return;

    activeModalStack.push(modalId);
    previousActiveElementRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusTimer = setTimeout(() => {
      if (dialogRef.current) {
        const autofocusElement = dialogRef.current.querySelector<HTMLElement>(
          '[autofocus]:not([disabled]), [data-autofocus]:not([disabled])'
        );
        if (autofocusElement && autofocusElement.offsetParent !== null) {
          autofocusElement.focus();
          return;
        }

        const firstFocusable = dialogRef.current.querySelector<HTMLElement>(
          'button:not([disabled]), [href]:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]):not([disabled])'
        );
        if (firstFocusable && firstFocusable.offsetParent !== null) {
          firstFocusable.focus();
        } else {
          dialogRef.current.focus();
        }
      }
    }, 50);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (
          activeModalStack.length > 0 &&
          activeModalStack[activeModalStack.length - 1] !== modalId
        ) {
          return;
        }
        e.stopPropagation();
        onCloseRef.current();
        return;
      }

      if (e.key === "Tab") {
        const dialog = dialogRef.current;
        if (!dialog) return;

        const focusables = Array.from(
          dialog.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href]:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]):not([disabled])'
          )
        ).filter((el) => el.offsetParent !== null);

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
      const idx = activeModalStack.lastIndexOf(modalId);
      if (idx !== -1) {
        activeModalStack.splice(idx, 1);
      }
      clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = prevOverflow;
      if (previousActiveElementRef.current && typeof previousActiveElementRef.current.focus === "function") {
        previousActiveElementRef.current.focus();
      }
    };
  }, [isOpen, modalId]);

  if (!isOpen && !isRendered) return null;

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget && !isExiting) onCloseRef.current();
      }}
      style={zIndex ? { zIndex } : undefined}
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 duration-150",
        isExiting ? "animate-out fade-out pointer-events-none" : "animate-in fade-in"
      )}
    >
      <div
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        className={cn(
          "relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl border border-border bg-card p-6 shadow-2xl duration-150 outline-none",
          isExiting ? "animate-out zoom-out-95 pointer-events-none" : "animate-in zoom-in-95",
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
