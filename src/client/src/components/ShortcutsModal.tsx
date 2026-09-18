import * as React from "react";
import { Modal } from "./ui/modal";
import { Button } from "./ui/button";
import { useTranslation } from "react-i18next";
import { Play, Search, Scissors } from "lucide-react";

interface ShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ShortcutItem {
  keys: string[];
  description: string;
}

export function ShortcutsModal({ isOpen, onClose }: ShortcutsModalProps) {
  const { t } = useTranslation();

  const playbackShortcuts: ShortcutItem[] = [
    { keys: ["Space"], description: t("shortcutsModal.playPause", "Play / Pause playback") },
    { keys: ["Q"], description: t("shortcutsModal.toggleQueue", "Toggle Queue Drawer") },
  ];

  const navShortcuts: ShortcutItem[] = [
    { keys: ["/", "Ctrl+K"], description: t("shortcutsModal.focusSearch", "Focus search box") },
    { keys: ["~", "F2"], description: t("shortcutsModal.systemLogs", "Toggle System Logs drawer") },
    { keys: ["?"], description: t("shortcutsModal.openHelp", "Open keyboard shortcuts cheatsheet") },
    { keys: ["Esc"], description: t("shortcutsModal.closeModal", "Close modal / Clear search / Dismiss") },
  ];

  const studioShortcuts: ShortcutItem[] = [
    { keys: ["Space"], description: t("shortcutsModal.studioPlayPause", "Play / Pause waveform preview") },
    { keys: ["←", "→"], description: t("shortcutsModal.studioNudgeCursor", "Move playhead cursor (Shift: 1.0s)") },
    { keys: ["Ctrl", "Scroll"], description: t("shortcutsModal.studioZoom", "Zoom waveform in / out") },
  ];

  const renderSection = (title: string, icon: React.ReactNode, items: ShortcutItem[]) => (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {icon}
        <span>{title}</span>
      </div>
      <div className="rounded-lg border border-border/70 bg-secondary/30 divide-y divide-border/40">
        {items.map((item, idx) => (
          <div key={idx} className="flex items-center justify-between px-3.5 py-2.5 text-xs">
            <span className="text-foreground/90 font-medium">{item.description}</span>
            <div className="flex items-center gap-1.5 shrink-0 ml-3">
              {item.keys.map((k, kIdx) => (
                <kbd
                  key={kIdx}
                  className="inline-flex items-center justify-center min-w-[24px] h-6 px-1.5 rounded border border-border/80 bg-secondary/80 font-mono text-[11px] font-semibold text-foreground shadow-xs select-none"
                >
                  {k}
                </kbd>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t("shortcutsModal.title", "Keyboard Shortcuts")}
      description={t("shortcutsModal.description", "Essential desktop hotkeys for quick playback and precision slicing.")}
      className="max-w-md"
    >
      <div className="space-y-5 py-1">
        {renderSection(
          t("shortcutsModal.playbackSection", "Playback Controls"),
          <Play className="h-3.5 w-3.5 text-primary" />,
          playbackShortcuts
        )}

        {renderSection(
          t("shortcutsModal.navSection", "Navigation & Search"),
          <Search className="h-3.5 w-3.5 text-flexoki-cyan" />,
          navShortcuts
        )}

        {renderSection(
          t("shortcutsModal.studioSection", "Slice Studio (WaveSurfer)"),
          <Scissors className="h-3.5 w-3.5 text-flexoki-yellow" />,
          studioShortcuts
        )}

        <div className="pt-2 flex justify-end">
          <Button variant="outline" size="sm" onClick={onClose}>
            {t("shortcutsModal.close", "Close")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
