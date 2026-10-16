import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Link, useLocation, useNavigate, useParams, type NavigateOptions } from "react-router-dom";
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  Globe,
  Lock,
  RotateCcw,
  Save,
  Settings2,
  ShieldCheck,
  Trash2,
  Unlock,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import {
  archiveVault,
  getDocument,
  getVaultInfo,
  unarchiveVault,
  updateVault,
} from "@/lib/api";
import { timeAgo } from "@/lib/utils";
import { SkillSection } from "@/components/skill/skill-section";
import { VAULT_SKILL_PATH } from "@/lib/skill";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CopyButton } from "@/components/ui/copy-button";
import { Label } from "@/components/ui/label";
import { PageShell } from "@/components/ui/page-shell";
import { Panel } from "@/components/ui/panel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Segmented } from "@/components/ui/segmented";
import { WorkspaceSectionHeader } from "@/components/ui/workspace-section-header";
import { TonalIcon } from "@/components/ui/tonal-icon";
import { Textarea } from "@/components/ui/textarea";
import { DeleteVaultDialog } from "@/components/delete-vault-dialog";
import { RoleBadge, VaultStateBadge } from "@/components/status-badge";
import { useOptionalSearchStatus } from "@/hooks/use-search-status";
import { SearchStatusStages } from "@/components/search-status-stages";
import { useVaultRefresh } from "@/contexts/vault-refresh-context";
import { useAccessVerification, useCurrentUser } from "@/contexts/current-user-context";
import { useResourceNavigationGuard } from "@/contexts/resource-navigation-context";
import { useDocumentHistoryGuard } from "@/hooks/use-document-history-guard";

interface TableMeta {
  name: string;
  row_count?: number;
  columns?: Array<{ name: string; type: string }>;
}

interface VaultInfo {
  name: string;
  description?: string;
  role?: "owner" | "admin" | "writer" | "reader";
  role_source?: "member" | "public";
  status?: string;
  is_archived?: boolean;
  is_external_git?: boolean;
  public_access?: "none" | "reader" | "writer";
  owner?: string;
  owner_display_name?: string;
  created_at?: string;
  last_activity?: string;
  member_count?: number;
  collection_count?: number;
  document_count?: number;
  table_count?: number;
  file_count?: number;
  edge_count?: number;
  tables?: TableMeta[];
}

type PublicAccess = "none" | "reader" | "writer";
type SaveScope = "general" | "access";
type SettingsSection = SaveScope | "skill" | "danger";
type PendingExit = { kind: "navigation"; href: string; options?: NavigateOptions } | { kind: "history"; proceed: () => void };
const SETTINGS_SECTIONS: Array<{ value: SettingsSection; label: string }> = [
  { value: "general", label: "General" },
  { value: "access", label: "Access" },
  { value: "skill", label: "Vault guide" },
  { value: "danger", label: "Advanced" },
];

const PUBLIC_LABELS: Record<PublicAccess, string> = {
  none: "Private",
  reader: "Public · read",
  writer: "Public · write",
};
const PUBLIC_ICONS: Record<PublicAccess, LucideIcon> = {
  none: Lock,
  reader: Globe,
  writer: Unlock,
};
const PUBLIC_DESCRIPTIONS: Record<PublicAccess, string> = {
  none: "Only invited members can see anything in this vault.",
  reader:
    "Any signed-in person with the link can read this vault. Writes still require an invitation.",
  writer:
    "Any signed-in person with the link can create, edit, and delete content. Use this only for deliberately open collaboration.",
};
const PUBLIC_ORDER: PublicAccess[] = ["none", "reader", "writer"];

export default function VaultSettingsPage() {
  const { name } = useParams<{ name: string }>();
  const user = useCurrentUser();
  // Proof revisions refresh reads, not the same account's active Guide draft.
  return <VaultSettingsWorkspace key={JSON.stringify([user?.user_id, name])} name={name} />;
}

