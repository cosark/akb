import { useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown } from "lucide-react";
import { getVaultPageActions } from "@/components/title-bar";
import { Button } from "@/components/ui/button";
import type { FocusedVaultPage } from "@/lib/vault-workspace";
import { cn } from "@/lib/utils";
import { useResourceNavigation } from "@/contexts/resource-navigation-context";

/** Focused tasks and document readers retain Vault navigation without a second bar. */
export function VaultPageSwitcher({ vault, page, onNavigateIntent }: { vault: string; page?: FocusedVaultPage; onNavigateIntent?: () => void }) {
  const { pathname } = useLocation();
  const { requestNavigation } = useResourceNavigation();
  const [open, setOpen] = useState(false);
  const followedLink = useRef(false);
  const actions = getVaultPageActions(vault).filter(action => action.key !== "search");
  const labelFor = (action: (typeof actions)[number]) => action.key === "publish" ? "Public links" : action.label;
  const current = actions.find(action => action.key === page);
  return <DropdownMenu.Root modal={false} open={open} onOpenChange={value => {
    if (value) followedLink.current = false;
    setOpen(value);
  }}>
    <DropdownMenu.Trigger asChild>
      <Button type="button" variant="ghost" data-slot="vault-page-switcher" aria-label={current ? `Vault pages, current: ${labelFor(current)}` : `Vault pages for ${vault}`}
        title={current ? undefined : `Pages in ${vault}`}
        className={cn("h-9 min-w-0 max-w-full gap-1.5 rounded-[var(--radius-sm)] px-2 text-sm font-semibold text-foreground data-[state=open]:bg-surface-selected data-[state=open]:text-surface-selected-foreground max-lg:h-11",
          !current && "shrink-0 border border-border font-medium focus-visible:ring-inset focus-visible:ring-offset-0",
        )}>
        <span aria-current={current ? "page" : undefined} className="truncate">{current ? labelFor(current) : "Vault"}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-foreground-muted" aria-hidden />
      </Button>
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal>
      <DropdownMenu.Content align="start" sideOffset={8} collisionPadding={12} aria-label="Vault pages" aria-labelledby={undefined}
        onCloseAutoFocus={event => { if (followedLink.current) event.preventDefault(); }}
        className="z-[var(--z-popover)] max-h-[var(--radix-dropdown-menu-content-available-height)] min-w-52 max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-[var(--radius-md)] border border-border bg-surface p-1 shadow-md">
        {!current && <DropdownMenu.Label className="max-w-72 border-b border-border px-3 py-2 text-xs text-foreground-muted [overflow-wrap:anywhere]">{vault}</DropdownMenu.Label>}
        {actions.map(action => <DropdownMenu.Item key={action.key} asChild>
          <Link to={action.href} aria-current={action.key === page ? "page" : undefined}
            onClick={event => {
              if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && !event.defaultPrevented) {
                // The independent reader menu is outside the breadcrumb's link
                // guard. Close it before the editor owns its leave confirmation.
                if (!current && !requestNavigation(action.href)) {
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
        </DropdownMenu.Item>)}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>;
}
