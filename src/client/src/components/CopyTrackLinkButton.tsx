import * as React from "react";
import { Link2, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui/button";
import { copyToClipboard } from "../lib/clipboard";
import { cn } from "../lib/utils";
import type { Track } from "@/server/types";

interface CopyTrackLinkButtonProps {
  sourceType?: Track["source_type"];
  sourceUri?: string;
}

export function CopyTrackLinkButton({ sourceType, sourceUri }: CopyTrackLinkButtonProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = React.useState(false);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  if (sourceType !== "youtube" || !sourceUri) {
    return null;
  }

  const handleCopy = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (await copyToClipboard(sourceUri)) {
      setCopied(true);
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      timerRef.current = setTimeout(() => {
        setCopied(false);
        timerRef.current = null;
      }, 1800);
    }
  };

  const label = copied
    ? t("trackCard.copiedLink", "Copied link!")
    : t("trackCard.copyLink", "Copy YouTube link");

  // The two icons cross-fade with a blur instead of swapping abruptly
  const iconClass = "transition duration-300 ease-out";

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-lg"
      onClick={handleCopy}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.stopPropagation();
        }
      }}
      data-copied={copied ? "true" : "false"}
      title={label}
      aria-label={label}
    >
      <span className="relative flex size-3.5 items-center justify-center">
        <Link2
          aria-hidden="true"
          className={cn(iconClass, "size-3.5", copied ? "scale-25 opacity-0 blur-xs" : "scale-100 opacity-100 blur-none")}
        />
        <Check
          aria-hidden="true"
          className={cn(
            iconClass,
            "absolute inset-0 size-3.5 text-flexoki-green",
            copied ? "scale-100 opacity-100 blur-none" : "scale-25 opacity-0 blur-xs"
          )}
        />
      </span>
    </Button>
  );
}
