import {
  useEffect,
  useId,
  useRef,
  useState,
  type DragEvent,
  type RefObject,
} from "react";
import { FileUp, FolderOpen, Paperclip } from "lucide-react";
import {
  uploadVaultFile,
  VaultFileUploadUncertainError,
  authSessionSnapshot,
  isCurrentAuthSession,
  type AuthSessionSnapshot,
  type FileUploadStage,
  type VaultFileUploadResult,
} from "@/lib/api";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useAccessVerification, useCurrentUser } from "@/contexts/current-user-context";

const STAGE_LABELS: Record<FileUploadStage, string> = {
  preparing: "Preparing upload…",
  uploading: "Uploading file…",
  confirming: "Finalizing file…",
};

interface FileUploadDialogProps {
  open: boolean;
  visible?: boolean;
  onOpenChange: (open: boolean) => void;
  vault: string;
  initialCollection?: string;
  onUploaded: (file: VaultFileUploadResult) => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
}

export function FileUploadDialog(props: FileUploadDialogProps) {
  const user = useCurrentUser();
  const { checking } = useAccessVerification();
  const session = authSessionSnapshot();
  // Foreground proof is a visibility boundary, not a new upload owner. Keep
  // the job outside the temporarily unmounted DialogContent so a file-picker
  // focus cycle cannot discard a File, a pending result, or Check upload ref.
  return <FileUploadForm key={JSON.stringify([props.vault, user?.user_id, session.generation])} {...props} accessChecking={checking} session={session} />;
}

