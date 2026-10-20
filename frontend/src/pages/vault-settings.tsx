import { useEffect, useRef, useState, type RefObject } from "react";
import { Link, useLocation, useNavigate, useParams, type NavigateOptions } from "react-router-dom";
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  Globe,
  Lock,
  RotateCcw,
  Save,
  Trash2,
  Users,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import {
  archiveVault,
  getDocument,
  getVaultInfo,
  unarchiveVault,
  updateVault,
} from "@/lib/api";
import { SkillSection } from "@/components/skill/skill-section";
import { VAULT_SKILL_PATH } from "@/lib/skill";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CopyButton } from "@/components/ui/copy-button";
import { Label } from "@/components/ui/label";
import { PageShell } from "@/components/ui/page-shell";
import { SettingRow, SettingsSection } from "@/components/ui/settings-section";
import { Textarea } from "@/components/ui/textarea";
import { DeleteVaultDialog } from "@/components/delete-vault-dialog";
import { useVaultRefresh } from "@/contexts/vault-refresh-context";
import { useAccessVerification, useCurrentUser } from "@/contexts/current-user-context";
import { useResourceNavigationGuard } from "@/contexts/resource-navigation-context";
import { useDocumentHistoryGuard } from "@/hooks/use-document-history-guard";
import { retainsGuideSettings } from "@/lib/vault-guide-navigation";

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
  none: "Invited members only",
  reader: "Everyone can view",
  writer: "Everyone can edit",
};
const PUBLIC_DESCRIPTIONS: Record<PublicAccess, string> = {
  none: "Only people you add as members can open this vault.",
  reader:
    "Anyone signed in to this AKB can view content without an invitation. Editing still requires permission.",
  writer:
    "Anyone signed in to this AKB can add, edit, and delete content, even without an invitation.",
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
  const hasInfo = info !== null;
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
  const generalStatusRef = useRef<HTMLSpanElement>(null);
  const accessStatusRef = useRef<HTMLSpanElement>(null);
  const settingsMainRef = useRef<HTMLDivElement>(null);
  const generalErrorRef = useRef<HTMLDivElement>(null);
  const accessErrorRef = useRef<HTMLDivElement>(null);
  const requestedSection = location.hash.slice(1);
  const activeSection = SETTINGS_SECTIONS.some(
    ({ value }) => value === requestedSection,
  )
    ? (requestedSection as SettingsSection)
    : "general";
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  function selectSection(section: string) {
    if (location.hash === `#${section}`) return;
    navigate({
      pathname: location.pathname,
      search: location.search,
      hash: `#${section}`,
    });
  }

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
    if (!hasInfo || checking || loadedRevision !== revision || !requestedSection) return;
    const destination = document.getElementById(activeSection);
    if (!destination || !settingsMainRef.current) return;
    // Scroll the sheet, not its ancestor rails. Keep old deep links usable.
    const frame = settingsMainRef.current;
    const scroller = frame.scrollHeight > frame.clientHeight
      ? frame
      : frame.closest<HTMLElement>('[data-slot="vault-route-viewport"]');
    scroller?.scrollTo?.({ top: scroller.scrollTop + destination.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 16 });
  }, [activeSection, requestedSection, hasInfo, checking, loadedRevision, revision]);

  useEffect(() => {
    if (saveError && saveErrorScope) {
      (saveErrorScope === "general"
        ? generalErrorRef
        : accessErrorRef
      ).current?.focus();
    }
  }, [saveError, saveErrorScope]);

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
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const triggerId = active?.closest('[role="menu"]')?.getAttribute("aria-labelledby");
      confirmExitFocus.current = (triggerId ? document.getElementById(triggerId) : null) ?? active;
    }
    setPendingExit(exit);
  }

  const continueNavigation = useResourceNavigationGuard(hasDraft || busy ? (href, options) => {
    // Anchors within this sheet never discard any of its drafts.
    if (new URL(href, window.location.origin).pathname === location.pathname) return true;
    if (name && retainsGuideSettings(name, location, href, options?.state)) return true;
    requestExit({ kind: "navigation", href, options });
    return false;
  } : null);
  useDocumentHistoryGuard(hasDraft || busy,
    proceed => requestExit({ kind: "history", proceed }),
    destination => destination.pathname !== location.pathname &&
      !(name && retainsGuideSettings(name, location, destination.href, window.history.state?.usr)));

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
    if (!info || !canEdit || busy) return;
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
    if (!name || !info || !canEdit || busy) return;
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
      setInfo(current => current ? { ...current, ...patch } : current);
      setSavedScope(scope);
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
    if (!name || !canEdit || busy) return;
    const generation = requestGeneration.current;
    await archiveVault(name);
    const data = await getVaultInfo(name);
    if (!mountedRef.current || generation !== requestGeneration.current) return;
    setInfo(data);
    refetchVaults();
  }

  async function confirmUnarchive() {
    if (!name || !canEdit || busy) return;
    const generation = requestGeneration.current;
    await unarchiveVault(name);
    const data = await getVaultInfo(name);
    if (!mountedRef.current || generation !== requestGeneration.current) return;
    setInfo(data);
    refetchVaults();
  }

  if (!name) return null;

  const loading = info === null && !loadError;

  return (
    <PageShell
      header={null}
      contentWidth="full"
      className="min-h-full bg-surface xl:h-full xl:min-h-0"
      contentClassName="min-h-full xl:flex xl:h-full xl:min-h-0 xl:flex-col"
    >
      <h1 className="sr-only">Settings</h1>
      {info && !verified && (
        loadError ? (
          <Alert variant="destructive">
            {loadError}
            <Button variant="outline" size="sm" onClick={() => loadInfo(name)} disabled={checking}>Try again</Button>
          </Alert>
        ) : <SettingsLoadingState />
      )}
      <div
        hidden={!!info && !verified}
        inert={!!info && !verified}
        className="flex min-h-full min-w-0 flex-col xl:min-h-0 xl:flex-1"
        data-testid="settings-workspace-shell"
      >
        {info && !canEdit && (
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-3 text-sm text-foreground-muted sm:px-5 lg:px-6">
            <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>Read only — only the vault owner can change settings.</span>
            {info.role_source === "public" && <Badge variant="info-outline">Access via public policy</Badge>}
          </div>
        )}
        <div
          ref={settingsMainRef}
          data-testid="settings-workspace-frame"
          className="@container/vault-settings rail-scroll min-w-0 flex-1 px-3 py-4 sm:px-5 lg:px-6 xl:min-h-0 xl:overflow-y-auto xl:overscroll-contain"
        >
          {verified && busy && <p role="status" className="mb-4 text-sm text-foreground-muted">Saving changes…</p>}
          {loadError && (
            <Alert variant="destructive">
              {loadError}
              <div className="mt-3"><Button variant="outline" size="sm" onClick={() => loadInfo(name)}>Try again</Button></div>
            </Alert>
          )}
          {loading && <SettingsLoadingState />}
          {info && (
            <div className="space-y-8 pb-6">
              <SettingsSection id="general" title="General">
                <SettingRow label={<Label htmlFor="vault-description">Description</Label>}>
                  <div data-testid="settings-general-editor">
                    <Textarea
                      id="vault-description"
                      value={description}
                      onChange={event => { setDescription(event.target.value); setSavedScope(null); }}
                      readOnly={!canEdit}
                      disabled={busy}
                      placeholder="What belongs in this vault?"
                      rows={3}
                      className="min-h-24 resize-y text-base leading-relaxed sm:text-sm"
                    />
                    {saveErrorScope === "general" && (
                      <div ref={generalErrorRef} tabIndex={-1} className="mt-3 outline-none">
                        <Alert variant="destructive">{saveError}</Alert>
                      </div>
                    )}
                    {canEdit && <SettingsActionBar
                      dirty={descriptionDirty} saving={savingScope === "general"} disabled={busy}
                      saved={savedScope === "general" && !descriptionDirty} statusRef={generalStatusRef}
                      onSave={() => requestSave("general")} onDiscard={() => handleDiscard("general")}
                    />}
                  </div>
                </SettingRow>
                <SettingRow label="Vault address">
                  <div className="flex min-h-10 min-w-0 items-center gap-2">
                    <code className="min-w-0 text-sm text-foreground [overflow-wrap:anywhere]">akb://{name}</code>
                    <CopyButton value={`akb://${name}`} label="Copy vault address" />
                    <span className="ml-1 text-xs text-foreground-muted">Permanent</span>
                  </div>
                </SettingRow>
              </SettingsSection>

              <SettingsSection id="access" title="Access">
                <SettingRow label={<>Who can access<p className="mt-1 text-xs font-normal text-foreground-muted">Sign-in required</p></>}>
                  <div data-testid="settings-access-editor">
                    <fieldset role="radiogroup" aria-label="Who can access" aria-describedby="vault-access-help" disabled={!canEdit || busy} className="grid max-w-2xl gap-2">
                      {PUBLIC_ORDER.map(value => {
                        return (
                          <label key={value} className={`flex min-h-11 items-center gap-3 rounded-[var(--radius-sm)] border px-3 py-2 text-sm ${publicAccess === value ? "border-primary bg-surface-selected text-surface-selected-foreground" : "border-border bg-surface text-foreground hover:border-border-strong hover:bg-surface-hover"} ${canEdit && !busy ? "cursor-pointer" : ""}`}>
                            <input
                              type="radio" name="vault-default-access" value={value} checked={publicAccess === value}
                              onChange={() => { setPublicAccess(value); setSavedScope(null); }}
                              className="h-4 w-4 shrink-0 accent-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
                            />
                            <span className="flex-1">{PUBLIC_LABELS[value]}</span>
                          </label>
                        );
                      })}
                    </fieldset>
                    <p id="vault-access-help" className={`mt-3 flex items-start gap-2 text-sm leading-relaxed ${publicAccess === "writer" ? "text-warning-soft-foreground" : "text-foreground-muted"}`}>
                      {publicAccess === "writer" && <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
                      {PUBLIC_DESCRIPTIONS[publicAccess]}
                    </p>
                    {saveErrorScope === "access" && (
                      <div ref={accessErrorRef} tabIndex={-1} className="mt-3 outline-none">
                        <Alert variant="destructive">{saveError}</Alert>
                      </div>
                    )}
                    {canEdit && <SettingsActionBar
                      dirty={accessDirty} saving={savingScope === "access"} disabled={busy}
                      saved={savedScope === "access" && !accessDirty} statusRef={accessStatusRef}
                      onSave={() => requestSave("access")} onDiscard={() => handleDiscard("access")}
                    />}
                    <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border pt-3 text-sm">
                      <Link className="inline-flex min-h-10 items-center gap-1.5 rounded-[var(--radius-sm)] text-link hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" to={`/vault/${encodeURIComponent(name)}/members`}>
                        <Users className="h-3.5 w-3.5" aria-hidden />Manage members
                      </Link>
                      <Link className="inline-flex min-h-10 items-center gap-1.5 rounded-[var(--radius-sm)] text-link hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" to={`/vault/${encodeURIComponent(name)}/publications`}>
                        <Globe className="h-3.5 w-3.5" aria-hidden />Public links
                      </Link>
                      <span className="text-xs text-foreground-muted">Share without sign-in using Public links.</span>
                    </div>
                  </div>
                </SettingRow>
              </SettingsSection>

              <SkillSection
                vault={name} doc={skillDoc} loading={skillQuery.isLoading || (!info && !loadError)}
                error={skillError} onRetry={() => { void skillQuery.refetch(); }}
                isMirror={info.is_external_git} canManage={canManageSkill} busy={saving}
                queryKey={["document", name, VAULT_SKILL_PATH, user?.user_id, revision]}
                navigationManaged onDraftStateChange={setGuideDraft}
              />

              {canEdit && (
                <SettingsSection id="danger" title="Danger zone">
                  <SettingRow label={info.is_archived ? "Vault archived" : "Archive vault"}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-sm text-foreground-muted">{info.is_archived ? "Read-only. Restore writing at any time." : "Make this vault read-only. You can restore it later."}</p>
                      <Button variant="outline" size="sm" disabled={busy} onClick={() => info.is_archived ? setPendingUnarchive(true) : setPendingArchive(true)} className="min-h-10 shrink-0 sm:min-h-8">
                        {info.is_archived ? <RotateCcw className="h-3.5 w-3.5" aria-hidden /> : <Archive className="h-3.5 w-3.5" aria-hidden />}
                        {info.is_archived ? "Unarchive" : "Archive"}
                      </Button>
                    </div>
                  </SettingRow>
                  <SettingRow label="Delete vault permanently">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-sm text-foreground-muted">All vault data will be removed. This cannot be undone.</p>
                      <Button variant="outline" size="sm" className="min-h-10 shrink-0 border-destructive text-destructive hover:bg-destructive-soft sm:min-h-8" disabled={busy} onClick={() => setDeleteOpen(true)}>
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />Delete vault
                      </Button>
                    </div>
                  </SettingRow>
                </SettingsSection>
              )}
            </div>
          )}
        </div>
      </div>

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
          if (!confirmExitFocus.current?.isConnected) {
            confirmExitFocus.current = settingsMainRef.current?.querySelector<HTMLElement>("#vault-description") ?? null;
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
        title={`Let everyone edit "${name}"?`}
        variant="destructive"
        description={
          <span className="flex items-start gap-2">
            <AlertTriangle
              className="mt-0.5 h-4 w-4 shrink-0 text-destructive"
              aria-hidden
            />
            <span>
              Anyone signed in to this AKB will be able to add, edit, and delete
              content, even if they aren’t a member. You can change this setting
              later.
            </span>
          </span>
        }
        confirmLabel="Allow editing for everyone"
        onConfirm={() => doSave("access")}
      />

      <DeleteVaultDialog
        open={verified && deleteOpen}
        onOpenChange={setDeleteOpen}
        vault={name}
        inventory={{ documents: info?.document_count, tables: info?.table_count, files: info?.file_count }}
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
  disabled,
  statusRef,
  onSave,
  onDiscard,
}: {
  dirty: boolean;
  saving: boolean;
  saved: boolean;
  disabled: boolean;
  statusRef: RefObject<HTMLSpanElement | null>;
  onSave: () => void;
  onDiscard: () => void;
}) {
  if (!dirty && !saving && !saved) return null;
  return (
    <div className="mt-3 flex min-h-10 flex-wrap items-center gap-2">
      {(dirty || saving) && <Button
        type="button"
        size="sm"
        onClick={onSave}
        loading={saving}
        disabled={!dirty || disabled}
        className="min-h-10 sm:min-h-8"
      >
        {!saving && <Save className="h-3.5 w-3.5" aria-hidden />}
        {saving ? "Saving…" : "Save changes"}
      </Button>}
      {dirty && !saving && (
        <Button type="button" variant="outline" size="sm" onClick={onDiscard} disabled={disabled} className="min-h-10 sm:min-h-8">
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

function SettingsLoadingState() {
  return (
    <div role="status" aria-label="Loading vault settings" className="space-y-8">
      {[0, 1, 2].map(index => (
        <div key={index} aria-hidden className="space-y-4">
          <div className="h-5 w-28 animate-pulse rounded-[var(--radius-sm)] bg-surface-2" />
          <div className="h-px bg-border" />
          <div className="h-24 max-w-4xl animate-pulse rounded-[var(--radius-sm)] bg-surface-2" />
        </div>
      ))}
    </div>
  );
}
