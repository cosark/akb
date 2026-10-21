import { useMemo, useState, type MouseEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowLeft, Clock3, FileText, Files, FolderOpen, Search, Table2 } from "lucide-react";
import { useCollectionProof, useVaultTree, type TreeNode } from "@/hooks/use-vault-tree";
import { useAccessVerification, useCurrentUser } from "@/contexts/current-user-context";
import { useResourceNavigation } from "@/contexts/resource-navigation-context";
import { useRecentCollections } from "@/lib/recent-collections";
import { isReservedCollection } from "@/lib/skill";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LoadingState, InlineLoadingState } from "@/components/ui/loading-state";
import { Panel } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";

const focus = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";
const PAGE = 24;

function collectionRows(tree: TreeNode[]): TreeNode[] {
  return tree.flatMap(node => node.kind === "collection" ? [node, ...collectionRows(node.children ?? [])] : []);
}

function inventory(node: TreeNode): string {
  const counts = { collection: 0, document: 0, table: 0, file: 0 };
  function visit(children: TreeNode[]) {
    for (const child of children) { counts[child.kind]++; if (child.children) visit(child.children); }
  }
  visit(node.children ?? []);
  return (Object.entries(counts) as Array<[keyof typeof counts, number]>).filter(([, count]) => count > 0)
    .map(([kind, count]) => `${count.toLocaleString()} ${kind}${count === 1 ? "" : "s"}`).join(" · ") || "Empty collection";
}

