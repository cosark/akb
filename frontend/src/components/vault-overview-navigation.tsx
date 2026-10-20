import { useLayoutEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { getVaultPageActions } from "@/components/title-bar";
import { useResourceNavigation } from "@/contexts/resource-navigation-context";

/** Overview owns page discovery; breadcrumbs only describe the current location. */
export function VaultOverviewNavigation({ vault }: { vault: string }) {
  const { requestNavigation } = useResourceNavigation();
  const actions = getVaultPageActions(vault).filter(action => action.key !== "overview" && action.key !== "search");
  return (
    <nav aria-label="Vault pages" className="min-w-0 shrink-0">
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {actions.map(action => (
          <li key={action.key} className={action.key === "members" ? "ml-2" : undefined}>
            <Link to={action.href} state={{ vaultPageNavigation: action.href }}
              className="inline-flex min-h-11 min-w-11 items-center gap-2 rounded-[var(--radius-sm)] text-sm font-medium text-link transition-colors hover:text-link-hover focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
              onClick={event => {
                if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.defaultPrevented) return;
                if (!requestNavigation(action.href)) { event.preventDefault(); return; }
              }}>
              <action.icon className="hidden h-4 w-4 shrink-0 @[30rem]/vault-overview:block" aria-hidden />
              {action.key === "publish" ? "Public links" : action.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Observe the committed route in the persistent shell. The Overview can
 * unmount after an animation frame when React defers a route transition. */
export function VaultOverviewNavigationFocus() {
  const location = useLocation();
  useLayoutEffect(() => {
    if (location.state?.vaultPageNavigation === location.pathname) {
      document.getElementById("main")?.focus({ preventScroll: true });
    }
  }, [location]);
  return null;
}
