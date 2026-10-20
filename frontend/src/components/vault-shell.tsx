import { Outlet, useLocation, useNavigate, useParams, useOutletContext } from "react-router-dom";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { RailCollapseButton } from "@/components/navigation-rail-controls";
import { AppPageLocation } from "@/components/app-page-location";
import { VaultExplorer } from "@/components/vault-explorer";
import { VaultCreateDialog } from "@/components/vault-create-dialog";
import { DocumentCreateDialog } from "@/components/document-create-dialog";
import { VaultRail } from "@/components/vault-rail";
import { TitleBar } from "@/components/title-bar";
import { ErrorBoundary } from "@/components/error-boundary";
import { VaultRefreshProvider } from "@/contexts/vault-refresh-context";
import { VaultCreateDialogProvider } from "@/contexts/vault-create-dialog-context";
import {
  DocumentCreateDialogProvider,
  type DocumentCreateDialogOptions,
} from "@/contexts/document-create-dialog-context";
import { useColumnResize } from "@/hooks/use-column-resize";
import { cn } from "@/lib/utils";
import { focusedVaultPageForPath } from "@/lib/vault-workspace";

const TREE_VISIBLE_KEY = "akb.treeVisible";
const VAULT_COLLAPSED_KEY = "akb.vaultRailCollapsed";

export interface VaultNavigationControl {
  open: boolean;
  onToggle: () => void;
}

/**
 * Content exploration retains Collections; Vault-level tasks omit it. All named
 * Vault routes share the same header menu. Explicit rail choices
 * survive the presentation change, including browser history and direct entry.
 */
