import * as React from "react";
import { Link2, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui/button";
import { copyToClipboard } from "../lib/clipboard";
import type { Track } from "@/server/types";

interface CopyTrackLinkButtonProps {
  sourceType?: Track["source_type"];
  sourceUri?: string;
  size?: "card" | "table";
}

export function CopyTrackLinkButton({
  sourceType,
  sourceUri,
  size = "card",
}: CopyTrackLinkButtonProps) {
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

  const sizeClass = size === "table" ? "h-7 w-7" : "h-8 w-8";

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={handleCopy}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.stopPropagation();
        }
      }}
      data-copied={copied ? "true" : "false"}
      className={`${sizeClass} cursor-pointer active:scale-[0.96] transition-[color,background-color,transform] duration-150 ${
        copied
          ? "text-emerald-500 bg-emerald-500/10 hover:text-emerald-500 hover:bg-emerald-500/15"
          : "text-muted-foreground hover:text-primary hover:bg-primary/10"
      }`}
      title={label}
      aria-label={label}
    >
      <span className="relative flex h-3.5 w-3.5 items-center justify-center">
        <Link2
          aria-hidden="true"
          className={`h-3.5 w-3.5 transition-[opacity,filter,scale] duration-300 ease-[cubic-bezier(0.2,0,0,1)] ${
            copied
              ? "scale-[0.25] opacity-0 blur-[4px]"
              : "scale-100 opacity-100 blur-0"
          }`}
        />
        <Check
          aria-hidden="true"
          className={`absolute inset-0 h-3.5 w-3.5 transition-[opacity,filter,scale] duration-300 ease-[cubic-bezier(0.2,0,0,1)] ${
            copied
              ? "scale-100 opacity-100 blur-0"
              : "scale-[0.25] opacity-0 blur-[4px]"
          }`}
        />
      </span>
    </Button>
  );
}
