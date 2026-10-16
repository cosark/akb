import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, type NavigateOptions } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { BookOpen, History, RotateCcw, Save } from "lucide-react";
import { AgentPreview } from "./agent-preview";
import { MarkdownRender } from "@/components/markdown-render";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { LoadingState } from "@/components/ui/loading-state";
import { SkillBadge } from "@/components/ui/skill-badge";
import { Panel } from "@/components/ui/panel";
import { WorkspaceSectionHeader } from "@/components/ui/workspace-section-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { authSessionSnapshot, getSkillTemplate, isCurrentAuthSession, updateDocument } from "@/lib/api";
import { VAULT_SKILL_PATH } from "@/lib/skill";
import { timeAgo } from "@/lib/utils";
import { useResourceNavigation, useResourceNavigationGuard } from "@/contexts/resource-navigation-context";
import { useDocumentHistoryGuard } from "@/hooks/use-document-history-guard";
import { useAccessVerification, useCurrentUser } from "@/contexts/current-user-context";

interface SkillDoc {
  content?: string;
  updated_at?: string;
  current_commit?: string | null;
}

interface Props {
  vault: string;
  /** The canonical doc from the settings page's skillQuery. */
  doc?: SkillDoc | null;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  /** External-git mirror vaults never carry a vault guide (backend excludes
   *  them from the seed and the reservation backfill). */
  isMirror?: boolean;
  /** Owner-authorized management capability. Read surfaces remain visible. */
  canManage: boolean;
  queryKey?: readonly unknown[];
  /** A containing workspace can protect all its drafts with one confirmation. */
  navigationManaged?: boolean;
  onDraftStateChange?: (state: { dirty: boolean; saving: boolean }) => void;
}

/**
 * The one editing surface for the vault guide. The document viewer bounces the
 * canonical path here, so preview / agent view / edit / reset / history all
 * live in this section.
 *
 * The body editor is deliberately body-only rather than the document page's
 * FrontmatterEditDialog: that dialog PATCHes `type` along with the body, and
 * `skill` is no longer in DOC_TYPES, so it would send `type: "note"` and the
 * backend's pinned-type guard would reject the save. Title/type/tags on this
 * doc are system-managed anyway.
 */
