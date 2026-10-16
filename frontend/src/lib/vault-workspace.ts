import { matchRoutes } from "react-router-dom";
import { appRouteContract } from "@/app-route-contract";

const focusedPages = {
  GraphPage: "graph",
  PublicationsPage: "publish",
  VaultMembersPage: "members",
  VaultSettingsPage: "settings",
} as const;

export type FocusedVaultPage = (typeof focusedPages)[keyof typeof focusedPages];

const menuPages = { VaultPage: "overview", ...focusedPages } as const;

/** Only a destination's own route is current; readers never imply Overview. */
export function vaultMenuPageForComponent(component: string) {
  return menuPages[component as keyof typeof menuPages] ?? null;
}

/** Route ownership, not URL suffixes or remembered rail state, selects chrome. */
export function focusedVaultPageForComponent(component: string): FocusedVaultPage | null {
  return focusedPages[component as keyof typeof focusedPages] ?? null;
}

export function focusedVaultPageForPath(pathname: string): FocusedVaultPage | null {
  const match = matchRoutes([...appRouteContract], pathname)?.at(-1);
  return match?.route.boundary === "vault-shell"
    ? focusedVaultPageForComponent(match.route.component)
    : null;
}