export function VaultShell() {
  const { name } = useParams<{ name: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const layout = useOutletContext<{
    setVaultNavigationWidth?: (width: number) => void;
    setVaultNavigationControl?: (control: VaultNavigationControl | null) => void;
    minimumVaultWorkspaceWidth?: number;
  } | null>();
  const focusedPage = focusedVaultPageForPath(location.pathname);
  const isFocusedWorkspace = focusedPage !== null;
  const isGraph = focusedPage === "graph";
  const isDocument = location.pathname.includes("/doc/");
  const isTable = location.pathname.includes("/table/");
  const isFile = location.pathname.includes("/file/");
  const isResourceViewer = isDocument || isTable || isFile;
  const isPublications = focusedPage === "publish";
  const isSearch = location.pathname.endsWith("/search");
  const isMembers = focusedPage === "members";
  const isSettings = focusedPage === "settings";
  const isActivity = location.pathname.endsWith("/activity");
  const overviewPath = name ? `/vault/${encodeURIComponent(name)}` : "";
  const isOverview =
    !!overviewPath && location.pathname.replace(/\/+$/, "") === overviewPath;
  const [createVaultOpen, setCreateVaultOpen] = useState(false);
  const createVaultTriggerRef = useRef<HTMLElement | null>(null);
  const [createDocument, setCreateDocument] = useState({
    open: false,
    collection: "",
    session: 0,
  });
  const createDocumentTriggerRef = useRef<HTMLElement | null>(null);
  const [desktopNav, setDesktopNav] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(min-width: 1024px)").matches
      : true,
  );
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [workspaceWidth, setWorkspaceWidth] = useState(0);
  const [minimumContentWidth, setMinimumContentWidth] = useState(656);
  const [mobileRailCollapsed, setMobileRailCollapsed] = useState(false);
  const [visible, setVisible] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return window.localStorage.getItem(TREE_VISIBLE_KEY) !== "0";
  });
  const [routeTreeOverride, setRouteTreeOverride] = useState<{
    key: string;
    visible: boolean;
  } | null>(null);
  const tree = useColumnResize({
    storageKey: "akb.treeWidth.v2",
    min: 220,
    max: 480,
    default: 258,
  });
  // Vault switcher rail (expanded mode) — drag-resizable like the tree, its own
  // persisted width. Collapsed mode stays a fixed w-14 icon rail.
  const rail = useColumnResize({
    storageKey: "akb.vaultRailWidth.v2",
    min: 192,
    max: 320,
    default: 218,
  });

  // The vault column can simplify to a thin icon rail (persisted) when the user
  // wants the space back; the tree column collapses independently via ⌘\.
  const [vaultCollapsed, setVaultCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(VAULT_COLLAPSED_KEY) === "1";
  });
  const toggleVaultCollapsed = useCallback(() => {
    setVaultCollapsed((c) => {
      const next = !c;
      window.localStorage.setItem(VAULT_COLLAPSED_KEY, next ? "1" : "0");
      return next;
    });
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const sync = () => setDesktopNav(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  const setTreeVisible = useCallback((next: boolean) => {
    setVisible(next);
    window.localStorage.setItem(TREE_VISIBLE_KEY, next ? "1" : "0");
  }, []);

  // A Collection deep link may reveal its tree without changing the user's
  // saved rail preference. Ordinary section changes retain the same rail.
  const collectionTarget = location.pathname === `/vault/${encodeURIComponent(name ?? "")}`
    ? new URLSearchParams(location.search).get("collection") : null;
  const routeTreeKey = collectionTarget ? `collection:${location.key}` : "";
  const effectiveTreeVisible = collectionTarget
    ? routeTreeOverride?.key === routeTreeKey ? routeTreeOverride.visible : true
    : visible;
  const setEffectiveTreeVisible = useCallback(
    (next: boolean) => {
      if (collectionTarget) {
        setRouteTreeOverride({ key: routeTreeKey, visible: next });
        return;
      }
      setTreeVisible(next);
    },
    [routeTreeKey, setTreeVisible, collectionTarget],
  );

  // Callback-ref pattern: children publish their refetch fns on mount; the
  // shell stores them in refs and exposes stable thunks via context.
  const refetchTreeRef = useRef<() => void>(() => {});
  const refetchVaultsRef = useRef<() => void>(() => {});
  const refetchTree = useCallback(() => refetchTreeRef.current(), []);
  const refetchVaults = useCallback(() => refetchVaultsRef.current(), []);
  const onTreeRefetchReady = useCallback((fn: () => void) => {
    refetchTreeRef.current = fn;
  }, []);
  const onVaultsRefetchReady = useCallback((fn: () => void) => {
    refetchVaultsRef.current = fn;
  }, []);
  const openCreateVault = useCallback(() => {
    if (document.activeElement instanceof HTMLElement) {
      createVaultTriggerRef.current = document.activeElement;
    }
    setMobileNavOpen(false);
    setCreateVaultOpen(true);
  }, []);
  const handleVaultCreated = useCallback(
    (vaultName: string) => {
      setCreateVaultOpen(false);
      refetchVaults();
      navigate(`/vault/${vaultName}`);
    },
    [navigate, refetchVaults],
  );
  const openCreateDocument = useCallback(
    (options?: DocumentCreateDialogOptions) => {
      if (!name) return;
      if (document.activeElement instanceof HTMLElement) {
        createDocumentTriggerRef.current = document.activeElement;
      }
      setMobileNavOpen(false);
      setCreateDocument((current) => ({
        open: true,
        collection: options?.collection?.trim() ?? "",
        session: current.session + 1,
      }));
    },
    [name],
  );
  const handleDocumentCreated = useCallback(
    (path?: string) => {
      setCreateDocument((current) => ({ ...current, open: false }));
      if (!name) return;
      navigate(
        path
          ? `/vault/${name}/doc/${encodeURIComponent(path)}`
          : `/vault/${name}`,
      );
    },
    [name, navigate],
  );

  const workspaceNavigationWidth =
    (vaultCollapsed ? 56 : rail.width) +
    (!vaultCollapsed ? 1 : 0) +
    (name && !isFocusedWorkspace ? (effectiveTreeVisible ? tree.width : 40) : 0) + 1;
  // Freeze only the sizing input during a gesture, so crossing the responsive
  // boundary cannot remove a handle while it still owns pointer capture.
  const settledNavigationWidth =
    (vaultCollapsed ? 56 : rail.settledWidth) + (!vaultCollapsed ? 1 : 0) +
    (name && !isFocusedWorkspace ? (effectiveTreeVisible ? tree.settledWidth : 40) : 0) + 1;
  // Measure the workspace after the personal rail, not a viewport breakpoint.
  // A narrow reading surface temporarily uses the existing navigation drawer;
  // neither the saved widths nor the user's expanded/collapsed preference changes.
  useLayoutEffect(() => {
    const element = workspaceRef.current;
    if (!element) return;
    const measure = () => {
      // Rail widths and header requirements are layout CSS pixels. A visual
      // rect includes CSS zoom and would keep inline rails over a clipped header.
      setWorkspaceWidth(element.clientWidth);
      setMinimumContentWidth(41 * (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const navigationOverlay = desktopNav && workspaceWidth > 0 && workspaceWidth - settledNavigationWidth < (layout?.minimumVaultWorkspaceWidth ?? minimumContentWidth);
  const inlineNavigation = desktopNav && !navigationOverlay;
  useEffect(() => {
    if (!collectionTarget) setRouteTreeOverride(null);
    if (collectionTarget && !inlineNavigation) setMobileNavOpen(true);
  }, [collectionTarget, inlineNavigation]);
  const toggleNavigation = useCallback(() => setMobileNavOpen(open => !open), []);
  const publishControl = layout?.setVaultNavigationControl;
  useLayoutEffect(() => {
    publishControl?.(navigationOverlay ? { open: mobileNavOpen, onToggle: toggleNavigation } : null);
  }, [navigationOverlay, mobileNavOpen, toggleNavigation, publishControl]);
  useLayoutEffect(() => () => publishControl?.(null), [publishControl]);

  useEffect(() => {
    if (inlineNavigation || !mobileNavOpen) return;
    const panel = document.getElementById("vault-workspace-navigation");
    const frame = window.requestAnimationFrame(() => {
      if (!panel?.contains(document.activeElement)) panel?.querySelector<HTMLElement>('button:not([disabled]), a[href]')?.focus();
    });
    const close = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      setMobileNavOpen(false);
      document.getElementById("vault-navigation-trigger")?.focus();
    };
    // This is a navigation disclosure, not a modal. Let Tab leave naturally,
    // dismissing the covering panel before the next destination takes focus.
    // Portalled switcher/collection menus remain part of the disclosure.
    const leave = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || panel?.contains(target)
        || target.id === "vault-navigation-trigger"
        || target.closest('[data-radix-popper-content-wrapper], [role="dialog"]')) return;
      setMobileNavOpen(false);
    };
    window.addEventListener("keydown", close);
    document.addEventListener("focusin", leave);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", close);
      document.removeEventListener("focusin", leave);
    };
  }, [inlineNavigation, mobileNavOpen]);

  // Focused tasks have no Collections to toggle. Their explicit shortcut
  // toggles the Vault list instead, without changing the saved tree choice.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "\\") {
        e.preventDefault();
        if (!inlineNavigation) {
          setMobileNavOpen((open) => !open);
          return;
        }
        if (isFocusedWorkspace) toggleVaultCollapsed();
        else setEffectiveTreeVisible(!effectiveTreeVisible);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inlineNavigation, effectiveTreeVisible, setEffectiveTreeVisible, isFocusedWorkspace, toggleVaultCollapsed]);

  // No empty context column before a Vault is selected.
  const showTree = !!name && !isFocusedWorkspace && effectiveTreeVisible;
  const publishWidth = layout?.setVaultNavigationWidth;
  useLayoutEffect(() => {
    publishWidth?.(inlineNavigation ? workspaceNavigationWidth : 0);
  }, [inlineNavigation, workspaceNavigationWidth, publishWidth]);
  useLayoutEffect(() => () => publishWidth?.(0), [publishWidth]);
  const effectiveVaultCollapsed = desktopNav
    ? vaultCollapsed
    : mobileRailCollapsed;
  const toggleEffectiveVaultCollapsed = desktopNav
    ? toggleVaultCollapsed
    : () => setMobileRailCollapsed((collapsed) => !collapsed);
  const cancelRailResize = rail.cancel;
  const cancelTreeResize = tree.cancel;
  useEffect(() => {
    if (!desktopNav || effectiveVaultCollapsed) cancelRailResize();
    if (!inlineNavigation || !showTree) cancelTreeResize();
  }, [desktopNav, effectiveVaultCollapsed, inlineNavigation, showTree, cancelRailResize, cancelTreeResize]);
  const mobileTreeWidth = effectiveVaultCollapsed
    ? "calc(100vw - 3.5rem)"
    : "calc(100vw - 10rem)";

  return (
    <VaultCreateDialogProvider openCreateVault={openCreateVault}>
      <DocumentCreateDialogProvider openCreateDocument={openCreateDocument}>
        <VaultRefreshProvider
          refetchTree={refetchTree}
          refetchVaults={refetchVaults}
        >
        <div className="flex flex-col h-full min-h-0">
        <div ref={workspaceRef} className="relative flex flex-1 min-h-0 min-w-0" data-navigation-mode={inlineNavigation ? "inline" : "overlay"} data-workspace-mode={isFocusedWorkspace ? "focused" : "content"}>
          {!inlineNavigation && mobileNavOpen && <button type="button" tabIndex={-1} aria-label="Dismiss vault navigation"
            onClick={() => { setMobileNavOpen(false); document.getElementById("vault-navigation-trigger")?.focus(); }}
            className="absolute inset-0 z-40 cursor-default bg-foreground/20" />}
          {/* Selection and content exploration retain their own full-height rails. */}
          <div
            id="vault-workspace-navigation"
            className={cn(
              "absolute bottom-0 left-0 z-[var(--z-overlay)] hidden max-w-full shrink-0 min-h-0 bg-surface shadow-lg",
              desktopNav ? "top-0" : "top-14",
              inlineNavigation && "lg:static lg:z-auto lg:-mt-14 lg:h-[calc(100%+3.5rem)] lg:flex lg:shadow-none",
              mobileNavOpen && "flex",
              !showTree && "border-r border-border",
            )}
          >
            <div id="vault-list-sidebar" className="flex min-h-0 shrink-0">
            <VaultRail
              current={name || ""}
              onRefetchReady={onVaultsRefetchReady}
              onCreateVault={openCreateVault}
              collapsed={effectiveVaultCollapsed}
              onToggleCollapsed={toggleEffectiveVaultCollapsed}
              width={desktopNav ? rail.width : 160}
            />
            </div>
            {/* The desktop Vault list resizes independently of Collections,
                both inline and in the temporary overlay. Mobile stays bounded. */}
            {desktopNav && !effectiveVaultCollapsed && (
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize vault list"
                aria-controls="vault-list-sidebar"
                aria-valuemin={192}
                aria-valuemax={320}
                aria-valuenow={rail.width}
                aria-valuetext={`${rail.width}px`}
                tabIndex={0}
                onFocus={() => setMobileNavOpen(true)}
                title="Drag or use arrow keys to resize · double-click to reset"
                {...rail.handlers}
                className="group relative z-10 w-px shrink-0 cursor-col-resize touch-none outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background before:absolute before:inset-y-0 before:-left-1.5 before:w-3"
              >
                <div className="mx-auto h-full w-px bg-border transition-colors group-hover:bg-primary group-focus-visible:bg-primary group-active:bg-primary" />
              </div>
            )}
            {/* Collections is exclusively a content explorer, not a Vault menu. */}
            {showTree && (
              <div
                id="vault-collections-sidebar"
                data-slot="vault-collections-sidebar"
                className="flex h-full min-h-0 shrink-0 flex-col overflow-hidden bg-surface"
                style={{ width: inlineNavigation ? tree.width : desktopNav ? 320 : mobileTreeWidth }}
              >
                <VaultExplorer vault={name}
                  onCollapse={() => setEffectiveTreeVisible(false)}
                  onRefetchReady={onTreeRefetchReady} />
              </div>
            )}
            {!isFocusedWorkspace && !effectiveTreeVisible && !!name && (
              <nav
                aria-label="Collections (collapsed)"
                className="h-full w-10 shrink-0 border-r border-border"
              >
                <div className="flex h-10 items-center justify-center border-b border-border lg:h-14">
                  <RailCollapseButton collapsed label="Expand collections" onClick={() => setEffectiveTreeVisible(true)} />
                </div>
              </nav>
            )}
          </div>
          {/* resize handle — resizes the tree column; only when the tree shows.
              Delta-based, so the fixed rail offset doesn't affect it. */}
          {inlineNavigation && showTree && (
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize tree panel"
              aria-controls="vault-collections-sidebar"
              aria-valuemin={220}
              aria-valuemax={480}
              aria-valuenow={tree.width}
              aria-valuetext={`${tree.width}px`}
              tabIndex={0}
              onFocus={() => setMobileNavOpen(true)}
              title="Drag or use arrow keys to resize · double-click to reset"
              {...tree.handlers}
              className="group relative z-10 w-px shrink-0 cursor-col-resize touch-none outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background before:absolute before:inset-y-0 before:-left-1.5 before:w-3 lg:-mt-14 lg:h-[calc(100%+3.5rem)]"
            >
              <div className="mx-auto h-full w-px bg-border transition-colors group-hover:bg-primary group-focus-visible:bg-primary group-active:bg-primary" />
            </div>
          )}

          {/* Desktop location lives in the app header. Narrow screens keep the
              breadcrumb and navigation-drawer trigger in their own location row. */}
          <div className="@container/vault-content flex min-h-0 min-w-0 flex-1 flex-col">
            {!desktopNav && <TitleBar
              crumbs={[]}
              breadcrumb={<AppPageLocation mobile />}
              left={
                <button
                  type="button"
                  id="vault-navigation-trigger"
                  onClick={() => setMobileNavOpen((open) => !open)}
                  aria-label={
                    mobileNavOpen
                      ? "Close vault navigation"
                      : "Open vault navigation"
                  }
                  aria-expanded={mobileNavOpen}
                  aria-controls="vault-workspace-navigation"
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-md)] text-foreground-muted hover:bg-surface-hover hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {mobileNavOpen ? (
                    <PanelLeftClose className="h-4 w-4" aria-hidden />
                  ) : (
                    <PanelLeftOpen className="h-4 w-4" aria-hidden />
                  )}
                </button>
              }
              className="h-14 shrink-0 overflow-visible bg-surface pr-2 backdrop-blur-none"
              showBack={false}
            />}

            {isGraph || isResourceViewer || isSearch ? (
              <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-background">
                <ErrorBoundary resetKeys={[location.pathname]}>
                  <Outlet />
                </ErrorBoundary>
              </div>
            ) : (
              <div
                data-slot="vault-route-viewport"
                className={cn(
                  "min-h-0 min-w-0 flex-1 bg-background",
                  "overflow-y-auto",
                )}
              >
                <div
                  className={cn(
                    "w-full",
                    isOverview
                        ? "min-h-full px-2 py-3 lg:p-0"
                        : isActivity || isPublications || isMembers || isSettings
                          ? "px-3 py-5 lg:px-4 lg:py-6 xl:px-5"
                          : "px-5 py-5 lg:px-7 lg:py-6 xl:px-8",
                  )}
                >
                  <ErrorBoundary resetKeys={[location.pathname]}>
                    <Outlet />
                  </ErrorBoundary>
                </div>
              </div>
            )}
          </div>
        </div>
        </div>
        <VaultCreateDialog
          open={createVaultOpen}
          onOpenChange={setCreateVaultOpen}
          onCreated={handleVaultCreated}
          onOpenExisting={handleVaultCreated}
          returnFocusRef={createVaultTriggerRef}
        />
        {name && (
          <DocumentCreateDialog
            key={`${name}:${createDocument.session}`}
            open={createDocument.open}
            vault={name}
            initialCollection={createDocument.collection}
            onOpenChange={(open) =>
              setCreateDocument((current) => ({ ...current, open }))
            }
            onCreated={handleDocumentCreated}
            returnFocusRef={createDocumentTriggerRef}
            desktopLeftOffset={(inlineNavigation ? workspaceNavigationWidth : 0) + 16}
          />
        )}
        </VaultRefreshProvider>
      </DocumentCreateDialogProvider>
    </VaultCreateDialogProvider>
  );
}