/** Collection index and its selected contents share the explorer's verified cache. */
export function VaultCollectionsWorkspace({ vault, enabled }: { vault: string; enabled: boolean }) {
  const user = useCurrentUser();
  const { checking } = useAccessVerification();
  const { requestNavigation } = useResourceNavigation();
  const location = useLocation();
  const requested = new URLSearchParams(location.search).get("collection") || "";
  const [filter, setFilter] = useState("");
  const [visible, setVisible] = useState(PAGE);
  const [selection, setSelection] = useState(requested);
  // Picker, explorer and browser history can change the destination without
  // using this directory's links. Search and pagination belong to that view.
  if (selection !== requested) {
    setSelection(requested);
    setFilter("");
    setVisible(PAGE);
  }
  const history = useRecentCollections(user?.user_id);
  const query = useVaultTree(vault, "unarchived", { collection: requested || undefined, enabled: enabled && !checking });
  const proof = useCollectionProof(vault, requested, enabled && !checking);
  const denied = query.accessDenied || Boolean(requested && proof.accessDenied);
  const tree = enabled && !checking && !denied && !query.showingPreviousScope ? query.tree : null;
  const error = query.error || (requested ? proof.error : "");
  const collections = useMemo(() => tree ? collectionRows(tree) : [], [tree]);
  const selected = requested && proof.verified ? collections.find(node => node.path === requested) ?? proof.node : undefined;
  const ancestors = selected ? selected.path.split("/").slice(0, -1).map((_part, index, parts) =>
    collections.find(node => node.path === parts.slice(0, index + 1).join("/")))
    .filter((node): node is TreeNode => node !== undefined && !isReservedCollection(node.path)) : [];
  const parent = ancestors.at(-1);
  const queryText = filter.trim().toLocaleLowerCase();
  const direct = selected ? selected.children ?? [] : tree ?? [];
  const cards = (queryText ? collections : direct.filter(node => node.kind === "collection"))
    .filter(node => !isReservedCollection(node.path) && (!queryText || `${node.name} ${node.path}`.toLocaleLowerCase().includes(queryText)));
  const resources = queryText ? [] : direct.filter(node => node.kind !== "collection");
  const recent = !requested && !queryText && tree && !denied ? history.filter(item => item.vault === vault)
    .flatMap(item => { const node = collections.find(row => row.path === item.path); return node && !isReservedCollection(node.path) ? [node] : []; }).slice(0, 3) : [];

  function href(path: string) { return path ? `/vault/${encodeURIComponent(vault)}?collection=${encodeURIComponent(path)}` : `/vault/${encodeURIComponent(vault)}`; }
  function navigationState(target: string) {
    return target === href("") || target.startsWith(href("") + "?collection=")
      ? { vaultPageNavigation: target, collectionView: "main" }
      : { vaultPageNavigation: target };
  }
  function follow(event: MouseEvent<HTMLAnchorElement>, target: string) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (!requestNavigation(target, { state: navigationState(target) })) event.preventDefault();
    else { setFilter(""); setVisible(PAGE); }
  }
  function collectionLink(node: TreeNode, compact = false) {
    const target = href(node.path);
    if (compact) return <Link key={node.path} to={target} state={{ vaultPageNavigation: target, collectionView: "main" }} onClick={event => follow(event, target)}
      aria-label={`Open collection ${node.path}`} className={`inline-flex min-h-9 min-w-0 items-center gap-1.5 rounded-[var(--radius-sm)] border border-border bg-surface px-2.5 py-1.5 text-ui text-foreground hover:bg-surface-hover max-sm:min-h-11 pointer-coarse:min-h-11 ${focus}`}>
      <Clock3 className="h-3.5 w-3.5 shrink-0 text-foreground-muted" aria-hidden /><span className="break-words [overflow-wrap:anywhere]">{node.name}</span>
    </Link>;
    const parent = node.path.split("/").slice(0, -1).join(" / ");
    return <li key={node.path} className="min-w-0"><Panel variant="workspace" flush inset={false} className="collection-sheet relative h-full min-w-0 transition-token hover:border-border-strong hover:bg-surface-hover">
      <Link to={target} state={{ vaultPageNavigation: target, collectionView: "main" }} onClick={event => follow(event, target)} aria-label={`Open collection ${node.path}`}
        className={`group flex min-h-24 min-w-0 flex-col rounded-[var(--radius-md)] p-3 pr-6 ${focus}`}>
        <span className="flex min-w-0 items-start gap-2"><FolderOpen className="mt-0.5 h-4 w-4 shrink-0 text-link" aria-hidden /><span className="min-w-0 break-words text-ui font-semibold leading-5 text-foreground group-hover:text-link [overflow-wrap:anywhere]">{node.name}</span></span>
        {parent && <span className="mt-1 break-words pl-6 text-xs text-foreground-muted [overflow-wrap:anywhere]">{parent}</span>}
        {query.complete && <span className="mt-auto break-words pt-3 text-xs leading-4 text-foreground-muted">{inventory(node)}</span>}
      </Link>
    </Panel></li>;
  }
  function resourceHref(node: TreeNode) {
    const kind = node.kind === "document" ? "doc" : node.kind;
    return `/vault/${encodeURIComponent(vault)}/${kind}/${encodeURIComponent(node.path)}`;
  }

  return <section aria-label="Collection workspace" className="@container/collections min-w-0" aria-busy={query.loading || query.refreshing || query.loadingMore || Boolean(requested && proof.loading)}>
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
      <div className="min-w-0">
        {requested ? <nav aria-label="Collection location">
          <ol className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
            <li className="min-w-0"><Link to={href("")} state={navigationState(href(""))} onClick={event => follow(event, href(""))}
              className={`inline-flex min-h-9 items-center gap-1.5 rounded-[var(--radius-sm)] text-link max-sm:min-h-11 pointer-coarse:min-h-11 ${focus}`}>
              {!parent && <ArrowLeft className="h-3.5 w-3.5 shrink-0" aria-hidden />}All collections
            </Link></li>
            {ancestors.map(node => <li key={node.path} className="flex min-w-0 items-center gap-1.5">
              <span aria-hidden className="text-foreground-muted">/</span>
              <Link to={href(node.path)} state={navigationState(href(node.path))} onClick={event => follow(event, href(node.path))}
                aria-label={node === parent ? `Back to collection ${node.path}` : `Open collection ${node.path}`}
                className={`inline-flex min-h-9 min-w-0 items-center gap-1.5 rounded-[var(--radius-sm)] text-link max-sm:min-h-11 pointer-coarse:min-h-11 ${focus}`}>
                {node === parent && <ArrowLeft className="h-3.5 w-3.5 shrink-0" aria-hidden />}<span className="break-words [overflow-wrap:anywhere]">{node.name}</span>
              </Link>
            </li>)}
            {selected && <li className="flex min-w-0 items-center gap-1.5" aria-current="page"><span aria-hidden className="text-foreground-muted">/</span><h2 className="min-w-0 break-words text-sm font-semibold [overflow-wrap:anywhere]">{selected.name}</h2></li>}
          </ol>
        </nav> : <h2 className="text-sm font-semibold">Collections</h2>}
      </div>
      <div className="relative min-w-0 flex-1 basis-52 @[32rem]/collections:max-w-64">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-muted" aria-hidden />
        <Input aria-label="Find a collection" placeholder="Find a collection" value={filter} onChange={event => { setFilter(event.target.value); setVisible(PAGE); }} className="h-9 pl-9 text-ui max-sm:h-11 max-sm:text-base pointer-coarse:h-11" />
      </div>
    </div>
    {error && <Alert variant="destructive" className="mb-3" title="Collections could not be loaded">
      {tree ? "Previous collections remain visible. " : "Try loading the collection directory again. "}<Button variant="outline" size="sm" className="max-sm:min-h-11 pointer-coarse:min-h-11" loading={query.refreshing || proof.refreshing} onClick={query.refetch}>Retry collections</Button>
    </Alert>}
    {(!tree || (requested && proof.loading)) && !error ? <LoadingState label="Loading collections"><div className="grid grid-cols-1 gap-3 @[28rem]/collections:grid-cols-2" aria-hidden>{Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-24 w-full" />)}</div></LoadingState> : tree && <>
      {query.refreshing && <InlineLoadingState label="Updating collections" className="mb-3" />}
      {requested && !selected ? <div role="status" className="py-6 text-ui text-foreground-muted">{proof.missing ? "This collection is unavailable. Choose another collection or return to all collections." : "This collection has not been verified in the loaded list."}
        {proof.hasMore && <Button variant="outline" size="sm" className="mt-3" loading={proof.loadingMore} onClick={proof.loadMore}>Load more collections to verify this location</Button>}
      </div> : <>
        {recent.length > 0 && <nav aria-label="Recently visited collections" className="mb-4">
          <h3 className="mb-2 text-xs font-medium text-foreground-muted">Recently visited</h3>
          <div className="flex flex-wrap gap-2">{recent.map(node => collectionLink(node, true))}</div>
        </nav>}
        {cards.length > 0 ? <ul aria-label={queryText ? "Matching collections" : "Collections"} className="grid auto-rows-fr grid-cols-1 gap-3 @[28rem]/collections:grid-cols-2 @[44rem]/collections:grid-cols-3">{cards.slice(0, visible).map(node => collectionLink(node))}</ul>
          : (queryText || !selected || resources.length === 0) && <p role="status" className="py-5 text-ui text-foreground-muted">{queryText ? query.complete ? "No collections match this name." : "No loaded collections match this name." : query.complete ? selected ? "This collection is empty." : "No collections yet. Add a collection from the Content menu." : "No collections are loaded in this view yet."}</p>}
        {cards.length > visible && <Button variant="outline" size="sm" className="mt-3 max-sm:min-h-11 pointer-coarse:min-h-11" onClick={() => setVisible(count => count + PAGE)}>Show more collections ({cards.length - visible} remaining)</Button>}
        {resources.length > 0 && <section aria-label="Collection resources" className="mt-5">
          <h3 className="mb-2 text-xs font-medium text-foreground-muted">{selected ? "Contents" : "At vault root"}</h3>
          <Panel variant="workspace" flush><ul className="divide-y divide-border">{resources.slice(0, visible).map(node => {
            const Icon = node.kind === "document" ? FileText : node.kind === "table" ? Table2 : Files;
            const target = resourceHref(node);
            return <li key={`${node.kind}:${node.path}`}><Link to={target} state={{ vaultPageNavigation: target }} onClick={event => follow(event, target)} className={`flex min-h-11 min-w-0 items-center gap-2 px-3 py-2 text-ui hover:bg-surface-hover ${focus}`}><Icon className="h-4 w-4 shrink-0 text-foreground-muted" aria-hidden /><span className="min-w-0 flex-1 break-words [overflow-wrap:anywhere]">{node.name}</span><span className="text-xs text-foreground-muted">{node.kind}</span></Link></li>;
          })}</ul></Panel>
          {resources.length > visible && <Button variant="outline" size="sm" className="mt-3 max-sm:min-h-11 pointer-coarse:min-h-11" onClick={() => setVisible(count => count + PAGE)}>Show more contents ({resources.length - visible} remaining)</Button>}
        </section>}
      </>}
      {query.hasMore && <div className="mt-3"><p className="mb-2 text-xs text-foreground-muted">Only loaded items are shown. Load more to continue browsing or searching.</p><Button variant="outline" size="sm" loading={query.loadingMore} onClick={query.loadMore}>Load more items</Button></div>}
    </>}
  </section>;
}
