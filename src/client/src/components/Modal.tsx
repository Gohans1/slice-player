import * as React from "react";
import { XIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}

// The app's dialog shell: shadcn Dialog with a header and a translated close button
export function Modal({ isOpen, onClose, title, description, children, className }: ModalProps) {
  const { t } = useTranslation();
  const closeLabel = t("common.close", "Close");

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent showCloseButton={false} className={cn("max-h-[90svh] overflow-y-auto sm:max-w-lg", className)}>
        {/* The margin keeps long titles clear of the close button */}
        <DialogHeader className="mr-6">
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children}
        <DialogClose
          aria-label={closeLabel}
          title={closeLabel}
          render={<Button variant="ghost" size="icon-sm" className="absolute top-2 right-2" />}
        >
          <XIcon />
        </DialogClose>
      </DialogContent>
    </Dialog>
  );
}
