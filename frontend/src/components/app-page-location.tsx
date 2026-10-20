import { matchRoutes, useLocation } from "react-router-dom";
import { useLayoutEffect, useRef } from "react";
import { ResourceBreadcrumb } from "@/components/resource-breadcrumb";
import { VaultBreadcrumb } from "@/components/vault-breadcrumb";
import { VaultPageSwitcher } from "@/components/vault-page-switcher";
import { useResourceLocation } from "@/contexts/resource-location-context";
import { appRouteContract } from "@/app-route-contract";
import { settingsSection } from "@/lib/settings-sections";
import { Bell, BookOpen, Boxes, CircleHelp, Compass, File, FilePlus2, FileText, GitCommitHorizontal, GitGraph, House, Plus, Search, Settings, Share2, Table2, Users, type LucideIcon } from "lucide-react";

const PAGE_IDENTITY: Record<string, [string, LucideIcon]> = {
  HomePage: ["Home", House],
  SearchPage: ["Search", Search],
  SettingsPage: ["Settings", Settings],
  NotificationsPage: ["Notifications", Bell],
  VaultNewPage: ["New vault", Plus],
  VaultIndexPage: ["Vaults", Boxes],
  VaultPage: ["Overview", Compass],
  DocumentNewPage: ["New document", FilePlus2],
  DocumentPage: ["Document", FileText],
  TablePage: ["Table", Table2],
  FilePage: ["File", File],
  GraphPage: ["Graph", GitGraph],
  PublicationsPage: ["Public links", Share2],
  VaultMembersPage: ["Members", Users],
  VaultSettingsPage: ["Settings", Settings],
  VaultActivityPage: ["Activity", GitCommitHorizontal],
  SkillRedirect: ["Vault guide", BookOpen],
};

/** Location chrome, not a second page heading or a resource filename. */
export function AppPageLocation({ isAdmin = false, mobile = false }: { isAdmin?: boolean; mobile?: boolean }) {
  const { pathname, search } = useLocation();
  const locationElement = useRef<HTMLDivElement>(null);
  const focusPageAfterNavigation = useRef(false);
  useLayoutEffect(() => {
    if (!focusPageAfterNavigation.current) return;
    focusPageAfterNavigation.current = false;
    const destination = locationElement.current?.querySelector<HTMLElement>('[data-slot="vault-page-switcher"]')
      ?? document.getElementById("main");
    destination?.focus({ preventScroll: true });
  }, [pathname]);
  const resource = useResourceLocation();
  const match = matchRoutes([...appRouteContract], pathname)?.at(-1);
  const section = pathname === "/settings" ? settingsSection(new URLSearchParams(search).get("tab"), isAdmin) : null;
  const [label, Icon] = section ? [section.label, section.icon] : PAGE_IDENTITY[match?.route.component ?? ""] ?? ["Page not found", CircleHelp];
  const vault = match?.route.boundary === "vault-shell" ? match.params.name : undefined;
  const className = `${mobile ? "flex lg:hidden" : "hidden lg:flex"} min-w-0 flex-1 items-center gap-2 overflow-hidden ${mobile ? "" : "pr-4"} text-sm`;
  const vaultMenu = vault ? <>
    <VaultPageSwitcher vault={vault} onNavigateIntent={() => { focusPageAfterNavigation.current = true; }} />
    <span aria-hidden className="h-4 w-px shrink-0 bg-border" />
  </> : null;
  if (vault && resource?.vault === vault) return <div ref={locationElement} data-slot="app-page-location" className={className}>
    {vaultMenu}
    <ResourceBreadcrumb location={resource} className="flex-1" />
  </div>;
  if (vault) {
    const isResource = ["DocumentPage", "FilePage", "TablePage"].includes(match?.route.component ?? "");
    return <div ref={locationElement} data-slot="app-page-location" className={className}>
      {vaultMenu}
      <VaultBreadcrumb vault={vault} title={label} className="flex-1"
        icon={isResource ? Icon : undefined} kind={isResource ? label : undefined} />
    </div>;
  }

  return (
    <nav aria-label="Current page" data-slot="app-page-location" className={className}>
      <span className="inline-flex min-w-0 items-center gap-2 font-semibold text-foreground">
        <Icon className="h-4 w-4 shrink-0 text-foreground-muted" aria-hidden="true" />
        <span aria-current="page" className="truncate">{label}</span>
      </span>
    </nav>
  );
}
