import * as React from "react";
import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "./alert-dialog";
import { Spinner } from "./spinner";

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
}: ConfirmModalProps) {
  const { t } = useTranslation();
  // Cancel takes focus first so Enter never confirms by accident
  const cancelRef = React.useRef<HTMLButtonElement>(null);

  const handleConfirm = async () => {
    if (isLoading) return;
    await onConfirm();
  };

  return (
    <AlertDialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open && !isLoading) onClose();
      }}
    >
      <AlertDialogContent initialFocus={cancelRef}>
        <AlertDialogHeader>
          {variant === "destructive" && (
            <AlertDialogMedia className="bg-destructive/10 text-destructive">
              <AlertTriangle />
            </AlertDialogMedia>
          )}
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>
            {description || t("library.confirmWarning", "Hành động này không thể hoàn tác.")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel ref={cancelRef} disabled={isLoading}>
            {cancelText || t("common.cancel", "Hủy")}
          </AlertDialogCancel>
          <AlertDialogAction variant={variant} onClick={handleConfirm} disabled={isLoading}>
            {isLoading && <Spinner data-icon="inline-start" />}
            {confirmText || t("common.delete", "Xóa")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
