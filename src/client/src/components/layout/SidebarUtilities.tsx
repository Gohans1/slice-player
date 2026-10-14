import * as React from "react";
import { useTranslation } from "react-i18next";
import { Archive, Keyboard, Languages, Terminal } from "lucide-react";
import { SidebarMenu, SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";
import { Kbd } from "../ui/kbd";
import { BackupModal } from "../BackupModal";
import { useLogStore } from "../../store/useLogStore";

interface SidebarUtilitiesProps {
  onOpenShortcuts: () => void;
}

export function SidebarUtilities({ onOpenShortcuts }: SidebarUtilitiesProps) {
  const { t, i18n } = useTranslation();
  const isLogsOpen = useLogStore((s) => s.isDrawerOpen);
  const toggleLogs = useLogStore((s) => s.toggleDrawer);
  const unreadErrorCount = useLogStore((s) => s.unreadErrorCount);
  const [isBackupOpen, setIsBackupOpen] = React.useState(false);

  const currentLang = (i18n.resolvedLanguage || i18n.language || "en").startsWith("vi") ? "vi" : "en";
  const logsLabel = unreadErrorCount > 0 ? t("nav.systemLogsUnread", { count: unreadErrorCount }) : t("nav.systemLogsAria");

  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton isActive={isLogsOpen} aria-label={logsLabel} tooltip={logsLabel} onClick={toggleLogs}>
            <Terminal />
            <span>{t("nav.systemLogsAria")}</span>
          </SidebarMenuButton>
          {unreadErrorCount > 0 && <SidebarMenuBadge>{unreadErrorCount}</SidebarMenuBadge>}
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton tooltip={t("sidebar.shortcuts")} onClick={onOpenShortcuts}>
            <Keyboard />
            <span>{t("sidebar.shortcuts")}</span>
          </SidebarMenuButton>
          <SidebarMenuBadge>
            <Kbd>?</Kbd>
          </SidebarMenuBadge>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton tooltip={t("nav.backupTooltip")} onClick={() => setIsBackupOpen(true)}>
            <Archive />
            <span>{t("nav.backup")}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            aria-label={t("nav.switchLanguage")}
            tooltip={t("nav.switchLanguage")}
            onClick={() => void i18n.changeLanguage(currentLang === "vi" ? "en" : "vi")}
          >
            <Languages />
            <span>{t("sidebar.language")}</span>
          </SidebarMenuButton>
          <SidebarMenuBadge>{currentLang.toUpperCase()}</SidebarMenuBadge>
        </SidebarMenuItem>
      </SidebarMenu>

      <BackupModal isOpen={isBackupOpen} onClose={() => setIsBackupOpen(false)} />
    </>
  );
}
