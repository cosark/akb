import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Box, Plus, Search, Star } from "lucide-react";
import { useVaultFavorites } from "@/hooks/use-vault-favorites";
import type { VaultSummary } from "@/hooks/use-vaults";
import { useCurrentUser } from "@/contexts/current-user-context";
import { useOpenVaultCreateDialog } from "@/contexts/vault-create-dialog-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WorkspaceSectionHeader } from "@/components/ui/workspace-section-header";

type DirectoryVault = VaultSummary & { description?: string; status?: string };
type Filter = "all" | "favorites" | "owned";
const PAGE = 30;

/** An actual directory is the primary entry point even with the navigator hidden. */
export function VaultDirectory({ vaults }: { vaults: DirectoryVault[] }) {
  const create = useOpenVaultCreateDialog();
  const user = useCurrentUser();
  const { isFavorite, toggleFavorite, favOrder } = useVaultFavorites();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [visible, setVisible] = useState(PAGE);
  const favoriteButtons = useRef(new Map<string, HTMLButtonElement>());
  const favoritesFilter = useRef<HTMLButtonElement>(null);
  const pendingFavoriteFocus = useRef<{ source: HTMLButtonElement; index: number } | null>(null);
  const matches = useMemo(() => vaults.filter(vault =>
    (filter !== "owned" || vault.role === "owner") &&
    (filter !== "favorites" || isFavorite(vault.id)) &&
    (vault.name + " " + (vault.description ?? "")).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  ).sort((a, b) => {
    const aFav = isFavorite(a.id), bFav = isFavorite(b.id);
    return aFav !== bFav ? (aFav ? -1 : 1) : aFav ? favOrder(a.id) - favOrder(b.id) : a.name.localeCompare(b.name);
  }), [vaults, filter, query, isFavorite, favOrder]);

  useLayoutEffect(() => {
    const pending = pendingFavoriteFocus.current;
    pendingFavoriteFocus.current = null;
    if (!pending || pending.source.isConnected ||
      (document.activeElement !== document.body && document.activeElement !== pending.source)) return;

    const remaining = matches.slice(0, visible);
    const next = remaining[Math.min(pending.index, remaining.length - 1)];
    const target = next && favoriteButtons.current.get(next.id);
    if (target && !target.disabled) target.focus();
    else favoritesFilter.current?.focus();
  }, [matches, visible]);

  return <section aria-labelledby="vault-directory-heading" className="@container/directory mx-auto w-full max-w-6xl p-3 sm:p-4 lg:p-6">
    <h1 className="sr-only">Vaults</h1>
    <WorkspaceSectionHeader id="vault-directory-heading" title="Your vaults" icon={Box} tone="collection"
      description="Open a space for related documents, tables, and files."
      right={<Button variant="outline" size="sm" onClick={create}><Plus className="h-4 w-4" aria-hidden />New vault</Button>} />
    <div className="mt-4 flex flex-wrap items-end gap-3">
      <div className="min-w-0 flex-1 basis-64">
        <Label htmlFor="vault-directory-query" className="mb-1.5 block text-xs">Find a vault</Label>
        <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-muted" aria-hidden />
          <Input id="vault-directory-query" value={query} placeholder="Filter by name or description" className="pl-9"
            onChange={event => { setQuery(event.target.value); setVisible(PAGE); }} />
        </div>
      </div>
      <div role="group" aria-label="Vault list filter" className="flex flex-wrap gap-1 rounded-[var(--radius-md)] border border-border p-1">
        {(["all", "favorites", "owned"] as const).map(value => <Button key={value} ref={value === "favorites" ? favoritesFilter : undefined} variant="ghost" size="sm" aria-pressed={filter === value}
          onClick={() => { setFilter(value); setVisible(PAGE); }}
          className={filter === value ? "bg-surface-selected text-surface-selected-foreground" : ""}>
          {value === "all" ? "All" : value === "favorites" ? "Favorites" : "Owned"}
        </Button>)}
      </div>
    </div>
    <p aria-label={vaults.length + (vaults.length === 1 ? " vault available" : " vaults available")} className="my-3 text-xs text-foreground-muted">
      {matches.length.toLocaleString()} {matches.length === 1 ? "vault" : "vaults"}{query || filter !== "all" ? " matching your filters" : " available"}
    </p>
    <ul aria-label="Available vaults" className="divide-y divide-border overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface">
      {matches.slice(0, visible).map(vault => <li key={vault.id} className="flex min-w-0 items-center gap-1 transition-token hover:bg-surface-hover">
        <Link to={"/vault/" + encodeURIComponent(vault.name)} className="group flex min-h-16 min-w-0 flex-1 items-center gap-3 px-4 py-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
          <Box className="h-4 w-4 shrink-0 text-link" aria-hidden />
          <span className="min-w-0 flex-1"><span className="block break-words text-sm font-semibold text-foreground group-hover:text-link">{vault.name}</span>
            {vault.description?.trim() && <span className="mt-1 block line-clamp-2 break-words text-sm text-foreground-muted">{vault.description}</span>}
          </span>
          <span className="hidden shrink-0 gap-2 @min-[32rem]/directory:flex">{vault.status === "archived" && <Badge variant="archived">Archived</Badge>}{vault.role === "reader" && <Badge>Read only</Badge>}</span>
          <ArrowRight className="h-4 w-4 shrink-0 text-foreground-muted" aria-hidden />
        </Link>
        <Button ref={node => { if (node) favoriteButtons.current.set(vault.id, node); else favoriteButtons.current.delete(vault.id); }}
          variant="ghost" size="icon" disabled={!user?.user_id} aria-pressed={isFavorite(vault.id)}
          aria-label={(isFavorite(vault.id) ? "Remove " : "Add ") + vault.name + (isFavorite(vault.id) ? " from favorites" : " to favorites")}
          className="mr-2 shrink-0" onClick={event => {
            // A keyboard/assistive activation removes this focused row only in Favorites.
            if (filter === "favorites" && isFavorite(vault.id) && event.detail === 0 && document.activeElement === event.currentTarget) {
              pendingFavoriteFocus.current = { source: event.currentTarget, index: matches.findIndex(match => match.id === vault.id) };
            }
            toggleFavorite(vault.id);
          }}>
          <Star className={isFavorite(vault.id) ? "h-4 w-4 fill-current text-link" : "h-4 w-4 text-foreground-muted"} aria-hidden />
        </Button>
      </li>)}
    </ul>
    {matches.length === 0 && <div role="status" className="py-8 text-center">
      <p className="text-sm font-medium">{filter === "favorites" && !query ? "No favorite vaults yet" : "No vaults match these filters"}</p>
      <p className="mt-1 text-sm text-foreground-muted">{filter === "favorites" && !query ? "Use the star beside a vault to keep it close." : "Try another name or show all available vaults."}</p>
      <Button variant="link" className="mt-2" onClick={() => { setQuery(""); setFilter("all"); setVisible(PAGE); }}>Show all vaults</Button>
    </div>}
    {matches.length > visible && <Button variant="outline" className="mt-3 w-full" onClick={() => setVisible(count => count + PAGE)}>
      Show more vaults ({(matches.length - visible).toLocaleString()} remaining)
    </Button>}
  </section>;
}
