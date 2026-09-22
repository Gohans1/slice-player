import * as React from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Modal } from "./modal";
import { Button } from "./button";
import { useTranslation } from "react-i18next";

interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  variant?: "destructive" | "default";
  isLoading?: boolean;
  zIndex?: number;
}

export function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmText,
  cancelText,
  variant = "destructive",
  isLoading = false,
  zIndex = 60,
}: ConfirmModalProps) {
  const { t } = useTranslation();
  const cancelBtnRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    if (isOpen) {
      // Focus cancel button by default to prevent accidental confirmation
      const timer = setTimeout(() => {
        cancelBtnRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  const handleConfirm = async () => {
    if (isLoading) return;
    await onConfirm();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={isLoading ? () => {} : onClose}
      title={title}
      className="max-w-md"
      zIndex={zIndex}
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-3 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-xs text-muted-foreground">
          <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
          <p className="leading-relaxed text-foreground/90">
            {description || t("library.confirmWarning", "Hành động này không thể hoàn tác.")}
          </p>
        </div>

        <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-border/50">
          <Button
            ref={cancelBtnRef}
            type="button"
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={isLoading}
            className="px-4 text-xs font-semibold"
          >
            {cancelText || t("common.cancel", "Hủy")}
          </Button>
          <Button
            type="button"
            variant={variant}
            size="sm"
            onClick={handleConfirm}
            disabled={isLoading}
            className="px-4 text-xs font-semibold gap-1.5"
          >
            {isLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            <span>{confirmText || t("common.delete", "Xóa")}</span>
          </Button>
        </div>
      </div>
    </Modal>
  );
}