function FileUploadForm({
  open,
  visible = true,
  onOpenChange,
  vault,
  initialCollection = "",
  onUploaded,
  returnFocusRef,
  accessChecking,
  session,
}: FileUploadDialogProps & { accessChecking: boolean; session: AuthSessionSnapshot }) {
  const active = useRef(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = `vault-file-input-${useId()}`;
  const [file, setFile] = useState<File | null>(null);
  const [collection, setCollection] = useState("");
  const [description, setDescription] = useState("");
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [stage, setStage] = useState<FileUploadStage>("preparing");
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState<VaultFileUploadUncertainError | null>(null);
  const [completed, setCompleted] = useState<VaultFileUploadResult | null>(null);
  const delivered = useRef<VaultFileUploadResult | null>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  useEffect(() => {
    if (wasOpen.current === open) return;
    wasOpen.current = open;
    if (open) {
      setCollection(initialCollection.trim());
      return;
    }
    setFile(null);
    setCollection("");
    setDescription("");
    setDragging(false);
    setStage("preparing");
    setError("");
    setUncertain(null);
    setCompleted(null);
    delivered.current = null;
  }, [open, initialCollection]);

  useEffect(() => {
    if (!open || !visible || accessChecking || !completed || delivered.current === completed ||
        !active.current || !isCurrentAuthSession(session)) return;
    delivered.current = completed;
    onUploaded(completed);
    onOpenChange(false);
  }, [open, visible, accessChecking, completed, session, onUploaded, onOpenChange]);

  function choose(next: File | null) {
    if (!next || !isCurrentAuthSession(session)) return;
    setFile(next);
    setError("");
  }

  function handleDrop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    setDragging(false);
    choose(event.dataTransfer.files?.[0] ?? null);
  }

  async function submit() {
    if (!file || uploading || completed || !visible || accessChecking || !isCurrentAuthSession(session)) return;
    setUploading(true);
    setError("");
    try {
      const uploaded = uncertain
        ? await uncertain.checkUpload()
        : await uploadVaultFile(vault, file, {
            collection,
            description,
            onStageChange: (next) => { if (active.current) setStage(next); },
          });
      if (!active.current || !isCurrentAuthSession(session)) return;
      setCompleted(uploaded);
    } catch (caught: unknown) {
      if (!active.current) return;
      if (caught instanceof VaultFileUploadUncertainError) setUncertain(caught);
      setError(
        caught instanceof Error
          ? caught.message
          : "The file could not be uploaded. Check the file and try again.",
      );
    } finally {
      if (active.current) setUploading(false);
    }
  }

  return (
    <>
    {/* The native picker may return after its focus event starts proof. Keep
        its element/listener owned with the job, not the hidden dialog portal. */}
    <input
      ref={inputRef}
      id={inputId}
      type="file"
      className="hidden"
      tabIndex={-1}
      disabled={uploading || Boolean(uncertain)}
      onChange={(event) => {
        choose(event.target.files?.[0] ?? null);
        event.target.value = "";
      }}
    />
    <Dialog open={open && visible && !accessChecking} onOpenChange={(next) => !uploading && !accessChecking && visible && onOpenChange(next)}>
      <DialogContent
        className="flex max-w-2xl flex-col gap-0 overflow-hidden p-0"
        onEscapeKeyDown={(event) => uploading && event.preventDefault()}
        onPointerDownOutside={(event) => uploading && event.preventDefault()}
        onCloseAutoFocus={(event) => {
          if (!returnFocusRef?.current) return;
          event.preventDefault();
          returnFocusRef.current.focus();
        }}
      >
        <DialogHeader className="shrink-0 border-b border-border px-6 py-5 pr-14">
          <DialogTitle className="flex items-center gap-2">
            <FileUp className="h-5 w-5 text-primary" aria-hidden />
            Upload a file
          </DialogTitle>
          <DialogDescription>
            Store an original file in {vault}. It will appear beside documents
            and tables in the Vault explorer.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 space-y-4 overflow-y-auto p-6">
          <div>
            <Label className="mb-1.5 block" htmlFor={inputId}>
              File <span className="text-foreground-muted">*</span>
            </Label>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              onDragEnter={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              disabled={uploading || Boolean(uncertain)}
              className={cn(
                "flex min-h-28 w-full items-center gap-4 rounded-[var(--radius-lg)] border border-dashed px-4 py-4 text-left transition-token",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
                "disabled:cursor-not-allowed disabled:opacity-50",
                dragging
                  ? "border-primary bg-surface-selected"
                  : "border-border-strong bg-background hover:bg-surface-hover",
              )}
            >
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-surface-selected text-surface-selected-foreground">
                {file ? (
                  <Paperclip className="h-5 w-5" aria-hidden />
                ) : (
                  <FileUp className="h-5 w-5" aria-hidden />
                )}
              </span>
              <span className="min-w-0">
                {file ? (
                  <>
                    <span className="block truncate text-sm font-semibold text-foreground">
                      {file.name}
                    </span>
                    <span className="mt-1 block text-xs text-foreground-muted">
                      {formatBytes(file.size)} · Click or drop another file to replace
                    </span>
                  </>
                ) : (
                  <>
                    <span className="block text-sm font-semibold text-foreground">
                      Choose a file or drop it here
                    </span>
                    <span className="mt-1 block text-xs text-foreground-muted">
                      Any file type supported by your browser can be stored.
                    </span>
                  </>
                )}
              </span>
            </button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="file-collection" className="mb-1.5 block">
                Collection <span className="text-foreground-muted">(optional)</span>
              </Label>
              <div className="relative">
                <FolderOpen
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-muted"
                  aria-hidden
                />
                <Input
                  id="file-collection"
                  value={collection}
                  onChange={(event) => setCollection(event.target.value)}
                  placeholder="research/notes"
                  className="pl-9"
                  disabled={uploading || Boolean(uncertain)}
                />
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-foreground-muted">
                Leave empty to place it at the Vault root.
              </p>
            </div>
            <div>
              <Label htmlFor="file-description" className="mb-1.5 block">
                Description <span className="text-foreground-muted">(optional)</span>
              </Label>
              <Textarea
                id="file-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="What this file contains"
                rows={2}
                disabled={uploading || Boolean(uncertain)}
                className="min-h-10 resize-none"
              />
            </div>
          </div>

          {error && (
            <Alert variant="destructive" title={uncertain ? "Upload confirmation unavailable" : "Upload failed"}>
              {error}
            </Alert>
          )}
          {uploading && (
            <p role="status" aria-live="polite" className="text-sm text-foreground-muted">
              {STAGE_LABELS[stage]}
            </p>
          )}
        </div>

        <DialogFooter className="shrink-0 border-t border-border bg-surface-2 px-6 py-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={uploading}
          >
            {uncertain ? "Close" : "Cancel"}
          </Button>
          <Button
            type="button"
            variant="accent"
            onClick={() => void submit()}
            loading={uploading}
            disabled={!file}
          >
            {!uploading && <FileUp className="h-4 w-4" aria-hidden />}
            {uploading ? STAGE_LABELS[stage] : uncertain ? "Check upload" : "Upload file"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}
