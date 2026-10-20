import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Box, type LucideIcon } from "lucide-react";
import { TooltipText } from "@/components/ui/tooltip-text";
import { cn } from "@/lib/utils";
import { useResourceNavigation } from "@/contexts/resource-navigation-context";

/** Shared location grammar for Vault pages and their resource readers. */
export function VaultBreadcrumb({
  vault, title, kind, icon: KindIcon, children, vaultAction, className, ariaLabel = "Current page",
}: {
  vault: string;
  title: string;
  kind?: string;
  icon?: LucideIcon;
  /** Optional Collection list items between the Vault and current location. */
  children?: ReactNode;
  /** Page-level controls only; standalone preview trails omit this slot. */
  vaultAction?: ReactNode;
  className?: string;
  ariaLabel?: string;
}) {
  const { requestNavigation } = useResourceNavigation();
  return (
    <nav aria-label={ariaLabel} className={cn("@container/resource-location min-w-0 text-sm", className)}
      onClickCapture={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
        const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>("a[href]");
        // Menus can portal from the Vault action. Their own leave guard owns
        // navigation, even though React events still bubble through this nav.
        if (!anchor || anchor.dataset.slot === "vault-page-link" || anchor.target === "_blank" || anchor.origin !== window.location.origin) return;
        if (!requestNavigation(`${anchor.pathname}${anchor.search}${anchor.hash}`)) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}>
      <ol className="flex min-w-0 items-center gap-1.5">
        <li className={cn("flex min-w-0 items-center", vaultAction ? "max-w-[40%]" : "max-w-[30%]", kind && "@max-xs/resource-location:max-w-none @max-xs/resource-location:shrink-0")}>
          <Link
            to={`/vault/${encodeURIComponent(vault)}`}
            title={vault}
            className={cn("inline-flex min-w-0 items-center gap-1.5 rounded-[var(--radius-sm)] text-foreground-muted transition-token hover:text-link focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
              kind && "@max-xs/resource-location:h-11 @max-xs/resource-location:w-9 @max-xs/resource-location:justify-center",
            )}
          >
            <Box className="h-4 w-4 shrink-0" aria-hidden />
            <span className={cn("truncate", kind && "@max-xs/resource-location:sr-only")}>{vault}</span>
          </Link>
          {vaultAction}
        </li>
        {children}
        <li className="flex min-w-0 flex-1 items-center gap-1.5">
          <span aria-hidden className="shrink-0 text-subtle">/</span>
          <TooltipText
            aria-current="page"
            tabIndex={kind ? 0 : undefined}
            side="bottom"
            className="min-w-0 truncate rounded-[var(--radius-sm)] font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          >{title}</TooltipText>
          {KindIcon && <span title={kind} className="inline-flex shrink-0 text-foreground-muted">
            <KindIcon className="h-4 w-4" aria-hidden />
          </span>}
          {kind && <span className="sr-only">({kind})</span>}
        </li>
      </ol>
    </nav>
  );
}
