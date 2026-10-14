import * as React from "react";
import { useTranslation } from "react-i18next";
import { Volume2, VolumeX } from "lucide-react";
import { Button } from "./ui/button";
import { VolumeSlider } from "./VolumeSlider";
import { usePlayerStore } from "../store/usePlayerStore";
import { cn } from "../lib/utils";

export function MasterVolume() {
  const { t } = useTranslation();
  const masterVolume = usePlayerStore((s) => s.masterVolume);
  const setMasterVolume = usePlayerStore((s) => s.setMasterVolume);

  const isMasterMuted = masterVolume === 0;
  const lastAudibleMasterRef = React.useRef(masterVolume > 0 ? masterVolume : 0.5);
  React.useEffect(() => {
    if (masterVolume > 0) lastAudibleMasterRef.current = masterVolume;
  }, [masterVolume]);
  const toggleMasterMute = () => setMasterVolume(isMasterMuted ? lastAudibleMasterRef.current : 0);

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon"
        onClick={toggleMasterMute}
        aria-label={isMasterMuted ? t("nav.unmuteAll") : t("nav.muteAll")}
        title={isMasterMuted ? t("nav.unmuteAll") : t("nav.muteAll")}
        className="h-8 w-8 text-muted-foreground hover:text-foreground shrink-0"
      >
        <span className="relative">
          <VolumeX
            aria-hidden="true"
            className={cn(
              "absolute inset-0 h-4 w-4 text-destructive transition-[opacity,filter,scale] duration-300 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none",
              isMasterMuted ? "scale-100 opacity-100 blur-0" : "scale-[0.25] opacity-0 blur-[4px]"
            )}
          />
          <Volume2
            aria-hidden="true"
            className={cn(
              "h-4 w-4 transition-[opacity,filter,scale] duration-300 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none",
              isMasterMuted ? "scale-[0.25] opacity-0 blur-[4px]" : "scale-100 opacity-100 blur-0"
            )}
          />
        </span>
      </Button>
      <VolumeSlider
        value={masterVolume}
        onChange={setMasterVolume}
        aria-label={t("nav.masterVolume")}
        title={t("nav.masterVolumeTooltip", { percent: Math.round(masterVolume * 100) })}
        className="w-20"
      />
    </div>
  );
}
