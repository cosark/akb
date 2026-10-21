import { Fragment, useContext, useRef, useState } from "react";
import { Link, matchRoutes, useLocation } from "react-router-dom";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown } from "lucide-react";
import { getVaultPageActions } from "@/components/title-bar";
import { Button } from "@/components/ui/button";
import { vaultMenuPageForComponent } from "@/lib/vault-workspace";
import { appRouteContract } from "@/app-route-contract";
import { cn } from "@/lib/utils";
import { useResourceNavigation } from "@/contexts/resource-navigation-context";
import { QueryClientContext, type QueryClient } from "@tanstack/react-query";

/** The vault-relative path of the document a document page shows: from its loaded data when cached (the route may
 *  name it by id), else the route parameter itself. */
function documentPathFor(queryClient: QueryClient | undefined, vault: string, id: string | undefined): string | undefined {
  if (!id) return undefined;
  for (const [, data] of queryClient?.getQueriesData<{ path?: unknown }>({ queryKey: ["document", vault, id] }) ?? []) {
    if (data && typeof data.path === "string" && data.path) return data.path;
  }
  return id;
}

/** One stable entry point, separate from location, on every named Vault route. */
export function VaultPageSwitcher({ vault, onNavigateIntent }: { vault: string; onNavigateIntent?: () => void }) {
  const { pathname } = useLocation();
  const { requestNavigation } = useResourceNavigation();
  const [open, setOpen] = useState(false);
  const followedLink = useRef(false);
  // Optional: the menu also renders outside a query provider (tests, stories), where no document data is cached.
  const queryClient = useContext(QueryClientContext);
  const match = matchRoutes([...appRouteContract], pathname)?.at(-1);
  if (match?.route.boundary !== "vault-shell" || match.params.name !== vault) return null;
  const page = vaultMenuPageForComponent(match.route.component);
  // From an open document, Graph opens focused on it (the same entry the document's own graph link uses).
  const documentPath = match.route.component === "DocumentPage" ? documentPathFor(queryClient, vault, match.params.id) : undefined;
  const actions = getVaultPageActions(vault).filter(action => action.key !== "search")
    .map(action => action.key === "graph" && documentPath ? { ...action, href: `${action.href}?entry=${encodeURIComponent(documentPath)}` } : action);
  const labelFor = (action: (typeof actions)[number]) => action.key === "publish" ? "Public links" : action.label;
  return <DropdownMenu.Root modal={false} open={open} onOpenChange={value => {
    if (value) followedLink.current = false;
    setOpen(value);
  }}>
    <DropdownMenu.Trigger asChild>
      <Button type="button" variant="ghost" data-slot="vault-page-switcher" aria-label={`Navigate in ${vault}`}
        className="h-9 shrink-0 gap-1.5 rounded-[var(--radius-sm)] border border-border px-2.5 text-sm font-medium text-foreground focus-visible:ring-inset focus-visible:ring-offset-0 data-[state=open]:bg-surface-selected data-[state=open]:text-surface-selected-foreground max-lg:h-11">
        <span>Navigate</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-foreground-muted" aria-hidden />
      </Button>
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal>
      <DropdownMenu.Content align="start" sideOffset={8} collisionPadding={12} aria-label="Vault pages" aria-labelledby={undefined}
        onCloseAutoFocus={event => { if (followedLink.current) event.preventDefault(); }}
        className="z-[var(--z-popover)] max-h-[var(--radix-dropdown-menu-content-available-height)] min-w-52 max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-[var(--radius-md)] border border-border bg-surface p-1 shadow-md">
        <DropdownMenu.Label className="max-w-72 border-b border-border px-3 py-2 text-xs text-foreground-muted [overflow-wrap:anywhere]">{vault}</DropdownMenu.Label>
        {actions.map(action => <Fragment key={action.key}>
          {action.key === "members" && <DropdownMenu.Separator className="my-1 h-px bg-border" />}
          <DropdownMenu.Item asChild>
          <Link to={action.href} aria-current={action.key === page ? "page" : undefined}
            onClick={event => {
              if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && !event.defaultPrevented) {
                // Page navigation is always independent of the breadcrumb's
                // link guard, including settings with an unsaved form.
                if (!requestNavigation(action.href)) {
                  event.preventDefault();
                  followedLink.current = true;
                  setOpen(false);
                  return;
                }
                followedLink.current = action.href !== pathname;
                if (followedLink.current) onNavigateIntent?.();
              }
            }}
            onKeyDownCapture={event => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)) event.stopPropagation();
            }}
            className={cn("flex min-h-11 items-center gap-2 rounded-[var(--radius-sm)] px-3 text-sm outline-none data-[highlighted]:bg-surface-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              action.key === page ? "font-semibold text-link" : "text-foreground",
            )}>
            <action.icon className="h-4 w-4 shrink-0 text-foreground-muted" aria-hidden />
            <span className="flex-1">{labelFor(action)}</span>
            {action.key === page && <Check className="h-4 w-4 text-link" aria-hidden />}
          </Link>
        </DropdownMenu.Item></Fragment>)}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>;
}