function VaultSettingsWorkspace({ name }: { name: string | undefined }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { refetchVaults } = useVaultRefresh();
  const user = useCurrentUser();
  const { checking, revision } = useAccessVerification();
  const [loadedRevision, setLoadedRevision] = useState<number | null>(null);
  const requestGeneration = useRef(0);
  const [info, setInfo] = useState<VaultInfo | null>(null);
  const [loadError, setLoadError] = useState("");
  const [description, setDescription] = useState("");
  const [publicAccess, setPublicAccess] = useState<PublicAccess>("none");
  const [savingScope, setSavingScope] = useState<SaveScope | null>(null);
  const [savedScope, setSavedScope] = useState<SaveScope | null>(null);
  const [saveError, setSaveError] = useState("");
  const [saveErrorScope, setSaveErrorScope] = useState<SaveScope | null>(null);
  const [pendingArchive, setPendingArchive] = useState(false);
  const [pendingUnarchive, setPendingUnarchive] = useState(false);
  const [pendingPublicWrite, setPendingPublicWrite] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [guideDraft, setGuideDraft] = useState({ dirty: false, saving: false });
  const [pendingExit, setPendingExit] = useState<PendingExit | null>(null);
  const confirmExitFocus = useRef<HTMLElement | null>(null);
  const exitFromMenu = useRef(false);
  const generalStatusRef = useRef<HTMLSpanElement>(null);
  const accessStatusRef = useRef<HTMLSpanElement>(null);
  const settingsTabsRef = useRef<HTMLDivElement>(null);
  const settingsMainRef = useRef<HTMLDivElement>(null);
  const generalErrorRef = useRef<HTMLDivElement>(null);
  const accessErrorRef = useRef<HTMLDivElement>(null);
  const requestedSection = location.hash.slice(1);
  const activeSection = SETTINGS_SECTIONS.some(
    ({ value }) => value === requestedSection,
  )
    ? (requestedSection as SettingsSection)
    : "general";
  const selectedSectionRef = useRef<string>(activeSection);
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  function selectSection(section: string) {
    // Pointer-down and focus can both activate a Radix tab before the URL
    // rerenders. Record that pending selection so one gesture adds one entry.
    if (selectedSectionRef.current === section) return;
    selectedSectionRef.current = section;
    navigate({
      pathname: location.pathname,
      search: location.search,
      hash: `#${section}`,
    });
  }
  const searchStatus = useOptionalSearchStatus();
  const vaultStatus = searchStatus?.observations.find(
    (row) => row.vaultName === name,
  );

  const skillQuery = useQuery({
    queryKey: ["document", name, VAULT_SKILL_PATH, user?.user_id, revision],
    queryFn: () => getDocument(name!, VAULT_SKILL_PATH),
    retry: false,
    enabled: !checking && loadedRevision === revision && !!name && !!info && !info.is_external_git,
  });
  const skillMissing = skillQuery.isError &&
    typeof skillQuery.error === "object" && skillQuery.error !== null &&
    "status" in skillQuery.error && skillQuery.error.status === 404;
  const skillDoc = skillMissing ? null : skillQuery.data;
  const skillError = skillQuery.isError && !skillMissing
    ? skillQuery.error.message || "Couldn't load the vault guide."
    : undefined;

  function loadInfo(vault: string) {
    const generation = ++requestGeneration.current;
    setLoadError("");
    getVaultInfo(vault)
      .then((data) => {
        if (!mountedRef.current || generation !== requestGeneration.current) return;
        setLoadedRevision(revision);
        setInfo(data);
        setDescription(value => !info || value === (info.description || "") ? data.description || "" : value);
        setPublicAccess(value => !info || value === (info.public_access || "none") ? (data.public_access as PublicAccess) || "none" : value);
      })
      .catch((error) => {
        if (mountedRef.current && generation === requestGeneration.current) setLoadError(error?.message || "Couldn't load this vault.");
      });
  }

  useEffect(() => {
    if (!name || checking) return;
    setLoadError("");
    loadInfo(name);
    return () => { requestGeneration.current += 1; };
    // The workspace is account/vault keyed. Retain same-account drafts while
    // proof revision invalidates the private read and its late completions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, checking, revision]);

  useEffect(() => {
    selectedSectionRef.current = activeSection;
    if (settingsMainRef.current) settingsMainRef.current.scrollTop = 0;
  }, [activeSection]);

  useEffect(() => {
    if (saveError && saveErrorScope === activeSection) {
      (saveErrorScope === "general"
        ? generalErrorRef
        : accessErrorRef
      ).current?.focus();
    }
  }, [saveError, saveErrorScope, activeSection]);

  useEffect(() => {
    if (!name) return;
    const previous = document.title;
    document.title = `${name} · Settings · AKB`;
    return () => {
      document.title = previous;
    };
  }, [name]);

  const verified = !checking && loadedRevision === revision && !loadError;
  const canEdit = verified && info?.role === "owner";
  const canManageSkill = verified && info?.role === "owner" && !info?.is_archived;
  const savedPublic = (info?.public_access as PublicAccess) || "none";
  const descriptionDirty = Boolean(
    info && description !== (info.description || ""),
  );
  const accessDirty = Boolean(info && publicAccess !== savedPublic);
  const dirty = descriptionDirty || accessDirty;
  const saving = savingScope !== null;
  const hasDraft = dirty || guideDraft.dirty;
  const busy = saving || guideDraft.saving;

  function requestExit(exit: PendingExit) {
    if (busy || (pendingExit && exit.kind !== "history")) return;
    if (!pendingExit) {
      confirmExitFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      exitFromMenu.current = !!confirmExitFocus.current?.closest('[role="menu"]');
    }
    setPendingExit(exit);
  }

  const continueNavigation = useResourceNavigationGuard(hasDraft || busy ? (href, options) => {
    // All settings panels stay mounted across local tab and hash transitions.
    if (new URL(href, window.location.origin).pathname === location.pathname) return true;
    requestExit({ kind: "navigation", href, options });
    return false;
  } : null);
  useDocumentHistoryGuard(hasDraft || busy,
    proceed => requestExit({ kind: "history", proceed }),
    destination => destination.pathname !== location.pathname);

  function confirmExit() {
    if (!pendingExit || busy) return;
    // Leave drafts intact until navigation actually unmounts this workspace.
    // A different active workspace guard may still cancel the departure.
    if (pendingExit.kind === "history") pendingExit.proceed();
    else continueNavigation(() => navigate(pendingExit.href, pendingExit.options));
  }

  useEffect(() => {
    if (!hasDraft && !busy) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [hasDraft, busy]);

  function requestSave(scope: SaveScope) {
    if (!info) return;
    const enablingPublicWrite =
      scope === "access" &&
      publicAccess === "writer" &&
      savedPublic !== "writer";
    if (enablingPublicWrite) {
      setPendingPublicWrite(true);
      return;
    }
    void doSave(scope);
  }

  async function doSave(scope: SaveScope) {
    if (!name || !info || !verified) return;
    const generation = requestGeneration.current;
    setSavingScope(scope);
    setSaveError("");
    setSaveErrorScope(null);
    try {
      const patch =
        scope === "general" ? { description } : { public_access: publicAccess };
      await updateVault(name, patch);
      refetchVaults();
      if (!mountedRef.current || generation !== requestGeneration.current) return;
      setInfo({ ...info, ...patch });
      setSavedScope(scope);
      requestAnimationFrame(() => {
        if (!mountedRef.current) return;
        const status = (
          scope === "general" ? generalStatusRef : accessStatusRef
        ).current;
        if (status && !status.closest("[hidden]")) status.focus();
      });
    } catch (error: unknown) {
      if (!mountedRef.current || generation !== requestGeneration.current) return;
      setSaveError(error instanceof Error ? error.message : "Save failed");
      setSaveErrorScope(scope);
      selectSection(scope);
    } finally {
      if (mountedRef.current) setSavingScope(null);
    }
  }

  function handleDiscard(scope: SaveScope) {
    if (!info) return;
    if (scope === "general") setDescription(info.description || "");
    else setPublicAccess(savedPublic);
    setSaveError("");
    setSaveErrorScope(null);
    setSavedScope(null);
  }

  async function confirmArchive() {
    if (!name || !verified) return;
    const generation = requestGeneration.current;
    await archiveVault(name);
    const data = await getVaultInfo(name);
    if (!mountedRef.current || generation !== requestGeneration.current) return;
    setInfo(data);
    refetchVaults();
  }

  async function confirmUnarchive() {
    if (!name || !verified) return;
    const generation = requestGeneration.current;
    await unarchiveVault(name);
    const data = await getVaultInfo(name);
    if (!mountedRef.current || generation !== requestGeneration.current) return;
    setInfo(data);
    refetchVaults();
  }

  if (!name) return null;

  const loading = info === null && !loadError;
  const tables = info?.tables ?? [];
  const deleteScale = info
    ? (
        [
          [info.document_count, "document"],
          [info.table_count, "table"],
          [info.file_count, "file"],
        ] as Array<[number | undefined, string]>
      )
        .filter(([count]) => (count ?? 0) > 0)
        .map(
          ([count, word]) =>
            `${count!.toLocaleString()} ${word}${count === 1 ? "" : "s"}`,
        )
        .join(", ")
    : "";

  return (
    <PageShell
      header={null}
      contentWidth="full"
      className="min-h-full bg-surface xl:h-full xl:min-h-0"
      contentClassName="min-h-full xl:flex xl:h-full xl:min-h-0 xl:flex-col"
    >
      <h1 className="sr-only">Settings</h1>
      {info && !verified && (loadError ? <Alert variant="destructive">{loadError} <Button variant="outline" size="sm" onClick={() => loadInfo(name)} disabled={checking}>Try again</Button></Alert> : <SettingsLoadingState />)}
      <Tabs
        hidden={!!info && !verified}
        inert={!!info && !verified}
        value={activeSection}
        onValueChange={selectSection}
        className="flex min-h-full min-w-0 flex-col xl:min-h-0 xl:flex-1"
        data-testid="settings-workspace-shell"
      >
        {info && !canEdit && (
          <Alert
            variant="info"
            className="shrink-0 rounded-none border-x-0 border-t-0 border-b px-3 py-2 sm:px-5 lg:px-6"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span>
                You can review these settings, but only the vault owner can
                change them.
              </span>
              {info.role_source === "public" && (
                <Badge
                  variant="info-outline"
                  title="This role comes from public access."
                >
                  <Globe className="h-3 w-3" aria-hidden />
                  Access via public policy
                </Badge>
              )}
            </div>
          </Alert>
        )}
        <div className="shrink-0 border-b border-border sm:px-2 lg:px-3">
          <div className="rail-scroll overflow-x-auto">
            <TabsList
              ref={settingsTabsRef}
              aria-label="Vault settings sections"
              className="h-12 gap-0 rounded-none bg-transparent p-0"
            >
              {SETTINGS_SECTIONS.map(({ value, label }) => (
                <TabsTrigger
                  key={value}
                  value={value}
                  aria-description={
                    (value === "general" && descriptionDirty) ||
                    (value === "access" && accessDirty)
                      ? "Unsaved changes"
                      : undefined
                  }
                  className="h-11 rounded-none border-b-2 border-transparent px-3 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-link data-[state=active]:shadow-none"
                >
                  {label}
                  {((value === "general" && descriptionDirty) ||
                    (value === "access" && accessDirty)) && (
                    <span
                      className="h-1.5 w-1.5 rounded-full bg-current"
                      aria-hidden
                    />
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
        </div>
        <div
          ref={settingsMainRef}
          data-testid="settings-workspace-frame"
          className="@container/vault-settings rail-scroll min-w-0 flex-1 px-3 py-5 sm:px-5 lg:p-6 xl:min-h-0 xl:overflow-y-auto xl:overscroll-contain"
        >
          <div className="min-w-0 w-full">
            {verified && busy && <p role="status" className="mb-4 text-sm text-foreground-muted">Saving changes… Keep settings open until this finishes.</p>}
            {loadError && (
              <Alert variant="destructive">
                {loadError}
                <div className="mt-3">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => loadInfo(name)}
                  >
                    Try again
                  </Button>
                </div>
              </Alert>
            )}
            {loading && <SettingsLoadingState />}
            {info && (
              <>
                <TabsContent
                  value="general"
                  forceMount
                  hidden={activeSection !== "general"}
                  className="w-full pt-0"
                >
                  <section
                    id="general"
                    role="region"
                    aria-labelledby="general-settings-heading"
                    className="scroll-mt-6"
                  >
                    <WorkspaceSectionHeader
                      id="general-settings-heading"
                      icon={Settings2}
                      title="General"
                      description="The identity people see across the workspace."
                      tone="knowledge"
                    />
                    <Panel
                      variant="workspace"
                      flush
                      className="grid min-w-0 border-border-strong @[56rem]/vault-settings:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]"
                    >
                      <div
                        data-testid="settings-general-editor"
                        className="flex min-w-0 flex-col"
                      >
                        <div className="flex-1 space-y-4 p-4 @[56rem]/vault-settings:p-6">
                          <Label
                            htmlFor="vault-description"
                            className="block text-sm font-semibold"
                          >
                            Description
                          </Label>
                          <p
                            id="vault-description-help"
                            className="max-w-prose text-sm leading-relaxed text-foreground-muted"
                          >
                            Explain what belongs here and who it serves. People see
                            this description in Vault Overview.
                          </p>
                          <Textarea
                            id="vault-description"
                            aria-describedby="vault-description-help"
                            value={description}
                            onChange={(event) => {
                              setDescription(event.target.value);
                              setSavedScope(null);
                            }}
                            readOnly={!canEdit}
                            disabled={saving}
                            placeholder="Explain what belongs in this vault and who it serves."
                            rows={6}
                            className="resize-y text-sm leading-relaxed"
                          />
                          {saveErrorScope === "general" && (
                            <div
                              ref={generalErrorRef}
                              tabIndex={-1}
                              className="outline-none"
                            >
                              <Alert variant="destructive">{saveError}</Alert>
                            </div>
                          )}
                        </div>
                        {canEdit && (
                          <SettingsActionBar
                            dirty={descriptionDirty}
                            saving={savingScope === "general"}
                            saved={savedScope === "general" && !descriptionDirty}
                            statusRef={generalStatusRef}
                            onSave={() => requestSave("general")}
                            onDiscard={() => handleDiscard("general")}
                          />
                        )}
                      </div>
                      <div
                        data-testid="settings-vault-identity"
                        className="min-w-0 space-y-5 border-t border-border bg-background p-4 @[56rem]/vault-settings:border-l @[56rem]/vault-settings:border-t-0 @[56rem]/vault-settings:p-6"
                      >
                        <h3 className="text-sm font-semibold text-foreground">
                          Vault identity
                        </h3>
                        <div>
                          <p
                            id="vault-address-label"
                            className="mb-1.5 text-xs text-foreground-muted"
                          >
                            Vault address
                          </p>
                          <div
                            aria-labelledby="vault-address-label"
                            className="flex min-h-10 min-w-0 items-center justify-between gap-3 rounded-[var(--radius-sm)] border border-border bg-surface px-3"
                          >
                            <span className="min-w-0 font-mono text-sm text-foreground [overflow-wrap:anywhere]">
                              akb://{name}
                            </span>
                            <CopyButton value={`akb://${name}`} label="Copy vault address" />
                          </div>
                          <p className="mt-2 max-w-prose text-xs leading-relaxed text-foreground-muted">
                            This address is permanent. Document links and agent connections depend on it.
                          </p>
                        </div>
                        <dl
                          aria-label="Vault ownership and dates"
                          className="grid grid-cols-2 gap-x-6 gap-y-5 border-t border-border pt-5"
                        >
                          <ContextRow
                            label="Owner"
                            value={info.owner_display_name || info.owner || "Not available"}
                          />
                          <ContextRow
                            label="Your role"
                            value={info.role ? <RoleBadge role={info.role} /> : "Not available"}
                          />
                          {(info.is_archived || info.is_external_git || (info.public_access && info.public_access !== "none")) && (
                            <ContextRow
                              label="Vault state"
                              value={
                                <div className="flex flex-wrap">
                                  <VaultStateBadge
                                    archived={info.is_archived}
                                    externalGit={info.is_external_git}
                                    publicAccess={info.public_access}
                                  />
                                </div>
                              }
                            />
                          )}
                          <ContextRow
                            label="Created"
                            value={info.created_at ? timeAgo(info.created_at) : "Not available"}
                          />
                          <ContextRow
                            label="Last active"
                            value={info.last_activity ? timeAgo(info.last_activity) : "Not available"}
                          />
                        </dl>
                      </div>
                    </Panel>
                  </section>

                </TabsContent>
                <TabsContent
                  value="access"
                  forceMount
                  hidden={activeSection !== "access"}
                  className="w-full pt-0"
                >
                  <section
                    id="access"
                    role="region"
                    aria-labelledby="access-settings-heading"
                    className="scroll-mt-6"
                  >
                    <WorkspaceSectionHeader
                      id="access-settings-heading"
                      icon={ShieldCheck}
                      title="Access"
                      description="Set the vault-wide default without changing individual member roles."
                      tone={publicAccess === "writer" ? "warning" : "people"}
                    />
                    <Panel
                      variant="workspace"
                      flush
                      className="grid min-w-0 border-border-strong @[56rem]/vault-settings:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]"
                    >
                      <div
                        data-testid="settings-access-editor"
                        className="@container/access-policy flex min-w-0 flex-col"
                      >
                        <div className="flex-1 space-y-4 p-4 @[56rem]/vault-settings:p-6">
                          <div>
                            <Label
                              id="public-access-label"
                              className="mb-3 block text-sm font-semibold"
                            >
                              Public access
                            </Label>
                            <Segmented
                              aria-labelledby="public-access-label"
                              value={publicAccess}
                              onChange={(value) => {
                                setPublicAccess(value as PublicAccess);
                                setSavedScope(null);
                              }}
                              disabled={!canEdit || saving}
                              className="grid-cols-1 @[42rem]/access-policy:grid-cols-3"
                              options={PUBLIC_ORDER.map((value) => {
                                const Icon = PUBLIC_ICONS[value];
                                return {
                                  value,
                                  label: PUBLIC_LABELS[value],
                                  description: PUBLIC_DESCRIPTIONS[value],
                                  icon: (
                                    <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                                  ),
                                  danger: value === "writer",
                                };
                              })}
                            />
                            <p className="mt-4 text-xs leading-relaxed text-foreground-muted">
                              Changes take effect only after you save.
                            </p>
                          </div>

                          {saveErrorScope === "access" && (
                            <div
                              ref={accessErrorRef}
                              tabIndex={-1}
                              className="outline-none"
                            >
                              <Alert variant="destructive">{saveError}</Alert>
                            </div>
                          )}
                        </div>
                        {canEdit && (
                          <SettingsActionBar
                            dirty={accessDirty}
                            saving={savingScope === "access"}
                            saved={savedScope === "access" && !accessDirty}
                            statusRef={accessStatusRef}
                            onSave={() => requestSave("access")}
                            onDiscard={() => handleDiscard("access")}
                          />
                        )}
                      </div>
                      <div
                        data-testid="settings-access-context"
                        className="min-w-0 space-y-5 border-t border-border bg-background p-4 @[56rem]/vault-settings:border-l @[56rem]/vault-settings:border-t-0 @[56rem]/vault-settings:p-6"
                      >
                        <div className="flex min-w-0 items-start gap-3">
                          <TonalIcon tone="people">
                            <Users className="h-4 w-4" aria-hidden />
                          </TonalIcon>
                          <div>
                            <h3 className="text-sm font-semibold text-foreground">
                              Members and ownership
                            </h3>
                            <p className="mt-2 max-w-prose text-sm leading-relaxed text-foreground-muted">
                              Invite people, adjust roles, or transfer ownership
                              from the Members page.
                            </p>
                          </div>
                        </div>
                        <Button
                          asChild
                          variant="outline"
                          size="sm"
                          className="shrink-0"
                        >
                          <Link to={`/vault/${encodeURIComponent(name)}/members`}>
                            Open members
                          </Link>
                        </Button>
                        <div className="space-y-2 border-t border-border pt-5">
                          <h3 className="text-sm font-semibold text-foreground">
                            Public links are separate
                          </h3>
                          <p className="max-w-prose text-sm leading-relaxed text-foreground-muted">
                            Public access is for signed-in people. Public links
                            provide separate, anonymous sharing for individual resources.
                          </p>
                          <Button
                            asChild
                            variant="link"
                            size="sm"
                            className="min-h-9 px-0"
                          >
                            <Link to={`/vault/${encodeURIComponent(name)}/publications`}>
                              Open public links
                            </Link>
                          </Button>
                        </div>
                      </div>
                    </Panel>
                  </section>
                </TabsContent>
                <TabsContent
                  value="skill"
                  forceMount
                  hidden={activeSection !== "skill"}
                  className="w-full pt-0"
                >
                  <SkillSection
                    vault={name}
                    doc={skillDoc}
                    loading={skillQuery.isLoading || (!info && !loadError)}
                    error={skillError}
                    onRetry={() => { void skillQuery.refetch(); }}
                    isMirror={info.is_external_git}
                    canManage={canManageSkill}
                    queryKey={["document", name, VAULT_SKILL_PATH, user?.user_id, revision]}
                    navigationManaged
                    onDraftStateChange={setGuideDraft}
                  />
                </TabsContent>
                <TabsContent
                  value="danger"
                  forceMount
                  hidden={activeSection !== "danger"}
                  className="w-full pt-0"
                >
                  <div
                    className={`grid min-w-0 items-start gap-6 ${canEdit ? "@[64rem]/vault-settings:grid-cols-2" : ""}`}
                  >
                    <section
                      data-testid="settings-operations"
                      aria-labelledby="operations-heading"
                      className="min-w-0"
                    >
                      <WorkspaceSectionHeader
                        id="operations-heading"
                        icon={Settings2}
                        title="Operations"
                        description="Background processing for this vault."
                        tone="neutral"
                      />
                      <Panel
                        variant="workspace"
                        flush
                        className="border-border-strong p-4 @[56rem]/vault-settings:p-6"
                      >
                        <SearchStatusStages observation={vaultStatus} />
                        <p className="mt-4 text-xs leading-relaxed text-foreground-muted">
                          New content is processed asynchronously after each
                          write.
                        </p>
                      </Panel>
                    </section>
                    {canEdit && (
                      <Panel
                        variant="workspace"
                        id="danger"
                        role="region"
                        aria-labelledby="danger-settings-heading"
                        data-testid="settings-lifecycle"
                        className="@container/settings-lifecycle min-w-0 scroll-mt-4 border-destructive"
                        flush
                      >
                        <div className="border-b border-destructive bg-destructive-soft px-3 py-2.5">
                          <div className="flex items-start gap-3">
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-destructive text-destructive">
                              <AlertTriangle className="h-4 w-4" aria-hidden />
                            </span>
                            <div>
                              <h2
                                id="danger-settings-heading"
                                className="text-sm font-semibold text-destructive"
                              >
                                Danger zone
                              </h2>
                              <p className="mt-1 text-xs leading-relaxed text-foreground-muted">
                                These actions change availability for every member
                                and connected agent.
                              </p>
                            </div>
                          </div>
                        </div>

                        <div className="divide-y divide-border">
                          <div className="flex flex-col gap-4 p-4 @[36rem]/settings-lifecycle:flex-row @[36rem]/settings-lifecycle:items-center @[36rem]/settings-lifecycle:justify-between">
                            <div className="min-w-0">
                              <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                                {info.is_archived ? (
                                  <Archive
                                    className="h-4 w-4 text-foreground-muted"
                                    aria-hidden
                                  />
                                ) : (
                                  <CheckCircle2
                                    className="h-4 w-4 text-success"
                                    aria-hidden
                                  />
                                )}
                                {info.is_archived
                                  ? "Vault archived"
                                  : "Archive vault"}
                              </h3>
                              <p className="mt-1 max-w-2xl text-sm leading-relaxed text-foreground-muted">
                                {info.is_archived
                                  ? "The vault is read-only. Members and agents can still retrieve its knowledge."
                                  : "Freeze all writes while keeping documents searchable. Archiving is reversible."}
                              </p>
                            </div>
                            {info.is_archived ? (
                              <Button
                                variant="outline"
                                size="sm"
                                className="self-start shrink-0"
                                onClick={() => setPendingUnarchive(true)}
                              >
                                <RotateCcw className="h-4 w-4" aria-hidden />
                                Unarchive
                              </Button>
                            ) : (
                              <Button
                                variant="outline"
                                size="sm"
                                className="self-start shrink-0"
                                onClick={() => setPendingArchive(true)}
                              >
                                <Archive className="h-4 w-4" aria-hidden />
                                Archive
                              </Button>
                            )}
                          </div>

                          <div className="flex flex-col gap-4 bg-destructive-soft p-4 @[36rem]/settings-lifecycle:flex-row @[36rem]/settings-lifecycle:items-center @[36rem]/settings-lifecycle:justify-between">
                            <div className="min-w-0">
                              <h3 className="flex items-center gap-2 text-sm font-semibold text-destructive">
                                <Trash2 className="h-4 w-4" aria-hidden />
                                Delete vault permanently
                              </h3>
                              <p className="mt-1 max-w-2xl text-sm leading-relaxed text-foreground-muted">
                                Removes everything inside
                                {deleteScale ? ` — ${deleteScale}` : ""}, plus git
                                history, relations, embeddings, sessions, and
                                stored files. This cannot be undone.
                              </p>
                              {tables.length > 0 && (
                                <p className="mt-2 max-w-2xl text-xs leading-relaxed text-foreground-muted">
                                  Tables removed:{" "}
                                  {tables
                                    .slice(0, 4)
                                    .map((table) => table.name)
                                    .join(", ")}
                                  {tables.length > 4
                                    ? `, and ${tables.length - 4} more`
                                    : ""}
                                  .
                                </p>
                              )}
                            </div>
                            <Button
                              variant="destructive"
                              size="sm"
                              className="self-start shrink-0"
                              onClick={() => setDeleteOpen(true)}
                            >
                              <Trash2 className="h-4 w-4" aria-hidden />
                              Delete vault
                            </Button>
                          </div>
                        </div>
                      </Panel>
                    )}
                  </div>
                </TabsContent>
              </>
            )}
          </div>
        </div>
      </Tabs>

      <span className="sr-only" role="status" aria-live="polite">
        {loading
          ? "Loading vault settings"
          : loadError
            ? "Could not load settings"
            : ""}
      </span>

      <ConfirmDialog
        open={pendingExit !== null}
        onOpenChange={open => {
          if (open || !mountedRef.current) return;
          if (exitFromMenu.current) {
            confirmExitFocus.current = [...document.querySelectorAll<HTMLElement>('[data-slot="vault-page-switcher"]')]
              .find(trigger => trigger.getClientRects().length > 0) ?? null;
          }
          if (!confirmExitFocus.current?.isConnected) {
            confirmExitFocus.current = settingsTabsRef.current?.querySelector<HTMLElement>('[aria-selected="true"]') ?? null;
          }
          setPendingExit(null);
        }}
        returnFocusRef={confirmExitFocus}
        title="Discard unsaved settings changes?"
        description="Your unsaved description, public-access, and vault guide changes will be discarded when you leave."
        confirmLabel="Discard changes and leave"
        cancelLabel="Keep editing"
        variant="destructive"
        busy={busy}
        onConfirm={confirmExit}
      />
      <ConfirmDialog
        open={verified && pendingArchive}
        onOpenChange={setPendingArchive}
        title={`Archive "${name}"?`}
        description={
          "Documents and tables become read-only. Agents can recall but cannot write.\nYou can unarchive any time."
        }
        confirmLabel="Archive vault"
        onConfirm={confirmArchive}
      />
      <ConfirmDialog
        open={verified && pendingUnarchive}
        onOpenChange={setPendingUnarchive}
        title={`Unarchive "${name}"?`}
        description="The vault returns to active. Agents can write again."
        confirmLabel="Unarchive"
        onConfirm={confirmUnarchive}
      />
      <ConfirmDialog
        open={verified && pendingPublicWrite}
        onOpenChange={setPendingPublicWrite}
        title={`Make "${name}" world-writable?`}
        variant="destructive"
        description={
          <span className="flex items-start gap-2">
            <AlertTriangle
              className="mt-0.5 h-4 w-4 shrink-0 text-destructive"
              aria-hidden
            />
            <span>
              Any signed-in person with the link will be able to create, edit,
              and delete content in this vault. You can lower access again
              later.
            </span>
          </span>
        }
        confirmLabel="Make world-writable"
        onConfirm={() => doSave("access")}
      />

      <DeleteVaultDialog
        open={verified && deleteOpen}
        onOpenChange={setDeleteOpen}
        vault={name}
        onDeleted={() => {
          if (!mountedRef.current || !verified) return;
          refetchVaults();
          continueNavigation(() => navigate("/vault"));
        }}
      />
    </PageShell>
  );
}

function SettingsActionBar({
  dirty,
  saving,
  saved,
  statusRef,
  onSave,
  onDiscard,
}: {
  dirty: boolean;
  saving: boolean;
  saved: boolean;
  statusRef: RefObject<HTMLSpanElement | null>;
  onSave: () => void;
  onDiscard: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-border bg-background px-4 py-3 @[56rem]/vault-settings:px-6">
      <Button
        type="button"
        size="sm"
        onClick={onSave}
        loading={saving}
        disabled={!dirty}
      >
        {!saving && <Save className="h-3.5 w-3.5" aria-hidden />}
        {saving ? "Saving…" : "Save changes"}
      </Button>
      {dirty && !saving && (
        <Button type="button" variant="outline" size="sm" onClick={onDiscard}>
          Discard
        </Button>
      )}
      <span
        ref={statusRef}
        tabIndex={-1}
        role="status"
        aria-live="polite"
        className="outline-none"
      >
        {dirty ? (
          <span className="text-xs text-foreground-muted">Unsaved changes</span>
        ) : saved ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-success">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
            Saved
          </span>
        ) : null}
      </span>
    </div>
  );
}

function ContextRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0 space-y-1.5">
      <dt className="text-xs text-foreground-muted">{label}</dt>
      <dd className="min-w-0 text-sm font-medium text-foreground [overflow-wrap:anywhere]">
        {value}
      </dd>
    </div>
  );
}

function SettingsLoadingState() {
  return (
    <div
      className="@container/settings-loading space-y-5"
      role="status"
      aria-label="Loading vault settings"
    >
      <div
        className="h-12 w-48 animate-pulse rounded-[var(--radius-sm)] bg-surface-2"
        aria-hidden
      />
      <div
        aria-hidden
        className="grid overflow-hidden rounded-[var(--radius-md)] border border-border @[56rem]/settings-loading:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]"
      >
        <div className="space-y-5 p-6">
          <div className="h-5 w-32 animate-pulse rounded-[var(--radius-sm)] bg-surface-2" />
          <div className="h-40 animate-pulse rounded-[var(--radius-sm)] bg-surface-2" />
          <div className="h-8 w-32 animate-pulse rounded-[var(--radius-sm)] bg-surface-2" />
        </div>
        <div className="space-y-5 border-t border-border bg-background p-6 @[56rem]/settings-loading:border-l @[56rem]/settings-loading:border-t-0">
          <div className="h-5 w-32 animate-pulse rounded-[var(--radius-sm)] bg-surface-2" />
          <div className="h-10 animate-pulse rounded-[var(--radius-sm)] bg-surface-2" />
          <div className="grid grid-cols-2 gap-5">
            {[0, 1, 2, 3].map(index => (
              <div key={index} className="h-10 animate-pulse rounded-[var(--radius-sm)] bg-surface-2" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
