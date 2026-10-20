import { Fragment, useRef, useState } from "react";
import { Link, matchRoutes, useLocation } from "react-router-dom";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Portal as TooltipPortal } from "@radix-ui/react-tooltip";
import { Check, ChevronDown } from "lucide-react";
import { getVaultPageActions } from "@/components/title-bar";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { vaultMenuPageForComponent } from "@/lib/vault-workspace";
import { appRouteContract } from "@/app-route-contract";
import { cn } from "@/lib/utils";
import { useResourceNavigation } from "@/contexts/resource-navigation-context";

/** Quiet page menu placed beside the Vault's direct Overview link. */
export function VaultPageSwitcher({ vault, onNavigateIntent }: { vault: string; onNavigateIntent?: () => void }) {
  const { pathname } = useLocation();
  const { requestNavigation } = useResourceNavigation();
  const [open, setOpen] = useState(false);
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const followedLink = useRef(false);
  const match = matchRoutes([...appRouteContract], pathname)?.at(-1);
  if (match?.route.boundary !== "vault-shell" || match.params.name !== vault) return null;
  const page = vaultMenuPageForComponent(match.route.component);
  const actions = getVaultPageActions(vault).filter(action => action.key !== "search");
  const labelFor = (action: (typeof actions)[number]) => action.key === "publish" ? "Public links" : action.label;
  return <DropdownMenu.Root modal={false} open={open} onOpenChange={value => {
    if (value) followedLink.current = false;
    setTooltipOpen(false);
    setOpen(value);
  }}>
    <TooltipProvider delayDuration={300}>
      <Tooltip open={open ? false : tooltipOpen} onOpenChange={setTooltipOpen}>
        <TooltipTrigger asChild>
          <DropdownMenu.Trigger asChild>
            <Button type="button" variant="ghost" size="icon" data-slot="vault-page-switcher" aria-label={`Pages in ${vault}`}
              className="h-11 w-11 shrink-0 rounded-[var(--radius-sm)] p-0 text-foreground-muted hover:text-link focus-visible:ring-inset focus-visible:ring-offset-0 data-[state=open]:bg-surface-selected data-[state=open]:text-surface-selected-foreground lg:h-8 lg:w-8 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11">
              <ChevronDown className="h-4 w-4 shrink-0" aria-hidden />
            </Button>
          </DropdownMenu.Trigger>
        </TooltipTrigger>
        <TooltipPortal><TooltipContent side="bottom">Vault pages</TooltipContent></TooltipPortal>
      </Tooltip>
    </TooltipProvider>
    <DropdownMenu.Portal>
      <DropdownMenu.Content align="start" sideOffset={8} collisionPadding={12} aria-label="Vault pages" aria-labelledby={undefined}
        onCloseAutoFocus={event => { if (followedLink.current) event.preventDefault(); }}
        className="z-[var(--z-popover)] max-h-[var(--radix-dropdown-menu-content-available-height)] min-w-52 max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-[var(--radius-md)] border border-border bg-surface p-1 shadow-md">
        <DropdownMenu.Label className="max-w-72 border-b border-border px-3 py-2 text-xs text-foreground-muted [overflow-wrap:anywhere]">{vault}</DropdownMenu.Label>
        {actions.map(action => <Fragment key={action.key}>
          {action.key === "members" && <DropdownMenu.Separator className="my-1 h-px bg-border" />}
          <DropdownMenu.Item asChild>
          <Link to={action.href} data-slot="vault-page-link" aria-current={action.key === page ? "page" : undefined}
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