export function SkillSection({
  vault,
  doc,
  loading,
  error,
  onRetry,
  isMirror,
  canManage,
  queryKey = ["document", vault, VAULT_SKILL_PATH],
  navigationManaged = false,
  onDraftStateChange,
}: Props) {
  const { checking } = useAccessVerification();
  const user = useCurrentUser();
  const ownerScope = JSON.stringify([vault, user?.user_id]);
  const latestScope = useRef(ownerScope);
  latestScope.current = ownerScope;
  const latestChecking = useRef(checking);
  latestChecking.current = checking;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const { requestNavigation } = useResourceNavigation();
  const [tab, setTab] = useState("preview");
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveConflict, setSaveConflict] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [baseCommit, setBaseCommit] = useState<string | null>(null);
  const [baseBody, setBaseBody] = useState<string | null>(null);
  const [resetBaseCommit, setResetBaseCommit] = useState<string | null>(null);
  const [pendingExit, setPendingExit] = useState<
    { kind: "cancel" } | { kind: "navigation"; href: string; options?: NavigateOptions } | { kind: "history"; proceed: () => void } | null
  >(null);
  const dirty = baseBody !== null && draft !== baseBody;
  useEffect(() => { onDraftStateChange?.({ dirty, saving }); }, [dirty, saving, onDraftStateChange]);
  const changedElsewhere = dirty && baseCommit !== (doc?.current_commit || null);
  const guardNavigation = useCallback((href: string, options?: NavigateOptions) => {
    // Settings categories retain this mounted editor and its draft.
    if (new URL(href, window.location.origin).pathname === location.pathname) return true;
    setPendingExit({ kind: "navigation", href, options });
    return false;
  }, [location.pathname]);
  const continueNavigation = useResourceNavigationGuard(!navigationManaged && (dirty || saving) ? guardNavigation : null);
  useDocumentHistoryGuard(!navigationManaged && (dirty || saving), (proceed) => setPendingExit({ kind: "history", proceed }));
  useEffect(() => {
    if (!dirty && !saving) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty, saving]);

  function invalidate() {
    queryClient.invalidateQueries({
      queryKey: ["document", vault, VAULT_SKILL_PATH],
    });
    queryClient.invalidateQueries({ queryKey: ["vault-skill-preview", vault] });
  }

  // Read tabs do not own the draft. A dirty buffer keeps its original revision
  // pin even when a background read discovers another writer's changes.
  function selectTab(next: string) {
    if (next === "edit" && !dirty && !saving) {
      setDraft(doc?.content || "");
      setBaseBody(doc?.content || "");
      setBaseCommit(doc?.current_commit || null);
      setSaveError("");
      setSaveConflict(false);
    }
    setTab(next);
  }

  function discardDraft() {
    setDraft("");
    setBaseBody(null);
    setBaseCommit(null);
    setSaveError("");
    setSaveConflict(false);
  }

  function confirmExit() {
    if (!pendingExit || saving) return;
    discardDraft();
    setTab("preview");
    if (pendingExit.kind === "navigation") continueNavigation(() => navigate(pendingExit.href, pendingExit.options));
    else if (pendingExit.kind === "history") pendingExit.proceed();
  }

  async function handleSave() {
    if (!canManage || checking) return;
    const scope = ownerScope;
    const session = authSessionSnapshot();
    const currentOperation = () => mounted.current && latestScope.current === scope && isCurrentAuthSession(session);
    setSaving(true);
    setSaveError("");
    setSaveConflict(false);
    try {
      const saved = await updateDocument(vault, VAULT_SKILL_PATH, {
        content: draft,
        expected_commit: baseCommit || undefined,
      });
      if (!currentOperation()) return;
      queryClient.setQueryData(queryKey, {
        ...doc,
        content: draft,
        current_commit: saved.current_commit ?? saved.commit_hash ?? doc?.current_commit,
      });
      discardDraft();
      invalidate();
      setTab("preview");
    } catch (e: unknown) {
      if (!currentOperation()) return;
      const message = e instanceof Error ? e.message : "Save failed";
      if (/^current_commit moved:/i.test(message)) {
        // Keep the local buffer and stale OCC pin intact: silently rebasing a
        // full-body save would overwrite the other editor's changes. Refresh
        // the read surfaces so History points at the newest commit instead.
        invalidate();
        setSaveConflict(true);
        setSaveError(
          "The guide changed in another session. Your draft is still here and was not saved. Copy it and compare with History. Cancel and discard only when you are ready to start from the latest version.",
        );
      } else {
        setSaveError(message);
      }
    } finally {
      if (mounted.current) setSaving(false);
    }
  }

  // Reset rejects on failure; the ConfirmDialog catches it and renders the
  // error inside the open dialog (one place), so the section keeps no error
  // state of its own for this path.
  async function handleReset() {
    if (!canManage || checking) return;
    const scope = ownerScope;
    const session = authSessionSnapshot();
    const currentOperation = () => mounted.current && latestScope.current === scope && isCurrentAuthSession(session);
    const template = await getSkillTemplate();
    if (!currentOperation() || latestChecking.current) return;
    const content = template.replaceAll("{vault}", vault);
    await updateDocument(vault, VAULT_SKILL_PATH, {
      content,
      expected_commit: resetBaseCommit || undefined,
    });
    if (!currentOperation()) return;
    discardDraft();
    setTab("preview");
    queryClient.invalidateQueries({
      queryKey: ["document", vault, VAULT_SKILL_PATH],
    });
    queryClient.invalidateQueries({ queryKey: ["vault-skill-preview", vault] });
  }

  return (
    <section id="skill" aria-labelledby="skill-h" className="scroll-mt-6">
      <WorkspaceSectionHeader
        id="skill-h"
        icon={BookOpen}
        title="Vault guide"
        description="The operating instructions injected into every agent session for this vault."
        tone="guide"
      />

      <Panel variant="workspace" className="border-border-strong">
        <div className="p-4">
          {error && !isMirror && (
            <Alert variant="destructive" title="Couldn't load the vault guide" className="mb-4">
              <p>{error}</p>
              {onRetry && <Button variant="outline" size="sm" className="mt-2" onClick={onRetry}>Retry</Button>}
            </Alert>
          )}
          {isMirror ? (
            <Alert variant="info">
              Read-only mirror vaults don't carry a vault guide. Edit the guide
              in the external git repository that owns this content instead.
            </Alert>
          ) : loading ? (
            <LoadingState label="Loading vault guide">
              <Skeleton className="h-40 w-full rounded-[var(--radius-lg)]" />
            </LoadingState>
          ) : !doc && error ? null : !doc ? (
            <Alert variant="warning">
              The vault guide is missing. It is restored automatically by the
              system backfill; contact an administrator if this persists.
            </Alert>
          ) : (
            <>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
                <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs">
                  <SkillBadge defined />
                  <span className="text-foreground-muted">
                    {doc.updated_at
                      ? `Updated ${timeAgo(doc.updated_at)}`
                      : "Update time unavailable"}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {doc.current_commit && (
                    <Button asChild variant="ghost" size="sm">
                      <Link
                        to={`/vault/${vault}/doc/${encodeURIComponent(VAULT_SKILL_PATH)}?commit=${doc.current_commit}`}
                        onClick={(event) => {
                          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                          if (!requestNavigation(`/vault/${vault}/doc/${encodeURIComponent(VAULT_SKILL_PATH)}?commit=${doc.current_commit}`)) event.preventDefault();
                        }}
                      >
                        <History className="h-3.5 w-3.5" aria-hidden />
                        History
                      </Link>
                    </Button>
                  )}
                  {canManage && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-destructive text-destructive hover:bg-destructive-soft"
                      disabled={saving}
                      onClick={() => {
                        setResetBaseCommit(doc.current_commit || null);
                        setResetOpen(true);
                      }}
                    >
                      <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                      Reset to template
                    </Button>
                  )}
                </div>
              </div>

              {dirty && <p role="status" className="mb-3 text-sm text-foreground-muted">Unsaved guide changes are kept while you switch views.</p>}

              <Tabs value={tab} onValueChange={selectTab}>
                <TabsList className="max-w-full overflow-x-auto">
                  <TabsTrigger value="preview">Preview</TabsTrigger>
                  <TabsTrigger value="agent">Agent view</TabsTrigger>
                  {canManage && <TabsTrigger value="edit">Edit</TabsTrigger>}
                </TabsList>

                <TabsContent value="preview" className="mx-auto w-full max-w-5xl">
                  <div className="min-w-0 bg-surface py-4">
                    <MarkdownRender
                      markdown={doc.content || ""}
                      assetContext={{
                        mode: "authenticated",
                        vault,
                        document: VAULT_SKILL_PATH,
                        commit: doc.current_commit || undefined,
                      }}
                    />
                  </div>
                </TabsContent>

                <TabsContent value="agent" className="mx-auto w-full max-w-5xl">
                  <p className="mb-3 max-w-prose text-xs leading-relaxed text-foreground-muted">
                    This is the server-composed payload an agent receives, not
                    merely the stored markdown document.
                  </p>
                  <AgentPreview vault={vault} />
                </TabsContent>

                {canManage && (
                  <TabsContent value="edit" className="mx-auto w-full max-w-5xl">
                    <Textarea
                      aria-label="Vault guide body"
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      disabled={saving}
                      rows={20}
                      placeholder="Markdown body of the vault guide."
                      className="resize-y font-mono text-xs leading-relaxed"
                      spellCheck={false}
                    />
                    {(saveError || changedElsewhere) && (
                      <Alert
                        variant={saveConflict || changedElsewhere ? "warning" : "destructive"}
                        title={
                          saveConflict || changedElsewhere ? "Guide changed elsewhere" : undefined
                        }
                        className="mt-3"
                      >
                        {saveError || "The saved guide changed while you were editing. Your draft and original revision are preserved; compare with History before saving."}
                      </Alert>
                    )}
                    <div className="mt-3 flex items-center gap-3">
                      <Button
                        variant="accent"
                        onClick={handleSave}
                        loading={saving}
                        disabled={!dirty}
                      >
                        {!saving && <Save className="h-4 w-4" aria-hidden />}
                        {saving ? "Saving…" : "Save guide"}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => {
                          if (dirty) setPendingExit({ kind: "cancel" });
                          else { discardDraft(); setTab("preview"); }
                        }}
                        disabled={saving}
                      >
                        Cancel
                      </Button>
                    </div>
                  </TabsContent>
                )}
              </Tabs>
            </>
          )}
        </div>
      </Panel>

      <ConfirmDialog
        open={!checking && pendingExit !== null}
        onOpenChange={(open) => { if (!open) setPendingExit(null); }}
        title="Discard unsaved guide changes?"
        description={saving ? "Wait for the guide save to finish before leaving." : "Your unsaved guide draft will be discarded."}
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        variant="destructive"
        busy={saving}
        onConfirm={confirmExit}
      />

      <ConfirmDialog
        open={!checking && resetOpen}
        onOpenChange={setResetOpen}
        title="Reset to template?"
        description="Replace current content and any unsaved draft with the AKB-default template? Previous content stays in version history."
        confirmLabel="Reset"
        variant="destructive"
        onConfirm={handleReset}
      />
    </section>
  );
}
